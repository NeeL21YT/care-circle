import type { ExtractedMedication } from "@/lib/ai/prescription/schemas";

export const DOSE_UNITS = ["tablet", "capsule", "ml", "mg", "drop", "puff", "patch", "unit", "other"];
export const FORMS = ["Tablet", "Capsule", "Liquid", "Injection", "Drops", "Inhaler", "Patch", "Cream or ointment", "Other"];
export const ROUTES = ["Oral", "Topical", "Inhaled", "Injection", "Eye", "Ear", "Other"];
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const matchOption = (opts: string[], v: string | null) => opts.find((o) => o.toLowerCase() === (v ?? "").trim().toLowerCase()) ?? "";

/** What the caregiver is editing for one extracted medicine. Everything is a string, as typed. */
export interface Draft {
  name: string; strength: string; doseAmount: string; doseUnit: string; form: string; route: string;
  frequency: "daily" | "every_n_days"; intervalDays: string; times: string;
  startDate: string; endDate: string; instructions: string;
}

/** "08:00, 20:00" or "08:00 20:00" to a list. Not validated here; see TIME_RE. */
export const parseTimes = (text: string) => text.split(/[,\s]+/).filter(Boolean);

const scheduleOf = (d: Draft, times: string[]) =>
  d.frequency === "daily" ? { frequency: "daily", times } : { frequency: "every_n_days", times, intervalDays: Number(d.intervalDays) };

/** Missing values stay missing: nothing here is defaulted for the caregiver. */
export function toDraft(m: ExtractedMedication): Draft {
  return {
    name: m.normalizedName ?? m.nameAsWritten,
    strength: m.strength ?? "",
    doseAmount: m.doseAmount == null ? "" : String(m.doseAmount),
    doseUnit: matchOption(DOSE_UNITS, m.doseUnit),
    form: matchOption(FORMS, m.dosageForm),
    route: matchOption(ROUTES, m.route),
    frequency: "daily", intervalDays: "", times: "",
    startDate: m.startDate ?? "", endDate: m.endDate ?? "",
    instructions: m.specialInstructions ?? "",
  };
}

export function toMedicationInput(d: Draft) {
  const times = parseTimes(d.times);
  return {
    name: d.name,
    strength: d.strength || null,
    doseAmount: d.doseAmount === "" ? 0 : Number(d.doseAmount),
    doseUnit: d.doseUnit,
    form: d.form,
    route: d.route,
    schedule: scheduleOf(d, times),
    startDate: d.startDate,
    endDate: d.endDate || null,
    instructions: d.instructions || null,
    status: "active",
  };
}

export function toExtracted(m: ExtractedMedication, d: Draft): ExtractedMedication {
  return {
    ...m,
    normalizedName: d.name || null,
    strength: d.strength || null,
    doseAmount: d.doseAmount !== "" && Number(d.doseAmount) > 0 ? Number(d.doseAmount) : null,
    doseUnit: d.doseUnit || null,
    dosageForm: d.form || null,
    route: d.route || null,
    startDate: d.startDate || null,
    endDate: d.endDate || null,
    specialInstructions: d.instructions || null,
  };
}

/** Only the fields the person filled in are applied to the existing medicine; name and start date stay. */
export function toChangePatch(d: Draft) {
  const times = parseTimes(d.times);
  const patch: Record<string, unknown> = {};
  if (d.strength.trim()) patch.strength = d.strength.trim();
  if (d.doseAmount !== "" && Number(d.doseAmount) > 0) patch.doseAmount = Number(d.doseAmount);
  if (d.doseUnit) patch.doseUnit = d.doseUnit;
  if (d.form) patch.form = d.form;
  if (d.route) patch.route = d.route;
  if (d.endDate) patch.endDate = d.endDate;
  if (d.instructions.trim()) patch.instructions = d.instructions.trim();
  if (times.length && times.every((t) => TIME_RE.test(t))) patch.schedule = scheduleOf(d, times);
  return patch;
}
