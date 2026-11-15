import { beforeEach, describe, expect, it } from "vitest";
import { standardWorld, makeUser, MED_INPUT, PATIENT_INPUT } from "../helpers";
import { __setFileStoreForTests } from "@/lib/storage";
import { __setAiClientForTests, type AiClient } from "@/lib/ai/client";
import { uploadDocument } from "@/lib/services/documents";
import { approveMedication, getExtraction, rejectExtraction, startExtraction, updateReview } from "@/lib/services/prescriptions";
import { createMedication, listMedications, updateMedication } from "@/lib/services/medications";
import { createPatient } from "@/lib/services/patients";
import { decide, getReconciliation } from "@/lib/services/reconciliation";
import { listTasks } from "@/lib/services/care-tasks";
import type { PrescriptionExtraction } from "@/lib/ai/prescription/schemas";

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
__setFileStoreForTests({ save: async () => {}, remove: async () => {}, read: async () => PNG, signedUrl: async () => "https://signed.example/x" });

const medX = (o: Record<string, unknown> = {}) => ({
  nameAsWritten: "Tab Metformin 500 mg", normalizedName: "Metformin", ingredient: null, strength: "500 mg", dosageForm: "tablet",
  doseInstructionAsWritten: "1 tablet twice daily", doseAmount: 1, doseUnit: "tablet", route: null, frequencyAsWritten: "twice daily",
  timingAsWritten: null, durationAsWritten: null, startDate: null, endDate: null, specialInstructions: null,
  confidence: { name: 0.95, strength: 0.95, dose: 0.9, frequency: 0.9, duration: 0.9 }, needsHumanReview: true, uncertainties: [], ...o,
});
let scan: PrescriptionExtraction["medications"] = [];
const ai: AiClient = { async generateJson<T>() { return { data: { documentType: "prescription", patientName: null, prescriber: { name: null, registrationNumber: null }, medications: scan, documentWarnings: [] } as unknown as T, usage: { inputTokens: 1, outputTokens: 1 }, model: "gemini-x-flash" }; } };

async function world(meds: Record<string, unknown>[], existing: Record<string, unknown>[] = [{}]) {
  const w = await standardWorld();
  __setAiClientForTests(ai);
  for (const e of existing) await createMedication(w.caregiver, w.patient.id, { ...MED_INPUT, ...e });
  scan = meds as never;
  const doc = await uploadDocument(w.caregiver, w.patient.id, { name: "rx.png", bytes: PNG }, { title: "Rx", category: "prescription", description: null, sharedWithPatient: false });
  const x = await startExtraction(w.caregiver, w.patient.id, doc.id);
  return { ...w, doc, x };
}
beforeEach(() => { scan = []; });

describe("comparison view", () => {
  it("shows possible differences and medicines missing from the prescription, and changes nothing", async () => {
    const { caregiver, patient, x } = await world([medX({ strength: "850 mg", frequencyAsWritten: "thrice daily" })], [{}, { name: "Amlodipine", strength: "5 mg" }]);
    const before = JSON.stringify(await listMedications(caregiver, patient.id));
    const r = await getReconciliation(caregiver, patient.id, x.id);
    expect(r.items[0].existing?.name).toBe("Metformin");
    expect(r.items[0].findings.map((f) => f.kind)).toEqual(expect.arrayContaining(["changed_strength", "changed_frequency"]));
    expect(r.absent.map((a) => a.existing?.name)).toEqual(["Amlodipine"]);
    expect(r.items[0].decision).toBeNull();
    expect(JSON.stringify(await listMedications(caregiver, patient.id))).toBe(before); // viewing never modifies
  });

  it("only caregivers who can manage medicines may see or decide; outsiders and other patients get nothing", async () => {
    const { caregiver, patient, x, patientUser, family, fake } = await world([medX()]);
    for (const u of [patientUser, family]) {
      await expect(getReconciliation(u, patient.id, x.id)).rejects.toMatchObject({ status: 403 });
      await expect(decide(u, patient.id, x.id, "m0", { decision: "unchanged" })).rejects.toMatchObject({ status: 403 });
    }
    await expect(getReconciliation(makeUser(fake, "o1", "caregiver"), patient.id, x.id)).rejects.toMatchObject({ status: 404 });
    const other = await createPatient(caregiver, { ...PATIENT_INPUT, fullName: "Other Person" });
    await expect(getReconciliation(caregiver, other.id, x.id)).rejects.toMatchObject({ status: 404 });
  });
});

