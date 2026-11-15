import "server-only";
import { col, db, fromData, fromSnap, toData } from "@/lib/db";
import { badRequest, conflict, notFound } from "@/lib/api/errors";
import { requirePatientAccess } from "@/lib/auth/access";
import type { CurrentUser } from "@/lib/auth/session";
import { MAX_MESSAGE_CHARS } from "@/lib/ai/assistant/safety";
import { runAssistantTurn, type HistoryMessage } from "@/lib/ai/assistant/assistant";
import type { ProposedAction } from "@/lib/ai/assistant/tool-registry";
import { consumeQuota, recordUsage } from "@/lib/ai/usage";
import { fmtTime } from "@/lib/format";
import { audit } from "./audit";
import { recordDoseEvent, snoozeDose } from "./doses";

export interface Conversation {
  id: string;
  patientId: string;
  userId: string;
  status: "active";
  preferredLanguage: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
}
export interface AiMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: Date;
  /** Tool NAMES and outcomes only. Results are not stored (they duplicate health data). */
  toolCalls: { name: string; ok: boolean }[];
  pendingActionIds: string[];
  modelIdentifier: string | null;
  promptVersion: string | null;
  errorStatus: string | null;
}
export interface PendingAction {
  id: string;
  type: ProposedAction["type"];
  doseId: string;
  params: ProposedAction["params"];
  summary: string;
  status: "pending" | "confirmed" | "cancelled" | "failed" | "expired";
  createdAt: Date;
  expiresAt: Date;
}

const PENDING_TTL_MS = 10 * 60_000;
const convs = (patientId: string) => col.sub(patientId, "aiConversations");
const msgs = (patientId: string, cid: string) => convs(patientId).doc(cid).collection("messages");
const pend = (patientId: string, cid: string) => convs(patientId).doc(cid).collection("pendingActions");

/** Conversations are private to the user who started them, even within the same care circle. */
async function ownConversation(user: CurrentUser, patientId: string, cid: string) {
  await requirePatientAccess(user.uid, patientId, "patient:read");
  const c = fromSnap<Conversation>(await convs(patientId).doc(cid).get());
  if (!c || c.userId !== user.uid) throw notFound("That conversation");
  return c;
}

export async function listConversations(user: CurrentUser, patientId: string) {
  await requirePatientAccess(user.uid, patientId, "patient:read");
  const snap = await convs(patientId).where("userId", "==", user.uid).get();
  return snap.docs
    .map((d) => ({ ...fromData<Conversation>(d.data()), id: d.id }))
    .sort((a, b) => +b.updatedAt - +a.updatedAt)
    .slice(0, 30);
}

export async function getConversation(user: CurrentUser, patientId: string, cid: string) {
  const conversation = await ownConversation(user, patientId, cid);
  const [m, p] = await Promise.all([msgs(patientId, cid).orderBy("createdAt", "asc").limit(200).get(), pend(patientId, cid).get()]);
  const now = Date.now();
  return {
    conversation,
    messages: m.docs.map((d) => ({ ...fromData<AiMessage>(d.data()), id: d.id })),
    pendingActions: p.docs
      .map((d) => ({ ...fromData<PendingAction>(d.data()), id: d.id }))
      .map((a) => (a.status === "pending" && +a.expiresAt < now ? { ...a, status: "expired" as const } : a)),
  };
}

export async function deleteConversation(user: CurrentUser, patientId: string, cid: string) {
  await ownConversation(user, patientId, cid);
  for (const sub of [msgs(patientId, cid), pend(patientId, cid)]) {
    const snap = await sub.get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
  }
  await convs(patientId).doc(cid).delete();
  await audit(patientId, user.uid, "assistant.delete_conversation", { type: "aiConversation", id: cid });
}

async function addMessage(patientId: string, cid: string, m: Omit<AiMessage, "id" | "createdAt"> & { createdAt?: Date }) {
  const ref = msgs(patientId, cid).doc();
  await ref.set(toData({ ...m, id: ref.id, createdAt: m.createdAt ?? new Date() }));
  await convs(patientId).doc(cid).update({ updatedAt: new Date() });
  return ref.id;
}

