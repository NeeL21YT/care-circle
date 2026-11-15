import type { ExtractedMedication } from "@/lib/ai/prescription/schemas";
import { LOW_CONFIDENCE } from "@/lib/ai/prescription/confidence";
import type { Medication } from "./types";

/**
 * Prescription reconciliation: compares a scanned prescription with the
 * medicines already on the list and reports POSSIBLE differences for a person
 * to review. It never decides which version is medically right, never changes
 * anything, and never fills in a missing value. Wording says "possible
 * difference", never "error" or "mistake".
 */
export const RECON_STATUSES = ["awaiting_review", "confirmed_change", "confirmed_new", "unchanged", "needs_clarification", "rejected"] as const;
export type ReconStatus = (typeof RECON_STATUSES)[number];

export const RECON_STATUS_LABEL: Record<ReconStatus, string> = {
  awaiting_review: "Waiting for your review",
  confirmed_change: "Confirmed as a change",
  confirmed_new: "Confirmed as a new medicine",
  unchanged: "Existing medicine stays as it is",
  needs_clarification: "Needs the doctor's clarification",
  rejected: "Rejected",
};

export type FindingKind =
  | "same_as_existing" | "possible_existing" | "same_ingredient" | "previously_stopped"
  | "changed_strength" | "changed_dose" | "changed_frequency" | "frequency_not_comparable"
  | "new_medication" | "duplicate_in_prescription"
  | "missing_dose" | "missing_frequency" | "missing_strength" | "low_confidence"
  | "conflicting_dates" | "uncertain_identity" | "not_on_prescription";

export interface Finding {
  kind: FindingKind;
  text: string;
  /** Needs a person's decision before anything is adopted. */
  attention: boolean;
  existing?: string | null;
  incoming?: string | null;
}

export interface MedSummary {
  id: string;
  name: string;
  strength: string | null;
  dose: string;
  frequency: string;
  status: string;
}

export interface ReconItem {
  /** Stable key used to store the review decision: "m0", "m1"... or "absent_<medicationId>". */
  key: string;
  index: number | null;
  incomingName: string | null;
  existing: MedSummary | null;
  matchedBy: "name" | "similar_name" | "ingredient" | null;
  findings: Finding[];
}

// ---------- name matching ----------
const FORM_WORDS = new Set(["tab", "tabs", "tablet", "tablets", "cap", "caps", "capsule", "capsules", "syp", "syrup", "inj", "injection", "drops", "susp", "suspension", "cream", "oint", "ointment", "gel", "sr", "er", "xr", "cr", "mr", "ds", "od", "forte"]);

/** Lower-case, no punctuation, no dosage-form words, no strength tokens. */
export function normalizeName(s: string | null | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/\b\d+(?:\.\d+)?\s*(?:mcg|µg|ug|mg|g|ml|iu|%|units?)\b/g, " ")
    .replace(/\b\d+(?:\.\d+)?\b/g, " ")
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !FORM_WORDS.has(w))
    .join(" ")
    .trim();
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}
export const similarity = (a: string, b: string) => (a || b ? 1 - levenshtein(a, b) / Math.max(a.length, b.length) : 0);

const SIMILAR_THRESHOLD = 0.82;

export function matchExisting(inc: ExtractedMedication, existing: Medication[]): { med: Medication; by: ReconItem["matchedBy"] } | null {
  const names = [inc.normalizedName, inc.nameAsWritten].map(normalizeName).filter(Boolean);
  const ing = normalizeName(inc.ingredient);
  // Prefer medicines that are still on the list over finished ones.
  const rank = (m: Medication) => (m.status === "discontinued" || m.status === "completed" ? 1 : 0);
  const pool = [...existing].sort((a, b) => rank(a) - rank(b));
  for (const m of pool) {
    const en = normalizeName(m.name);
    if (en && names.includes(en)) return { med: m, by: "name" };
  }
  for (const m of pool) {
    const ei = normalizeName(m.activeIngredient);
    if (ing && ei && ing === ei) return { med: m, by: "ingredient" };
    if (ing && normalizeName(m.name) === ing) return { med: m, by: "ingredient" };
  }
  let best: { med: Medication; score: number } | null = null;
  for (const m of pool) {
    const en = normalizeName(m.name);
    for (const n of names) {
      const sc = en && n ? similarity(en, n) : 0;
      if (sc >= SIMILAR_THRESHOLD && (!best || sc > best.score)) best = { med: m, score: sc };
    }
  }
  return best ? { med: best.med, by: "similar_name" } : null;
}

