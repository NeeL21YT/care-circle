import "server-only";
import { col, db, fromData, fromSnap, toData } from "@/lib/db";
import { badRequest, notFound } from "@/lib/api/errors";
import { nextStatus, RESPONDED } from "@/lib/domain/dose-state";
import type { DoseEvent, DoseEventSource, DoseEventType, DoseOccurrence, DoseStatus } from "@/lib/domain/types";
import { requirePatientAccess } from "@/lib/auth/access";
import { can } from "@/lib/domain/permissions";
import type { CurrentUser } from "@/lib/auth/session";
import { audit } from "./audit";

const MAX_BACKDATE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

export function doseText(m: { doseAmount: number; doseUnit: string; strength: string | null }) {
  return `${m.doseAmount} ${m.doseUnit}${m.strength ? ` (${m.strength})` : ""}`;
}

export async function listDoses(
  user: CurrentUser,
  patientId: string,
  q: { from?: Date; to?: Date; limit?: number },
) {
  const { membership } = await requirePatientAccess(user.uid, patientId, "doses:read");
  const now = new Date();
  let from = q.from ?? new Date(now.getTime() - 24 * 3600_000);
  // Members who can see the schedule but not adherence history only get future
  // doses, which are by definition unanswered, so history is never exposed.
  if (!can(membership, "doses:viewHistory") && from < now) from = now;
  const to = q.to ?? new Date(now.getTime() + 48 * 3600_000);
  const snap = await col
    .sub(patientId, "doseOccurrences")
    .where("scheduledAt", ">=", from)
    .where("scheduledAt", "<", to)
    .orderBy("scheduledAt", "asc")
    .limit(q.limit ?? 200)
    .get();
  return snap.docs.map((d) => ({ ...fromData<DoseOccurrence>(d.data()), id: d.id }));
}

export async function listDoseEvents(user: CurrentUser, patientId: string, occurrenceId: string) {
  await requirePatientAccess(user.uid, patientId, "doses:viewHistory");
  const snap = await col.sub(patientId, "doseEvents").where("doseOccurrenceId", "==", occurrenceId).orderBy("recordedAt", "asc").get();
  return snap.docs.map((d) => ({ ...fromData<DoseEvent>(d.data()), id: d.id }));
}

export interface RecordEventInput {
  eventType: DoseEventType;
  note?: string | null;
  clientEventId?: string;
  snoozeMinutes?: number;
  occurredAt?: string;
}

/**
 * Records a person's response. Appends an immutable event and updates the
 * occurrence's current status in ONE transaction. Previous events are never
 * edited: changing your mind adds a new event, so full history is preserved.
 * `clientEventId` makes retries (e.g. from an offline queue) idempotent.
 */
