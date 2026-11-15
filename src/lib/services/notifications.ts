import "server-only";
import { DateTime } from "luxon";
import { col, db, fromData, fromSnap, toData } from "@/lib/db";
import { notFound } from "@/lib/api/errors";
import { serverEnv } from "@/lib/env";
import { deliverAfter } from "@/lib/domain/escalation";
import type {
  AppNotification, Delivery, Membership, NotificationPreferences, NotificationType, Patient,
} from "@/lib/domain/types";
import { requirePatientAccess } from "@/lib/auth/access";
import type { CurrentUser } from "@/lib/auth/session";
import { loadPreferences } from "./preferences";
import { sendEmail } from "@/lib/email/send";
import {
  appointmentEmail, medicationFollowUpEmail, medicationReminderEmail, missedDoseEmail, type RenderedEmail,
} from "@/lib/email/templates";

/**
 * Notification GENERATION is independent of DELIVERY.
 *
 *  - `createNotificationOnce` writes the notification record. Its document id
 *    is a deterministic idempotency key, so creating the same logical
 *    notification twice is a no-op.
 *  - `deliverPendingEmails` sends records whose email delivery is pending.
 *    It records the PROVIDER's outcome on the record. A patient's response to
 *    a dose is tracked on the dose itself and never inferred from delivery.
 */

export interface NotificationPayload {
  kind: "dose" | "appointment" | "care";
  patientName: string;
  // dose
  occurrenceId?: string;
  medicationName?: string;
  doseText?: string;
  instructions?: string | null;
  localTime?: string;
  // appointment
  appointmentId?: string;
  doctorName?: string;
  facility?: string | null;
  location?: string | null;
  appointmentType?: string;
  localDateTime?: string;
  whenText?: string;
}

type Stored = AppNotification & { payload: NotificationPayload; emailKey: EmailKey };
type EmailKey = "upcomingDose" | "doseReminder" | "doseFollowUp" | "doseMissed" | "appointment";

const TYPE_TO_KEY: Record<NotificationType, EmailKey | null> = {
  upcoming_dose: "upcomingDose",
  dose_reminder: "doseReminder",
  dose_follow_up: "doseFollowUp",
  dose_missed: "doseMissed",
  appointment_upcoming: "appointment",
  appointment_reminder: "appointment",
  care_circle_invitation: null,
  // In-app only for now; email for coordination events is added with the notification milestone.
  task_assigned: null,
  task_reassigned: null,
  handover_shared: null,
};

const MAX_ATTEMPTS = 3;
const LEASE_MS = 2 * 60 * 1000;

const isAlreadyExists = (e: unknown) =>
  (e as { code?: number | string })?.code === 6 || String((e as Error)?.message).includes("ALREADY_EXISTS");

export interface NewNotification {
  /** Deterministic idempotency key, e.g. `dose_<occ>_due_<uid>`. */
  id: string;
  patient: Patient;
  recipient: Pick<Membership, "uid" | "role" | "email">;
  type: NotificationType;
  title: string;
  body: string;
  resourceId: string | null;
  stage: string;
  payload: NotificationPayload;
  now: Date;
}

/** Returns true if created, false if it already existed (idempotent). */
export async function createNotificationOnce(n: NewNotification): Promise<boolean> {
  const prefs = await loadPreferences(n.recipient.uid, n.patient.id, n.recipient.role, n.patient.timezone);
  const emailKey = TYPE_TO_KEY[n.type];
  let email: Delivery | null = null;
  const base: Delivery = {
    channel: "email", status: "pending", attempts: 0, providerMessageId: null, lastError: null,
    lastAttemptAt: null, sentAt: null, deliverAfter: null, leaseUntil: null, skipReason: null,
  };
  if (emailKey) {
    if (!prefs.email[emailKey]) email = { ...base, status: "skipped", skipReason: "preference_disabled" };
    else if (!n.recipient.email) email = { ...base, status: "skipped", skipReason: "no_email_address" };
    else email = { ...base, deliverAfter: deliverAfter(n.now, prefs.quietHours) };
  }
  const doc: Stored = {
    id: n.id,
    patientId: n.patient.id,
    recipientUid: n.recipient.uid,
    type: n.type,
    title: n.title,
    body: n.body,
    resourceId: n.resourceId,
    stage: n.stage,
    scheduledFor: n.now,
    readAt: null,
    deliveries: {
      in_app: { ...base, channel: "in_app", status: "sent", sentAt: n.now },
      email,
      push: null, // Phase 2+: FCM adapter plugs in here
    },
    createdAt: n.now,
    payload: n.payload,
    emailKey: emailKey ?? "doseReminder",
  };
  try {
    await col.sub(n.patient.id, "notifications").doc(n.id).create({ ...toData(doc), notificationId: n.id });
    return true;
  } catch (e) {
    if (isAlreadyExists(e)) return false;
    throw e;
  }
}

function render(n: Stored, recipientName: string): RenderedEmail {
  const p = n.payload;
  const appUrl = `${serverEnv().APP_URL}/patients/${n.patientId}`;
  if (p.kind === "appointment") {
    return appointmentEmail({
      recipientName, patientName: p.patientName, doctorName: p.doctorName ?? "your doctor",
      facility: p.facility, location: p.location, localDateTime: p.localDateTime ?? "",
      appointmentType: p.appointmentType ?? "Appointment", whenText: p.whenText ?? "soon",
      appUrl: `${appUrl}/appointments`,
    });
  }
  const data = {
    recipientName, patientName: p.patientName, medicationName: p.medicationName ?? "your medicine",
    doseText: p.doseText ?? "", localTime: p.localTime ?? "", instructions: p.instructions, appUrl,
  };
  switch (n.type) {
    case "upcoming_dose": return medicationReminderEmail({ ...data, upcoming: true });
    case "dose_follow_up": return medicationFollowUpEmail(data);
    case "dose_missed": return missedDoseEmail(data);
    default: return medicationReminderEmail(data);
  }
}

