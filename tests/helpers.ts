import { FakeFirestore } from "./fake-firestore";
import { __setDbForTests } from "@/lib/firebase/admin";
import { __setEmailSender } from "@/lib/email/send";
import type { CurrentUser } from "@/lib/auth/session";
import type { SharePermissions } from "@/lib/domain/types";
import { createPatient } from "@/lib/services/patients";
import { createInvitation, acceptInvitation } from "@/lib/services/care-circle";
import type { RenderedEmail } from "@/lib/email/templates";
import type { SendResult } from "@/lib/email/send";
import { vi } from "vitest";

export const sentEmails: { to: string; email: RenderedEmail; idempotencyKey?: string }[] = [];

export function freshWorld() {
  const fake = new FakeFirestore();
  __setDbForTests(fake);
  sentEmails.length = 0;
  __setEmailSender(async (args): Promise<SendResult> => {
    sentEmails.push(args);
    return { sent: true, providerMessageId: `msg_${sentEmails.length}`, error: null };
  });
  return fake;
}

export function makeUser(
  fake: FakeFirestore,
  uid: string,
  accountType: CurrentUser["accountType"],
  opts: { verified?: boolean; email?: string } = {},
): CurrentUser {
  const email = opts.email ?? `${uid}@example.com`;
  const user: CurrentUser = {
    uid, email, emailVerified: opts.verified ?? true, displayName: `User ${uid}`, accountType,
  };
  void fake.doc(`users/${uid}`).set({ uid, email, displayName: user.displayName, accountType, createdAt: new Date() });
  return user;
}

export const PATIENT_INPUT = {
  fullName: "Asha Verma",
  dateOfBirth: "1946-03-02",
  gender: null,
  phone: null,
  email: null,
  preferredLanguage: "English",
  timezone: "Asia/Kolkata",
  emergencyContactName: null,
  emergencyContactPhone: null,
  medicalNotes: null,
};

export const MED_INPUT = {
  name: "Metformin",
  activeIngredient: null,
  strength: "500 mg",
  doseAmount: 1,
  doseUnit: "tablet",
  form: "Tablet",
  route: "Oral",
  schedule: { frequency: "daily" as const, times: ["08:00", "20:00"] },
  startDate: "2026-11-01",
  endDate: null,
  prescriber: null,
  instructions: "Take with food",
  status: "active" as const,
};

/** Captures the raw token from the email the invitation flow "sent". */
export function lastInviteToken(): string {
  const mail = sentEmails.at(-1);
  const m = mail?.email.text.match(/\/invite\/([A-Za-z0-9_-]+)/);
  if (!m) throw new Error("no invite link in last email");
  return m[1];
}

export async function addMember(
  fake: FakeFirestore,
  caregiver: CurrentUser,
  patientId: string,
  uid: string,
  role: "patient" | "family",
  permissions?: Partial<SharePermissions>,
) {
  const accountType = role === "patient" ? "patient" : "family";
  const user = makeUser(fake, uid, accountType);
  await createInvitation(caregiver, patientId, { email: user.email, role, permissions });
  await acceptInvitation(user, lastInviteToken());
  return user;
}

export async function standardWorld() {
  const fake = freshWorld();
  vi.useRealTimers();
  const caregiver = makeUser(fake, "cg1", "caregiver");
  const patient = await createPatient(caregiver, PATIENT_INPUT);
  const patientUser = await addMember(fake, caregiver, patient.id, "pt1", "patient");
  const family = await addMember(fake, caregiver, patient.id, "fm1", "family");
  sentEmails.length = 0; // drop invitation emails so tests only see worker output
  return { fake, caregiver, patient, patientUser, family };
}
