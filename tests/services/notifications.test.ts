import { describe, expect, it } from "vitest";
import { runTick } from "@/lib/services/jobs";
import { recordDoseEvent, snoozeDose } from "@/lib/services/doses";
import { createAppointment } from "@/lib/services/appointments";
import { savePreferences } from "@/lib/services/preferences";
import { deliverPendingEmails, listNotifications } from "@/lib/services/notifications";
import { __setEmailSender } from "@/lib/email/send";
import { sentEmails, standardWorld } from "../helpers";

const T0 = new Date("2026-11-15T08:00:00Z"); // dose time
const at = (min: number) => new Date(T0.getTime() + min * 60_000);

async function worldWithDose() {
  const w = await standardWorld();
  const occId = "medX_20261115T0800Z";
  await w.fake.doc(`patients/${w.patient.id}/doseOccurrences/${occId}`).set({
    patientId: w.patient.id, medicationId: "medX", medicationName: "Metformin", doseText: "1 tablet (500 mg)",
    instructions: "With food", scheduledAt: T0, timezone: "Asia/Kolkata", status: "scheduled",
    gracePeriodMinutes: 45, notifiedAt: null, respondedAt: null, snoozedUntil: null, createdAt: at(-60), updatedAt: at(-60),
  });
  // Give users real emails + opt caregiver/family into relevant emails.
  await savePreferences(w.caregiver, { patientId: w.patient.id, email: { upcomingDose: false, doseReminder: false, doseFollowUp: false, doseMissed: true, appointment: true }, quietHours: { enabled: false, start: "22:00", end: "07:00", timezone: "Asia/Kolkata" } });
  return { ...w, occId };
}
const notifs = (w: Awaited<ReturnType<typeof worldWithDose>>) =>
  [...w.fake.docs.entries()].filter(([k]) => k.startsWith(`patients/${w.patient.id}/notifications/`)).map(([k, v]) => ({ id: k.split("/").pop()!, ...(v as Record<string, any>) }) as Record<string, any>);
const occ = (w: Awaited<ReturnType<typeof worldWithDose>>) => w.fake.docs.get(`patients/${w.patient.id}/doseOccurrences/${w.occId}`) as Record<string, any>;