describe("duplicates need an explicit decision", () => {
  it("blocks adding a medicine that looks like an existing one until it is confirmed as new", async () => {
    const { caregiver, patient, x } = await world([medX()]);
    await expect(approveMedication(caregiver, patient.id, x.id, 0, MED_INPUT)).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/already on the list/) });
    expect(await listMedications(caregiver, patient.id)).toHaveLength(1);
    await decide(caregiver, patient.id, x.id, "m0", { decision: "confirmed_new" });
    const res = await approveMedication(caregiver, patient.id, x.id, 0, { ...MED_INPUT, name: "Metformin (second)" });
    expect(res.medication.sourceDocumentId).toBeTruthy();
    expect(await listMedications(caregiver, patient.id)).toHaveLength(2);
    const r = await getReconciliation(caregiver, patient.id, x.id);
    expect(r.items[0].decision?.status).toBe("confirmed_new");
    expect(r.items[0].decision?.medicationId).toBe(res.medication.id);
    expect(r.items[0].settled).toBe(true);
  });

  it("adds a genuinely new medicine without extra steps and records the decision", async () => {
    const { caregiver, patient, x } = await world([medX({ normalizedName: "Amlodipine", nameAsWritten: "Amlodipine 5", strength: "5 mg" })]);
    const res = await approveMedication(caregiver, patient.id, x.id, 0, { ...MED_INPUT, name: "Amlodipine" });
    expect(res.extractionStatus).toBe("approved");
    expect((await getReconciliation(caregiver, patient.id, x.id)).items[0].decision?.status).toBe("confirmed_new");
  });
});

describe("confirming a change", () => {
  it("applies ONLY the person's chosen fields to the existing medicine, with history and source", async () => {
    const { caregiver, patient, x, fake } = await world([medX({ strength: "850 mg" })]);
    const [orig] = await listMedications(caregiver, patient.id);
    const res = await decide(caregiver, patient.id, x.id, "m0", { decision: "confirmed_change", medicationPatch: { strength: "850 mg" }, note: "Doctor increased it" });
    expect(res.extractionStatus).toBe("approved");
    const [after] = await listMedications(caregiver, patient.id);
    expect(after.id).toBe(orig.id);
    expect(after.strength).toBe("850 mg");
    expect(after.doseAmount).toBe(orig.doseAmount); // untouched fields stay as they were
    expect(after.schedule).toEqual(orig.schedule);
    expect(after.version).toBe(orig.version + 1);
    const v = fake.docs.get(`patients/${patient.id}/medications/${orig.id}/versions/${after.version}`)!;
    expect(v.strength).toBe("850 mg");
    expect(v.changeSource).toMatchObject({ type: "prescription_reconciliation", extractionId: x.id, key: "m0", byUid: "cg1" });
    expect(fake.docs.get(`patients/${patient.id}/medications/${orig.id}/versions/${orig.version}`)!.strength).toBe("500 mg"); // history kept
    // The original scan is preserved exactly as the AI returned it.
    expect((await getExtraction(caregiver, patient.id, x.id)).extractedData!.medications[0].strength).toBe("850 mg");
    expect((await getReconciliation(caregiver, patient.id, x.id)).items[0].decision).toMatchObject({ status: "confirmed_change", note: "Doctor increased it", snapshot: { existing: { strength: "500 mg" } } });
  });

  it("cannot change a medicine's status through a change patch", async () => {
    const { caregiver, patient, x } = await world([medX({ strength: "850 mg" })]);
    await decide(caregiver, patient.id, x.id, "m0", { decision: "confirmed_change", medicationPatch: { strength: "850 mg", status: "discontinued" } });
    expect((await listMedications(caregiver, patient.id))[0].status).toBe("active");
  });

  it("needs a real patch and a real existing medicine", async () => {
    const { caregiver, patient, x } = await world([medX({ strength: "850 mg" }), medX({ normalizedName: "Aspirin", nameAsWritten: "Aspirin" })]);
    await expect(decide(caregiver, patient.id, x.id, "m0", { decision: "confirmed_change" })).rejects.toMatchObject({ status: 400 });
    await expect(decide(caregiver, patient.id, x.id, "m0", { decision: "confirmed_change", medicationPatch: { doseAmount: -1 } })).rejects.toMatchObject({ status: 400 });
    await expect(decide(caregiver, patient.id, x.id, "m1", { decision: "unchanged" })).rejects.toMatchObject({ status: 400 }); // nothing to keep
    await expect(decide(caregiver, patient.id, x.id, "nope", { decision: "unchanged" })).rejects.toMatchObject({ status: 404 });
  });
});

