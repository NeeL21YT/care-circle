import type { CareTask } from "@/lib/domain/types";
import { beforeEach, describe, expect, it } from "vitest";
import { standardWorld, addMember, makeUser, MED_INPUT, PATIENT_INPUT } from "../helpers";
import { __setAiClientForTests, type AiClient, type GenerateJsonRequest } from "@/lib/ai/client";
import { AiError } from "@/lib/ai/errors";
import { isGrounded, summarizeHandover } from "@/lib/ai/handover/summarizer";
import { buildHandover, type HandoverItem } from "@/lib/domain/handover";
import { createMedication } from "@/lib/services/medications";
import { createPatient } from "@/lib/services/patients";
import { createTask, setTaskStatus } from "@/lib/services/care-tasks";
import { taskCreateSchema } from "@/lib/domain/schemas";
import { acknowledgeHandover, getHandover, listHandovers, prepareHandover, refreshDraft, shareHandover, updateDraftNote } from "@/lib/services/handovers";
import { listActivity } from "@/lib/services/care-activity";
import { listNotifications } from "@/lib/services/notifications";
import { updateMemberPermissions } from "@/lib/services/care-circle";

type Lines = { text: string; refs: string[] }[];
let aiLines: (items: { id: string; fact: string }[]) => Lines = () => [];
let aiFails = false;
let aiCalls = 0;
const ai: AiClient = {
  async generateJson<T>(req: GenerateJsonRequest<T>) {
    aiCalls++;
    if (aiFails) throw new AiError("ai_timeout");
    const text = (req.parts[0] as { text: string }).text;
    const items = JSON.parse(text.slice(text.indexOf("["), text.lastIndexOf("]") + 1));
    return { data: { lines: aiLines(items) } as unknown as T, usage: { inputTokens: 1, outputTokens: 1 }, model: "gemini-x-flash" };
  },
};

const task = (over: Record<string, unknown> = {}) => taskCreateSchema.parse({ title: "Arrange transport", ...over });

/** Writes dose occurrences straight into the fake so we can test PAST doses. */
async function addDose(fake: Awaited<ReturnType<typeof standardWorld>>["fake"], patientId: string, over: Record<string, unknown>) {
  const id = "dose_" + Math.random().toString(36).slice(2, 9);
  await fake.doc(`patients/${patientId}/doseOccurrences/${id}`).set({
    patientId, medicationId: "m1", medicationName: "Metformin", doseText: "1 tablet, 500 mg", instructions: null,
    scheduledAt: new Date(Date.now() - 3 * 3600_000), timezone: "Asia/Kolkata", status: "scheduled", gracePeriodMinutes: 30,
    notifiedAt: null, respondedAt: null, snoozedUntil: null, createdAt: new Date(), updatedAt: new Date(), ...over,
  });
  return id;
}

async function world() {
  const w = await standardWorld();
  aiCalls = 0;
  aiFails = false;
  aiLines = (items) => items.map((i) => ({ text: i.fact, refs: [i.id] }));
  __setAiClientForTests(ai);
  const secondary = await addMember(w.fake, w.caregiver, w.patient.id, "sc1", "family", { tasks: true, manageCare: true, medications: true, adherence: true, appointments: true, documents: true });
  const viewer = await addMember(w.fake, w.caregiver, w.patient.id, "vw1", "family", { tasks: true }); // tasks only, no medicine/adherence access
  return { ...w, secondary, viewer };
}
beforeEach(() => __setAiClientForTests(ai));

