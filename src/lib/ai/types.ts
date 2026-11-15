/**
 * Phase 2 AI service interfaces. NO model calls are implemented in Phase 1.
 *
 * Contracts the future Gemini integration must honour (from the product spec):
 *  - AI output is a DRAFT until a human verifies it (Medication.verificationStatus).
 *  - Never guess illegible values: return null / needsHumanReview.
 *  - No diagnosis, dose changes or emergency determination.
 *  - Data access ONLY via `getAuthorizedPatientContext` (see services/patient-data.ts).
 */

export interface ExtractedMedicationDraft {
  nameAsWritten: string;
  strength: string | null;
  doseInstructionAsWritten: string | null;
  route: string | null;
  frequencyAsWritten: string | null;
  timingAsWritten: string | null;
  durationAsWritten: string | null;
  confidence: { name: number; strength: number; doseInstruction: number; frequency: number };
  needsHumanReview: boolean;
  uncertainties: string[];
}

export interface PrescriptionExtractionResult {
  documentId: string;
  documentType: "prescription" | "other";
  medications: ExtractedMedicationDraft[];
  documentWarnings: string[];
}

export interface PrescriptionExtractor {
  /** Reads a stored document (by id, authorized server-side) into drafts. */
  extract(input: { patientId: string; documentId: string; actorUid: string }): Promise<PrescriptionExtractionResult>;
}

export interface AssistantTool<I = unknown, O = unknown> {
  name: string;
  description: string;
  /** Executed on the server with the caller's identity; must enforce authorization. */
  execute(input: I, ctx: { actorUid: string; patientId: string }): Promise<O>;
}

export interface CareAssistant {
  /** Answers only from authorized platform data; refuses clinical advice. */
  answer(input: { actorUid: string; patientId: string; question: string }): Promise<{ text: string }>;
}

export interface AiServices {
  prescriptionExtractor: PrescriptionExtractor;
  careAssistant: CareAssistant;
}

export class AiNotImplementedError extends Error {
  readonly status = 501;
  constructor(feature: string) {
    super(`${feature} is not available yet. It is planned for Phase 2.`);
    this.name = "AiNotImplementedError";
  }
}
