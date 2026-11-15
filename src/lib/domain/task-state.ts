import type { TaskStatus } from "./types";

/**
 * Task status rules.
 *
 *  - The ASSIGNEE moves their own task along: accept, start, flag, complete.
 *  - A MANAGER (primary or secondary caregiver) can additionally cancel,
 *    reopen and complete on someone's behalf. Every such change is recorded in
 *    the activity feed with the actor's name, so nothing happens silently.
 *  - Unassigned tasks cannot be progressed; someone must take them first.
 */
const ASSIGNEE_MOVES: Record<TaskStatus, TaskStatus[]> = {
  pending: ["accepted", "in_progress", "needs_attention", "completed"],
  accepted: ["in_progress", "needs_attention", "completed", "pending"],
  in_progress: ["accepted", "needs_attention", "completed"],
  needs_attention: ["accepted", "in_progress", "completed"],
  completed: [],
  cancelled: [],
};

const MANAGER_EXTRA: Record<TaskStatus, TaskStatus[]> = {
  pending: ["cancelled"],
  accepted: ["cancelled"],
  in_progress: ["cancelled"],
  needs_attention: ["cancelled", "pending"],
  completed: ["pending"], // reopen
  cancelled: ["pending"], // reopen
};

export function canMoveStatus(from: TaskStatus, to: TaskStatus, actor: { isManager: boolean; isAssignee: boolean; assigned: boolean }): boolean {
  if (from === to) return false;
  if (!actor.assigned && to !== "cancelled" && to !== "pending") return false;
  if (actor.isAssignee && ASSIGNEE_MOVES[from].includes(to)) return true;
  if (actor.isManager && (ASSIGNEE_MOVES[from].includes(to) || MANAGER_EXTRA[from].includes(to))) return true;
  return false;
}