export interface DeliveryStats { attempted: number; sent: number; failed: number; skipped: number; retried: number }

/**
 * Sends pending emails. Safe to run concurrently and repeatedly:
 *  - each record is CLAIMED in a transaction with a lease, so two workers can
 *    never both send it;
 *  - the deterministic notification id means a record can only ever be created
 *    once (Brevo has no idempotency header, so a lost response after a
 *    successful send can cause at most one repeat on retry);
 *  - dose notifications are re-checked at send time and dropped if the patient
 *    has answered in the meantime (e.g. during quiet hours).
 */
export async function deliverPendingEmails(now: Date, limit = 100): Promise<DeliveryStats> {
  const stats: DeliveryStats = { attempted: 0, sent: 0, failed: 0, skipped: 0, retried: 0 };
  const snap = await db().collectionGroup("notifications").where("deliveries.email.status", "in", ["pending", "sending"]).limit(limit).get();

  for (const doc of snap.docs) {
    const ref = doc.ref;
    // 1) Claim.
    const claimed = await db().runTransaction(async (tx) => {
      const cur = fromSnap<Stored>(await tx.get(ref));
      const e = cur?.deliveries.email;
      if (!cur || !e) return null;
      const leaseExpired = e.status === "sending" && (!e.leaseUntil || e.leaseUntil <= now);
      if (e.status !== "pending" && !leaseExpired) return null;
      if (e.deliverAfter && e.deliverAfter > now) return null; // quiet hours
      tx.update(ref, {
        "deliveries.email.status": "sending",
        "deliveries.email.attempts": e.attempts + 1,
        "deliveries.email.lastAttemptAt": now,
        "deliveries.email.leaseUntil": new Date(now.getTime() + LEASE_MS),
      });
      return { ...cur, deliveries: { ...cur.deliveries, email: { ...e, attempts: e.attempts + 1 } } } as Stored;
    });
    if (!claimed) continue;
    stats.attempted++;

    const finish = (fields: Record<string, unknown>) => ref.update({ "deliveries.email.leaseUntil": null, ...fields });

    // 2) Re-check relevance for dose notifications.
    if (claimed.payload.kind === "dose" && claimed.payload.occurrenceId) {
      const occ = fromSnap<{ status: string }>(await col.sub(claimed.patientId, "doseOccurrences").doc(claimed.payload.occurrenceId).get());
      const answered = occ && ["reported_taken", "reported_skipped", "unknown", "cancelled"].includes(occ.status);
      if (!occ || answered) {
        await finish({ "deliveries.email.status": "skipped", "deliveries.email.skipReason": "resolved_before_delivery" });
        stats.skipped++;
        continue;
      }
    }

    // 3) Send.
    const user = fromSnap<{ email: string; displayName: string }>(await col.users().doc(claimed.recipientUid).get());
    if (!user?.email) {
      await finish({ "deliveries.email.status": "skipped", "deliveries.email.skipReason": "no_email_address" });
      stats.skipped++;
      continue;
    }
    const result = await sendEmail({ to: user.email, email: render(claimed, user.displayName.split(" ")[0] || "there"), idempotencyKey: `notif_${claimed.id}` });
    if (result.sent) {
      await finish({ "deliveries.email.status": "sent", "deliveries.email.sentAt": now, "deliveries.email.providerMessageId": result.providerMessageId, "deliveries.email.lastError": null });
      stats.sent++;
    } else if (result.skipped === "not_configured") {
      await finish({ "deliveries.email.status": "skipped", "deliveries.email.skipReason": "email_provider_not_configured" });
      stats.skipped++;
    } else {
      const attempts = claimed.deliveries.email!.attempts;
      const giveUp = attempts >= MAX_ATTEMPTS;
      await finish({ "deliveries.email.status": giveUp ? "failed" : "pending", "deliveries.email.lastError": result.error });
      if (giveUp) stats.failed++; else stats.retried++;
    }
  }
  return stats;
}

// ---- Reading (in-app inbox) ----

export async function listNotifications(user: CurrentUser, patientId: string, opts: { limit?: number } = {}) {
  await requirePatientAccess(user.uid, patientId, "notifications:read");
  // A user only ever sees notifications addressed to them.
  const snap = await col
    .sub(patientId, "notifications")
    .where("recipientUid", "==", user.uid)
    .orderBy("createdAt", "desc")
    .limit(opts.limit ?? 50)
    .get();
  return snap.docs.map((d) => {
    const n = fromData<Stored>(d.data());
    const { payload: _p, emailKey: _k, ...rest } = n;
    void _p; void _k;
    return { ...rest, id: d.id };
  });
}

export async function markNotificationRead(user: CurrentUser, notificationId: string) {
  const snap = await db()
    .collectionGroup("notifications")
    .where("recipientUid", "==", user.uid)
    .where("notificationId", "==", notificationId)
    .limit(1)
    .get();
  const doc = snap.docs[0];
  if (!doc) throw notFound("That notification");
  await doc.ref.update({ readAt: new Date() });
  return { id: notificationId, readAt: new Date() };
}

export function localTimeLabel(instant: Date, timezone: string) {
  return DateTime.fromJSDate(instant, { zone: timezone }).toFormat("h:mm a");
}

export type { NotificationPreferences };
