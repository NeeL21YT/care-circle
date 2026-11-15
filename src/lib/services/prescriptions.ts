import "server-only";
import { col, fromData, fromSnap, toData } from "@/lib/db";
import { conflict, notFound, badRequest } from "@/lib/api/errors";
import { requirePatientAccess } from "@/lib/auth/access";
import type { CurrentUser } from "@/lib/auth/session";
import type { HealthDocument } from "@/lib/domain/types";
import { medicationInputSchema, type MedicationInput } from "@/lib/domain/schemas";
import { fileStore } from "@/lib/storage";
import { AiError } from "@/lib/ai/errors";
import { extractPrescription } from "@/lib/ai/prescription/extractor";
import { extractedMedicationSchema, type ExtractedMedication, type ExtractionStatus, type PrescriptionExtraction } from "@/lib/ai/prescription/schemas";
import { consumeQuota, recordUsage } from "@/lib/ai/usage";
import { audit } from "./audit";
import { createMedication, listMedications } from "./medications";
import { reconcile, type ReconStatus } from "@/lib/domain/reconciliation";
import { readDecisions, writeDecision, type ReconDecision } from "./reconciliation-store";
import { DateTime } from "luxon";
import { z } from "zod";
import { runTx } from "@/lib/db/transaction";

export interface PrescriptionExtractionRecord {
  id: string;
  patientId: string;
  sourceDocumentId: string;
  requestedBy: string;
  status: ExtractionStatus;
  /** Exactly what the model returned (after the deterministic safety pass). Never edited. */
  extractedData: PrescriptionExtraction | null;
  /** What the human is correcting. Starts as a copy of extractedData.medications. */
  reviewedMedications: ExtractedMedication[];
  uncertaintyFlags: number;
  /** index -> created medication id (or "pending" while being created). */
  approvals: Record<string, string>;
  modelIdentifier: string | null;
  promptVersion: string | null;
  history: { status: ExtractionStatus; at: Date; note?: string }[];
  failureCode: string | null;
  createdAt: Date;
  completedAt: Date | null;
  approvedAt: Date | null;
  approvedBy: string | null;
}

const ACTIVE: ExtractionStatus[] = ["uploaded", "queued", "processing", "review_required"];
const sub = (patientId: string) => col.sub(patientId, "prescriptionExtractions");

const strip = (r: PrescriptionExtractionRecord) => r;

async function load(patientId: string, id: string) {
  const r = fromSnap<PrescriptionExtractionRecord>(await sub(patientId).doc(id).get());
  if (!r) throw notFound("That extraction");
  return r;
}

async function setStatus(patientId: string, id: string, status: ExtractionStatus, extra: Partial<PrescriptionExtractionRecord> = {}, note?: string) {
  const ref = sub(patientId).doc(id);
  const r = fromSnap<PrescriptionExtractionRecord>(await ref.get());
  if (!r) return;
  await ref.set(toData({ ...r, ...extra, status, history: [...r.history, { status, at: new Date(), ...(note ? { note } : {}) }] }));
}

export async function listExtractions(user: CurrentUser, patientId: string) {
  await requirePatientAccess(user.uid, patientId, "medications:write");
  const snap = await sub(patientId).orderBy("createdAt", "desc").get();
  return snap.docs.map((d) => ({ ...fromData<PrescriptionExtractionRecord>(d.data()), id: d.id })).map(strip);
}

export async function getExtraction(user: CurrentUser, patientId: string, id: string) {
  await requirePatientAccess(user.uid, patientId, "medications:write");
  return load(patientId, id);
}

/**
 * Runs the scanner on an already-uploaded document. Idempotent: an in-flight or
 * awaiting-review extraction for the same document is returned instead of
 * starting (and paying for) another. `retry` starts a fresh one.
 */
