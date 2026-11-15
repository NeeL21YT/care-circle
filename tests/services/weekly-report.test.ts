import { describe, expect, it } from "vitest";
import { addMember, makeUser, standardWorld } from "../helpers";
import { createTask } from "@/lib/services/care-tasks";
import { taskCreateSchema } from "@/lib/domain/schemas";
import { checkinSchema } from "@/lib/domain/weekly-report";
import { getWeeklyReport, listMyCheckins, saveCheckin } from "@/lib/services/weekly-report";

type World = Awaited<ReturnType<typeof standardWorld>>;

async function addDose(fake: World["fake"], patientId: string, over: Record<string, unknown>) {
  const id = "dose_" + Math.random().toString(36).slice(2, 9);
  await fake.doc(`patients/${patientId}/doseOccurrences/${id}`).set({
    patientId, medicationId: "m1", medicationName: "Metformin", doseText: "1 tablet", instructions: null,
    scheduledAt: new Date(Date.now() - 3 * 3600_000), timezone: "Asia/Kolkata", status: "scheduled", gracePeriodMinutes: 30,
    notifiedAt: null, respondedAt: null, snoozedUntil: null, createdAt: new Date(), updatedAt: new Date(), ...over,
  });
}

async function world() {
  const w = await standardWorld();
  const manager = await addMember(w.fake, w.caregiver, w.patient.id, "sc1", "family", { tasks: true, manageCare: true, medications: true, adherence: true, appointments: true, documents: true });
  const noAdherence = await addMember(w.fake, w.caregiver, w.patient.id, "sc2", "family", { tasks: true, manageCare: true });
  const viewer = await addMember(w.fake, w.caregiver, w.patient.id, "vw1", "family", { tasks: true });
  return { ...w, manager, noAdherence, viewer };
}

describe("getWeeklyReport", () => {
  it("computes stats from real records", async () => {
    const { caregiver, patient, fake } = await world();
    for (let i = 0; i < 3; i++) await addDose(fake, patient.id, { status: "reported_taken", scheduledAt: new Date(Date.now() - (i + 2) * 3600_000) });
    await addDose(fake, patient.id, { status: "reported_skipped", scheduledAt: new Date(Date.now() - 30 * 3600_000) });
    await addDose(fake, patient.id, { status: "missed_by_policy", scheduledAt: new Date(Date.now() - 40 * 3600_000) });
    await createTask(caregiver, patient.id, taskCreateSchema.parse({ title: "Buy groceries" }));
    const r = await getWeeklyReport(caregiver, patient.id);
    expect(r.doses).toMatchObject({ scheduled: 5, reportedTaken: 3, reportedSkipped: 1, noReport: 1, adherencePercent: 60 });
    expect(r.sentences.join(" ")).toMatch(/3 were reported taken, 1 was reported skipped and 1 has no report yet/);
    expect(r.tasks).toMatchObject({ open: 1, unassigned: 1 });
    expect(r.attention.map((a) => a.id)).toEqual(expect.arrayContaining(["doses-no-report", "tasks-unassigned"]));
    expect(r.omitted).toEqual([]);
  });

  it("has null adherence when nothing was due", async () => {
    const { caregiver, patient } = await world();
    const r = await getWeeklyReport(caregiver, patient.id);
    expect(r.doses!.adherencePercent).toBeNull();
  });

  it("omits what the viewer may not see and says so", async () => {
    const { noAdherence, patient, fake } = await world();
    await addDose(fake, patient.id, { status: "reported_taken" });
    const r = await getWeeklyReport(noAdherence, patient.id);
    expect(r.doses).toBeNull();
    expect(r.omitted).toEqual(expect.arrayContaining(["medicine doses", "appointments", "documents", "prescription scans"]));
    expect(r.tasks).not.toBeNull();
  });

  it("enforces access", async () => {
    const { viewer, patientUser, patient, fake } = await world();
    for (const u of [viewer, patientUser]) await expect(getWeeklyReport(u, patient.id)).rejects.toMatchObject({ status: 403 });
    await expect(getWeeklyReport(makeUser(fake, "o1", "caregiver"), patient.id)).rejects.toMatchObject({ status: 404 });
  });
});

describe("check-ins", () => {
  const input = (level: "comfortable" | "somewhat_difficult" | "very_difficult", note = "") => checkinSchema.parse({ level, note });

  it("validates input", () => {
    expect(checkinSchema.safeParse({ level: "fine" }).success).toBe(false);
    expect(checkinSchema.safeParse({ level: "comfortable", note: "x".repeat(501) }).success).toBe(false);
  });

  it("upserts one check-in per week", async () => {
    const { caregiver, patient } = await world();
    const a = await saveCheckin(caregiver, patient.id, input("comfortable"));
    expect(a.id).toBe(`cg1_${a.weekKey}`);
    const b = await saveCheckin(caregiver, patient.id, input("very_difficult", "long week"));
    expect(b.id).toBe(a.id);
    const mine = await listMyCheckins(caregiver, patient.id);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ level: "very_difficult", note: "long week" });
  });

  it("never returns other people's check-ins, even to a primary caregiver", async () => {
    const { caregiver, manager, patient } = await world();
    await saveCheckin(manager, patient.id, input("very_difficult", "private"));
    expect(await listMyCheckins(caregiver, patient.id)).toEqual([]);
    expect(await listMyCheckins(manager, patient.id)).toHaveLength(1);
  });

  it("requires manage access to save", async () => {
    const { viewer, patient } = await world();
    await expect(saveCheckin(viewer, patient.id, input("comfortable"))).rejects.toMatchObject({ status: 403 });
  });

  it("keeps the note out of the audit trail", async () => {
    const { caregiver, patient, fake } = await world();
    await saveCheckin(caregiver, patient.id, input("somewhat_difficult", "SECRET-NOTE"));
    const snap = await fake.collection(`patients/${patient.id}/auditEvents`).get();
    const rows = snap.docs.map((d) => d.data() as Record<string, unknown>).filter((d) => d.action === "checkin.save");
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows[0])).not.toContain("SECRET-NOTE");
    expect(rows[0].resourceType).toBe("caregiverCheckin");
  });
});
