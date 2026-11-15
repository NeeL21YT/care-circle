import "server-only";
import { DateTime } from "luxon";
import { col, fromData, fromSnap, toData } from "@/lib/db";
import { badRequest, notFound } from "@/lib/api/errors";
import type { Appointment } from "@/lib/domain/types";
import type { AppointmentInput } from "@/lib/domain/schemas";
import { requirePatientAccess } from "@/lib/auth/access";
import type { CurrentUser } from "@/lib/auth/session";
import { audit } from "./audit";

function toInstant(date: string, time: string, timezone: string): Date {
  const dt = DateTime.fromISO(`${date}T${time}`, { zone: timezone });
  if (!dt.isValid) throw badRequest("Enter a valid appointment date and time.");
  return dt.toUTC().toJSDate();
}

export async function listAppointments(
  user: CurrentUser,
  patientId: string,
  q: { scope?: "upcoming" | "past" | "all"; from?: Date; to?: Date } = {},
) {
  await requirePatientAccess(user.uid, patientId, "appointments:read");
  const now = new Date();
  let query = col.sub(patientId, "appointments").orderBy("startsAt", q.scope === "past" ? "desc" : "asc");
  if (q.scope === "upcoming") query = query.where("startsAt", ">=", now);
  if (q.scope === "past") query = query.where("startsAt", "<", now);
  if (q.from) query = query.where("startsAt", ">=", q.from);
  if (q.to) query = query.where("startsAt", "<", q.to);
  const snap = await query.limit(500).get();
  return snap.docs.map((d) => ({ ...fromData<Appointment>(d.data()), id: d.id }));
}

export async function createAppointment(user: CurrentUser, patientId: string, input: AppointmentInput) {
  const { patient } = await requirePatientAccess(user.uid, patientId, "appointments:write");
  const ref = col.sub(patientId, "appointments").doc();
  const now = new Date();
  const appt: Appointment = {
    id: ref.id,
    patientId,
    doctorName: input.doctorName,
    facility: input.facility ?? null,
    startsAt: toInstant(input.date, input.time, patient.timezone),
    timezone: patient.timezone,
    location: input.location ?? null,
    appointmentType: input.appointmentType,
    notes: input.notes ?? null,
    reminderOffsetsMinutes: [...new Set(input.reminderOffsetsMinutes)].sort((a, b) => b - a),
    status: "scheduled",
    createdByUid: user.uid,
    createdAt: now,
    updatedAt: now,
  };
  await ref.set(toData(appt));
  await audit(patientId, user.uid, "appointment.create", { type: "appointment", id: ref.id });
  return appt;
}

export async function updateAppointment(
  user: CurrentUser,
  patientId: string,
  appointmentId: string,
  changes: Partial<AppointmentInput> & { status?: Appointment["status"] },
) {
  const { patient } = await requirePatientAccess(user.uid, patientId, "appointments:write");
  const ref = col.sub(patientId, "appointments").doc(appointmentId);
  const cur = fromSnap<Appointment>(await ref.get());
  if (!cur) throw notFound("That appointment");
  if (cur.status === "cancelled" && changes.status !== "scheduled") {
    throw badRequest("This appointment was cancelled. Restore it before editing.");
  }
  const { date, time, ...rest } = changes;
  const patch: Record<string, unknown> = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
  if (date || time) {
    const local = DateTime.fromJSDate(cur.startsAt, { zone: patient.timezone });
    patch.startsAt = toInstant(date ?? local.toFormat("yyyy-MM-dd"), time ?? local.toFormat("HH:mm"), patient.timezone);
  }
  if (patch.reminderOffsetsMinutes) {
    patch.reminderOffsetsMinutes = [...new Set(patch.reminderOffsetsMinutes as number[])].sort((a, b) => b - a);
  }
  patch.updatedAt = new Date();
  await ref.update(patch);
  await audit(patientId, user.uid, changes.status === "cancelled" ? "appointment.cancel" : "appointment.update", { type: "appointment", id: appointmentId }, { fields: Object.keys(patch) });
  return { ...cur, ...patch } as Appointment;
}

/** DELETE = cancel (keeps the record and any reminder history). */
export function cancelAppointment(user: CurrentUser, patientId: string, appointmentId: string) {
  return updateAppointment(user, patientId, appointmentId, { status: "cancelled" });
}
