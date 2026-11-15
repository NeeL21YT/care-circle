import "server-only";
import { col, db, fromData, fromSnap, toData } from "@/lib/db";
import { badRequest, notFound } from "@/lib/api/errors";
import { generateOccurrences, generatesDoses, validateSchedule } from "@/lib/domain/scheduling";
import type { DoseOccurrence, Medication, MedicationStatus, Patient } from "@/lib/domain/types";
import type { MedicationInput } from "@/lib/domain/schemas";
import { requirePatientAccess } from "@/lib/auth/access";
import type { CurrentUser } from "@/lib/auth/session";
import { mapLimit } from "@/lib/async";
import { audit } from "./audit";
import { applySystemEvent, doseText } from "./doses";

/** How far ahead occurrences are materialized. The worker extends it daily. */
export const HORIZON_DAYS = 14;

/** Allowed status moves. Completed/discontinued are final: add a new medication to resume. */
const TRANSITIONS: Record<MedicationStatus, MedicationStatus[]> = {
  draft: ["active", "discontinued"],
  active: ["on_hold", "completed", "discontinued"],
  on_hold: ["active", "completed", "discontinued"],
  completed: [],
  discontinued: [],
};

export async function listMedications(user: CurrentUser, patientId: string) {
  await requirePatientAccess(user.uid, patientId, "medications:read");
  const snap = await col.sub(patientId, "medications").orderBy("name", "asc").get();
  return snap.docs.map((d) => ({ ...fromData<Medication>(d.data()), id: d.id }));
}

export async function getMedication(user: CurrentUser, patientId: string, medicationId: string) {
  await requirePatientAccess(user.uid, patientId, "medications:read");
  const m = fromSnap<Medication>(await col.sub(patientId, "medications").doc(medicationId).get());
  if (!m) throw notFound("That medication");
  return m;
}

export async function createMedication(
  user: CurrentUser,
  patientId: string,
  input: MedicationInput,
  /** Set when the caregiver approved an AI-extracted draft. */
  source?: { documentId: string },
) {
  const { patient } = await requirePatientAccess(user.uid, patientId, "medications:write");
  const now = new Date();
  const ref = col.sub(patientId, "medications").doc();
  const med: Medication = {
    id: ref.id,
    patientId,
    name: input.name,
    activeIngredient: input.activeIngredient ?? null,
    strength: input.strength ?? null,
    doseAmount: input.doseAmount,
    doseUnit: input.doseUnit,
    form: input.form,
    route: input.route,
    schedule: input.schedule,
    startDate: input.startDate,
    endDate: input.endDate ?? null,
    prescriber: input.prescriber ?? null,
    instructions: input.instructions ?? null,
    status: input.status,
    // Phase 2 hooks. A caregiver typing this in IS the human verification.
    sourceDocumentId: source?.documentId ?? null,
    verificationStatus: "verified",
    verifiedByUid: user.uid,
    verifiedAt: now,
    createdByUid: user.uid,
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
  await ref.set(toData(med));
  await snapshotVersion(patientId, med);
  await reconcileOccurrences(patient, med, now);
  await audit(patientId, user.uid, "medication.create", { type: "medication", id: med.id }, { status: med.status });
  return med;
}

export async function updateMedication(
  user: CurrentUser,
  patientId: string,
  medicationId: string,
  changes: Partial<MedicationInput>,
  /** Where the change came from (e.g. a reviewed prescription), kept in the version history. */
  source?: { type: "prescription_reconciliation"; extractionId: string; key: string },
) {
  const { patient } = await requirePatientAccess(user.uid, patientId, "medications:write");
  const ref = col.sub(patientId, "medications").doc(medicationId);
  const now = new Date();
  const clean = Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== undefined));

  const { before, after } = await db().runTransaction(async (tx) => {
    const cur = fromSnap<Medication>(await tx.get(ref));
    if (!cur) throw notFound("That medication");
    const next = { ...cur, ...clean } as Medication;
    if (clean.status && clean.status !== cur.status && !TRANSITIONS[cur.status].includes(clean.status as MedicationStatus)) {
      throw badRequest(`A ${cur.status.replace("_", " ")} medication cannot be changed to ${String(clean.status).replace("_", " ")}.`);
    }
    if (cur.status === "completed" || cur.status === "discontinued") {
      throw badRequest("This medication is finished. Add it again as a new medication to restart it.");
    }
    const issues = validateSchedule(next.schedule, next.startDate, next.endDate);
    if (issues.length) throw badRequest(issues[0].message, Object.fromEntries(issues.map((i) => [i.field, i.message])));
    next.updatedAt = now;
    next.version = cur.version + 1;
    tx.update(ref, { ...clean, updatedAt: now, version: next.version });
    return { before: cur, after: next };
  });

  await snapshotVersion(patientId, after, source ? { ...source, byUid: user.uid } : null);
  await reconcileOccurrences(patient, after, now);
  const statusChanged = before.status !== after.status;
  await audit(
    patientId, user.uid, statusChanged ? "medication.status_change" : "medication.update",
    { type: "medication", id: medicationId },
    { fields: Object.keys(clean), ...(source ? { via: source.type, extractionId: source.extractionId } : {}), ...(statusChanged ? { from: before.status, to: after.status } : {}) },
  );
  return after;
}