export async function sendMessage(user: CurrentUser, patientId: string, input: { conversationId?: string; message: string }) {
  const { patient, membership } = await requirePatientAccess(user.uid, patientId, "patient:read");
  const text = input.message.trim();
  if (!text) throw badRequest("Type a question first.");
  if (text.length > MAX_MESSAGE_CHARS) throw badRequest(`Please keep your message under ${MAX_MESSAGE_CHARS} characters.`);

  let cid = input.conversationId;
  let history: HistoryMessage[] = [];
  if (cid) {
    await ownConversation(user, patientId, cid);
    const prev = await msgs(patientId, cid).orderBy("createdAt", "asc").limit(200).get();
    history = prev.docs.map((d) => fromData<AiMessage>(d.data())).map((m) => ({ role: m.role, content: m.content }));
  } else {
    const ref = convs(patientId).doc();
    const now = new Date();
    const c: Conversation = { id: ref.id, patientId, userId: user.uid, status: "active", preferredLanguage: patient.preferredLanguage, title: text.slice(0, 60), createdAt: now, updatedAt: now };
    await ref.set(toData(c));
    cid = ref.id;
  }

  await consumeQuota(patientId, user.uid, "assistant");
  await addMessage(patientId, cid, { role: "user", content: text, toolCalls: [], pendingActionIds: [], modelIdentifier: null, promptVersion: null, errorStatus: null });
  await audit(patientId, user.uid, "assistant.message", { type: "aiConversation", id: cid });

  try {
    const reply = await runAssistantTurn(
      { user, patientId, timezone: patient.timezone, now: new Date() },
      { role: membership.role, language: patient.preferredLanguage, history, message: text },
    );
    await recordUsage(patientId, user.uid, { inputTokens: reply.inputTokens, outputTokens: reply.outputTokens });
    const pendingIds: string[] = [];
    for (const p of reply.proposals) {
      const ref = pend(patientId, cid).doc();
      const now = new Date();
      const a: PendingAction = { id: ref.id, type: p.type, doseId: p.doseId, params: p.params, summary: p.summary, status: "pending", createdAt: now, expiresAt: new Date(+now + PENDING_TTL_MS) };
      await ref.set(toData(a));
      pendingIds.push(ref.id);
    }
    await addMessage(patientId, cid, { role: "assistant", content: reply.text, toolCalls: reply.toolsUsed, pendingActionIds: pendingIds, modelIdentifier: reply.model, promptVersion: reply.promptVersion, errorStatus: null });
  } catch (e) {
    await recordUsage(patientId, user.uid, null);
    const code = (e as { code?: string }).code ?? "internal";
    await addMessage(patientId, cid, { role: "assistant", content: "Sorry, I could not answer just now. Please try again in a moment.", toolCalls: [], pendingActionIds: [], modelIdentifier: null, promptVersion: null, errorStatus: code });
  }
  return getConversation(user, patientId, cid);
}

/**
 * The ONLY way an assistant suggestion becomes a change. Runs when the signed-in
 * user presses Confirm; the action executes through the same service as the
 * normal buttons, with that user's permissions re-checked.
 */
export async function resolvePendingAction(user: CurrentUser, patientId: string, cid: string, actionId: string, decision: "confirm" | "cancel") {
  const { patient } = await requirePatientAccess(user.uid, patientId, "patient:read");
  await ownConversation(user, patientId, cid);
  const ref = pend(patientId, cid).doc(actionId);

  const action = await db().runTransaction(async (tx) => {
    const t = tx as { get(r: unknown): Promise<{ exists: boolean; data(): unknown }>; update(r: unknown, d: unknown): void };
    const snap = await t.get(ref);
    if (!snap.exists) throw notFound("That action");
    const a = fromData<PendingAction>(snap.data());
    if (a.status !== "pending") throw conflict("That action was already handled.");
    if (+a.expiresAt < Date.now()) {
      t.update(ref, { status: "expired" });
      throw conflict("That request timed out. Please ask again.");
    }
    t.update(ref, { status: decision === "confirm" ? "confirmed" : "cancelled" });
    return { ...a, id: actionId };
  });

  if (decision === "cancel") {
    await audit(patientId, user.uid, "assistant.cancel", { type: "aiConversation", id: cid });
    await addMessage(patientId, cid, { role: "assistant", content: "Okay, I did not change anything.", toolCalls: [], pendingActionIds: [], modelIdentifier: null, promptVersion: null, errorStatus: null });
    return getConversation(user, patientId, cid);
  }

  try {
    let content: string;
    if (action.type === "snooze") {
      const r = await snoozeDose(user, patientId, action.doseId, action.params.minutes ?? 15, `ai-${actionId}`);
      const until = r.occurrence.snoozedUntil;
      content = `Done. I will remind you again at ${until ? fmtTime(until, patient.timezone) : "the new time"}.`;
    } else {
      const response = action.params.response ?? "unsure";
      const eventType = response === "taken" ? "reported_taken" : response === "skipped" ? "reported_skipped" : "reported_unsure";
      await recordDoseEvent(user, patientId, action.doseId, { eventType, clientEventId: `ai-${actionId}` });
      content = response === "taken" ? "Done. I saved that you reported taking it. This is your own report." : response === "skipped" ? "Done. I saved that you reported skipping it." : "Done. I saved that you are not sure.";
    }
    await audit(patientId, user.uid, "assistant.confirm", { type: "aiConversation", id: cid }, { action: action.type });
    await addMessage(patientId, cid, { role: "assistant", content, toolCalls: [], pendingActionIds: [], modelIdentifier: null, promptVersion: null, errorStatus: null });
  } catch (e) {
    await ref.update({ status: "failed" });
    const why = e instanceof Error && "status" in e ? e.message : "Something went wrong.";
    await addMessage(patientId, cid, { role: "assistant", content: `That did not work. ${why}`, toolCalls: [], pendingActionIds: [], modelIdentifier: null, promptVersion: null, errorStatus: "action_failed" });
  }
  return getConversation(user, patientId, cid);
}