// ---------- strength / dose / frequency ----------
const UNIT_TO_MG: Record<string, number> = { mg: 1, g: 1000, mcg: 0.001, ug: 0.001, µg: 0.001 };

/** "500 mg" -> comparable value. Returns null if no recognizable strength. */
export function parseStrength(s: string | null | undefined): { value: number; unit: string } | null {
  const m = (s ?? "").toLowerCase().match(/(\d+(?:\.\d+)?)\s*(mcg|µg|ug|mg|g|ml|iu|%|units?)\b/);
  if (!m) return null;
  const unit = m[2].replace(/^units?$/, "unit");
  const f = UNIT_TO_MG[unit];
  return f ? { value: Math.round(Number(m[1]) * f * 1e6) / 1e6, unit: "mg" } : { value: Number(m[1]), unit };
}

export type TimesPerDay = number | "other" | null;

/** Conservative reading of how often per day. Anything unclear is null, never guessed. */
export function timesPerDay(text: string | null | undefined): TimesPerDay {
  const t = (text ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!t) return null;
  if (/alternate|every other|weekly|once a week|every \d+ days|fortnight|monthly|\bprn\b|as needed|if needed|sos/.test(t)) return "other";
  const dash = t.match(/\b([01])\s*-\s*([01])\s*-\s*([01])(?:\s*-\s*([01]))?\b/);
  if (dash) return dash.slice(1).filter(Boolean).reduce((n, d) => n + Number(d), 0) || null;
  if (/\b(qid|q\.i\.d|four times|4 times|4x)\b/.test(t)) return 4;
  if (/\b(tds|t\.d\.s|tid|t\.i\.d|thrice|three times|3 times|3x)\b/.test(t)) return 3;
  if (/\b(bd|b\.d|bid|b\.i\.d|twice|two times|2 times|2x)\b/.test(t)) return 2;
  if (/\b(od|o\.d|qd|once|one time|1 time|1x|daily|every day|each day)\b/.test(t)) return 1;
  return null;
}

const label = (n: TimesPerDay) => (typeof n === "number" ? `${n} time${n === 1 ? "" : "s"} a day` : "an unclear schedule");

function summarize(m: Medication): MedSummary {
  const freq = m.schedule.frequency === "daily" ? label(m.schedule.times.length) : m.schedule.frequency === "weekly" ? "certain days of the week" : `every ${m.schedule.intervalDays ?? "few"} days`;
  return { id: m.id, name: m.name, strength: m.strength, dose: `${m.doseAmount} ${m.doseUnit}`, frequency: `${freq} (${[...m.schedule.times].sort().join(", ")})`, status: m.status };
}

// ---------- main ----------
const OPEN = new Set(["active", "on_hold", "draft"]);
const FIELD_LABEL: Record<string, string> = { name: "medicine name", strength: "strength", dose: "dose", frequency: "how often", duration: "duration" };

export interface ReconcileInput {
  incoming: ExtractedMedication[];
  existing: Medication[];
  documentType: "prescription" | "other";
  /** Patient-local date "YYYY-MM-DD". */
  today: string;
}

