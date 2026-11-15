import { describe, expect, it } from "vitest";
import { matchExisting, normalizeName, parseStrength, reconcile, similarity, timesPerDay } from "@/lib/domain/reconciliation";
import type { ExtractedMedication } from "@/lib/ai/prescription/schemas";
import type { Medication } from "@/lib/domain/types";

const inc = (o: Partial<ExtractedMedication> = {}): ExtractedMedication => ({
  nameAsWritten: "Tab Metformin 500 mg", normalizedName: "Metformin", ingredient: null, strength: "500 mg", dosageForm: "tablet",
  doseInstructionAsWritten: "1 tablet twice daily", doseAmount: 1, doseUnit: "tablet", route: null, frequencyAsWritten: "twice daily",
  timingAsWritten: null, durationAsWritten: null, startDate: null, endDate: null, specialInstructions: null,
  confidence: { name: 0.95, strength: 0.95, dose: 0.9, frequency: 0.9, duration: 0.9 }, needsHumanReview: true, uncertainties: [], ...o,
});
const med = (o: Partial<Medication> = {}): Medication => ({
  id: "med1", patientId: "p", name: "Metformin", activeIngredient: null, strength: "500 mg", doseAmount: 1, doseUnit: "tablet", form: "Tablet", route: "Oral",
  schedule: { frequency: "daily", times: ["08:00", "20:00"] }, startDate: "2026-01-01", endDate: null, prescriber: null, instructions: null, status: "active",
  sourceDocumentId: null, verificationStatus: "verified", verifiedByUid: "u", verifiedAt: new Date(), createdByUid: "u", createdAt: new Date(), updatedAt: new Date(), version: 1, ...o,
} as Medication);
const run = (incoming: ExtractedMedication[], existing: Medication[], today = "2026-11-15") => reconcile({ incoming, existing, documentType: "prescription", today });
const kinds = (r: ReturnType<typeof run>, i = 0) => r.items[i].findings.map((f) => f.kind);

describe("name matching", () => {
  it("normalizes forms, strengths and punctuation", () => {
    expect(normalizeName("Tab. Metformin 500mg SR")).toBe("metformin");
    expect(normalizeName("Syp Crocin 125 mg/5 ml")).toBe("crocin");
    expect(normalizeName(null)).toBe("");
  });
  it("matches exact, similar (typo) and by ingredient (brand vs generic), but not different medicines", () => {
    expect(matchExisting(inc(), [med()])?.by).toBe("name");
    expect(matchExisting(inc({ normalizedName: "Metformn", nameAsWritten: "Metformn" }), [med()])?.by).toBe("similar_name");
    expect(matchExisting(inc({ normalizedName: "Glycomet", nameAsWritten: "Glycomet 500", ingredient: "Metformin" }), [med()])?.by).toBe("ingredient");
    expect(matchExisting(inc({ normalizedName: "Amlodipine", nameAsWritten: "Amlodipine 5" }), [med()])).toBeNull();
    // Similar-sounding but different drugs must not be treated as the same without a person checking.
    expect(similarity("metformin", "methotrexate")).toBeLessThan(0.82);
  });
  it("prefers a medicine still on the list over a finished one", () => {
    const hit = matchExisting(inc(), [med({ id: "old", status: "discontinued" }), med({ id: "cur" })]);
    expect(hit?.med.id).toBe("cur");
  });
});

describe("strength and frequency parsing", () => {
  it("compares strengths across units", () => {
    expect(parseStrength("500 mg")).toEqual(parseStrength("0.5 g"));
    expect(parseStrength("500 mcg")).toEqual(parseStrength("0.5 mg"));
    expect(parseStrength("500 mg")).not.toEqual(parseStrength("850 mg"));
    expect(parseStrength("twice daily")).toBeNull();
  });
  it("reads common frequency wording and never guesses", () => {
    expect(timesPerDay("1-0-1")).toBe(2);
    expect(timesPerDay("1-1-1")).toBe(3);
    expect(timesPerDay("0-0-1")).toBe(1);
    expect(timesPerDay("BD after food")).toBe(2);
    expect(timesPerDay("twice daily")).toBe(2);
    expect(timesPerDay("thrice a day")).toBe(3);
    expect(timesPerDay("once daily")).toBe(1);
    expect(timesPerDay("at night")).toBeNull(); // unclear -> null, not 1
    expect(timesPerDay("every other day")).toBe("other");
    expect(timesPerDay("as needed")).toBe("other");
    expect(timesPerDay("")).toBeNull();
  });
});

