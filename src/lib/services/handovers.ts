import "server-only";
import { col, fromData, fromSnap, toData } from "@/lib/db";
import { badRequest, conflict, notFound } from "@/lib/api/errors";
import { requirePatientAccess } from "@/lib/auth/access";
import type { CurrentUser } from "@/lib/auth/session";
import { can } from "@/lib/domain/permissions";
import { buildHandover, HANDOVER_CHANGE_ACTIONS, REQUIRES_LABEL, summaryToText, type HandoverItem, type SummaryLine } from "@/lib/domain/handover";
import type { Action } from "@/lib/domain/permissions";
import type { Membership, Role } from "@/lib/domain/types";
import { summarizeHandover } from "@/lib/ai/handover/summarizer";
import { consumeQuota } from "@/lib/ai/usage";
import { audit } from "./audit";
import { logActivity } from "./care-activity";
import { listAppointments } from "./appointments";
import { listDocuments } from "./documents";
import { listDoses } from "./doses";
import { createNotificationOnce } from "./notifications";
import { listExtractions } from "./prescriptions";
import { listTasks } from "./care-tasks";

export interface Handover {
  id: string;
  patientId: string;
  createdByUid: string;
  createdByName: string;
  createdByRole: Role;
  createdAt: Date;
  periodStart: Date;
  periodEnd: Date;
  periodHours: number;
  items: HandoverItem[];
  /** Kinds of information the author could not see, so the reader knows what is NOT covered. */
  omitted: string[];
  summaryLines: SummaryLine[];
  summaryText: string;
  summarySource: "ai" | "template";
  modelIdentifier: string | null;
  promptVersion: string | null;
  /** The author's own words, shown separately from the generated summary. */
  note: string;
  status: "draft" | "shared";
  recipientUid: string | null;
  recipientName: string | null;
  sharedAt: Date | null;
  acknowledgedAt: Date | null;
  acknowledgedByUid: string | null;
  sourceEventIds: string[];
  lastActivity: { text: string; at: Date } | null;
}

export const PERIOD_OPTIONS_HOURS = [8, 12, 24, 48, 72] as const;
const handovers = (patientId: string) => col.sub(patientId, "careHandovers");

async function memberNames(patientId: string) {
  const snap = await col.sub(patientId, "memberships").get();
  return new Map(snap.docs.map((d) => [d.id, fromData<Membership>(d.data()).displayName]));
}

/** Gathers ONLY what this user may see (every read goes through the permissioned services). */
async function gather(user: CurrentUser, patientId: string, periodHours: number) {
  const { patient, membership } = await requirePatientAccess(user.uid, patientId, "handovers:write");
  const now = new Date();
  const periodStart = new Date(now.getTime() - periodHours * 3600_000);
  const names = await memberNames(patientId);
  const ok = (a: Action) => can(membership, a);

  const [doses, upcoming, appointments, tasks, documents, prescriptions, audits, activity] = await Promise.all([
    ok("doses:viewHistory") ? listDoses(user, patientId, { from: periodStart, to: new Date(now.getTime() + 8 * 3600_000), limit: 500 }) : null,
    ok("doses:read") ? listDoses(user, patientId, { from: now, to: new Date(now.getTime() + 8 * 3600_000), limit: 50 }) : null,
    ok("appointments:read") ? listAppointments(user, patientId, { scope: "upcoming", to: new Date(now.getTime() + 7 * 86400_000) }) : null,
    ok("tasks:read") ? listTasks(user, patientId, { filter: "all" }) : null,
    ok("documents:read") ? listDocuments(user, patientId) : null,
    ok("medications:write") ? listExtractions(user, patientId) : null,
    col.sub(patientId, "auditEvents").where("at", ">=", periodStart).get(),
    col.sub(patientId, "careActivity").where("at", ">=", periodStart).get(),
  ]);

  const auditRows = audits.docs.map((d) => ({ id: d.id, ...(d.data() as { action: string; actorUid: string | null; at: unknown }) })).map((a) => ({ ...a, at: fromData<{ at: Date }>({ at: a.at }).at }));
  const changes = auditRows
    .filter((a) => HANDOVER_CHANGE_ACTIONS.includes(a.action) && a.actorUid)
    .map((a): { id: string; action: string; actorName: string; at: Date; requires: Action } => ({
      id: a.id, action: a.action, actorName: names.get(a.actorUid!) ?? "A family member", at: a.at,
      requires: a.action.startsWith("appointment") ? "appointments:read" : a.action.startsWith("document") ? "documents:read" : "medications:read",
    }))
    // The author can only report changes in areas they themselves can see.
    .filter((c) => ok(c.requires));

  const built = buildHandover({
    now, periodStart, timezone: patient.timezone,
    doses, upcomingDoses: upcoming, appointments, tasks,
    documents: documents?.map((d) => ({ id: d.id, title: d.title, category: d.category, createdAt: d.createdAt, uploadedByName: d.uploadedByName })) ?? null,
    prescriptions: prescriptions ? prescriptions.filter((p) => p.status === "review_required").map((p) => ({ id: p.id, medicineCount: p.reviewedMedications.length, createdAt: p.createdAt })) : null,
    changes,
  });

  // Last human activity from either feed (never the system's own events).
  const acts = [
    ...auditRows.filter((a) => a.actorUid && a.action !== "handover.create").map((a) => ({ at: a.at, uid: a.actorUid!, what: a.action })),
    ...activity.docs.map((d) => fromData<{ at: Date; actorUid: string | null }>(d.data())).filter((a) => a.actorUid).map((a) => ({ at: a.at, uid: a.actorUid!, what: "care activity" })),
  ].sort((a, b) => +b.at - +a.at);
  const last = acts[0];
  const lastActivity = last ? { text: `Last activity by ${names.get(last.uid) ?? "a family member"}`, at: last.at } : null;
  return { patient, membership, now, periodStart, ...built, lastActivity };
}

