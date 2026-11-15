import type { ExtractedMedication, PrescriptionExtraction } from "./schemas";
import { lowConfidenceFields } from "./confidence";

/** Phrases that look like instructions aimed at an AI rather than prescription content. */
const INJECTION = /(ignore|disregard|forget)\s+(all\s+|any\s+|the\s+)?(previous|prior|above)|system prompt|you are now|as an ai|new instructions?:/i;

const FIELD_LABEL: Record<string, string> = {
  name: "medicine name",
  strength: "strength",
  dose: "dose",
  frequency: "how often",
  duration: "for how long",
};

function strings(m: ExtractedMedication): string[] {
  return [m.nameAsWritten, m.doseInstructionAsWritten, m.frequencyAsWritten, m.timingAsWritten, m.durationAsWritten, m.specialInstructions, ...m.uncertainties].filter(
    (s): s is string => typeof s === "string",
  );
}

/**
 * Deterministic safety pass over model output. It can only ADD review flags,
 * never remove them or invent values: the model may not talk its way out of
 * human review.
 */
export function validateExtraction(raw: PrescriptionExtraction): PrescriptionExtraction {
  const warnings = [...raw.documentWarnings];
  const meds = raw.medications.map((m) => {
    const out: ExtractedMedication = { ...m, uncertainties: [...m.uncertainties] };
    for (const f of lowConfidenceFields(out)) out.uncertainties.push(`Low confidence in ${FIELD_LABEL[f]}. Check it against the prescription.`);
    if (!out.doseInstructionAsWritten && out.doseAmount === null) out.uncertainties.push("No dose could be read. Enter it from the prescription.");
    if (!out.frequencyAsWritten) out.uncertainties.push("No frequency could be read. Enter it from the prescription.");
    if (strings(out).some((s) => INJECTION.test(s))) {
      out.uncertainties.push("This entry contains text that looks like an instruction. It was ignored; check the original.");
      if (!warnings.includes(INJECTION_WARNING)) warnings.push(INJECTION_WARNING);
    }
    // Every AI draft is reviewed by a human, always.
    return { ...out, needsHumanReview: true };
  });
  if (raw.documentType !== "prescription") warnings.push("This does not look like a prescription. Check that you uploaded the right file.");
  if (raw.documentType === "prescription" && meds.length === 0) warnings.push("No medicines were found. The photo may be unclear or cropped.");
  return { ...raw, medications: meds, documentWarnings: warnings };
}

const INJECTION_WARNING = "Part of the document contains text addressed to an AI. It was not followed.";
