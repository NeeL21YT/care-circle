import "server-only";
import { DateTime } from "luxon";
import { col, db, fromData, toData } from "@/lib/db";
import { adminAuth } from "@/lib/firebase/admin";
import type { CurrentUser } from "@/lib/auth/session";
import { FULL_SHARE } from "@/lib/domain/permissions";
import { appointmentInputSchema, taskCreateSchema } from "@/lib/domain/schemas";
import type { DoseEvent, DoseOccurrence, Medication, Membership, Patient } from "@/lib/domain/types";
import { createAppointment, listAppointments } from "@/lib/services/appointments";
import { createTask } from "@/lib/services/care-tasks";
import { doseText } from "@/lib/services/doses";
import { prepareHandover, shareHandover } from "@/lib/services/handovers";
import { createMedication, listMedications, reconcileOccurrences } from "@/lib/services/medications";
import { createPatient } from "@/lib/services/patients";
import { mapLimit } from "@/lib/async";
import { DEMO_PEOPLE, DEMO_UIDS } from "./index";

const TZ = "Asia/Kolkata";

export interface DemoAuth {
  ensureUser(u: { uid: string; email: string; displayName: string }): Promise<void>;
}

/** Real Firebase Auth users with no password, so they can only be entered through the demo endpoint. */
const firebaseDemoAuth: DemoAuth = {
  async ensureUser(u) {
    const auth = adminAuth();
    try {
      const cur = await auth.getUser(u.uid);
      if (!cur.emailVerified) await auth.updateUser(u.uid, { emailVerified: true });
    } catch (e) {
      if ((e as { code?: string }).code !== "auth/user-not-found") throw e;
      await auth.createUser({ uid: u.uid, email: u.email, displayName: u.displayName, emailVerified: true });
    }
  },
};

const asUser = (role: keyof typeof DEMO_UIDS): CurrentUser => ({
  uid: DEMO_UIDS[role], email: "", emailVerified: true, displayName: DEMO_PEOPLE[role].name,
  accountType: role === "caregiver" ? "caregiver" : role === "patient" ? "patient" : "family",
});

const stateRef = () => db().collection("demo").doc("state");
const isAlreadyExists = (e: unknown) => (e as { code?: number | string })?.code === 6 || String((e as Error)?.message).includes("ALREADY_EXISTS");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const MEDS = [
  { name: "Metformin", strength: "500 mg", doseAmount: 1, doseUnit: "tablet", form: "Tablet", times: ["08:00", "20:00"], instructions: "Take with food." },
  { name: "Amlodipine", strength: "5 mg", doseAmount: 1, doseUnit: "tablet", form: "Tablet", times: ["09:00"], instructions: "Take in the morning." },
  { name: "Atorvastatin", strength: "10 mg", doseAmount: 1, doseUnit: "tablet", form: "Tablet", times: ["21:00"], instructions: "Take after dinner." },
];

type Status = DoseOccurrence["status"];
/** A believable, deterministic history: mostly reported taken, with one skip, one gap and one open reminder today. */
function statusFor(dayOffset: number, med: number, slot: number, firstPastToday: boolean): Status {
  if (dayOffset === 0) return firstPastToday ? "reported_taken" : "notified";
  if (dayOffset === -1 && med === 0 && slot === 1) return "reported_skipped";
  if (dayOffset === -2 && med === 0 && slot === 0) return "missed_by_policy";
  return "reported_taken";
}

