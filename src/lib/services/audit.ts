import "server-only";
import { col } from "@/lib/db";

export type AuditAction =
  | "patient.create" | "patient.update" | "patient.policy_update"
  | "member.invite" | "member.invite_revoke" | "member.accept" | "member.revoke" | "member.permissions_update"
  | "medication.create" | "medication.update" | "medication.status_change"
  | "dose.event"
  | "appointment.create" | "appointment.update" | "appointment.cancel"
  | "document.upload" | "document.delete" | "document.access"
  | "preferences.update"
  | "task.create" | "task.assign" | "task.status" | "task.note"
  | "handover.create" | "handover.share" | "handover.acknowledge" | "handover.delete"
  | "assistant.message" | "assistant.confirm" | "assistant.cancel" | "assistant.delete_conversation"
  | "prescription.reconcile" | "prescription.extract" | "prescription.edit" | "prescription.approve" | "prescription.reject";

/**
 * Append-only audit trail. Metadata holds ids and changed field NAMES only;
 * never health details, so the audit log itself is not a leak vector.
 */
export async function audit(
  patientId: string,
  actorUid: string | null,
  action: AuditAction,
  resource: { type: string; id: string },
  metadata: Record<string, string | number | boolean | string[] | null> = {},
) {
  await col.sub(patientId, "auditEvents").doc().set({
    patientId,
    actorUid,
    action,
    resourceType: resource.type,
    resourceId: resource.id,
    metadata,
    at: new Date(),
  });
}

import { fromData } from "@/lib/db";
import { requirePatientAccess } from "@/lib/auth/access";
import type { CurrentUser } from "@/lib/auth/session";

/** Activity history, visible to primary caregivers only. */
export async function listAudit(user: CurrentUser, patientId: string, limit = 100) {
  await requirePatientAccess(user.uid, patientId, "audit:read");
  const snap = await col.sub(patientId, "auditEvents").orderBy("at", "desc").limit(limit).get();
  return snap.docs.map((d) => ({ ...fromData<{ at: Date; actorUid: string | null; action: string; resourceType: string; resourceId: string; metadata: Record<string, unknown> }>(d.data()), id: d.id }));
}
