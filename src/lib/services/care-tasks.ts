import "server-only";
import { DateTime } from "luxon";
import { randomUUID } from "node:crypto";
import { col, fromData, fromSnap, toData } from "@/lib/db";
import { badRequest, conflict, notFound } from "@/lib/api/errors";
import { requirePatientAccess } from "@/lib/auth/access";
import type { CurrentUser } from "@/lib/auth/session";
import { can, ForbiddenError } from "@/lib/domain/permissions";
import { canMoveStatus } from "@/lib/domain/task-state";
import type { TaskCreateInput } from "@/lib/domain/schemas";
import { OPEN_TASK_STATUSES, type CareTask, type Membership, type Patient, type TaskStatus } from "@/lib/domain/types";
import { audit } from "./audit";
import { logActivity } from "./care-activity";
import { createNotificationOnce } from "./notifications";
import { runTx } from "@/lib/db/transaction";

const tasks = (patientId: string) => col.sub(patientId, "careTasks");
const MAX_NOTES = 50;

function dueInstant(date: string | null, time: string | null, tz: string): Date | null {
  if (!date) return null;
  const dt = DateTime.fromISO(`${date}T${time ?? "23:59"}`, { zone: tz });
  if (!dt.isValid) throw badRequest("Enter a valid due date and time.");
  return dt.toUTC().toJSDate();
}

/** Assignees must be ACTIVE members of THIS patient's circle who can act on tasks. */
async function resolveAssignee(patientId: string, uid: string) {
  const m = fromSnap<Membership>(await col.sub(patientId, "memberships").doc(uid).get());
  if (!m || m.status !== "active" || !can(m, "tasks:respond")) {
    throw badRequest("That person cannot be given tasks. Choose someone in the care circle who can see care tasks.");
  }
  return m;
}

async function notifyAssignee(patient: Patient, task: CareTask, assignee: Membership, actorName: string, type: "task_assigned" | "task_reassigned", version: number) {
  await createNotificationOnce({
    // Deterministic: one notification per (task, assignee, assignment version).
    id: `task_${task.id}_${assignee.uid}_v${version}`,
    patient,
    recipient: { uid: assignee.uid, role: assignee.role, email: assignee.email },
    type,
    title: type === "task_assigned" ? "A care task was given to you" : "A care task was handed over to you",
    body: `${actorName}: ${task.title}`,
    resourceId: task.id,
    stage: "assigned",
    payload: { kind: "care", patientName: patient.fullName },
    now: new Date(),
  });
}

function visibleTo(membership: Membership, task: CareTask) {
  // Patients only ever see tasks assigned to them.
  return membership.role !== "patient" || task.assignedToUid === membership.uid;
}

export async function createTask(user: CurrentUser, patientId: string, input: TaskCreateInput) {
  const { patient } = await requirePatientAccess(user.uid, patientId, "tasks:write");
  const assignee = input.assignedToUid ? await resolveAssignee(patientId, input.assignedToUid) : null;
  const now = new Date();
  // A client request id makes retries idempotent: the second create finds the first.
  const ref = input.clientRequestId ? tasks(patientId).doc(`req_${user.uid.slice(0, 12)}_${input.clientRequestId}`) : tasks(patientId).doc();
  const existing = fromSnap<CareTask>(await ref.get());
  if (existing) return existing;
  const task: CareTask = {
    id: ref.id,
    patientId,
    title: input.title,
    description: input.description ?? null,
    assignedToUid: assignee?.uid ?? null,
    assignedToName: assignee?.displayName ?? null,
    createdByUid: user.uid,
    createdByName: user.displayName,
    dueAt: dueInstant(input.dueDate, input.dueTime, patient.timezone),
    priority: input.priority,
    status: "pending",
    notes: [],
    related: input.related,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    completedByUid: null,
  };
  await ref.create(toData(task));
  await logActivity(patientId, { category: "task", type: "task_created", actorUid: user.uid, actorName: user.displayName, summary: `${user.displayName} created the task "${task.title}"${assignee ? ` for ${assignee.displayName}` : " (unassigned)"}.`, resourceType: "careTask", resourceId: task.id });
  await audit(patientId, user.uid, "task.create", { type: "careTask", id: task.id }, { assigned: Boolean(assignee) });
  if (assignee && assignee.uid !== user.uid) await notifyAssignee(patient, task, assignee, user.displayName, "task_assigned", 1);
  return task;
}