/** Adds the last 3 days of dose history. Uses create(), so reruns never overwrite what a visitor changed. */
async function topUpHistory(patient: Patient, meds: Medication[], now: Date) {
  const today = DateTime.fromJSDate(now, { zone: TZ }).startOf("day");
  const ordered = MEDS.map((m) => meds.find((x) => x.name === m.name)).filter(Boolean) as Medication[];
  const rows: { path: "doseOccurrences" | "doseEvents"; id: string; data: DoseOccurrence | DoseEvent }[] = [];
  for (let off = -3; off <= 0; off++) {
    const day = today.plus({ days: off });
    for (const [mi, med] of ordered.entries()) {
      const times = [...med.schedule.times].sort();
      let pastToday = 0;
      for (const [si, t] of times.entries()) {
        const [h, m] = t.split(":").map(Number);
        const at = day.set({ hour: h, minute: m }).toUTC().toJSDate();
        if (at >= now) continue;
        const status = statusFor(off, mi, si, off === 0 && pastToday++ === 0);
        const id = `demo_${med.id}_${day.toFormat("yyyyMMdd")}_${t.replace(":", "")}`;
        const responded = status === "reported_taken" || status === "reported_skipped" ? new Date(at.getTime() + 12 * 60_000) : null;
        rows.push({ path: "doseOccurrences", id, data: {
          id, patientId: patient.id, medicationId: med.id, medicationName: med.name, doseText: doseText(med), instructions: med.instructions,
          scheduledAt: at, timezone: TZ, status, gracePeriodMinutes: patient.escalationPolicy.escalateAfterMinutes,
          notifiedAt: new Date(at.getTime() + 60_000), respondedAt: responded, snoozedUntil: null, createdAt: at, updatedAt: responded ?? at,
        } });
        if (responded) {
          rows.push({ path: "doseEvents", id: `${id}_demo`, data: {
            id: `${id}_demo`, patientId: patient.id, doseOccurrenceId: id, eventType: status === "reported_taken" ? "reported_taken" : "reported_skipped",
            userId: DEMO_UIDS.patient, source: "patient_ui", note: null, occurredAt: responded, recordedAt: responded, clientEventId: null,
            previousStatus: "notified", resultingStatus: status,
          } });
        }
      }
    }
  }
  await mapLimit(rows, 12, async (r) => {
    try {
      await col.sub(patient.id, r.path).doc(r.id).create(toData(r.data));
    } catch (e) {
      if (!isAlreadyExists(e)) throw e;
    }
  });
}

async function firstTimeSeed(now: Date, auth: DemoAuth): Promise<string> {
  for (const r of ["caregiver", "patient", "family"] as const) {
    const p = DEMO_PEOPLE[r];
    await auth.ensureUser({ uid: DEMO_UIDS[r], email: p.email, displayName: p.name });
    await col.users().doc(DEMO_UIDS[r]).set({ uid: DEMO_UIDS[r], email: p.email, displayName: p.name, accountType: asUser(r).accountType, createdAt: now });
  }
  const caregiver = asUser("caregiver");
  const patient = await createPatient(caregiver, {
    fullName: "Asha Verma", dateOfBirth: "1952-03-14", gender: "Female", phone: null, email: null, preferredLanguage: "English", timezone: TZ,
    emergencyContactName: "Meera Verma", emergencyContactPhone: "+91 00000 00000", medicalNotes: "Made-up demo profile.",
  });
  // Memberships are written directly (email left empty so no reminder email is ever attempted for demo people).
  const member = (r: "patient" | "family"): Membership => ({
    uid: DEMO_UIDS[r], patientId: patient.id, role: r, permissions: { ...FULL_SHARE },
    status: "active", displayName: DEMO_PEOPLE[r].name, email: "", invitedByUid: caregiver.uid, createdAt: now, updatedAt: now,
  });
  for (const r of ["patient", "family"] as const) await col.sub(patient.id, "memberships").doc(DEMO_UIDS[r]).set(member(r));

  const start = DateTime.fromJSDate(now, { zone: TZ }).minus({ days: 30 }).toFormat("yyyy-MM-dd");
  for (const m of MEDS) {
    await createMedication(caregiver, patient.id, {
      name: m.name, activeIngredient: null, strength: m.strength, doseAmount: m.doseAmount, doseUnit: m.doseUnit, form: m.form, route: "Oral",
      schedule: { frequency: "daily", times: m.times }, startDate: start, endDate: null, prescriber: "Dr. R. Rao", instructions: m.instructions, status: "active",
    });
  }
  const meds = await listMedications(caregiver, patient.id);
  await topUpHistory(patient, meds, now);

  const day = (n: number) => DateTime.fromJSDate(now, { zone: TZ }).plus({ days: n }).toFormat("yyyy-MM-dd");
  await createAppointment(caregiver, patient.id, appointmentInputSchema.parse({ doctorName: "Dr. R. Rao", facility: "City Clinic", date: day(3), time: "11:30", location: "Second floor, Room 4", appointmentType: "Check-up", notes: "Bring the latest blood test report." }));

  const t = (o: Record<string, unknown>) => createTask(caregiver, patient.id, taskCreateSchema.parse(o));
  await t({ title: "Confirm Thursday's appointment with the clinic", assignedToUid: DEMO_UIDS.family, dueDate: day(1), priority: "high" });
  await t({ title: "Collect the new prescription", description: "From the clinic reception.", dueDate: day(-1) });
  await t({ title: "Arrange transport for the check-up", assignedToUid: DEMO_UIDS.caregiver, dueDate: day(2) });

  // A real handover from Meera to Rahul, built from the records above (plain facts: no AI call during seeding).
  const h = await prepareHandover(caregiver, patient.id, { periodHours: 48, useAi: false });
  await shareHandover(caregiver, patient.id, h.id, DEMO_UIDS.family);
  return patient.id;
}

