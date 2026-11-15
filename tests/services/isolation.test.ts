import { beforeEach, describe, expect, it } from "vitest";
import { createPatient, getPatientForUser, listPatientsForUser, updatePatient } from "@/lib/services/patients";
import { createMedication, listMedications } from "@/lib/services/medications";
import { createAppointment, listAppointments } from "@/lib/services/appointments";
import { listDoses, recordDoseEvent } from "@/lib/services/doses";
import { listDocuments } from "@/lib/services/documents";
import { listNotifications } from "@/lib/services/notifications";
import { getAuthorizedPatientContext } from "@/lib/services/patient-data";
import { HttpError } from "@/lib/api/errors";
import { ForbiddenError } from "@/lib/domain/permissions";
import { freshWorld, makeUser, MED_INPUT, PATIENT_INPUT } from "../helpers";

describe("cross-patient isolation", () => {
  let a: Awaited<ReturnType<typeof setup>>;
  async function setup() {
    const fake = freshWorld();
    const cgA = makeUser(fake, "cgA", "caregiver");
    const cgB = makeUser(fake, "cgB", "caregiver");
    const pA = await createPatient(cgA, PATIENT_INPUT);
    const pB = await createPatient(cgB, { ...PATIENT_INPUT, fullName: "Ravi Menon" });
    const medB = await createMedication(cgB, pB.id, MED_INPUT);
    return { fake, cgA, cgB, pA, pB, medB };
  }
  beforeEach(async () => { a = await setup(); });

  const expect404 = async (p: Promise<unknown>) => {
    await expect(p).rejects.toBeInstanceOf(HttpError);
    await expect(p).rejects.toMatchObject({ status: 404 });
  };

  it("a caregiver of patient A cannot read ANY of patient B's data", async () => {
    const { cgA, pB } = a;
    await expect404(getPatientForUser(cgA.uid, pB.id));
    await expect404(listMedications(cgA, pB.id));
    await expect404(listAppointments(cgA, pB.id));
    await expect404(listDoses(cgA, pB.id, {}));
    await expect404(listDocuments(cgA, pB.id));
    await expect404(listNotifications(cgA, pB.id));
    await expect404(getAuthorizedPatientContext(cgA, pB.id, ["medications", "doses"]));
  });

  it("a caregiver of patient A cannot write to patient B", async () => {
    const { cgA, pB } = a;
    await expect404(createMedication(cgA, pB.id, MED_INPUT));
    await expect404(createAppointment(cgA, pB.id, { doctorName: "Dr X", facility: null, date: "2027-01-01", time: "10:00", location: null, appointmentType: "Checkup", notes: null, reminderOffsetsMinutes: [60] }));
    await expect404(updatePatient(cgA, pB.id, { fullName: "Hijacked" }));
  });

  it("cannot respond to a dose of another patient even with a valid occurrence id", async () => {
    const { cgA, pB, fake } = a;
    const occId = [...fake.docs.keys()].find((k) => k.startsWith(`patients/${pB.id}/doseOccurrences/`))!.split("/").pop()!;
    await expect404(recordDoseEvent(cgA, pB.id, occId, { eventType: "reported_taken" }));
    // And using A's patient path with B's occurrence id finds nothing (ids are scoped per patient).
    await expect404(recordDoseEvent(cgA, a.pA.id, occId, { eventType: "reported_taken" }));
  });

  it("each user's patient list contains only their own patients", async () => {
    expect((await listPatientsForUser(a.cgA.uid)).map((x) => x.patient.fullName)).toEqual(["Asha Verma"]);
    expect((await listPatientsForUser(a.cgB.uid)).map((x) => x.patient.fullName)).toEqual(["Ravi Menon"]);
  });

  it("non-caregiver account types cannot create patient profiles", async () => {
    const fam = makeUser(a.fake, "fam", "family");
    await expect(createPatient(fam, PATIENT_INPUT)).rejects.toBeInstanceOf(ForbiddenError);
    const pat = makeUser(a.fake, "pat", "patient");
    await expect(createPatient(pat, PATIENT_INPUT)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