export async function startExtraction(user: CurrentUser, patientId: string, documentId: string, opts: { retry?: boolean } = {}) {
  await requirePatientAccess(user.uid, patientId, "medications:write");
  const doc = fromSnap<HealthDocument>(await col.sub(patientId, "documents").doc(documentId).get());
  if (!doc) throw notFound("That document");
  if (doc.contentType !== "application/pdf" && doc.contentType !== "image/jpeg" && doc.contentType !== "image/png") {
    throw badRequest("Only PDF, JPG and PNG files can be scanned.");
  }

  const existing = (await sub(patientId).where("sourceDocumentId", "==", documentId).get()).docs
    .map((d) => ({ ...fromData<PrescriptionExtractionRecord>(d.data()), id: d.id }))
    .filter((r) => ACTIVE.includes(r.status));
  if (existing.length && !opts.retry) return existing.sort((a, b) => +b.createdAt - +a.createdAt)[0];
  if (opts.retry) {
    for (const r of existing) {
      if (r.status === "processing" || r.status === "queued") throw conflict("This prescription is already being scanned.");
    }
  }

  await consumeQuota(patientId, user.uid, "prescription");

  const ref = sub(patientId).doc();
  const now = new Date();
  const base: PrescriptionExtractionRecord = {
    id: ref.id,
    patientId,
    sourceDocumentId: documentId,
    requestedBy: user.uid,
    status: "queued",
    extractedData: null,
    reviewedMedications: [],
    uncertaintyFlags: 0,
    approvals: {},
    modelIdentifier: null,
    promptVersion: null,
    history: [{ status: "uploaded", at: now }, { status: "queued", at: now }],
    failureCode: null,
    createdAt: now,
    completedAt: null,
    approvedAt: null,
    approvedBy: null,
  };
  await ref.set(toData(base));
  await audit(patientId, user.uid, "prescription.extract", { type: "prescriptionExtraction", id: ref.id });

  await setStatus(patientId, ref.id, "processing");
  await col.sub(patientId, "documents").doc(documentId).update({ processingStatus: "processing" });
  try {
    const bytes = await fileStore().read(doc.storagePath);
    const out = await extractPrescription({ bytes, mimeType: doc.contentType });
    await recordUsage(patientId, user.uid, out.usage);
    const flags = out.result.medications.reduce((n, m) => n + m.uncertainties.length, 0) + out.result.documentWarnings.length;
    await setStatus(patientId, ref.id, "review_required", {
      extractedData: out.result,
      reviewedMedications: out.result.medications,
      uncertaintyFlags: flags,
      modelIdentifier: out.model,
      promptVersion: out.promptVersion,
      completedAt: new Date(),
    });
    await col.sub(patientId, "documents").doc(documentId).update({ processingStatus: "completed" });
  } catch (e) {
    await recordUsage(patientId, user.uid, null);
    const code = e instanceof AiError ? e.failure : "ai_unavailable";
    await setStatus(patientId, ref.id, "failed", { failureCode: code, completedAt: new Date() }, code);
    await col.sub(patientId, "documents").doc(documentId).update({ processingStatus: "failed" });
    // Surface the failure to the caller too; the record keeps the history.
    throw e;
  }
  return load(patientId, ref.id);
}

const editSchema = z.object({ medications: z.array(extractedMedicationSchema).max(30) });

/** Decisions that settle a medicine without creating a new one. */
const SETTLED: ReconStatus[] = ["confirmed_change", "unchanged", "needs_clarification", "rejected"];

/** Human edits. Only allowed while awaiting review and before any decision or approval. */
export async function updateReview(user: CurrentUser, patientId: string, id: string, input: unknown) {
  await requirePatientAccess(user.uid, patientId, "medications:write");
  const r = await load(patientId, id);
  if (r.status !== "review_required") throw conflict("This prescription can no longer be edited.");
  const parsed = editSchema.safeParse(input);
  if (!parsed.success) throw badRequest("Please check the medicine details.");
  const decisions = await readDecisions(patientId, id);
  if (Object.keys(r.approvals).some((k) => r.approvals[k]) || Object.values(decisions).some((d) => d.status !== "awaiting_review")) {
    throw conflict("Some medicines were already reviewed. Edit the rest from the medicines page.");
  }
  await sub(patientId).doc(id).update({ reviewedMedications: parsed.data.medications });
  await audit(patientId, user.uid, "prescription.edit", { type: "prescriptionExtraction", id });
  return load(patientId, id);
}

/**
 * Completes the extraction once EVERY medicine has been settled by a person:
 * approved as new, or decided in reconciliation. Medicines "not on this
 * prescription" never block completion. "approved" means at least one
 * medicine was adopted (added or changed); otherwise nothing was adopted.
 */
export async function finalizeIfComplete(patientId: string, id: string, actor: CurrentUser) {
  const r = await load(patientId, id);
  if (r.status !== "review_required" || r.reviewedMedications.length === 0) return r.status;
  const decisions = await readDecisions(patientId, id);
  const settled = r.reviewedMedications.every((_, i) => {
    const a = r.approvals[String(i)];
    return (a && a !== "pending") || SETTLED.includes(decisions[`m${i}`]?.status as ReconStatus);
  });
  if (!settled) return r.status;
  const adopted = Object.values(r.approvals).some((a) => a && a !== "pending") || Object.values(decisions).some((d) => d.status === "confirmed_change");
  const status: ExtractionStatus = adopted ? "approved" : "rejected";
  await setStatus(patientId, id, status, adopted ? { approvedAt: new Date(), approvedBy: actor.uid } : {});
  return status;
}