/** Remembers the patient id for the rest of the local day, so a role switch needs no database read at all. */
let memo: { day: string; patientId: string } | null = null;
export function __resetDemoCache() {
  memo = null;
}

/**
 * Makes sure the demo world exists and is current, and returns the demo patient's id.
 * Idempotent and safe under concurrent visitors (a claim document decides who seeds).
 */
export async function ensureDemoWorld(opts: { auth?: DemoAuth; now?: Date } = {}): Promise<string> {
  const auth = opts.auth ?? firebaseDemoAuth;
  const now = opts.now ?? new Date();
  const ref = stateRef();
  const today = DateTime.fromJSDate(now, { zone: TZ }).toFormat("yyyy-MM-dd");
  if (memo?.day === today) return memo.patientId;

  for (let attempt = 0; attempt < 60; attempt++) {
    const snap = await ref.get();
    let state = snap.exists ? fromData<{ status: string; patientId?: string; startedAt: Date; refreshedDay?: string }>(snap.data()) : null;
    if (!state) {
      try {
        const startedAt = new Date();
        await ref.create({ status: "seeding", startedAt });
        state = { status: "seeding", startedAt };
        try {
          const patientId = await firstTimeSeed(now, auth);
          await ref.set({ status: "ready", patientId, seededAt: new Date(), startedAt: state.startedAt, refreshedDay: DateTime.fromJSDate(now, { zone: TZ }).toFormat("yyyy-MM-dd") });
          return patientId;
        } catch (e) {
          // Let the next visitor retry cleanly, but ONLY clear our own claim (never another run's "ready" state).
          const cur = await ref.get().catch(() => null);
          if (cur?.exists) {
            const c = fromData<{ status: string; startedAt: Date }>(cur.data());
            if (c.status === "seeding" && c.startedAt.getTime() === state.startedAt.getTime()) await ref.delete().catch(() => undefined);
          }
          throw e;
        }
      } catch (e) {
        if (!isAlreadyExists(e)) throw e;
        continue;
      }
    }
    if (state.status === "ready" && state.patientId) {
      // Visitors normally do no writes: the refresh runs at most once per local day.
      if (state.refreshedDay !== today) {
        await refresh(state.patientId, now);
        await ref.update({ refreshedDay: today });
      }
      memo = { day: today, patientId: state.patientId };
      return state.patientId;
    }
    // Someone else is seeding. Wait for them, unless they seem to have died.
    if (now.getTime() - state.startedAt.getTime() > 90_000) await ref.delete().catch(() => undefined);
    else await sleep(250);
  }
  throw new Error("The demo is still being prepared. Please try again in a moment.");
}

/** Keeps the demo current: recent history, future reminders and an upcoming appointment. */
async function refresh(patientId: string, now: Date) {
  const caregiver = asUser("caregiver");
  const snap = await col.patients().doc(patientId).get();
  if (!snap.exists) return;
  const patient = { ...fromData<Patient>(snap.data()), id: patientId };
  const meds = await listMedications(caregiver, patientId);
  await topUpHistory(patient, meds, now);
  for (const m of meds) if (m.status === "active") await reconcileOccurrences(patient, m, now);
  const upcoming = (await listAppointments(caregiver, patientId, { scope: "upcoming" })).filter((a) => a.status === "scheduled");
  if (!upcoming.length) {
    const date = DateTime.fromJSDate(now, { zone: TZ }).plus({ days: 3 }).toFormat("yyyy-MM-dd");
    await createAppointment(caregiver, patientId, appointmentInputSchema.parse({ doctorName: "Dr. R. Rao", facility: "City Clinic", date, time: "11:30", location: "Second floor, Room 4", appointmentType: "Check-up", notes: "Bring the latest blood test report." }));
  }
}
