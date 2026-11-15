import "server-only";
import { col, fromData } from "@/lib/db";
import { requirePatientAccess } from "@/lib/auth/access";
import { can } from "@/lib/domain/permissions";
import type { CurrentUser } from "@/lib/auth/session";
import type { CareActivityEvent } from "@/lib/domain/types";

/**
 * Human-readable, append-only feed of coordination events (tasks, handovers).
 * Summaries are short and contain no medical detail. Medication events live in
 * the dose history and the audit log and are not copied here.
 */
/** Strictly increasing within a process, so events logged in the same millisecond keep their order. */
let lastSeq = 0;
const nextSeq = () => (lastSeq = Math.max(lastSeq + 1, Date.now() * 1000));

export async function logActivity(
  patientId: string,
  e: Omit<CareActivityEvent, "id" | "patientId" | "at"> & { at?: Date },
) {
  const ref = col.sub(patientId, "careActivity").doc();
  await ref.set({ ...e, id: ref.id, patientId, at: e.at ?? new Date(), seq: nextSeq() });
}

export async function listActivity(user: CurrentUser, patientId: string, limit = 50): Promise<CareActivityEvent[]> {
  const { membership } = await requirePatientAccess(user.uid, patientId, "patient:read");
  const canTasks = can(membership, "tasks:read");
  const canHandovers = can(membership, "handovers:read");
  const snap = await col.sub(patientId, "careActivity").orderBy("seq", "desc").limit(Math.min(limit, 100) * 2).get();
  return snap.docs
    .map((d) => ({ ...fromData<CareActivityEvent>(d.data()), id: d.id }))
    .filter((e) => (e.category === "task" ? canTasks : canHandovers))
    // Patients only see activity about tasks that concern them: the task service already
    // limits their task list, and activity summaries name the people involved, so keep it to the circle.
    .filter(() => membership.role !== "patient")
    .slice(0, limit);
}
