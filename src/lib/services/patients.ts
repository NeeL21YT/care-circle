import "server-only";
import { col, db, fromSnap, toData } from "@/lib/db";
import { DEFAULT_ESCALATION_POLICY, type EscalationPolicy, type Membership, type Patient } from "@/lib/domain/types";
import { FULL_SHARE, assertCan } from "@/lib/domain/permissions";
import type { PatientInput } from "@/lib/domain/schemas";
import { validatePolicy } from "@/lib/domain/escalation";
import { badRequest } from "@/lib/api/errors";
import type { CurrentUser } from "@/lib/auth/session";
import { requirePatientAccess } from "@/lib/auth/access";
import { audit } from "./audit";
import { ForbiddenError } from "@/lib/domain/permissions";

/** Which patient fields each role may see. Family sees basic identity only. */
export function viewPatient(p: Patient, role: Membership["role"]): Partial<Patient> & { id: string } {
  if (role === "family") {
    return { id: p.id, fullName: p.fullName, photoPath: p.photoPath, preferredLanguage: p.preferredLanguage, timezone: p.timezone };
  }
  if (role === "patient") {
    // Patients see their own record but not caregiver-only operational data.
    const { escalationPolicy: _e, createdByUid: _c, ...rest } = p;
    void _e; void _c;
    return rest;
  }
  return p;
}

export async function createPatient(user: CurrentUser, input: PatientInput): Promise<Patient> {
  if (user.accountType !== "caregiver") {
    throw new ForbiddenError("Only caregiver accounts can create patient profiles.");
  }
  const ref = col.patients().doc();
  const now = new Date();
  const patient: Patient = {
    id: ref.id,
    fullName: input.fullName,
    photoPath: null,
    dateOfBirth: input.dateOfBirth,
    gender: input.gender ?? null,
    phone: input.phone ?? null,
    email: input.email ?? null,
    preferredLanguage: input.preferredLanguage,
    timezone: input.timezone,
    emergencyContactName: input.emergencyContactName ?? null,
    emergencyContactPhone: input.emergencyContactPhone ?? null,
    medicalNotes: input.medicalNotes ?? null,
    escalationPolicy: DEFAULT_ESCALATION_POLICY,
    createdByUid: user.uid,
    createdAt: now,
    updatedAt: now,
  };
  const membership: Membership = {
    uid: user.uid,
    patientId: ref.id,
    role: "primary_caregiver",
    permissions: { ...FULL_SHARE },
    status: "active",
    displayName: user.displayName,
    email: user.email,
    invitedByUid: null,
    createdAt: now,
    updatedAt: now,
  };
  const batch = db().batch();
  batch.set(ref, toData(patient));
  batch.set(col.sub(ref.id, "memberships").doc(user.uid), toData({ ...membership, id: user.uid }));
  await batch.commit();
  await audit(ref.id, user.uid, "patient.create", { type: "patient", id: ref.id });
  return patient;
}

export async function listPatientsForUser(uid: string) {
  const ms = await db()
    .collectionGroup("memberships")
    .where("uid", "==", uid)
    .where("status", "==", "active")
    .get();
  const out: { patient: Partial<Patient> & { id: string }; role: Membership["role"] }[] = [];
  await Promise.all(
    ms.docs.map(async (m) => {
      const patientId = m.ref.parent.parent!.id;
      const p = fromSnap<Patient>(await col.patients().doc(patientId).get());
      const role = (m.data() as { role: Membership["role"] }).role;
      if (p) out.push({ patient: viewPatient(p, role), role });
    }),
  );
  return out.sort((a, b) => (a.patient.fullName ?? "").localeCompare(b.patient.fullName ?? ""));
}

export async function getPatientForUser(uid: string, patientId: string) {
  const { patient, membership } = await requirePatientAccess(uid, patientId, "patient:read");
  return { patient: viewPatient(patient, membership.role), membership };
}

export async function updatePatient(
  user: CurrentUser,
  patientId: string,
  changes: Partial<PatientInput>,
) {
  const { membership } = await requirePatientAccess(user.uid, patientId, "patient:read");
  // Caregivers edit everything; patients may only edit basic preferences.
  if (membership.role === "patient") {
    assertCan(membership, "patient:updatePreferences");
    const allowed = new Set(["phone", "email", "preferredLanguage"]);
    const bad = Object.keys(changes).filter((k) => !allowed.has(k));
    if (bad.length) throw new ForbiddenError("Patients can only change their phone, email and language.");
  } else {
    assertCan(membership, "patient:update");
  }
  const clean = Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== undefined));
  await col.patients().doc(patientId).update({ ...clean, updatedAt: new Date() });
  await audit(patientId, user.uid, "patient.update", { type: "patient", id: patientId }, { fields: Object.keys(clean) });
  return (await getPatientForUser(user.uid, patientId)).patient;
}

export async function updateEscalationPolicy(user: CurrentUser, patientId: string, policy: EscalationPolicy) {
  const { patient } = await requirePatientAccess(user.uid, patientId, "policy:update");
  const problem = validatePolicy(policy);
  if (problem) throw badRequest(problem);
  await col.patients().doc(patientId).update({ escalationPolicy: policy, updatedAt: new Date() });
  await audit(patientId, user.uid, "patient.policy_update", { type: "patient", id: patientId });
  return { ...patient, escalationPolicy: policy };
}

// ---- Profile photograph ----
import { fileStore } from "@/lib/storage";
import { sniffContentType } from "./documents";

const MAX_PHOTO_BYTES = 1024 * 1024;

export async function uploadPatientPhoto(user: CurrentUser, patientId: string, bytes: Uint8Array) {
  await requirePatientAccess(user.uid, patientId, "patient:update");
  if (bytes.length === 0 || bytes.length > MAX_PHOTO_BYTES) throw badRequest("Choose a photo under 1 MB.");
  const type = sniffContentType(bytes);
  if (type !== "image/jpeg" && type !== "image/png") throw badRequest("The photo must be a JPG or PNG image.");
  const path = `patients/${patientId}/profile/photo.${type === "image/png" ? "png" : "jpg"}`;
  await fileStore().save(path, bytes, type);
  await col.patients().doc(patientId).update({ photoPath: path, updatedAt: new Date() });
  await audit(patientId, user.uid, "patient.update", { type: "patient", id: patientId }, { fields: ["photoPath"] });
  return { photoPath: path };
}

/** Short-lived signed URL for a patient's photo, or null. Callers must already be authorized. */
export async function photoUrl(photoPath: string | null | undefined): Promise<string | null> {
  if (!photoPath) return null;
  try {
    return await fileStore().signedUrl(photoPath, 15 * 60);
  } catch {
    return null;
  }
}