describe("notification worker", () => {
  it("sends the patient a reminder when due, marking the dose 'notified' (not acknowledged)", async () => {
    const w = await worldWithDose();
    const r = await runTick(at(1));
    expect(r.doseNotificationsCreated).toBe(1);
    expect(r.dosesNotified).toBe(1);
    expect(occ(w).status).toBe("notified");
    expect(sentEmails.map((e) => e.to)).toEqual(["pt1@example.com"]);
    expect(sentEmails[0].email.subject).toContain("Metformin");
  });

  it("is idempotent: running the tick repeatedly never duplicates notifications or sends", async () => {
    const w = await worldWithDose();
    await runTick(at(1));
    await runTick(at(1));
    await runTick(at(2));
    await Promise.all([runTick(at(3)), runTick(at(3))]);
    expect(notifs(w).filter((n) => n.stage === "due")).toHaveLength(1);
    expect(sentEmails).toHaveLength(1);
  });

  it("escalates in order: reminder -> follow-up -> caregiver, then marks missed-by-policy", async () => {
    const w = await worldWithDose();
    await runTick(at(1));          // reminder
    expect(sentEmails).toHaveLength(1);
    await runTick(at(16));         // follow-up
    expect(sentEmails.map((e) => e.to)).toEqual(["pt1@example.com", "pt1@example.com"]);
    await runTick(at(46));         // escalation to caregiver
    expect(sentEmails.at(-1)!.to).toBe("cg1@example.com");
    expect(occ(w).status).toBe("missed_by_policy");
    expect(sentEmails.at(-1)!.email.text).toContain("does not mean the medicine was or was not taken");
    // Family has no adherence grant and default prefs off: no email.
    expect(sentEmails.some((e) => e.to === "fm1@example.com")).toBe(false);
    // No further sends however often it runs.
    const n = sentEmails.length;
    await runTick(at(90)); await runTick(at(120));
    expect(sentEmails).toHaveLength(n);
  });

  it("stops everything once the patient answers, and never sends a stale queued email", async () => {
    const w = await worldWithDose();
    await runTick(at(1));
    await recordDoseEvent(w.patientUser, w.patient.id, w.occId, { eventType: "reported_taken" });
    await runTick(at(60));
    expect(sentEmails).toHaveLength(1);
    expect(notifs(w).some((n) => n.stage === "follow_up" || n.stage === "escalate")).toBe(false);
    expect(occ(w).status).toBe("reported_taken");
  });

  it("drops a queued email if the patient answered before it was delivered (quiet hours case)", async () => {
    const w = await worldWithDose();
    // Quiet hours cover 13:00-14:00 IST (07:30-08:30Z).
    await savePreferences(w.patientUser, { patientId: w.patient.id, email: { upcomingDose: false, doseReminder: true, doseFollowUp: true, doseMissed: false, appointment: true }, quietHours: { enabled: true, start: "13:00", end: "14:00", timezone: "Asia/Kolkata" } });
    await runTick(at(1));
    expect(sentEmails).toHaveLength(0); // held for quiet hours
    expect(notifs(w)[0].deliveries.email.status).toBe("pending");
    await recordDoseEvent(w.patientUser, w.patient.id, w.occId, { eventType: "reported_taken" });
    await runTick(at(40)); // quiet hours over
    expect(sentEmails).toHaveLength(0);
    expect(notifs(w).find((n) => n.stage === "due")!.deliveries.email).toMatchObject({ status: "skipped", skipReason: "resolved_before_delivery" });
  });

  it("holds email during quiet hours and sends after they end (in-app record exists immediately)", async () => {
    const w = await worldWithDose();
    // Quiet hours 13:00-13:40 IST = 07:30-08:10Z; the dose is at 08:00Z.
    await savePreferences(w.patientUser, { patientId: w.patient.id, email: { upcomingDose: false, doseReminder: true, doseFollowUp: true, doseMissed: false, appointment: true }, quietHours: { enabled: true, start: "13:00", end: "13:40", timezone: "Asia/Kolkata" } });
    await runTick(at(1));
    expect(sentEmails).toHaveLength(0);
    const inbox = await listNotifications(w.patientUser, w.patient.id);
    expect(inbox.some((n) => n.type === "dose_reminder")).toBe(true);
    await runTick(at(11));
    expect(sentEmails).toHaveLength(1);
  });

  it("respects disabled email preferences but still records in-app", async () => {
    const w = await worldWithDose();
    await savePreferences(w.patientUser, { patientId: w.patient.id, email: { upcomingDose: false, doseReminder: false, doseFollowUp: false, doseMissed: false, appointment: false }, quietHours: { enabled: false, start: "22:00", end: "07:00", timezone: "Asia/Kolkata" } });
    await runTick(at(1));
    expect(sentEmails).toHaveLength(0);
    const n = notifs(w)[0];
    expect(n.deliveries.in_app.status).toBe("sent");
    expect(n.deliveries.email).toMatchObject({ status: "skipped", skipReason: "preference_disabled" });
  });

  it("a snoozed dose is reminded again after the snooze, once", async () => {
    const w = await worldWithDose();
    await runTick(at(1));
    await snoozeDose(w.patientUser, w.patient.id, w.occId, 10);
    // Pretend the snooze was recorded at at(2): fix snoozedUntil deterministically.
    occ(w).snoozedUntil = at(12);
    await runTick(at(5));
    expect(sentEmails).toHaveLength(1); // still snoozed
    await runTick(at(13));
    await runTick(at(13));
    expect(sentEmails).toHaveLength(2); // exactly one post-snooze reminder
  });

  it("records provider delivery results separately from patient acknowledgement", async () => {
    const w = await worldWithDose();
    await runTick(at(1));
    const n = notifs(w).find((x) => x.stage === "due")!;
    expect(n.deliveries.email).toMatchObject({ status: "sent", providerMessageId: "msg_1", attempts: 1 });
    expect(occ(w).status).toBe("notified"); // delivered, NOT acknowledged
    expect(occ(w).respondedAt).toBeNull();
  });

  it("retries failed sends up to 3 times, then marks failed; passes an idempotency key", async () => {
    const w = await worldWithDose();
    const keys: (string | undefined)[] = [];
    __setEmailSender(async (a) => { keys.push(a.idempotencyKey); return { sent: false, providerMessageId: null, error: "boom" }; });
    await runTick(at(1));
    await runTick(at(2));
    await runTick(at(3));
    await runTick(at(4));
    const n = notifs(w).find((x) => x.stage === "due")!;
    expect(n.deliveries.email).toMatchObject({ status: "failed", attempts: 3, lastError: "boom" });
    expect(keys.filter((k) => k === `notif_${n.id}`)).toHaveLength(3);
  });

  it("two workers racing never double-send (lease claim)", async () => {
    const w = await worldWithDose();
    await runTick(at(1));
    // Add a second pending notification and race two delivery passes.
    const [key] = [...w.fake.docs.keys()].filter((k) => k.includes("/notifications/"));
    const doc = w.fake.docs.get(key)! as any;
    doc.deliveries.email = { ...doc.deliveries.email, status: "pending", attempts: 0, sentAt: null };
    sentEmails.length = 0;
    __setEmailSender(async (a) => { sentEmails.push(a); await new Promise((r) => setTimeout(r, 5)); return { sent: true, providerMessageId: "m", error: null }; });
    await Promise.all([deliverPendingEmails(at(2)), deliverPendingEmails(at(2))]);
    expect(sentEmails).toHaveLength(1);
  });
});

describe("appointment reminders", () => {
  it("creates each reminder once, only inside its window, and never for stale offsets", async () => {
    const w = await standardWorld();
    await savePreferences(w.caregiver, { patientId: w.patient.id, email: { upcomingDose: false, doseReminder: false, doseFollowUp: false, doseMissed: true, appointment: true }, quietHours: { enabled: false, start: "22:00", end: "07:00", timezone: "Asia/Kolkata" } });
    const start = new Date(Date.now() + 26 * 3600_000);
    const local = new Date(start.getTime() + 5.5 * 3600_000).toISOString();
    const appt = await createAppointment(w.caregiver, w.patient.id, {
      doctorName: "Dr. Rao", facility: "City Clinic", date: local.slice(0, 10), time: local.slice(11, 16),
      location: "Room 4", appointmentType: "Checkup", notes: null, reminderOffsetsMinutes: [1440, 60],
    });
    // 25h before... the 24h reminder is not due yet.
    await runTick(new Date(Date.now()));
    expect(sentEmails).toHaveLength(0);
    // 23.5h before: 1440 reminder fires for patient + caregiver (family has no grant).
    const t1 = new Date(appt.startsAt.getTime() - 23.5 * 3600_000);
    await runTick(t1); await runTick(t1);
    expect(sentEmails.map((e) => e.to).sort()).toEqual(["cg1@example.com", "pt1@example.com"]);
    // 50 minutes before: 60-minute reminder.
    const t2 = new Date(appt.startsAt.getTime() - 50 * 60_000);
    await runTick(t2); await runTick(t2);
    expect(sentEmails).toHaveLength(4);
    expect(sentEmails.at(-1)!.email.subject).toContain("Dr. Rao");
  });
});
