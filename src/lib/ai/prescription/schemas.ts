import { z } from "zod";

const nullableText = z.string().max(500).nullable();
const conf = z.number().min(0).max(1);

/**
 * Structured extraction contract. Every field the model could not read MUST be
 * null: the review UI treats null as "missing until a human supplies it".
 * `...AsWritten` fields preserve the prescription's own wording; normalized
 * fields are suggestions only. Confidence values are model estimates, not
 * calibrated accuracy.
 */
export const extractedMedicationSchema = z.object({
  nameAsWritten: z.string().min(1).max(200),
  normalizedName: nullableText,
  ingredient: nullableText,
  strength: nullableText,
  dosageForm: nullableText,
  doseInstructionAsWritten: nullableText,
  doseAmount: z.number().positive().max(10000).nullable(),
  doseUnit: nullableText,
  route: nullableText,
  frequencyAsWritten: nullableText,
  timingAsWritten: nullableText,
  durationAsWritten: nullableText,
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  specialInstructions: nullableText,
  confidence: z.object({ name: conf, strength: conf, dose: conf, frequency: conf, duration: conf }),
  needsHumanReview: z.boolean(),
  uncertainties: z.array(z.string().max(300)).max(20),
});
export type ExtractedMedication = z.infer<typeof extractedMedicationSchema>;

export const prescriptionExtractionSchema = z.object({
  documentType: z.enum(["prescription", "other"]),
  patientName: nullableText,
  prescriber: z.object({ name: nullableText, registrationNumber: nullableText }),
  medications: z.array(extractedMedicationSchema).max(30),
  documentWarnings: z.array(z.string().max(300)).max(20),
});
export type PrescriptionExtraction = z.infer<typeof prescriptionExtractionSchema>;

export const EXTRACTION_STATUSES = [
  "uploaded",
  "queued",
  "processing",
  "review_required",
  "approved",
  "rejected",
  "failed",
] as const;
export type ExtractionStatus = (typeof EXTRACTION_STATUSES)[number];
