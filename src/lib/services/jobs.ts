import "server-only";
import { DateTime } from "luxon";
import { col, db, fromData } from "@/lib/db";
import { dueStages, type DoseStage } from "@/lib/domain/escalation";
import { UNRESOLVED } from "@/lib/domain/dose-state";
import type { Appointment, DoseOccurrence, Medication, Membership, NotificationType, Patient } from "@/lib/domain/types";
import { applySystemEvent } from "./doses";
import { reconcileOccurrences, HORIZON_DAYS } from "./medications";
import {
  createNotificationOnce, deliverPendingEmails, localTimeLabel, type DeliveryStats,
} from "./notifications";

/**
 * Scheduled backend work. Invoked by Cloud Scheduler / Vercel Cron (see
 * /api/jobs/tick and functions/src/index.ts). NEVER by a browser timer.
 *
 * Every step is idempotent: occurrences have deterministic ids, notifications
 * use deterministic idempotency-key ids, and system events can be written only
 * once. Running the tick twice (or concurrently) produces no duplicates.
 */

interface PatientCtx {
  patient: Patient;
  members: Membership[];
}

async function loadPatientCtx(cache: Map<string, PatientCtx | null>, patientId: string): Promise<PatientCtx | null> {
  if (cache.has(patientId)) return cache.get(patientId)!;
  const pSnap = await col.patients().doc(patientId).get();
  if (!pSnap.exists) { cache.set(patientId, null); return null; }
  const patient = { ...fromData<Patient>(pSnap.data()), id: pSnap.id };
  const mSnap = await col.sub(patientId, "memberships").where("status", "==", "active").get();
  const members = mSnap.docs.map((d) => ({ ...fromData<Membership>(d.data()), uid: d.id }));
  const ctx = { patient, members };
  cache.set(patientId, ctx);
  return ctx;
}

const STAGE_META: Record<DoseStage, { type: NotificationType; recipients: "patient" | "caregivers"; title: (n: string, t: string) => string }> = {
  upcoming: { type: "upcoming_dose", recipients: "patient", title: (n, t) => `Coming up at ${t}: ${n}` },
  due: { type: "dose_reminder", recipients: "patient", title: (n, t) => `Time for ${n} (${t})` },
  follow_up: { type: "dose_follow_up", recipients: "patient", title: (n, t) => `Reminder: ${n} from ${t}` },
  escalate: { type: "dose_missed", recipients: "caregivers", title: (n, t) => `No response yet for ${n} at ${t}` },
};

function recipientsFor(kind: "patient" | "caregivers" | "appointment", ctx: PatientCtx): Membership[] {
  switch (kind) {
    case "patient":
      return ctx.members.filter((m) => m.role === "patient");
    case "caregivers":
      // Caregivers always; family only with the adherence grant (their own
      // preferences then decide whether an email is actually sent).
      return ctx.members.filter((m) => m.role === "primary_caregiver" || (m.role === "family" && m.permissions.adherence));
    case "appointment":
      return ctx.members.filter((m) => m.role !== "family" || m.permissions.appointments);
  }
}

export interface TickResult {
  at: string;
  medicationsExtended: number;
  doseNotificationsCreated: number;
  appointmentNotificationsCreated: number;
  dosesNotified: number;
  dosesMissedByPolicy: number;
  delivery: DeliveryStats;
}

