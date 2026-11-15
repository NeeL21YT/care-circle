import "server-only";
import { DateTime } from "luxon";
import { badRequest, conflict, notFound } from "@/lib/api/errors";
import { requirePatientAccess } from "@/lib/auth/access";
import type { CurrentUser } from "@/lib/auth/session";
import { medicationUpdateSchema, taskCreateSchema, type ReconciliationDecisionInput } from "@/lib/domain/schemas";
import { reconcile, type ReconItem, type ReconStatus } from "@/lib/domain/reconciliation";
import { audit } from "./audit";
import { createTask } from "./care-tasks";
import { listMedications, updateMedication } from "./medications";
import { finalizeIfComplete, getExtraction } from "./prescriptions";
import { readDecisions, writeDecision, type ReconDecision } from "./reconciliation-store";

const OPEN = ["active", "on_hold", "draft"];
/** Once a person has decided one of these, it is final (changes are made from the medicines page). */
const FINAL: ReconStatus[] = ["confirmed_change", "unchanged", "rejected"];

export interface ReconView extends ReconItem {
  decision: ReconDecision | null;
  /** True when a person has settled this item. */
  settled: boolean;
}

async function compute(user: CurrentUser, patientId: string, extractionId: string) {
  const { patient } = await requirePatientAccess(user.uid, patientId, "medications:write");
  const x = await getExtraction(user, patientId, extractionId);
  const [existing, decisions] = await Promise.all([listMedications(user, patientId), readDecisions(patientId, extractionId)]);
  const r = reconcile({
    incoming: x.reviewedMedications, existing, documentType: x.extractedData?.documentType ?? "prescription",
    today: DateTime.now().setZone(patient.timezone).toFormat("yyyy-MM-dd"),
  });
  return { x, existing, decisions, ...r };
}

export async function getReconciliation(user: CurrentUser, patientId: string, extractionId: string) {
  const { x, decisions, items, absent } = await compute(user, patientId, extractionId);
  const view = (i: ReconItem): ReconView => {
    const d = decisions[i.key] ?? null;
    const approved = i.index !== null && Boolean(x.approvals[String(i.index)] && x.approvals[String(i.index)] !== "pending");
    return { ...i, decision: d, settled: approved || (d !== null && (FINAL.includes(d.status) || d.status === "needs_clarification")) };
  };
  return { extractionId, status: x.status, items: items.map(view), absent: absent.map(view) };
}

/**
 * Records a person's decision about one compared medicine. Nothing here is
 * automatic: every adopted change is applied through the normal medication
 * service with the decider's own permissions, and recorded in the medicine's
 * version history and the audit log.
 */
export async function decide(user: CurrentUser, patientId: string, extractionId: string, key: string, input: ReconciliationDecisionInput) {
  const { x, existing, decisions, items, absent } = await compute(user, patientId, extractionId);
  if (x.status !== "review_required") throw conflict("This prescription is no longer waiting for review.");
  const item = [...items, ...absent].find((i) => i.key === key);
  if (!item) throw notFound("That medicine");
  const isAbsent = item.index === null;
  const current = decisions[key];
  if (current && FINAL.includes(current.status)) throw conflict("This was already decided.");
  if (!isAbsent && x.approvals[String(item.index)] && x.approvals[String(item.index)] !== "pending") throw conflict("This medicine was already added.");

  const { decision } = input;
  const allowedForAbsent: ReconStatus[] = ["unchanged", "needs_clarification", "confirmed_change"];
  if (isAbsent && !allowedForAbsent.includes(decision)) throw badRequest("Choose to keep it as it is, ask the doctor, or confirm it was stopped.");
  if ((decision === "unchanged" || decision === "confirmed_change") && !item.existing) throw badRequest("There is no existing medicine to keep or change.");
  const target = item.existing ? existing.find((m) => m.id === item.existing!.id) : undefined;
  if ((decision === "unchanged" || decision === "confirmed_change") && target && !OPEN.includes(target.status)) {
    throw badRequest("That medicine is finished. Add it as a new medicine instead.");
  }

  let medicationId: string | null = null;
  const source = { type: "prescription_reconciliation" as const, extractionId, key };
  if (decision === "confirmed_change") {
    if (isAbsent) {
      // The person confirms the medicine was stopped. This is their decision, not an inference.
      await updateMedication(user, patientId, target!.id, { status: "discontinued" }, source);
    } else {
      const parsed = medicationUpdateSchema.safeParse(input.medicationPatch ?? {});
      if (!parsed.success) throw badRequest("Please check the details you want to apply.");
      const { status: _ignored, ...patch } = parsed.data;
      void _ignored; // status changes are only possible through the explicit "stopped" decision above
      if (!Object.keys(patch).length) throw badRequest("Enter the details you want to apply to the existing medicine.");
      await updateMedication(user, patientId, target!.id, patch, source);
    }
    medicationId = target!.id;
  }

  const inc = item.index !== null ? x.reviewedMedications[item.index] : null;
  const record: ReconDecision = {
    status: decision, decidedByUid: user.uid, decidedByName: user.displayName, decidedAt: new Date(), note: input.note ?? null, medicationId,
    snapshot: { incoming: inc ? { name: item.incomingName, strength: inc.strength, dose: inc.doseInstructionAsWritten, frequency: inc.frequencyAsWritten } : null, existing: item.existing },
  };
  const ok = await writeDecision(patientId, extractionId, key, record, (cur) => !cur || !FINAL.includes(cur.status));
  if (!ok) throw conflict("This was just decided by someone else.");
  await audit(patientId, user.uid, "prescription.reconcile", { type: "prescriptionExtraction", id: extractionId }, { key, decision, ...(medicationId ? { medicationId } : {}) });

  if (decision === "needs_clarification" && input.createTask) {
    // Optional follow-up for the family. A failure here must not undo the decision.
    await createTask(user, patientId, taskCreateSchema.parse({
      title: `Ask the doctor about ${item.incomingName ?? item.existing?.name ?? "a medicine"}`.slice(0, 140),
      description: "From a scanned prescription: some details need the doctor's clarification before they are used.",
      related: { type: "prescription", id: extractionId },
      clientRequestId: `recon_${extractionId.slice(0, 20)}_${key}`.replace(/[^A-Za-z0-9_-]/g, "_"),
    })).catch(() => undefined);
  }

  const status = await finalizeIfComplete(patientId, extractionId, user);
  return { key, decision: record, extractionStatus: status };
}