export async function listTasks(user: CurrentUser, patientId: string, q: { filter?: "open" | "mine" | "unassigned" | "all" } = {}) {
  const { membership } = await requirePatientAccess(user.uid, patientId, "tasks:read");
  const snap = await tasks(patientId).orderBy("createdAt", "desc").limit(300).get();
  let rows = snap.docs.map((d) => ({ ...fromData<CareTask>(d.data()), id: d.id })).filter((t) => visibleTo(membership, t));
  const filter = q.filter ?? "open";
  if (filter === "open") rows = rows.filter((t) => OPEN_TASK_STATUSES.includes(t.status));
  if (filter === "mine") rows = rows.filter((t) => t.assignedToUid === user.uid && OPEN_TASK_STATUSES.includes(t.status));
  if (filter === "unassigned") rows = rows.filter((t) => !t.assignedToUid && OPEN_TASK_STATUSES.includes(t.status));
  const rank = (t: CareTask) => (OPEN_TASK_STATUSES.includes(t.status) ? 0 : 1);
  return rows.sort((a, b) => rank(a) - rank(b) || (a.dueAt?.getTime() ?? Infinity) - (b.dueAt?.getTime() ?? Infinity) || +b.createdAt - +a.createdAt);
}

async function loadFor(user: CurrentUser, patientId: string, id: string, action: "tasks:read" | "tasks:respond" | "tasks:write") {
  const access = await requirePatientAccess(user.uid, patientId, action);
  const task = fromSnap<CareTask>(await tasks(patientId).doc(id).get());
  if (!task || !visibleTo(access.membership, task)) throw notFound("That task");
  return { ...access, task };
}

export async function getTask(user: CurrentUser, patientId: string, id: string) {
  return (await loadFor(user, patientId, id, "tasks:read")).task;
}

export async function updateTask(user: CurrentUser, patientId: string, id: string, patch: { title?: string; description?: string | null; dueDate?: string | null; dueTime?: string | null; priority?: CareTask["priority"] }) {
  const { patient, task } = await loadFor(user, patientId, id, "tasks:write");
  if (!OPEN_TASK_STATUSES.includes(task.status)) throw conflict("Reopen this task before changing it.");
  const next: Partial<CareTask> = { updatedAt: new Date() };
  const changed: string[] = [];
  if (patch.title !== undefined && patch.title !== task.title) { next.title = patch.title; changed.push("title"); }
  if (patch.description !== undefined && (patch.description ?? null) !== task.description) { next.description = patch.description ?? null; changed.push("description"); }
  if (patch.priority && patch.priority !== task.priority) { next.priority = patch.priority; changed.push("priority"); }
  if (patch.dueDate !== undefined || patch.dueTime !== undefined) {
    next.dueAt = dueInstant(patch.dueDate ?? null, patch.dueTime ?? null, patient.timezone);
    changed.push("due date");
  }
  if (!changed.length) return task;
  await tasks(patientId).doc(id).update(next);
  await logActivity(patientId, { category: "task", type: "task_updated", actorUid: user.uid, actorName: user.displayName, summary: `${user.displayName} changed the ${changed.join(", ")} of "${next.title ?? task.title}".`, resourceType: "careTask", resourceId: id });
  return { ...task, ...next } as CareTask;
}

/**
 * Assign, transfer or claim. Allowed for: managers (any task), the current
 * assignee (hand over to someone else) and any task-capable member claiming an
 * UNASSIGNED task for themselves. Always logged with who changed it, and the
 * new assignee must accept again.
 */
export async function assignTask(user: CurrentUser, patientId: string, id: string, toUid: string | null) {
  const { patient, membership, task } = await loadFor(user, patientId, id, "tasks:respond");
  const isManager = can(membership, "tasks:write");
  const isAssignee = task.assignedToUid === user.uid;
  const claiming = !task.assignedToUid && toUid === user.uid;
  if (!isManager && !isAssignee && !claiming) throw new ForbiddenError("Only the person responsible, or a caregiver who manages tasks, can reassign this.");
  if (!OPEN_TASK_STATUSES.includes(task.status)) throw conflict("Reopen this task before assigning it.");
  if (toUid === task.assignedToUid) return task;
  if (toUid === null && !isManager) throw new ForbiddenError("Only a caregiver who manages tasks can leave a task unassigned.");
  const assignee = toUid ? await resolveAssignee(patientId, toUid) : null;

  const ref = tasks(patientId).doc(id);
  const updated = await runTx(async (t) => {
    const snap = await t.get(ref);
    const cur = fromData<CareTask>(snap.data());
    if (cur.assignedToUid !== task.assignedToUid) throw conflict("This task was just changed by someone else. Refresh and try again.");
    const patch = { assignedToUid: assignee?.uid ?? null, assignedToName: assignee?.displayName ?? null, status: "pending" as TaskStatus, updatedAt: new Date() };
    t.update(ref, patch);
    return { ...cur, id, ...patch } as CareTask;
  });
  const from = task.assignedToName ?? "nobody";
  const verb = claiming ? "took over" : "reassigned";
  await logActivity(patientId, { category: "task", type: "task_reassigned", actorUid: user.uid, actorName: user.displayName, summary: `${user.displayName} ${verb} "${task.title}": from ${from} to ${assignee?.displayName ?? "nobody (unassigned)"}.`, resourceType: "careTask", resourceId: id });
  await audit(patientId, user.uid, "task.assign", { type: "careTask", id }, { from: task.assignedToUid, to: assignee?.uid ?? null });
  if (assignee && assignee.uid !== user.uid) {
    const version = 1 + (await countAssignments(patientId, id));
    await notifyAssignee(patient, updated, assignee, user.displayName, "task_reassigned", version);
  }
  return updated;
}