describe("preparing a handover from real records", () => {
  it("aggregates doses, tasks and notes the author can see, and records its sources", async () => {
    const { caregiver, patient, fake, secondary } = await world();
    const taken = await addDose(fake, patient.id, { status: "reported_taken", respondedAt: new Date(Date.now() - 2.9 * 3600_000) });
    const open = await addDose(fake, patient.id, { status: "notified", scheduledAt: new Date(Date.now() - 1 * 3600_000) });
    const t = await createTask(caregiver, patient.id, task({ assignedToUid: "sc1" }));
    await setTaskStatus(secondary, patient.id, t.id, "accepted");
    const h = await prepareHandover(caregiver, patient.id);
    const sections = h.items.map((i) => i.section);
    expect(sections).toEqual(expect.arrayContaining(["medication_taken", "medication_unresolved", "tasks"]));
    expect(h.items.find((i) => i.section === "medication_unresolved")!.attention).toBe(true);
    expect(h.sourceEventIds).toEqual(expect.arrayContaining([taken, open, t.id]));
    expect(h.status).toBe("draft");
    expect(h.summarySource).toBe("ai");
    expect(h.summaryText).toMatch(/reported taken/);
    expect(h.lastActivity?.text).toMatch(/Last activity by/);
  });

  it("does not turn unresolved reminders into resolved ones, even if the AI tries", async () => {
    const { caregiver, patient, fake } = await world();
    await addDose(fake, patient.id, { status: "missed_by_policy" });
    aiLines = (items) => [{ text: "Everything was taken as planned.", refs: [items[0].id] }];
    const h = await prepareHandover(caregiver, patient.id);
    // The line cites a real item but the guard only checks numbers; the unresolved item must still be present as its own fact.
    expect(h.items[0].section).toBe("medication_unresolved");
    expect(h.summaryLines.some((l) => /no response was recorded/.test(l.text))).toBe(true);
  });

  it("works without any AI and says so", async () => {
    const { caregiver, patient, fake } = await world();
    await addDose(fake, patient.id, { status: "scheduled" });
    aiFails = true;
    const h = await prepareHandover(caregiver, patient.id);
    expect(h.summarySource).toBe("template");
    expect(h.summaryText).toMatch(/no response was recorded/);
    expect(h.modelIdentifier).toBeNull();
  });

  it("gives a truthful empty handover", async () => {
    const { caregiver, patient } = await world();
    const h = await prepareHandover(caregiver, patient.id);
    expect(h.items).toHaveLength(0);
    expect(h.summaryText).toMatch(/No activity or outstanding items/);
    expect(aiCalls).toBe(0); // nothing to summarize, so no model call
  });

  it("limits the content to what the author may see and says what is missing", async () => {
    const { patient, fake, secondary, caregiver } = await world();
    await addDose(fake, patient.id, { status: "scheduled" });
    await createMedication(caregiver, patient.id, { ...MED_INPUT });
    const h = await prepareHandover(secondary, patient.id);
    expect(h.omitted).toContain("prescriptions waiting to be checked"); // secondary cannot write medicines
    expect(h.items.some((i) => i.section === "medication_unresolved")).toBe(true);
  });

  it("only handover managers can prepare one", async () => {
    const { patient, viewer, patientUser, family, fake } = await world();
    for (const u of [viewer, patientUser, family]) await expect(prepareHandover(u, patient.id)).rejects.toMatchObject({ status: 403 });
    await expect(prepareHandover(makeUser(fake, "o1", "caregiver"), patient.id)).rejects.toMatchObject({ status: 404 });
  });

  it("rejects odd period lengths and enforces the daily quota", async () => {
    const { caregiver, patient } = await world();
    await expect(prepareHandover(caregiver, patient.id, { periodHours: 5 })).rejects.toMatchObject({ status: 400 });
    process.env.AI_DAILY_HANDOVER_SUMMARIES = "1";
    try {
      await prepareHandover(caregiver, patient.id);
      await expect(prepareHandover(caregiver, patient.id)).rejects.toMatchObject({ code: "ai_quota_exceeded" });
    } finally { delete process.env.AI_DAILY_HANDOVER_SUMMARIES; }
  });

  it("replaces the author's earlier unshared draft and keeps the note on refresh", async () => {
    const { caregiver, patient, fake } = await world();
    const a = await prepareHandover(caregiver, patient.id);
    await updateDraftNote(caregiver, patient.id, a.id, "Please check the evening tablets.");
    await addDose(fake, patient.id, { status: "scheduled" });
    const b = await refreshDraft(caregiver, patient.id, a.id);
    expect(b.note).toBe("Please check the evening tablets.");
    expect(b.items.length).toBeGreaterThan(0);
    expect((await listHandovers(caregiver, patient.id)).filter((h) => h.status === "draft")).toHaveLength(1);
  });
});

