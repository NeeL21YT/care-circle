import "server-only";
import { col, fromSnap } from "@/lib/db";
import { notFound } from "@/lib/api/errors";
import { assertCan, type Action } from "@/lib/domain/permissions";
import type { Membership, Patient } from "@/lib/domain/types";

export interface PatientAccess {
  patient: Patient;
  membership: Membership;
}

/**
 * The single authorization choke point for patient-scoped data.
 *
 * Verifies, in order: (1) the patient exists, (2) the caller has an ACTIVE
 * membership on THAT patient, (3) the membership's role/permissions allow the
 * action. Non-members get 404 (not 403) so patient ids cannot be enumerated.
 * The patientId always comes from the URL and is checked against the caller's
 * own membership document; it is never trusted on its own.
 */
export async function requirePatientAccess(
  uid: string,
  patientId: string,
  action: Action,
): Promise<PatientAccess> {
  const [pSnap, mSnap] = await Promise.all([
    col.patients().doc(patientId).get(),
    col.sub(patientId, "memberships").doc(uid).get(),
  ]);
  const patient = fromSnap<Patient>(pSnap);
  const membership = fromSnap<Membership>(mSnap);
  if (!patient || !membership || membership.status !== "active" || membership.uid !== uid) {
    throw notFound("That patient");
  }
  assertCan(membership, action);
  return { patient, membership };
}

/** Same, but returns null instead of throwing when the user lacks the action. */
export async function tryPatientAccess(uid: string, patientId: string, action: Action) {
  try {
    return await requirePatientAccess(uid, patientId, action);
  } catch {
    return null;
  }
}
