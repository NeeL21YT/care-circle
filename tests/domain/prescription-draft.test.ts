import { describe, expect, it } from "vitest";
import type { ExtractedMedication } from "@/lib/ai/prescription/schemas";
import { parseTimes, toChangePatch, toDraft, toExtracted, toMedicationInput, TIME_RE, type Draft } from "@/lib/client/prescription-draft";

const med = (over: Partial<ExtractedMedication> = {}): ExtractedMedication => ({
  nameAsWritten: "Metformin 500", normalizedName: null, ingredient: null, strength: null, dosageForm: null,
  doseInstructionAsWritten: null, doseAmount: null, doseUnit: null, route: null, frequencyAsWritten: null,
  timingAsWritten: null, durationAsWritten: null, startDate: null, endDate: null, specialInstructions: null,
  confidence: { name: 0.9, strength: 0.9, dose: 0.9, frequency: 0.9, duration: 0.9 }, needsHumanReview: false, uncertainties: [],
  ...over,
});
const draft = (over: Partial<Draft> = {}): Draft => ({ ...toDraft(med()), ...over });

describe("prescription draft", () => {
  it("leaves anything the scan could not read empty instead of defaulting it", () => {
    const d = toDraft(med());
    expect(d).toMatchObject({ name: "Metformin 500", strength: "", doseAmount: "", doseUnit: "", form: "", route: "", times: "", startDate: "", endDate: "" });
  });

  it("maps AI wording to the closest known option, case-insensitively, and drops unknown values", () => {
    const d = toDraft(med({ doseUnit: " MG ", dosageForm: "tablet", route: "by mouth" }));
    expect(d.doseUnit).toBe("mg");
    expect(d.form).toBe("Tablet");
    expect(d.route).toBe("");
  });

  it("prefers the normalized name when there is one", () => {
    expect(toDraft(med({ normalizedName: "Metformin" })).name).toBe("Metformin");
  });

  it("parses reminder times split by commas or spaces and ignores blanks", () => {
    expect(parseTimes("08:00, 20:00  14:30,")).toEqual(["08:00", "20:00", "14:30"]);
    expect(parseTimes("  ")).toEqual([]);
    expect(["08:00", "23:59", "00:00"].every((t) => TIME_RE.test(t))).toBe(true);
    expect(["24:00", "8:00", "08:60"].some((t) => TIME_RE.test(t))).toBe(false);
  });

  it("builds a daily or every-few-days schedule for approval", () => {
    expect(toMedicationInput(draft({ name: "A", doseAmount: "1", times: "08:00" })).schedule).toEqual({ frequency: "daily", times: ["08:00"] });
    expect(toMedicationInput(draft({ frequency: "every_n_days", intervalDays: "3", times: "09:00" })).schedule).toEqual({ frequency: "every_n_days", times: ["09:00"], intervalDays: 3 });
  });

  it("turns empty optional fields into null and an empty dose into 0 so the server rejects it", () => {
    const input = toMedicationInput(draft());
    expect(input).toMatchObject({ strength: null, endDate: null, instructions: null, doseAmount: 0, status: "active" });
  });

  it("saves a draft with only positive doses and null for blanks, keeping the original wording", () => {
    const m = med({ frequencyAsWritten: "twice daily" });
    const out = toExtracted(m, draft({ name: "Metformin", doseAmount: "0", strength: "500 mg" }));
    expect(out.doseAmount).toBeNull();
    expect(out.strength).toBe("500 mg");
    expect(out.normalizedName).toBe("Metformin");
    expect(out.nameAsWritten).toBe("Metformin 500");
    expect(out.frequencyAsWritten).toBe("twice daily");
  });

  it("applies only the filled-in fields to an existing medicine", () => {
    expect(toChangePatch(draft())).toEqual({});
    expect(toChangePatch(draft({ strength: " 850 mg ", doseAmount: "2", doseUnit: "tablet", times: "08:00 20:00" }))).toEqual({
      strength: "850 mg", doseAmount: 2, doseUnit: "tablet", schedule: { frequency: "daily", times: ["08:00", "20:00"] },
    });
  });

  it("never applies a schedule with an invalid time", () => {
    expect(toChangePatch(draft({ times: "08:00, 25:00" }))).not.toHaveProperty("schedule");
  });
});
