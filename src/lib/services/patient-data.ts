import "server-only";
import { can, type Action } from "@/lib/domain/permissions";
import { requirePatientAccess } from "@/lib/auth/access";
import type { CurrentUser } from "@/lib/auth/session";
import { listAppointments } from "./appointments";
import { listDoses } from "./doses";
import { listMedications } from "./medications";
import { listDocuments } from "./documents";

/**
 * Phase 2 seam: one authorized entry point for "give me this patient's data".
 *
 * A future AI assistant must NOT query Firestore directly. It calls these
 * functions on behalf of the authenticated user, so every read passes the same
 * role/permission checks as the REST API and cross-patient retrieval is
 * impossible by construction (the patientId is always verified against the
 * caller's own membership first).
 */
export type DataScope = "medications" | "doses" | "appointments" | "documents";

const SCOPE_ACTION: Record<DataScope, Action> = {
  medications: "medications:read",
  doses: "doses:read",
  appointments: "appointments:read",
  documents: "documents:read",
};

export async function getAuthorizedPatientContext(user: CurrentUser, patientId: string, scopes: DataScope[]) {
  const { patient, membership } = await requirePatientAccess(user.uid, patientId, "patient:read");
  const allowed = scopes.filter((s) => can(membership, SCOPE_ACTION[s]));
  const out: {
    patient: { id: string; fullName: string; timezone: string };
    role: typeof membership.role;
    deniedScopes: DataScope[];
    medications?: Awaited<ReturnType<typeof listMedications>>;
    doses?: Awaited<ReturnType<typeof listDoses>>;
    appointments?: Awaited<ReturnType<typeof listAppointments>>;
    documents?: Awaited<ReturnType<typeof listDocuments>>;
  } = {
    patient: { id: patient.id, fullName: patient.fullName, timezone: patient.timezone },
    role: membership.role,
    deniedScopes: scopes.filter((s) => !allowed.includes(s)),
  };
  await Promise.all([
    allowed.includes("medications") && listMedications(user, patientId).then((r) => (out.medications = r)),
    allowed.includes("doses") && listDoses(user, patientId, {}).then((r) => (out.doses = r)),
    allowed.includes("appointments") && listAppointments(user, patientId, { scope: "upcoming" }).then((r) => (out.appointments = r)),
    allowed.includes("documents") && listDocuments(user, patientId).then((r) => (out.documents = r)),
  ].filter(Boolean));
  return out;
}