export async function recordDoseEvent(
  user: CurrentUser,
  patientId: string,
  occurrenceId: string,
  input: RecordEventInput,
) {
  const { membership } = await requirePatientAccess(user.uid, patientId, "doses:respond");
  const source: DoseEventSource = membership.role === "patient" ? "patient_ui" : "caregiver_ui";
  const now = new Date();
  let occurredAt = now;
  if (input.occurredAt) {
    const t = new Date(input.occurredAt);
    if (t.getTime() <= now.getTime() + MAX_FUTURE_SKEW_MS && t.getTime() >= now.getTime() - MAX_BACKDATE_MS) occurredAt = t;
  }
  if (input.eventType === "snoozed" && !input.snoozeMinutes) throw badRequest("Choose how long to wait.");

  const occRef = col.sub(patientId, "doseOccurrences").doc(occurrenceId);
  const eventId = input.clientEventId ? `${occurrenceId}_${input.clientEventId}` : col.sub(patientId, "doseEvents").doc().id;
  const evRef = col.sub(patientId, "doseEvents").doc(eventId);

  const result = await db().runTransaction(async (tx) => {
    const [occSnap, evSnap] = await Promise.all([tx.get(occRef), tx.get(evRef)]);
    const occ = fromSnap<DoseOccurrence>(occSnap);
    if (!occ) throw notFound("That dose");
    if (evSnap.exists) {
      // Idempotent retry: return the original outcome, write nothing.
      return { occurrence: occ, event: { ...fromData<DoseEvent>(evSnap.data()), id: evSnap.id }, duplicate: true };
    }
    const status = nextStatus({ current: occ.status, event: input.eventType, byUser: true });
    const event: DoseEvent = {
      id: eventId,
      patientId,
      doseOccurrenceId: occurrenceId,
      eventType: input.eventType,
      userId: user.uid,
      source,
      note: input.note ?? null,
      occurredAt,
      recordedAt: now,
      clientEventId: input.clientEventId ?? null,
      snoozeMinutes: input.eventType === "snoozed" ? input.snoozeMinutes ?? null : null,
      previousStatus: occ.status,
      resultingStatus: status,
    };
    const answered = RESPONDED.has(status);
    const update: Record<string, unknown> = {
      status,
      updatedAt: now,
      respondedAt: answered ? occurredAt : occ.respondedAt ?? null,
      snoozedUntil: status === "snoozed" ? new Date(occurredAt.getTime() + (input.snoozeMinutes ?? 0) * 60_000) : null,
    };
    tx.create(evRef, toData(event));
    tx.update(occRef, update);
    return { occurrence: { ...occ, ...update } as DoseOccurrence, event, duplicate: false };
  });

  if (!result.duplicate) {
    await audit(patientId, user.uid, "dose.event", { type: "doseOccurrence", id: occurrenceId }, { eventType: input.eventType, source });
  }
  return result;
}

/** Snooze is just a "snoozed" event with a validated duration. */
export function snoozeDose(user: CurrentUser, patientId: string, occurrenceId: string, minutes: number, clientEventId?: string) {
  return recordDoseEvent(user, patientId, occurrenceId, { eventType: "snoozed", snoozeMinutes: minutes, clientEventId });
}

/**
 * System-generated transition (worker): notified / missed_by_policy / cancelled.
 * Never overwrites a patient's own answer (the state machine throws).
 * Returns false instead of throwing when the transition no longer applies, so
 * a worker retry is harmless.
 */
export async function applySystemEvent(
  patientId: string,
  occurrenceId: string,
  eventType: Extract<DoseEventType, "notified" | "missed_by_policy" | "cancelled" | "reinstated">,
  now: Date,
): Promise<boolean> {
  const occRef = col.sub(patientId, "doseOccurrences").doc(occurrenceId);
  // Deterministic event id => notified / missed_by_policy are written at most once
  // per dose. cancelled / reinstated can legitimately repeat (schedule edits), so
  // they are keyed by time.
  const repeatable = eventType === "cancelled" || eventType === "reinstated";
  const evRef = col.sub(patientId, "doseEvents").doc(`${occurrenceId}_sys_${eventType}${repeatable ? `_${now.getTime()}` : ""}`);
  return db().runTransaction(async (tx) => {
    const [occSnap, evSnap] = await Promise.all([tx.get(occRef), tx.get(evRef)]);
    const occ = fromSnap<DoseOccurrence>(occSnap);
    if (!occ || evSnap.exists) return false;
    let status: DoseStatus;
    try {
      status = nextStatus({ current: occ.status, event: eventType, byUser: false });
    } catch {
      return false;
    }
    const event: DoseEvent = {
      id: evRef.id, patientId, doseOccurrenceId: occurrenceId, eventType, userId: null,
      source: "system", note: null, occurredAt: now, recordedAt: now, clientEventId: null,
      previousStatus: occ.status, resultingStatus: status,
    };
    tx.create(evRef, toData(event));
    tx.update(occRef, {
      status, updatedAt: now,
      ...(eventType === "notified" ? { notifiedAt: occ.notifiedAt ?? now } : {}),
      ...(eventType === "reinstated" ? { notifiedAt: null, respondedAt: null, snoozedUntil: null } : {}),
    });
    return true;
  });
}
