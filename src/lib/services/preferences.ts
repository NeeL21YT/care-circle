import "server-only";
import { col, fromSnap, toData } from "@/lib/db";
import type { EmailPreferences, NotificationPreferences, Role } from "@/lib/domain/types";
import { requirePatientAccess } from "@/lib/auth/access";
import type { CurrentUser } from "@/lib/auth/session";
import { audit } from "./audit";

/** Sensible per-role defaults; users can change every one of them. */
export function defaultPreferences(uid: string, patientId: string, role: Role, timezone: string): NotificationPreferences {
  const email: EmailPreferences =
    role === "patient"
      ? { upcomingDose: false, doseReminder: true, doseFollowUp: true, doseMissed: false, appointment: true }
      : role === "primary_caregiver"
        ? { upcomingDose: false, doseReminder: false, doseFollowUp: false, doseMissed: true, appointment: true }
        : { upcomingDose: false, doseReminder: false, doseFollowUp: false, doseMissed: false, appointment: false };
  return {
    uid, patientId, email,
    quietHours: { enabled: false, start: "22:00", end: "07:00", timezone },
    updatedAt: new Date(0),
  };
}

export async function getPreferences(user: CurrentUser, patientId: string): Promise<NotificationPreferences> {
  const { patient, membership } = await requirePatientAccess(user.uid, patientId, "notifications:read");
  return loadPreferences(user.uid, patientId, membership.role, patient.timezone);
}

export async function loadPreferences(uid: string, patientId: string, role: Role, timezone: string): Promise<NotificationPreferences> {
  const stored = fromSnap<NotificationPreferences>(await col.sub(patientId, "notificationPreferences").doc(uid).get());
  const base = defaultPreferences(uid, patientId, role, timezone);
  return stored ? { ...base, ...stored, email: { ...base.email, ...stored.email } } : base;
}

export async function savePreferences(
  user: CurrentUser,
  input: Pick<NotificationPreferences, "patientId" | "email" | "quietHours">,
) {
  const { membership } = await requirePatientAccess(user.uid, input.patientId, "patient:updatePreferences");
  // Family members can only opt into categories they are permitted to see.
  const email = { ...input.email };
  if (membership.role === "family") {
    if (!membership.permissions.adherence) email.doseMissed = false;
    if (!membership.permissions.appointments) email.appointment = false;
    email.upcomingDose = false; email.doseReminder = false; email.doseFollowUp = false;
  }
  const prefs: NotificationPreferences = {
    uid: user.uid, patientId: input.patientId, email, quietHours: input.quietHours, updatedAt: new Date(),
  };
  await col.sub(input.patientId, "notificationPreferences").doc(user.uid).set(toData({ ...prefs, id: user.uid }));
  await audit(input.patientId, user.uid, "preferences.update", { type: "notificationPreferences", id: user.uid });
  return prefs;
}