export function reconcile(input: ReconcileInput): { items: ReconItem[]; absent: ReconItem[] } {
  const { incoming, existing, today } = input;
  const matchedIds = new Set<string>();
  const seenNames = new Map<string, number>();

  const items = incoming.map((inc, index): ReconItem => {
    const findings: Finding[] = [];
    const add = (f: Finding) => findings.push(f);
    const name = inc.normalizedName ?? inc.nameAsWritten;
    const norm = normalizeName(name);

    if (norm) {
      if (seenNames.has(norm)) add({ kind: "duplicate_in_prescription", attention: true, text: `This medicine appears more than once on the prescription (also as medicine ${seenNames.get(norm)! + 1}). Check whether it is listed twice by mistake or is meant for different times.` });
      else seenNames.set(norm, index);
    }

    const hit = matchExisting(inc, existing);
    const ex = hit?.med ?? null;
    if (ex) matchedIds.add(ex.id);

    if (!ex) {
      add({ kind: "new_medication", attention: false, text: "Not on the current medicine list." });
      if (inc.confidence.name < LOW_CONFIDENCE || !inc.normalizedName) {
        add({ kind: "uncertain_identity", attention: true, text: "The medicine name was hard to read, so it cannot be reliably matched to your list. Check the name against the prescription." });
      }
    } else {
      const open = OPEN.has(ex.status);
      if (hit!.by === "similar_name") add({ kind: "possible_existing", attention: true, text: `May be the same as "${ex.name}" already on the list. The names are similar, not identical.`, existing: ex.name, incoming: name });
      else if (hit!.by === "ingredient") add({ kind: "same_ingredient", attention: true, text: `Has the same active ingredient as "${ex.name}" already on the list (for example a brand versus the generic name).`, existing: ex.name, incoming: name });
      if (!open) add({ kind: "previously_stopped", attention: true, text: `A medicine with this name is on the list as ${ex.status.replace("_", " ")}. Check whether this prescription restarts it.` });

      const diffs: Finding[] = [];
      const a = parseStrength(ex.strength), b = parseStrength(inc.strength);
      if (a && b && (a.unit !== b.unit || a.value !== b.value)) diffs.push({ kind: "changed_strength", attention: true, text: "The strength is possibly different.", existing: ex.strength, incoming: inc.strength });
      if (inc.doseAmount !== null && inc.doseUnit && (inc.doseAmount !== ex.doseAmount || inc.doseUnit.toLowerCase() !== ex.doseUnit.toLowerCase())) {
        diffs.push({ kind: "changed_dose", attention: true, text: "The amount per dose is possibly different.", existing: `${ex.doseAmount} ${ex.doseUnit}`, incoming: `${inc.doseAmount} ${inc.doseUnit}` });
      }
      const inFreq = timesPerDay(inc.frequencyAsWritten) ?? timesPerDay(inc.doseInstructionAsWritten);
      const exFreq: TimesPerDay = ex.schedule.frequency === "daily" ? ex.schedule.times.length : "other";
      if (typeof inFreq === "number" && typeof exFreq === "number") {
        if (inFreq !== exFreq) diffs.push({ kind: "changed_frequency", attention: true, text: "How often is possibly different.", existing: label(exFreq), incoming: label(inFreq) });
      } else if (inc.frequencyAsWritten || inc.doseInstructionAsWritten) {
        add({ kind: "frequency_not_comparable", attention: false, text: "How often could not be compared automatically. Read it from the prescription.", existing: summarize(ex).frequency, incoming: inc.frequencyAsWritten ?? inc.doseInstructionAsWritten });
      }
      diffs.forEach(add);
      if (!diffs.length && open) add({ kind: "same_as_existing", attention: true, text: `Looks the same as "${ex.name}" already on the list. Adding it again would create a duplicate.` });
    }

    if (!inc.strength) add({ kind: "missing_strength", attention: false, text: "No strength was read from the prescription." });
    if (inc.doseAmount === null) add({ kind: "missing_dose", attention: true, text: inc.doseInstructionAsWritten ? `The dose could not be turned into a number. It reads: "${inc.doseInstructionAsWritten}".` : "No dose was found. It will stay empty until you enter it." });
    if (!inc.frequencyAsWritten && !inc.doseInstructionAsWritten) add({ kind: "missing_frequency", attention: true, text: "No instructions for how often were found. They will stay empty until you enter them." });
    const low = (Object.keys(inc.confidence) as (keyof ExtractedMedication["confidence"])[]).filter((k) => inc.confidence[k] < LOW_CONFIDENCE);
    if (low.length) add({ kind: "low_confidence", attention: true, text: `The AI was unsure about: ${low.map((k) => FIELD_LABEL[k]).join(", ")}. This is an estimate, not a measure of accuracy.` });
    if (inc.startDate && inc.endDate && inc.endDate < inc.startDate) add({ kind: "conflicting_dates", attention: true, text: "The end date is before the start date.", incoming: `${inc.startDate} to ${inc.endDate}` });
    else if (inc.endDate && inc.endDate < today) add({ kind: "conflicting_dates", attention: true, text: "The end date has already passed.", incoming: inc.endDate });

    return { key: `m${index}`, index, incomingName: name, existing: ex ? summarize(ex) : null, matchedBy: hit?.by ?? null, findings };
  });

  // Medicines still on the list that the new prescription does not mention. Informational only: this is NOT a conclusion that they were stopped.
  const absent: ReconItem[] = input.documentType === "prescription" && incoming.length
    ? existing.filter((m) => OPEN.has(m.status) && m.status !== "draft" && !matchedIds.has(m.id)).map((m) => ({
        key: `absent_${m.id}`, index: null, incomingName: null, existing: summarize(m), matchedBy: null,
        findings: [{ kind: "not_on_prescription" as const, attention: false, text: `"${m.name}" is on your list but is not on this prescription. That could mean it is unchanged, was left off, or was stopped. Only the doctor can say which.` }],
      }))
    : [];
  return { items, absent };
}
