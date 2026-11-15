import { describe, expect, it } from "vitest";
import { standardWorld, addMember, makeUser, MED_INPUT, PATIENT_INPUT } from "../helpers";
import { appointmentInputSchema } from "@/lib/domain/schemas";
import { createAppointment } from "@/lib/services/appointments";
import { createMedication } from "@/lib/services/medications";
import { createPatient } from "@/lib/services/patients";
import { getDoctorBrief, updateBrief } from "@/lib/services/doctor-brief";
import { ForbiddenError } from "@/lib/domain/permissions";
import { HttpError } from "@/lib/api/errors";

const appt = (over: Record<string, unknown> = {}) => appointmentInputSchema.parse({ doctorName: "Dr Rao", facility: "City Clinic", date: "2026-12-01", time: "10:30", location: "Room 4", appointmentType: "Checkup", notes: null, reminderOffsetsMinutes: [60], ...over });

async function addDose(fake: Awaited<ReturnType<typeof standardWorld>>["fake"], patientId: string, over: Record<string, unknown>) {
  const id = "dose_" + Math.random().toString(36).slice(2, 9);
  await fake.doc(`patients/${patientId}/doseOccurrences/${id}`).set({
    patientId, medicationId: "m1", medicationName: "Metformin", doseText: "1 tablet", instructions: null,
    scheduledAt: new Date(Date.now() - 3 * 86400_000), timezone: "Asia/Kolkata", status: "scheduled", gracePeriodMinutes: 30,
    notifiedAt: null, respondedAt: null, snoozedUntil: null, createdAt: new Date(), updatedAt: new Date(), ...over,
  });
}

async function world() {
  const w = await standardWorld();
  const a = await createAppointment(w.caregiver, w.patient.id, appt());
  const manager = await addMember(w.fake, w.caregiver, w.patient.id, "mg1", "family", { tasks: true, manageCare: true, medications: true, adherence: true, appointments: true, documents: true });
  const limited = await addMember(w.fake, w.caregiver, w.patient.id, "lm1", "family", { appointments: true, medications: true, adherence: false, documents: false });
  const noAppt = await addMember(w.fake, w.caregiver, w.patient.id, "na1", "family", { appointments: false, medications: true });
  return { ...w, a, manager, limited, noAppt };
}

const ex = async (p: Promise<unknown>) => p.then(() => null, (e) => e as Error);

describe("getDoctorBrief", () => {
  it("builds the brief for the right patient and 404s for another patient's appointment", async () => {
    const { caregiver, patient, a, fake } = await world();
    const r = await getDoctorBrief(caregiver, patient.id, a.id);
    expect(r.brief.overview.fullName).toBe("Asha Verma");
    expect(r.brief.overview.doctor).toBe("Dr Rao");
    expect(r.brief.overview.location).toBe("Room 4");
    const other = await createPatient(caregiver, { ...PATIENT_INPUT, fullName: "Other Person" });
    const otherAppt = await createAppointment(caregiver, other.id, appt({ doctorName: "Dr Other" }));
    const err = await ex(getDoctorBrief(caregiver, patient.id, otherAppt.id));
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(404);
    expect(((await ex(updateBrief(caregiver, patient.id, otherAppt.id, { type: "addQuestion", text: "x" }))) as HttpError).status).toBe(404);
    expect(fake).toBeTruthy();
  });

  it("returns 404 to outsiders and to members who cannot read appointments", async () => {
    const { fake, patient, a, noAppt } = await world();
    const outsider = makeUser(fake, "out1", "family");
    expect(((await ex(getDoctorBrief(outsider, patient.id, a.id))) as HttpError).status).toBe(404);
    expect(await ex(getDoctorBrief(noAppt, patient.id, a.id))).toBeInstanceOf(ForbiddenError);
  });

  it("gates sections by permission", async () => {
    const { caregiver, patient, a, limited, manager, fake } = await world();
    await createMedication(caregiver, patient.id, MED_INPUT);
    await addDose(fake, patient.id, { status: "reported_skipped" });
    await fake.doc(`patients/${patient.id}/documents/d1`).set({ patientId: patient.id, title: "Blood test", category: "lab_report", storagePath: "x", sharedWithPatient: true, createdAt: new Date(), updatedAt: new Date() });
    const full = (await getDoctorBrief(manager, patient.id, a.id)).brief;
    expect(full.activity!.reportedSkipped).toBe(1);
    expect(full.documents!.items[0].title).toBe("Blood test");
    expect(full.medications!.current).toHaveLength(1);
    expect(full.medications!.awaitingVerification).toBeNull();
    const lim = (await getDoctorBrief(limited, patient.id, a.id)).brief;
    expect(lim.activity).toBeNull();
    expect(lim.documents).toBeNull();
    expect(lim.omitted).toEqual(expect.arrayContaining(["Medication activity", "Recent health documents"]));
    expect(lim.medications).not.toBeNull();
    const cg = (await getDoctorBrief(caregiver, patient.id, a.id)).brief;
    expect(cg.medications!.awaitingVerification).toBe(0);
    expect(cg.omitted).toEqual([]);
  });

  it("uses self-reported wording and never says a dose was taken", async () => {
    const { caregiver, patient, a, fake } = await world();
    await addDose(fake, patient.id, { status: "reported_taken" });
    await addDose(fake, patient.id, { status: "missed_by_policy", scheduledAt: new Date(Date.now() - 86400_000) });
    const b = (await getDoctorBrief(caregiver, patient.id, a.id)).brief;
    expect(b.activity!.label).toBe("Self-reported by the patient. Not verified.");
    expect(b.activity!.reportedTaken).toBe(1);
    expect(b.activity!.noReport).toBe(1);
    expect(JSON.stringify(b)).not.toMatch(/was taken/i);
  });

  it("handles no medications and no documents", async () => {
    const { caregiver, patient, a } = await world();
    const b = (await getDoctorBrief(caregiver, patient.id, a.id)).brief;
    expect(b.medications!.current).toEqual([]);
    expect(b.documents!.items).toEqual([]);
    expect(b.activity!.lines).toEqual([]);
  });

  it("reports edit rights: caregiver and manager yes, patient and limited family no", async () => {
    const { caregiver, patient, a, manager, patientUser, limited } = await world();
    expect((await getDoctorBrief(caregiver, patient.id, a.id)).canEdit).toBe(true);
    expect((await getDoctorBrief(manager, patient.id, a.id)).canEdit).toBe(true);
    expect((await getDoctorBrief(patientUser, patient.id, a.id)).canEdit).toBe(false);
    expect((await getDoctorBrief(limited, patient.id, a.id)).canEdit).toBe(false);
  });
});