async function countAssignments(patientId: string, taskId: string) {
  const snap = await col.sub(patientId, "careActivity").where("resourceId", "==", taskId).get();
  return snap.docs.filter((d) => (d.data() as { type?: string }).type === "task_reassigned").length;
}

export async function setTaskStatus(user: CurrentUser, patientId: string, id: string, status: TaskStatus) {
  const { membership, task } = await loadFor(user, patientId, id, "tasks:respond");
  const isManager = can(membership, "tasks:write");
  const isAssignee = task.assignedToUid === user.uid;
  if (!canMoveStatus(task.status, status, { isManager, isAssignee, assigned: Boolean(task.assignedToUid) })) {
    if (!isManager && !isAssignee) throw new ForbiddenError("Only the person responsible can update this task.");
    throw conflict(`This task cannot move from "${task.status.replace("_", " ")}" to "${status.replace("_", " ")}".`);
  }
  const ref = tasks(patientId).doc(id);
  const now = new Date();
  await runTx(async (t) => {
    const cur = fromData<CareTask>((await t.get(ref)).data());
    if (cur.status !== task.status) throw conflict("This task was just changed by someone else. Refresh and try again.");
    t.update(ref, {
      status,
      updatedAt: now,
      completedAt: status === "completed" ? now : null,
      completedByUid: status === "completed" ? user.uid : null,
    });
  });
  await audit(patientId, user.uid, "task.status", { type: "careTask", id }, { status });
  const onBehalf = !isAssignee && isManager ? " on behalf of the assignee" : "";
  await logActivity(patientId, { category: "task", type: `task_${status}`, actorUid: user.uid, actorName: user.displayName, summary: `${user.displayName} marked "${task.title}" as ${status.replace("_", " ")}${onBehalf}.`, resourceType: "careTask", resourceId: id });
  return { ...task, status, updatedAt: now };
}

export async function addTaskNote(user: CurrentUser, patientId: string, id: string, text: string) {
  const { membership, task } = await loadFor(user, patientId, id, "tasks:respond");
  const isManager = can(membership, "tasks:write");
  if (task.assignedToUid !== user.uid && !isManager) throw new ForbiddenError("Only the person responsible, or a caregiver who manages tasks, can add notes.");
  if (task.notes.length >= MAX_NOTES) throw conflict("This task has too many notes. Start a new task instead.");
  const note = { id: randomUUID(), uid: user.uid, name: user.displayName, text, at: new Date() };
  await tasks(patientId).doc(id).update({ notes: [...task.notes, note], updatedAt: note.at });
  await audit(patientId, user.uid, "task.note", { type: "careTask", id });
  await logActivity(patientId, { category: "task", type: "task_note", actorUid: user.uid, actorName: user.displayName, summary: `${user.displayName} added a note to "${task.title}".`, resourceType: "careTask", resourceId: id });
  return note;
}


/** People who can be given tasks (capability "tasks") or receive handovers ("handovers") in this circle. */
export async function listCircleMembers(user: CurrentUser, patientId: string, capability: "tasks" | "handovers") {
  await requirePatientAccess(user.uid, patientId, "tasks:read");
  const snap = await col.sub(patientId, "memberships").get();
  const need = capability === "tasks" ? "tasks:respond" : "handovers:read";
  return snap.docs
    .map((d) => fromData<Membership>(d.data()))
    .filter((m) => m.status === "active" && can(m, need))
    .map((m) => ({ uid: m.uid, displayName: m.displayName, role: m.role }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}