async function summarize(patientId: string, user: CurrentUser, items: HandoverItem[], useAi: boolean) {
  if (!useAi) return summarizeHandover(items, { ai: false });
  await consumeQuota(patientId, user.uid, "handover");
  return summarizeHandover(items);
}

/** Creates a private draft from real records. Replaces the author's earlier unshared draft. */
export async function prepareHandover(user: CurrentUser, patientId: string, opts: { periodHours?: number; useAi?: boolean } = {}) {
  const periodHours = opts.periodHours ?? 24;
  if (!(PERIOD_OPTIONS_HOURS as readonly number[]).includes(periodHours)) throw badRequest("Choose 8, 12, 24, 48 or 72 hours.");
  const g = await gather(user, patientId, periodHours);
  const summary = await summarize(patientId, user, g.items, opts.useAi ?? true);

  const old = await handovers(patientId).where("createdByUid", "==", user.uid).get();
  for (const d of old.docs) if ((d.data() as { status?: string }).status === "draft") await d.ref.delete();

  const ref = handovers(patientId).doc();
  const h: Handover = {
    id: ref.id, patientId,
    createdByUid: user.uid, createdByName: user.displayName, createdByRole: g.membership.role,
    createdAt: g.now, periodStart: g.periodStart, periodEnd: g.now, periodHours,
    items: g.items, omitted: g.omitted,
    summaryLines: summary.lines, summaryText: summaryToText(summary.lines), summarySource: summary.source,
    modelIdentifier: summary.model, promptVersion: summary.promptVersion,
    note: "", status: "draft",
    recipientUid: null, recipientName: null, sharedAt: null, acknowledgedAt: null, acknowledgedByUid: null,
    sourceEventIds: [...new Set(g.items.map((i) => i.sourceId.split(":")[0]))],
    lastActivity: g.lastActivity,
  };
  await ref.set(toData(h));
  await audit(patientId, user.uid, "handover.create", { type: "careHandover", id: ref.id }, { periodHours, items: g.items.length });
  return h;
}

async function loadOwnDraft(user: CurrentUser, patientId: string, id: string) {
  await requirePatientAccess(user.uid, patientId, "handovers:write");
  const h = fromSnap<Handover>(await handovers(patientId).doc(id).get());
  if (!h || h.createdByUid !== user.uid) throw notFound("That handover");
  if (h.status !== "draft") throw conflict("This handover was already shared and can no longer be changed.");
  return h;
}

export async function updateDraftNote(user: CurrentUser, patientId: string, id: string, note: string) {
  const h = await loadOwnDraft(user, patientId, id);
  await handovers(patientId).doc(id).update({ note: note.trim().slice(0, 1000) });
  return { ...h, note: note.trim().slice(0, 1000) };
}

/** Rebuilds the draft from current records (new activity since it was prepared is included). */
export async function refreshDraft(user: CurrentUser, patientId: string, id: string) {
  const h = await loadOwnDraft(user, patientId, id);
  const fresh = await prepareHandover(user, patientId, { periodHours: h.periodHours });
  await handovers(patientId).doc(fresh.id).update({ note: h.note });
  return { ...fresh, note: h.note };
}