describe("updateBrief", () => {
  it("adds, toggles and removes questions; everyone with access reads them", async () => {
    const { caregiver, patient, a, patientUser } = await world();
    const n = await updateBrief(caregiver, patient.id, a.id, { type: "addQuestion", text: "Should the dose change?" });
    const id = n.questions[0].id;
    expect(n.questions[0]).toMatchObject({ text: "Should the dose change?", done: false, addedByUid: "cg1" });
    expect((await updateBrief(caregiver, patient.id, a.id, { type: "toggleQuestion", id })).questions[0].done).toBe(true);
    expect((await getDoctorBrief(patientUser, patient.id, a.id)).brief.questions).toHaveLength(1);
    expect((await updateBrief(caregiver, patient.id, a.id, { type: "removeQuestion", id })).questions).toEqual([]);
    expect(((await ex(updateBrief(caregiver, patient.id, a.id, { type: "toggleQuestion", id }))) as HttpError).status).toBe(404);
  });

  it("forbids patients and family without manageCare from editing", async () => {
    const { patient, a, patientUser, limited } = await world();
    for (const u of [patientUser, limited]) {
      expect(await ex(updateBrief(u, patient.id, a.id, { type: "addQuestion", text: "x" }))).toBeInstanceOf(ForbiddenError);
      expect(await ex(updateBrief(u, patient.id, a.id, { type: "addObservation", text: "x" }))).toBeInstanceOf(ForbiddenError);
    }
  });

  it("enforces the 30 item caps", async () => {
    const { caregiver, patient, a } = await world();
    for (let i = 0; i < 30; i++) await updateBrief(caregiver, patient.id, a.id, { type: "addQuestion", text: `q${i}` });
    expect(((await ex(updateBrief(caregiver, patient.id, a.id, { type: "addQuestion", text: "one too many" }))) as HttpError).status).toBe(409);
    for (let i = 0; i < 30; i++) await updateBrief(caregiver, patient.id, a.id, { type: "addObservation", text: `o${i}` });
    expect(((await ex(updateBrief(caregiver, patient.id, a.id, { type: "addObservation", text: "too many" }))) as HttpError).status).toBe(409);
  });

  it("lets an observation be removed by its author or a primary caregiver only", async () => {
    const { caregiver, patient, a, manager, fake } = await world();
    const other = await addMember(fake, caregiver, patient.id, "mg2", "family", { tasks: true, manageCare: true, appointments: true });
    const n1 = await updateBrief(manager, patient.id, a.id, { type: "addObservation", text: "Seemed tired" });
    const n2 = await updateBrief(other, patient.id, a.id, { type: "addObservation", text: "Ate well" });
    const [o1, o2] = [n1.observations[0], n2.observations[1]];
    expect(o1).toMatchObject({ uid: "mg1", name: "User mg1" });
    expect(await ex(updateBrief(other, patient.id, a.id, { type: "removeObservation", id: o1.id }))).toBeInstanceOf(ForbiddenError);
    expect((await updateBrief(manager, patient.id, a.id, { type: "removeObservation", id: o1.id })).observations).toHaveLength(1);
    expect((await updateBrief(caregiver, patient.id, a.id, { type: "removeObservation", id: o2.id })).observations).toHaveLength(0);
  });

  it("shows observations in the brief as family-reported with the author", async () => {
    const { caregiver, patient, a, manager } = await world();
    await updateBrief(manager, patient.id, a.id, { type: "addObservation", text: "Seemed tired" });
    const o = (await getDoctorBrief(caregiver, patient.id, a.id)).brief.observations[0];
    expect(o).toMatchObject({ label: "Family-reported observation", name: "User mg1", text: "Seemed tired" });
  });

  it("audits edits without putting note text in the log", async () => {
    const { caregiver, patient, a, fake } = await world();
    await updateBrief(caregiver, patient.id, a.id, { type: "addObservation", text: "SECRET-NOTE-TEXT" });
    await updateBrief(caregiver, patient.id, a.id, { type: "addQuestion", text: "SECRET-QUESTION" });
    const snap = await fake.collection(`patients/${patient.id}/auditEvents`).get();
    const rows = snap.docs.map((d) => d.data() ?? {}).filter((r) => r.action === "brief.update");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ resourceType: "doctorBrief", resourceId: a.id });
    expect(JSON.stringify(rows)).not.toContain("SECRET");
  });
});