export async function runTick(now = new Date()): Promise<TickResult> {
  const cache = new Map<string, PatientCtx | null>();
  const result: TickResult = {
    at: now.toISOString(), medicationsExtended: 0, doseNotificationsCreated: 0,
    appointmentNotificationsCreated: 0, dosesNotified: 0, dosesMissedByPolicy: 0,
    delivery: { attempted: 0, sent: 0, failed: 0, skipped: 0, retried: 0 },
  };

  // 1) Keep the rolling window of future dose occurrences topped up.
  const meds = await db().collectionGroup("medications").where("status", "==", "active").get();
  for (const m of meds.docs) {
    const med = { ...fromData<Medication>(m.data()), id: m.id };
    const last = (m.data() as { horizonExtendedAt?: { toDate(): Date } | Date }).horizonExtendedAt;
    const lastDate = last instanceof Date ? last : last?.toDate?.();
    if (lastDate && now.getTime() - lastDate.getTime() < 6 * 3600_000) continue;
    const ctx = await loadPatientCtx(cache, med.patientId);
    if (!ctx) continue;
    await reconcileOccurrences(ctx.patient, med, now, HORIZON_DAYS);
    await m.ref.update({ horizonExtendedAt: now });
    result.medicationsExtended++;
  }

  // 2) Dose notification stages.
  const windowStart = new Date(now.getTime() - 24 * 3600_000);
  const windowEnd = new Date(now.getTime() + 125 * 60_000);
  const occs = await db().collectionGroup("doseOccurrences").where("scheduledAt", ">=", windowStart).where("scheduledAt", "<=", windowEnd).get();
  for (const o of occs.docs) {
    const occ = { ...fromData<DoseOccurrence>(o.data()), id: o.id };
    if (!UNRESOLVED.has(occ.status)) continue;
    const ctx = await loadPatientCtx(cache, occ.patientId);
    if (!ctx) continue;
    const stages = dueStages({ scheduledAt: occ.scheduledAt, status: occ.status, snoozedUntil: occ.snoozedUntil, now, policy: ctx.patient.escalationPolicy });
    const resumed = occ.status === "snoozed" && occ.snoozedUntil && occ.snoozedUntil <= now;

    for (const stage of stages) {
      const meta = STAGE_META[stage];
      // A reminder after a snooze is its own notification, keyed by that snooze.
      const stageKey = stage === "due" && resumed ? `due_s${occ.snoozedUntil!.getTime()}` : stage;
      const localTime = localTimeLabel(occ.scheduledAt, ctx.patient.timezone);
      for (const r of recipientsFor(meta.recipients, ctx)) {
        const created = await createNotificationOnce({
          id: `dose_${occ.id}_${stageKey}_${r.uid}`,
          patient: ctx.patient,
          recipient: r,
          type: meta.type,
          title: meta.title(occ.medicationName, localTime),
          body:
            stage === "escalate"
              ? `${ctx.patient.fullName} has not responded to the ${localTime} reminder for ${occ.medicationName}. This does not mean it was or was not taken.`
              : `${occ.medicationName}, ${occ.doseText}, scheduled for ${localTime}.`,
          resourceId: occ.id,
          stage: stageKey,
          payload: {
            kind: "dose", patientName: ctx.patient.fullName, occurrenceId: occ.id,
            medicationName: occ.medicationName, doseText: occ.doseText, instructions: occ.instructions, localTime,
          },
          now,
        });
        if (created) result.doseNotificationsCreated++;
      }
      // State side-effects, each guarded by the state machine and written once.
      if (stage === "due" && (await applySystemEvent(occ.patientId, occ.id, "notified", now))) result.dosesNotified++;
      if (stage === "escalate" && (await applySystemEvent(occ.patientId, occ.id, "missed_by_policy", now))) result.dosesMissedByPolicy++;
    }
  }

  // 3) Appointment reminders.
  const apptEnd = new Date(now.getTime() + 14 * 24 * 3600_000);
  const appts = await db().collectionGroup("appointments").where("startsAt", ">", now).where("startsAt", "<=", apptEnd).get();
  const LATENESS_MS = 2 * 3600_000; // tolerate a short scheduler outage, never fire stale reminders
  for (const a of appts.docs) {
    const appt = { ...fromData<Appointment>(a.data()), id: a.id };
    if (appt.status !== "scheduled") continue;
    const ctx = await loadPatientCtx(cache, appt.patientId);
    if (!ctx) continue;
    for (const offset of appt.reminderOffsetsMinutes) {
      const fireAt = appt.startsAt.getTime() - offset * 60_000;
      if (now.getTime() < fireAt || now.getTime() - fireAt > LATENESS_MS) continue;
      const mins = Math.round((appt.startsAt.getTime() - now.getTime()) / 60_000);
      const whenText = mins >= 36 * 60 ? `in ${Math.round(mins / 1440)} days` : mins >= 20 * 60 ? "tomorrow" : mins >= 90 ? `in about ${Math.round(mins / 60)} hours` : mins >= 50 ? "in about an hour" : `in ${Math.max(mins, 1)} minutes`;
      const local = DateTime.fromJSDate(appt.startsAt, { zone: ctx.patient.timezone }).toFormat("ccc d LLL yyyy, h:mm a");
      for (const r of recipientsFor("appointment", ctx)) {
        const created = await createNotificationOnce({
          id: `appt_${appt.id}_${offset}_${r.uid}`,
          patient: ctx.patient,
          recipient: r,
          type: offset >= 720 ? "appointment_upcoming" : "appointment_reminder",
          title: `Appointment ${whenText}: ${appt.doctorName}`,
          body: `${local}${appt.location ? `, ${appt.location}` : ""}.`,
          resourceId: appt.id,
          stage: `offset_${offset}`,
          payload: {
            kind: "appointment", patientName: ctx.patient.fullName, appointmentId: appt.id, doctorName: appt.doctorName,
            facility: appt.facility, location: appt.location, appointmentType: appt.appointmentType, localDateTime: local, whenText,
          },
          now,
        });
        if (created) result.appointmentNotificationsCreated++;
      }
    }
  }

  // 4) Deliver (provider results are recorded on each notification).
  result.delivery = await deliverPendingEmails(now);
  return result;
}
