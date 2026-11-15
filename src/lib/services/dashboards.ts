import "server-only";
import { DateTime } from "luxon";
import { summarizeAdherence, weeklyActivity, type AdherenceSummary, type DailyAdherence } from "@/lib/domain/adherence";
import { can } from "@/lib/domain/permissions";
import type { Appointment, DoseEvent, DoseOccurrence, Membership, Patient } from "@/lib/domain/types";
import { col, db, fromData } from "@/lib/db";
import { listPatientsForUser, viewPatient } from "./patients";

/**
 * Read models for the three dashboards. Everything is computed from real
 * Firestore data and goes through the SAME permission checks as the API:
 * a section the member may not see is returned as `null`, never filtered
 * client-side.
 */

export interface PatientSnapshot {
  patient: Partial<Patient> & { id: string };
  role: Membership["role"];
  timezone: string;
  nextDose: DoseOccurrence | null;
  todayDoses: DoseOccurrence[] | null;
  nextAppointment: Appointment | null;
  recentEvents: (DoseEvent & { medicationName?: string })[] | null;
  adherence: AdherenceSummary | null;
  weekly: DailyAdherence[] | null;
  activeMedicationCount: number | null;
  unresolvedToday: number | null;
  canSeeMedications: boolean;
  canSeeAppointments: boolean;
}

export async function getPatientSnapshot(uid: string, patientId: string, now = new Date()): Promise<PatientSnapshot | null> {
  const mSnap = await col.sub(patientId, "memberships").doc(uid).get();
  const pSnap = await col.patients().doc(patientId).get();
  if (!mSnap.exists || !pSnap.exists) return null;
  const membership = { ...fromData<Membership>(mSnap.data()), uid };
  if (membership.status !== "active") return null;
  const patient = { ...fromData<Patient>(pSnap.data()), id: patientId };
  const tz = patient.timezone;

  const canDoses = can(membership, "doses:read");
  const canHistory = can(membership, "doses:viewHistory");
  const canMeds = can(membership, "medications:read");
  const canAppts = can(membership, "appointments:read");

  const startOfDay = DateTime.fromJSDate(now, { zone: tz }).startOf("day");
  const dayStart = startOfDay.toUTC().toJSDate();
  const dayEnd = startOfDay.plus({ days: 1 }).toUTC().toJSDate();
  const weekStart = startOfDay.minus({ days: 6 }).toUTC().toJSDate();

  const [dosesSnap, apptSnap, medsSnap, eventsSnap] = await Promise.all([
    canDoses
      ? col.sub(patientId, "doseOccurrences").where("scheduledAt", ">=", canHistory ? weekStart : now).where("scheduledAt", "<", new Date(dayEnd.getTime() + 24 * 3600_000)).orderBy("scheduledAt", "asc").get()
      : null,
    canAppts ? col.sub(patientId, "appointments").where("startsAt", ">=", now).orderBy("startsAt", "asc").limit(10).get() : null,
    canMeds ? col.sub(patientId, "medications").where("status", "==", "active").get() : null,
    canHistory ? col.sub(patientId, "doseEvents").where("recordedAt", ">=", dayStart).orderBy("recordedAt", "desc").limit(30).get() : null,
  ]);

  const doses = (dosesSnap?.docs ?? []).map((d) => ({ ...fromData<DoseOccurrence>(d.data()), id: d.id }));
  const todayDoses = canDoses ? doses.filter((d) => d.scheduledAt >= dayStart && d.scheduledAt < dayEnd) : null;
  const upcoming = doses.filter((d) => d.status !== "cancelled" && (d.scheduledAt >= now || (["scheduled", "notified", "acknowledged", "snoozed"] as string[]).includes(d.status)) && d.scheduledAt < dayEnd && d.scheduledAt >= dayStart);
  // "Next" = the earliest dose still awaiting an answer, else the next future one.
  const awaiting = upcoming.filter((d) => ["scheduled", "notified", "acknowledged", "snoozed", "missed_by_policy"].includes(d.status));
  const nextDose = canDoses ? awaiting[0] ?? doses.find((d) => d.scheduledAt >= now && d.status !== "cancelled") ?? null : null;

  const nameById = new Map(doses.map((d) => [d.id, d.medicationName]));
  const recentEvents = canHistory
    ? (eventsSnap?.docs ?? []).map((d) => {
        const e = fromData<DoseEvent>(d.data());
        return { ...e, id: d.id, medicationName: nameById.get(e.doseOccurrenceId) };
      })
    : null;

  const adherenceDoses = canHistory ? doses.filter((d) => d.scheduledAt < dayEnd) : [];
  return {
    patient: viewPatient(patient, membership.role),
    role: membership.role,
    timezone: tz,
    nextDose,
    todayDoses,
    nextAppointment: canAppts ? (apptSnap?.docs.map((d) => ({ ...fromData<Appointment>(d.data()), id: d.id })).find((a) => a.status === "scheduled") ?? null) : null,
    recentEvents,
    adherence: canHistory ? summarizeAdherence(adherenceDoses.filter((d) => d.scheduledAt >= weekStart), now) : null,
    weekly: canHistory ? weeklyActivity(adherenceDoses, now, tz, 7) : null,
    activeMedicationCount: canMeds ? (medsSnap?.size ?? 0) : null,
    unresolvedToday: todayDoses ? summarizeAdherence(todayDoses, now).unresolved : null,
    canSeeMedications: canMeds,
    canSeeAppointments: canAppts,
  };
}

export interface CaregiverOverview {
  patients: PatientSnapshot[];
  totals: {
    patients: number;
    activeMedications: number;
    todayScheduled: number;
    todayTaken: number;
    todayUnresolved: number;
    upcomingAppointments: number;
  };
}

export async function getCaregiverOverview(uid: string, now = new Date()): Promise<CaregiverOverview> {
  const linked = await listPatientsForUser(uid);
  const snaps = (await Promise.all(linked.map((l) => getPatientSnapshot(uid, l.patient.id, now)))).filter((s): s is PatientSnapshot => !!s);
  const totals = { patients: snaps.length, activeMedications: 0, todayScheduled: 0, todayTaken: 0, todayUnresolved: 0, upcomingAppointments: 0 };
  for (const s of snaps) {
    totals.activeMedications += s.activeMedicationCount ?? 0;
    if (s.todayDoses) {
      const live = s.todayDoses.filter((d) => d.status !== "cancelled");
      totals.todayScheduled += live.length;
      totals.todayTaken += live.filter((d) => d.status === "reported_taken").length;
      totals.todayUnresolved += s.unresolvedToday ?? 0;
    }
    if (s.nextAppointment) totals.upcomingAppointments++;
  }
  return { patients: snaps, totals };
}

/** Counts for the unread-notification badge. */
export async function unreadNotificationCount(uid: string): Promise<number> {
  const snap = await db().collectionGroup("notifications").where("recipientUid", "==", uid).where("readAt", "==", null).get();
  return snap.size;
}