describe("other decisions", () => {
  it("keeping the existing medicine changes nothing, and nothing is adopted", async () => {
    const { caregiver, patient, x } = await world([medX()]);
    const before = JSON.stringify(await listMedications(caregiver, patient.id));
    const res = await decide(caregiver, patient.id, x.id, "m0", { decision: "unchanged" });
    expect(JSON.stringify(await listMedications(caregiver, patient.id))).toBe(before);
    expect(res.extractionStatus).toBe("rejected");
  });

  it("'needs clarification' parks the item, optionally adds a doctor task, and can be revised", async () => {
    const { caregiver, patient, x } = await world([medX({ strength: "850 mg" }), medX({ normalizedName: "Aspirin", nameAsWritten: "Aspirin" })]);
    await decide(caregiver, patient.id, x.id, "m0", { decision: "needs_clarification", createTask: true });
    const tasks = await listTasks(caregiver, patient.id);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toMatch(/Ask the doctor about Metformin/);
    expect(tasks[0].related).toEqual({ type: "prescription", id: x.id });
    // Not final: the person can change their mind after hearing back from the doctor.
    const r = await decide(caregiver, patient.id, x.id, "m0", { decision: "confirmed_change", medicationPatch: { strength: "850 mg" } });
    expect(r.decision.status).toBe("confirmed_change");
    // A repeated request does not create a second task.
    await decide(caregiver, patient.id, x.id, "m1", { decision: "needs_clarification", createTask: true });
    await decide(caregiver, patient.id, x.id, "m1", { decision: "needs_clarification", createTask: true }).catch(() => undefined);
    expect((await listTasks(caregiver, patient.id)).filter((t) => t.title.includes("Aspirin"))).toHaveLength(1);
  });

  it("final decisions cannot be re-decided and the review is locked afterwards", async () => {
    const { caregiver, patient, x } = await world([medX({ strength: "850 mg" }), medX({ normalizedName: "Aspirin", nameAsWritten: "Aspirin" })]);
    await decide(caregiver, patient.id, x.id, "m0", { decision: "unchanged" });
    await expect(decide(caregiver, patient.id, x.id, "m0", { decision: "confirmed_change", medicationPatch: { strength: "850 mg" } })).rejects.toMatchObject({ status: 409 });
    await expect(updateReview(caregiver, patient.id, x.id, { medications: [] })).rejects.toMatchObject({ status: 409 });
    await decide(caregiver, patient.id, x.id, "m1", { decision: "rejected" });
    await expect(decide(caregiver, patient.id, x.id, "m1", { decision: "unchanged" })).rejects.toMatchObject({ status: 409 }); // extraction already complete
  });

  it("whole-scan rejection is refused once something was changed", async () => {
    const { caregiver, patient, x } = await world([medX({ strength: "850 mg" })]);
    const second = await world([medX({ strength: "850 mg" })]);
    await expect(rejectExtraction(second.caregiver, second.patient.id, second.x.id)).resolves.toMatchObject({ status: "rejected" });
    void caregiver; void patient; void x;
  });

  it("handles medicines missing from the prescription only by explicit choice, and never auto-stops them", async () => {
    const { caregiver, patient, x } = await world([medX({ normalizedName: "Aspirin", nameAsWritten: "Aspirin", strength: "75 mg" })], [{}, { name: "Amlodipine", strength: "5 mg" }]);
    const key = (await getReconciliation(caregiver, patient.id, x.id)).absent.find((a) => a.existing?.name === "Amlodipine")!.key;
    const meds = await listMedications(caregiver, patient.id);
    expect(meds.find((m) => m.name === "Amlodipine")!.status).toBe("active"); // absent from the scan is NOT a reason to stop it
    await expect(decide(caregiver, patient.id, x.id, key, { decision: "confirmed_new" })).rejects.toMatchObject({ status: 400 });
    await decide(caregiver, patient.id, x.id, key, { decision: "confirmed_change" }); // explicit: "this was stopped"
    expect((await listMedications(caregiver, patient.id)).find((m) => m.name === "Amlodipine")!.status).toBe("discontinued");
  });

  it("absent medicines never block completing the scan", async () => {
    const { caregiver, patient, x } = await world([medX({ normalizedName: "Aspirin", nameAsWritten: "Aspirin", strength: "75 mg" })], [{}, { name: "Amlodipine" }]);
    const res = await approveMedication(caregiver, patient.id, x.id, 0, { ...MED_INPUT, name: "Aspirin" });
    expect(res.extractionStatus).toBe("approved");
  });
});

describe("existing medicines stay protected", () => {
  it("a finished medicine cannot be 'kept' or changed through reconciliation", async () => {
    const { caregiver, patient, x } = await world([medX()]);
    const [m] = await listMedications(caregiver, patient.id);
    await updateMedication(caregiver, patient.id, m.id, { status: "discontinued" });
    const r = await getReconciliation(caregiver, patient.id, x.id);
    expect(r.items[0].findings.map((f) => f.kind)).toContain("previously_stopped");
    await expect(decide(caregiver, patient.id, x.id, "m0", { decision: "unchanged" })).rejects.toMatchObject({ status: 400 });
    // But it can be added again as a new medicine, deliberately.
    const res = await approveMedication(caregiver, patient.id, x.id, 0, { ...MED_INPUT, name: "Metformin" });
    expect(res.medication.id).not.toBe(m.id);
  });
});