describe("summary guards", () => {
  const item = (id: string, text: string, attention = false): HandoverItem => ({ id, section: "tasks", requires: "tasks:read", text, at: null, attention, sourceId: id });

  it("rejects lines with unknown refs or invented numbers", () => {
    const byId = new Map([["t1", item("t1", 'Task "Call clinic": due 10:30 AM.')]]);
    expect(isGrounded({ text: "Call the clinic by 10:30 AM.", refs: ["t1"] }, byId)).toBe(true);
    expect(isGrounded({ text: "Call the clinic by 11:45 AM.", refs: ["t1"] }, byId)).toBe(false);
    expect(isGrounded({ text: "Something", refs: ["nope"] }, byId)).toBe(false);
    expect(isGrounded({ text: "Something", refs: [] }, byId)).toBe(false);
  });

  it("keeps status wording: rejects resolving or overstating rewrites, accepts faithful ones", () => {
    const mk = (section: HandoverItem["section"], text: string, attention: boolean): HandoverItem => ({ id: "x1", section, requires: "doses:viewHistory", text, at: null, attention, sourceId: "s" });
    const unresolved = new Map([["x1", mk("medication_unresolved", "Metformin (1 tablet) scheduled for Sun 15 Nov, 4:30 PM: no response was recorded.", true)]]);
    const ok = (t: string, m = unresolved) => isGrounded({ text: t, refs: ["x1"] }, m);
    expect(ok("The 4:30 PM Metformin has no response recorded yet.")).toBe(true);
    expect(ok("Metformin at 4:30 PM is still unresolved.")).toBe(true);
    expect(ok("Metformin at 4:30 PM was taken.")).toBe(false);
    expect(ok("Everything is fine with the 4:30 PM Metformin.")).toBe(false);
    expect(ok("Metformin at 4:30 PM: no response, this is urgent.")).toBe(false);
    const taken = new Map([["x1", mk("medication_taken", "Metformin (1 tablet) scheduled for 8:00 AM was reported taken at 8:15 AM. This is a self-report, not verified.", false)]]);
    expect(ok("Metformin was reported taken at 8:15 AM.", taken)).toBe(true);
    expect(ok("Metformin was taken at 8:15 AM.", taken)).toBe(false); // lost the self-report wording
    expect(ok("Metformin was verified as taken at 8:15 AM.", taken)).toBe(false);
  });

  it("drops ungrounded AI lines and re-adds any attention item the AI skipped", async () => {
    const items = buildHandover({
      now: new Date("2026-11-15T10:00:00Z"), periodStart: new Date("2026-11-14T10:00:00Z"), timezone: "Asia/Kolkata",
      doses: [], upcomingDoses: [], appointments: [], documents: [], prescriptions: [], changes: [],
      tasks: [
        { id: "a", title: "Overdue", dueAt: new Date("2026-11-15T08:00:00Z"), status: "pending", assignedToUid: "u", assignedToName: "Ravi", notes: [], createdAt: new Date("2026-11-14T12:00:00Z") },
        { id: "b", title: "Calm", dueAt: null, status: "accepted", assignedToUid: "u", assignedToName: "Ravi", notes: [], createdAt: new Date("2026-11-14T12:00:00Z") },
      ] as unknown as CareTask[],
    }).items;
    const calm = items.find((i) => i.sourceId === "b")!;
    aiLines = () => [{ text: "The calm task is fine.", refs: [calm.id] }, { text: "A made-up task due at 9:99.", refs: [calm.id] }];
    __setAiClientForTests(ai);
    const s = await summarizeHandover(items);
    expect(s.source).toBe("ai");
    expect(s.lines.map((l) => l.text)).not.toContain("A made-up task due at 9:99.");
    expect(s.lines.some((l) => /overdue/.test(l.text))).toBe(true); // attention item forced back in
  });
});