export async function shareHandover(user: CurrentUser, patientId: string, id: string, recipientUid: string) {
  const { patient } = await requirePatientAccess(user.uid, patientId, "handovers:write");
  const h = await loadOwnDraft(user, patientId, id);
  if (recipientUid === user.uid) throw badRequest("Choose someone else to hand over to.");
  const m = fromSnap<Membership>(await col.sub(patientId, "memberships").doc(recipientUid).get());
  if (!m || m.status !== "active" || !can(m, "handovers:read")) {
    throw badRequest("That person cannot receive handovers. Choose someone in the care circle who can see care tasks.");
  }
  // The recipient must be allowed to see EVERYTHING in the handover. Sharing never widens anyone's access.
  const lacking = [...new Set(h.items.filter((i) => !can(m, i.requires)).map((i) => REQUIRES_LABEL[i.requires] ?? i.requires))];
  if (lacking.length) throw badRequest(`${m.displayName} cannot see ${lacking.join(" or ")}, which this handover includes. Ask a primary caregiver to share it with them, or pick someone else.`);

  const now = new Date();
  await handovers(patientId).doc(id).update({ status: "shared", recipientUid, recipientName: m.displayName, sharedAt: now });
  await audit(patientId, user.uid, "handover.share", { type: "careHandover", id }, { recipient: recipientUid });
  await logActivity(patientId, { category: "handover", type: "handover_shared", actorUid: user.uid, actorName: user.displayName, summary: `${user.displayName} handed over care to ${m.displayName}.`, resourceType: "careHandover", resourceId: id });
  await createNotificationOnce({
    id: `handover_${id}_${recipientUid}`,
    patient, recipient: { uid: m.uid, role: m.role, email: m.email },
    type: "handover_shared", title: "A care handover is waiting for you", body: `${user.displayName} shared a handover. Please read and acknowledge it.`,
    resourceId: id, stage: "shared", payload: { kind: "care", patientName: patient.fullName }, now,
  });
  return { ...h, status: "shared" as const, recipientUid, recipientName: m.displayName, sharedAt: now };
}

export async function acknowledgeHandover(user: CurrentUser, patientId: string, id: string) {
  await requirePatientAccess(user.uid, patientId, "handovers:read");
  const ref = handovers(patientId).doc(id);
  const h = fromSnap<Handover>(await ref.get());
  if (!h || h.status !== "shared" || h.recipientUid !== user.uid) throw notFound("That handover");
  if (h.acknowledgedAt) return h; // idempotent
  const now = new Date();
  await ref.update({ acknowledgedAt: now, acknowledgedByUid: user.uid });
  await audit(patientId, user.uid, "handover.acknowledge", { type: "careHandover", id });
  await logActivity(patientId, { category: "handover", type: "handover_acknowledged", actorUid: user.uid, actorName: user.displayName, summary: `${user.displayName} acknowledged the handover from ${h.createdByName}.`, resourceType: "careHandover", resourceId: id });
  return { ...h, acknowledgedAt: now, acknowledgedByUid: user.uid };
}

export async function deleteDraft(user: CurrentUser, patientId: string, id: string) {
  await loadOwnDraft(user, patientId, id);
  await handovers(patientId).doc(id).delete();
  await audit(patientId, user.uid, "handover.delete", { type: "careHandover", id });
}

/** Visible to: the author (own drafts and shared), the recipient (shared), and primary caregivers (shared, for oversight). */
function canSee(membership: Membership, uid: string, h: Handover) {
  if (h.createdByUid === uid) return true;
  if (h.status !== "shared") return false;
  return h.recipientUid === uid || membership.role === "primary_caregiver";
}

export async function listHandovers(user: CurrentUser, patientId: string) {
  const { membership } = await requirePatientAccess(user.uid, patientId, "handovers:read");
  const snap = await handovers(patientId).orderBy("createdAt", "desc").limit(100).get();
  return snap.docs
    .map((d) => ({ ...fromData<Handover>(d.data()), id: d.id }))
    .filter((h) => canSee(membership, user.uid, h))
    .map(({ items: _i, summaryLines: _l, ...rest }) => {
      void _i; void _l;
      return rest;
    });
}

/**
 * Re-checks what a reader may see NOW (access can be reduced after sharing).
 * Items they no longer may see, and summary lines that rely on them, are removed.
 */
function forReader(membership: Membership, uid: string, h: Handover): Handover {
  if (h.createdByUid === uid || membership.role === "primary_caregiver") return h;
  const hidden = new Set(h.items.filter((i) => !can(membership, i.requires)).map((i) => i.id));
  if (!hidden.size) return h;
  const lines = h.summaryLines.filter((l) => !l.refs.some((r) => hidden.has(r)));
  return { ...h, items: h.items.filter((i) => !hidden.has(i.id)), summaryLines: lines, summaryText: summaryToText(lines), omitted: [...h.omitted, "some items you no longer have access to"] };
}

export async function getHandover(user: CurrentUser, patientId: string, id: string) {
  const { membership } = await requirePatientAccess(user.uid, patientId, "handovers:read");
  const h = fromSnap<Handover>(await handovers(patientId).doc(id).get());
  if (!h || !canSee(membership, user.uid, h)) throw notFound("That handover");
  return forReader(membership, user.uid, h);
}

