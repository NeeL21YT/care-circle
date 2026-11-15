import type { ExtractedMedication } from "./schemas";

/** Below this the field is visibly highlighted in the review UI. Product rule, not a clinical threshold. */
export const LOW_CONFIDENCE = 0.75;

export type FieldKey = keyof ExtractedMedication["confidence"];

export function lowConfidenceFields(m: ExtractedMedication): FieldKey[] {
  return (Object.keys(m.confidence) as FieldKey[]).filter((k) => m.confidence[k] < LOW_CONFIDENCE);
}