describe("reconcile", () => {
  it("flags an identical medicine as a likely duplicate", () => {
    const r = run([inc()], [med()]);
    expect(kinds(r)).toContain("same_as_existing");
    expect(r.items[0].existing?.id).toBe("med1");
  });

  it("reports changed strength, dose and frequency as POSSIBLE differences, showing both values", () => {
    const r = run([inc({ strength: "850 mg", doseAmount: 2, frequencyAsWritten: "thrice daily" })], [med()]);
    const f = r.items[0].findings;
    expect(f.map((x) => x.kind)).toEqual(expect.arrayContaining(["changed_strength", "changed_dose", "changed_frequency"]));
    expect(f.find((x) => x.kind === "changed_strength")).toMatchObject({ existing: "500 mg", incoming: "850 mg" });
    expect(f.find((x) => x.kind === "changed_frequency")).toMatchObject({ existing: "2 times a day", incoming: "3 times a day" });
    expect(kinds(r)).not.toContain("same_as_existing");
    expect(f.map((x) => x.text).join(" ")).not.toMatch(/\berror|mistake|wrong|should (stop|start|take)\b/i);
  });

  it("does not compare unclear or non-daily frequencies; it says so instead", () => {
    const r = run([inc({ frequencyAsWritten: "at night", doseInstructionAsWritten: null })], [med()]);
    expect(kinds(r)).toContain("frequency_not_comparable");
    expect(kinds(r)).not.toContain("changed_frequency");
    const weekly = run([inc()], [med({ schedule: { frequency: "weekly", times: ["08:00"], daysOfWeek: [1] } })]);
    expect(kinds(weekly)).toContain("frequency_not_comparable");
  });

  it("treats a medicine not on the list as new, and flags unreadable names", () => {
    const r = run([inc({ normalizedName: null, nameAsWritten: "Syp ????", confidence: { name: 0.1, strength: 0, dose: 0.1, frequency: 0.1, duration: 0 }, doseAmount: null, strength: null, frequencyAsWritten: null, doseInstructionAsWritten: null })], [med()]);
    expect(kinds(r)).toEqual(expect.arrayContaining(["new_medication", "uncertain_identity", "missing_dose", "missing_frequency", "missing_strength", "low_confidence"]));
    expect(r.items[0].existing).toBeNull();
  });

  it("flags medicines that were stopped earlier", () => {
    const r = run([inc()], [med({ status: "discontinued" })]);
    expect(kinds(r)).toContain("previously_stopped");
    expect(kinds(r)).not.toContain("same_as_existing"); // restarting is not a duplicate
  });

  it("flags conflicting dates and a duplicate entry within the same prescription", () => {
    const r = run([inc({ startDate: "2026-12-01", endDate: "2026-11-20" }), inc({ endDate: "2026-01-01" })], []);
    expect(kinds(r, 0)).toContain("conflicting_dates");
    expect(kinds(r, 1)).toEqual(expect.arrayContaining(["conflicting_dates", "duplicate_in_prescription"]));
  });

  it("lists active medicines missing from the prescription without calling them stopped", () => {
    const r = run([inc()], [med(), med({ id: "med2", name: "Amlodipine" }), med({ id: "med3", name: "Old", status: "discontinued" })]);
    expect(r.absent.map((a) => a.existing!.id)).toEqual(["med2"]);
    const text = r.absent[0].findings[0].text;
    expect(text).toMatch(/Only the doctor can say/);
    expect(text).toMatch(/could mean/);
    expect(text).not.toMatch(/^"[^"]*" (was|has been|is) (stopped|discontinued)/);
    expect(r.absent[0].findings[0].attention).toBe(false);
  });

  it("does not list absent medicines when nothing was read from the prescription", () => {
    expect(run([], [med()]).absent).toEqual([]);
    expect(reconcile({ incoming: [inc()], existing: [med({ id: "x", name: "Other" })], documentType: "other", today: "2026-11-15" }).absent).toEqual([]);
  });

  it("has stable keys and never mutates its input", () => {
    const existing = [med()];
    const snapshot = JSON.stringify(existing);
    const r = run([inc(), inc({ normalizedName: "Aspirin", nameAsWritten: "Aspirin" })], existing);
    expect(r.items.map((i) => i.key)).toEqual(["m0", "m1"]);
    expect(JSON.stringify(existing)).toBe(snapshot);
  });
});

import { medicationUpdateSchema } from "@/lib/domain/schemas";
describe("partial medication updates", () => {
  it("leave omitted fields untouched and only clear fields that are explicitly emptied", () => {
    const only = medicationUpdateSchema.parse({ doseAmount: 2 });
    expect(only).toEqual({ doseAmount: 2 });
    expect("strength" in only).toBe(false);
    expect(medicationUpdateSchema.parse({ strength: "  " }).strength).toBeNull();
    expect(medicationUpdateSchema.parse({ instructions: null }).instructions).toBeNull();
    expect(medicationUpdateSchema.parse({ strength: " 850 mg " }).strength).toBe("850 mg");
  });
});
