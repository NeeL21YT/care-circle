import "server-only";
import { col, fromData, toData } from "@/lib/db";
import { requirePatientAccess } from "@/lib/auth/access";
import type { CurrentUser } from "@/lib/auth/session";
import { can, type Action } from "@/lib/domain/permissions";
import { buildWeeklyReport, isoWeekKey, REPORT_DAYS, type CheckinInput, type CheckinLevel } from "@/lib/domain/weekly-report";
import { audit } from "./audit";
import { listAppointments } from "./appointments";
import { listTasks } from "./care-tasks";
import { listDocuments } from "./documents";
import { listDoses } from "./doses";
import { listHandovers } from "./handovers";
import { listExtractions } from "./prescriptions";

/** Builds the report from ONLY what this caregiver may see. Needs tasks:write (manageCare). */
export async function getWeeklyReport(user: CurrentUser, patientId: string) {
  const { patient, membership } = await requirePatientAccess(user.uid, patientId, "tasks:write");
  const now = new Date();
  const from = new Date(now.getTime() - REPORT_DAYS * 86_400_000);
  const ok = (a: Action) => can(membership, a);

  const [doses, tasks, appointments, documents, scans, handovers] = await Promise.all([
    ok("doses:viewHistory") ? listDoses(user, patientId, { from, to: now, limit: 500 }) : null,
    ok("tasks:read") ? listTasks(user, patientId, { filter: "all" }) : null,
    ok("appointments:read") ? listAppointments(user, patientId, { scope: "all", from, to: new Date(now.getTime() + 90 * 86_400_000) }) : null,
    ok("documents:read") ? listDocuments(user, patientId) : null,
    ok("medications:write") ? listExtractions(user, patientId) : null,
    ok("handovers:read") ? listHandovers(user, patientId) : null,
  ]);

  return buildWeeklyReport({
    now,
    timezone: patient.timezone,
    doses,
    tasks,
    appointments,
    documentDates: documents ? documents.map((d) => d.createdAt) : null,
    scansWaiting: scans ? scans.filter((s) => s.status === "review_required").length : null,
    handoverDates: handovers ? handovers.map((h) => h.createdAt) : null,
  });
}

export interface Checkin {
  id: string;
  patientId: string;
  uid: string;
  weekKey: string;
  level: CheckinLevel;
  note: string;
  createdAt: Date;
  updatedAt: Date;
}

const checkins = (patientId: string) => col.sub(patientId, "caregiverCheckins");

/** One check-in per person per ISO week; saving again in the same week updates it. */
export async function saveCheckin(user: CurrentUser, patientId: string, input: CheckinInput) {
  const { patient } = await requirePatientAccess(user.uid, patientId, "tasks:write");
  const now = new Date();
  const weekKey = isoWeekKey(now, patient.timezone);
  const id = `${user.uid}_${weekKey}`;
  const ref = checkins(patientId).doc(id);
  const existing = await ref.get();
  const createdAt = existing.exists ? fromData<Checkin>(existing.data()).createdAt : now;
  const record: Checkin = { id, patientId, uid: user.uid, weekKey, level: input.level, note: input.note, createdAt, updatedAt: now };
  await ref.set(toData(record));
  // Metadata never carries the note or the level: this log is visible to primary caregivers.
  await audit(patientId, user.uid, "checkin.save", { type: "caregiverCheckin", id });
  return record;
}

/** The caller's OWN check-ins only, newest first. Nobody else's are ever returned. */
export async function listMyCheckins(user: CurrentUser, patientId: string, limit = 6) {
  await requirePatientAccess(user.uid, patientId, "tasks:write");
  const snap = await checkins(patientId).where("uid", "==", user.uid).get();
  return snap.docs
    .map((d) => ({ ...fromData<Checkin>(d.data()), id: d.id }))
    .filter((c) => c.uid === user.uid)
    .sort((a, b) => b.weekKey.localeCompare(a.weekKey))
    .slice(0, limit);
}