describe("sharing and acknowledging", () => {
  it("shares a draft with a recipient who can see everything in it, notifies once, and logs it", async () => {
    const { caregiver, patient, secondary } = await world();
    await createTask(caregiver, patient.id, task());
    const h = await prepareHandover(caregiver, patient.id);
    const shared = await shareHandover(caregiver, patient.id, h.id, "sc1");
    expect(shared.status).toBe("shared");
    expect((await listNotifications(secondary, patient.id)).filter((n) => n.type === "handover_shared")).toHaveLength(1);
    expect((await listActivity(caregiver, patient.id))[0].summary).toMatch(/handed over care to/);
    await expect(shareHandover(caregiver, patient.id, h.id, "sc1")).rejects.toMatchObject({ status: 409 }); // no re-share / edit after sharing
    await expect(updateDraftNote(caregiver, patient.id, h.id, "late edit")).rejects.toMatchObject({ status: 409 });
  });

  it("refuses to share with someone who cannot see part of the content", async () => {
    const { caregiver, patient, fake } = await world();
    await addDose(fake, patient.id, { status: "scheduled" });
    const h = await prepareHandover(caregiver, patient.id);
    await expect(shareHandover(caregiver, patient.id, h.id, "vw1")).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/cannot see reported medicine activity/) });
    await expect(shareHandover(caregiver, patient.id, h.id, "cg1")).rejects.toMatchObject({ status: 400 }); // not yourself
    await expect(shareHandover(caregiver, patient.id, h.id, "pt1")).rejects.toMatchObject({ status: 400 }); // patients do not receive handovers
    await expect(shareHandover(caregiver, patient.id, h.id, "ghost")).rejects.toMatchObject({ status: 400 });
  });

  it("only the recipient acknowledges, once, and it is recorded", async () => {
    const { caregiver, patient, secondary, viewer } = await world();
    const h = await prepareHandover(caregiver, patient.id);
    await shareHandover(caregiver, patient.id, h.id, "sc1");
    await expect(acknowledgeHandover(viewer, patient.id, h.id)).rejects.toMatchObject({ status: 404 });
    await expect(acknowledgeHandover(caregiver, patient.id, h.id)).rejects.toMatchObject({ status: 404 });
    const a = await acknowledgeHandover(secondary, patient.id, h.id);
    expect(a.acknowledgedByUid).toBe("sc1");
    const again = await acknowledgeHandover(secondary, patient.id, h.id);
    expect(again.acknowledgedAt).toEqual(a.acknowledgedAt);
    expect((await listActivity(caregiver, patient.id))[0].summary).toMatch(/acknowledged the handover/);
    expect((await getHandover(caregiver, patient.id, h.id)).acknowledgedAt).toBeTruthy();
  });

  it("keeps drafts private and shared handovers to author, recipient and the primary caregiver", async () => {
    const { caregiver, patient, secondary, viewer } = await world();
    const draft = await prepareHandover(secondary, patient.id);
    await expect(getHandover(caregiver, patient.id, draft.id)).rejects.toMatchObject({ status: 404 }); // even the primary cannot read others' drafts
    await shareHandover(secondary, patient.id, draft.id, "cg1");
    expect((await getHandover(caregiver, patient.id, draft.id)).id).toBe(draft.id);
    await expect(getHandover(viewer, patient.id, draft.id)).rejects.toMatchObject({ status: 404 });
    expect(await listHandovers(viewer, patient.id)).toEqual([]);
    expect((await listHandovers(caregiver, patient.id)).map((h) => h.id)).toEqual([draft.id]);
  });

  it("re-checks the recipient's access at read time", async () => {
    const { caregiver, patient, fake } = await world();
    await addDose(fake, patient.id, { status: "scheduled" });
    await createTask(caregiver, patient.id, task());
    const h = await prepareHandover(caregiver, patient.id);
    await shareHandover(caregiver, patient.id, h.id, "sc1");
    const secondary = makeUser(fake, "sc1", "family");
    expect((await getHandover(secondary, patient.id, h.id)).items.some((i) => i.section === "medication_unresolved")).toBe(true);
    await updateMemberPermissions(caregiver, patient.id, "sc1", { medications: true, adherence: false, appointments: true, documents: true, tasks: true, manageCare: true });
    const reduced = await getHandover(secondary, patient.id, h.id);
    expect(reduced.items.some((i) => i.section === "medication_unresolved")).toBe(false);
    expect(reduced.summaryText).not.toMatch(/no response was recorded/);
    expect(reduced.omitted).toContain("some items you no longer have access to");
  });

  it("never leaks across patients", async () => {
    const { caregiver, patient, fake } = await world();
    const other = await createPatient(caregiver, { ...PATIENT_INPUT, fullName: "Other Person" });
    const h = await prepareHandover(caregiver, patient.id);
    await expect(getHandover(caregiver, other.id, h.id)).rejects.toMatchObject({ status: 404 });
    const stranger = makeUser(fake, "x9", "caregiver");
    await expect(getHandover(stranger, patient.id, h.id)).rejects.toMatchObject({ status: 404 });
    // A task or dose in another patient's record never appears.
    await createTask(caregiver, other.id, task({ title: "Other patient's task" }));
    const again = await prepareHandover(caregiver, patient.id);
    expect(JSON.stringify(again.items)).not.toContain("Other patient's task");
  });
});