/** DELETE = discontinue. History (occurrences, events, versions) is always kept. */
export function discontinueMedication(user: CurrentUser, patientId: string, medicationId: string) {
  return updateMedication(user, patientId, medicationId, { status: "discontinued" });
}

async function snapshotVersion(patientId: string, med: Medication, changeSource: Record<string, string> | null = null) {
  await col.sub(patientId, "medications").doc(med.id).collection("versions").doc(String(med.version)).set({ ...toData(med), changeSource, snapshotAt: new Date() });
}

function occurrenceDoc(patient: Patient, med: Medication, slot: { id: string; scheduledAt: Date }, now: Date): DoseOccurrence {
  return {
    id: slot.id,
    patientId: patient.id,
    medicationId: med.id,
    medicationName: med.name,
    doseText: doseText(med),
    instructions: med.instructions,
    scheduledAt: slot.scheduledAt,
    timezone: patient.timezone,
    status: "scheduled",
    gracePeriodMinutes: patient.escalationPolicy.escalateAfterMinutes,
    notifiedAt: null,
    respondedAt: null,
    snoozedUntil: null,
    createdAt: now,
    updatedAt: now,
  };
}

const isAlreadyExists = (e: unknown) =>
  (e as { code?: number | string })?.code === 6 || String((e as Error)?.message).includes("ALREADY_EXISTS");

/**
 * Brings stored FUTURE occurrences in line with the medication:
 *  - creates missing occurrences in the horizon (deterministic ids + create(),
 *    so it is safe to call repeatedly and concurrently),
 *  - cancels untouched future occurrences that no longer match the schedule,
 *  - cancels future unanswered occurrences when the medication stops being active,
 *  - refreshes the name/dose snapshot on the ones that stay.
 * Past occurrences and anything a person already answered are never touched.
 */
export async function reconcileOccurrences(patient: Patient, med: Medication, now: Date, horizonDays = HORIZON_DAYS) {
  const to = new Date(now.getTime() + horizonDays * 24 * 3600_000);
  const desired = generatesDoses(med.status)
    ? generateOccurrences(med, patient.timezone, now, to)
    : [];
  const desiredIds = new Set(desired.map((s) => s.id));

  const existingSnap = await col
    .sub(patient.id, "doseOccurrences")
    .where("medicationId", "==", med.id)
    .where("scheduledAt", ">=", now)
    .get();
  const existing = new Map(existingSnap.docs.map((d) => [d.id, fromData<DoseOccurrence>(d.data())]));

  // Create missing.
  // Concurrent (not one-by-one): a twice-daily medicine is ~28 documents, and each is its own round trip.
  await mapLimit(desired.filter((slot) => !existing.has(slot.id)), 12, async (slot) => {
    try {
      await col.sub(patient.id, "doseOccurrences").doc(slot.id).create(toData(occurrenceDoc(patient, med, slot, now)));
    } catch (e) {
      if (!isAlreadyExists(e)) throw e;
    }
  });
  // Cancel or refresh existing future ones.
  await mapLimit([...existing], 8, async ([id, occ]) => {
    const untouched = occ.status === "scheduled" || occ.status === "notified" || occ.status === "snoozed";
    if (!desiredIds.has(id) && untouched) {
      await applySystemEvent(patient.id, id, "cancelled", now);
    } else if (desiredIds.has(id) && occ.status === "cancelled") {
      // Medication resumed / schedule restored: bring the dose back.
      await applySystemEvent(patient.id, id, "reinstated", now);
      await col.sub(patient.id, "doseOccurrences").doc(id).update({
        medicationName: med.name, doseText: doseText(med), instructions: med.instructions, updatedAt: now,
      });
    } else if (desiredIds.has(id) && occ.status === "scheduled") {
      await col.sub(patient.id, "doseOccurrences").doc(id).update({
        medicationName: med.name, doseText: doseText(med), instructions: med.instructions, updatedAt: now,
      });
    }
  });
}