/**
 * The only path from an AI draft to a NEW active medicine. The caller supplies
 * the final, human-checked fields; they are validated by the SAME schema as
 * manual entry, and scheduling goes through the Phase 1 medication service.
 * If the medicine looks like one already on the list, the person must first
 * confirm it is a separate medicine (reconciliation), so duplicates are never
 * created by accident.
 */
export async function approveMedication(user: CurrentUser, patientId: string, id: string, index: number, input: unknown) {
  const { patient } = await requirePatientAccess(user.uid, patientId, "medications:write");
  const parsed = medicationInputSchema.safeParse(input);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const i of parsed.error.issues) fields[i.path.join(".")] ??= i.message;
    throw badRequest("Please check the highlighted fields.", fields);
  }
  const med: MedicationInput = parsed.data;

  const current = await load(patientId, id);
  if (current.status !== "review_required") throw conflict("This prescription is not waiting for review.");
  if (!Number.isInteger(index) || index < 0 || index >= current.reviewedMedications.length) throw badRequest("That medicine is not on this prescription.");

  const [existing, decisions] = await Promise.all([listMedications(user, patientId), readDecisions(patientId, id)]);
  const item = reconcile({
    incoming: current.reviewedMedications, existing, documentType: current.extractedData?.documentType ?? "prescription",
    today: DateTime.now().setZone(patient.timezone).toFormat("yyyy-MM-dd"),
  }).items[index];
  const looksExisting = item.existing && ["active", "on_hold", "draft"].includes(item.existing.status);
  const decided = decisions[`m${index}`];
  if (looksExisting && decided?.status !== "confirmed_new") {
    throw conflict(`This looks like "${item.existing!.name}", which is already on the list. First choose how to handle it: update the existing medicine, keep it as it is, or confirm this is a separate new medicine.`);
  }
  if (decided && SETTLED.includes(decided.status)) throw conflict("This medicine was already reviewed.");

  // Reserve the slot transactionally so a double click cannot create two medicines.
  const ref = sub(patientId).doc(id);
  await runTx(async (t) => {
    const snap = await t.get(ref);
    if (!snap.exists) throw notFound("That extraction");
    const r = fromData<PrescriptionExtractionRecord>(snap.data());
    if (r.status !== "review_required") throw conflict("This prescription is not waiting for review.");
    if (r.approvals[String(index)]) throw conflict("That medicine was already approved.");
    t.update(ref, { [`approvals.${index}`]: "pending" });
  });

  try {
    const created = await createMedication(user, patientId, med, { documentId: current.sourceDocumentId });
    const after = await load(patientId, id);
    await ref.update({ approvals: { ...after.approvals, [String(index)]: created.id } });
    const decision: ReconDecision = {
      status: "confirmed_new", decidedByUid: user.uid, decidedByName: user.displayName, decidedAt: new Date(), note: decided?.note ?? null, medicationId: created.id,
      snapshot: { incoming: { name: item.incomingName, strength: current.reviewedMedications[index].strength, dose: current.reviewedMedications[index].doseInstructionAsWritten, frequency: current.reviewedMedications[index].frequencyAsWritten }, existing: item.existing },
    };
    await writeDecision(patientId, id, `m${index}`, decision, () => true);
    await audit(patientId, user.uid, "prescription.approve", { type: "prescriptionExtraction", id }, { index });
    const status = await finalizeIfComplete(patientId, id, user);
    return { medication: created, extractionStatus: status };
  } catch (e) {
    await ref.update({ [`approvals.${index}`]: "" }).catch(() => undefined);
    throw e;
  }
}

export async function rejectExtraction(user: CurrentUser, patientId: string, id: string) {
  await requirePatientAccess(user.uid, patientId, "medications:write");
  const r = await load(patientId, id);
  if (r.status !== "review_required" && r.status !== "failed") throw conflict("This prescription can no longer be rejected.");
  const decisions = await readDecisions(patientId, id);
  if (Object.values(r.approvals).some(Boolean) || Object.values(decisions).some((d) => d.status === "confirmed_change" || d.status === "confirmed_new")) {
    throw conflict("Some medicines were already added or changed, so this cannot be rejected.");
  }
  await setStatus(patientId, id, "rejected");
  await audit(patientId, user.uid, "prescription.reject", { type: "prescriptionExtraction", id });
  return load(patientId, id);
}
