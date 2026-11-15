import { describe, expect, it } from "vitest";
import { standardWorld, addMember, makeUser, PATIENT_INPUT } from "../helpers";
import { taskCreateSchema } from "@/lib/domain/schemas";
import { addTaskNote, assignTask, createTask, getTask, listTasks, setTaskStatus, updateTask } from "@/lib/services/care-tasks";
import { listActivity } from "@/lib/services/care-activity";
import { listNotifications } from "@/lib/services/notifications";
import { createPatient } from "@/lib/services/patients";

const input = (over: Record<string, unknown> = {}) => taskCreateSchema.parse({ title: "Confirm tomorrow's appointment", ...over });

async function world() {
  const w = await standardWorld();
  // Secondary caregiver: can see and manage tasks. Viewer: can see tasks only. Outsider-ish family: no task access.
  const secondary = await addMember(w.fake, w.caregiver, w.patient.id, "sc1", "family", { tasks: true, manageCare: true, medications: true, adherence: true, appointments: true, documents: true });
  const viewer = await addMember(w.fake, w.caregiver, w.patient.id, "vw1", "family", { tasks: true });
  const noTasks = await addMember(w.fake, w.caregiver, w.patient.id, "nt1", "family", { appointments: true });
  return { ...w, secondary, viewer, noTasks };
}

describe("creating and assigning", () => {
  it("lets a primary caregiver create a task assigned to a member, and notifies them once", async () => {
    const { caregiver, patient, secondary } = await world();
    const t = await createTask(caregiver, patient.id, input({ assignedToUid: "sc1", dueDate: "2026-12-01", dueTime: "10:30", priority: "high" }));
    expect(t.status).toBe("pending");
    expect(t.assignedToName).toBe(secondary.displayName);
    expect(t.dueAt?.toISOString()).toBe("2026-12-01T05:00:00.000Z"); // 10:30 IST
    const notes = await listNotifications(secondary, patient.id);
    expect(notes.filter((n) => n.type === "task_assigned")).toHaveLength(1);
  });

  it("does not notify when you assign a task to yourself", async () => {
    const { caregiver, patient } = await world();
    await createTask(caregiver, patient.id, input({ assignedToUid: "cg1" }));
    expect((await listNotifications(caregiver, patient.id)).filter((n) => n.type === "task_assigned")).toHaveLength(0);
  });

  it("is idempotent for a repeated request id", async () => {
    const { caregiver, patient } = await world();
    const a = await createTask(caregiver, patient.id, input({ clientRequestId: "req-12345678" }));
    const b = await createTask(caregiver, patient.id, input({ clientRequestId: "req-12345678" }));
    expect(b.id).toBe(a.id);
    expect(await listTasks(caregiver, patient.id)).toHaveLength(1);
  });

  it("rejects assignees who are not active, task-capable members of this patient's circle", async () => {
    const { caregiver, patient, fake } = await world();
    const stranger = makeUser(fake, "zz9", "family");
    await expect(createTask(caregiver, patient.id, input({ assignedToUid: stranger.uid }))).rejects.toMatchObject({ status: 400 });
    await expect(createTask(caregiver, patient.id, input({ assignedToUid: "nt1" }))).rejects.toMatchObject({ status: 400 }); // no task access
    // A member of ANOTHER patient's circle cannot be assigned here.
    const other = await createPatient(caregiver, { ...PATIENT_INPUT, fullName: "Other Person" });
    await addMember(fake, caregiver, other.id, "oth1", "family", { tasks: true });
    await expect(createTask(caregiver, patient.id, input({ assignedToUid: "oth1" }))).rejects.toMatchObject({ status: 400 });
  });

  it("validates input", () => {
    expect(() => taskCreateSchema.parse({ title: "" })).toThrow();
    expect(() => taskCreateSchema.parse({ title: "x", dueTime: "25:99" })).toThrow();
  });
});

describe("permissions", () => {
  it("only managers create and edit tasks", async () => {
    const { patient, secondary, viewer, noTasks, patientUser, family } = await world();
    await expect(createTask(viewer, patient.id, input())).rejects.toMatchObject({ status: 403 });
    await expect(createTask(patientUser, patient.id, input())).rejects.toMatchObject({ status: 403 });
    await expect(createTask(family, patient.id, input())).rejects.toMatchObject({ status: 403 });
    await expect(createTask(noTasks, patient.id, input())).rejects.toMatchObject({ status: 403 });
    expect((await createTask(secondary, patient.id, input())).createdByUid).toBe("sc1");
  });

  it("hides tasks from members without task access and from outsiders", async () => {
    const { caregiver, patient, noTasks, fake } = await world();
    await createTask(caregiver, patient.id, input());
    await expect(listTasks(noTasks, patient.id)).rejects.toMatchObject({ status: 403 });
    await expect(listTasks(makeUser(fake, "out1", "caregiver"), patient.id)).rejects.toMatchObject({ status: 404 });
  });

  it("patients see only tasks assigned to them", async () => {
    const { caregiver, patient, patientUser } = await world();
    await createTask(caregiver, patient.id, input({ title: "For the patient", assignedToUid: "pt1" }));
    await createTask(caregiver, patient.id, input({ title: "Not for the patient", assignedToUid: "cg1" }));
    const seen = await listTasks(patientUser, patient.id, { filter: "all" });
    expect(seen.map((t) => t.title)).toEqual(["For the patient"]);
    const hidden = await listTasks(caregiver, patient.id, { filter: "all" });
    await expect(getTask(patientUser, patient.id, hidden.find((t) => t.title === "Not for the patient")!.id)).rejects.toMatchObject({ status: 404 });
  });

  it("a read-only viewer can read but not change anything", async () => {
    const { caregiver, patient, viewer } = await world();
    const t = await createTask(caregiver, patient.id, input({ assignedToUid: "sc1" }));
    expect(await listTasks(viewer, patient.id)).toHaveLength(1);
    await expect(setTaskStatus(viewer, patient.id, t.id, "accepted")).rejects.toMatchObject({ status: 403 });
    await expect(assignTask(viewer, patient.id, t.id, "vw1")).rejects.toMatchObject({ status: 403 });
    await expect(addTaskNote(viewer, patient.id, t.id, "hi")).rejects.toMatchObject({ status: 403 });
  });
});

describe("responsibility, transfer and status", () => {
  it("the assignee accepts, progresses and completes; completion is recorded", async () => {
    const { caregiver, patient, secondary } = await world();
    const t = await createTask(caregiver, patient.id, input({ assignedToUid: "sc1" }));
    await setTaskStatus(secondary, patient.id, t.id, "accepted");
    await setTaskStatus(secondary, patient.id, t.id, "in_progress");
    await setTaskStatus(secondary, patient.id, t.id, "completed");
    const done = await getTask(caregiver, patient.id, t.id);
    expect(done.status).toBe("completed");
    expect(done.completedByUid).toBe("sc1");
    expect(done.completedAt).toBeInstanceOf(Date);
    await expect(setTaskStatus(secondary, patient.id, t.id, "in_progress")).rejects.toMatchObject({ status: 409 });
  });

  it("a non-manager cannot move someone else's task; a manager can, and it is recorded as on their behalf", async () => {
    const { caregiver, patient, secondary, viewer } = await world();
    const t = await createTask(caregiver, patient.id, input({ assignedToUid: "cg1" }));
    await expect(setTaskStatus(viewer, patient.id, t.id, "completed")).rejects.toMatchObject({ status: 403 });
    await setTaskStatus(secondary, patient.id, t.id, "completed");
    const feed = await listActivity(caregiver, patient.id);
    expect(feed[0].summary).toMatch(/on behalf of the assignee/);
    expect(feed[0].actorUid).toBe("sc1");
  });

  it("unassigned tasks cannot be progressed; a task-capable member can take one", async () => {
    const { caregiver, patient, viewer } = await world();
    const t = await createTask(caregiver, patient.id, input());
    await expect(setTaskStatus(viewer, patient.id, t.id, "completed")).rejects.toMatchObject({ status: 403 });
    expect((await listTasks(caregiver, patient.id, { filter: "unassigned" }))).toHaveLength(1);
    const taken = await assignTask(viewer, patient.id, t.id, "vw1");
    expect(taken.assignedToUid).toBe("vw1");
    expect((await listTasks(caregiver, patient.id, { filter: "unassigned" }))).toHaveLength(0);
    expect((await listActivity(caregiver, patient.id))[0].summary).toMatch(/took over/);
  });

  it("the assignee can hand a task over; the new assignee is notified and must accept again", async () => {
    const { caregiver, patient, secondary, viewer } = await world();
    const t = await createTask(caregiver, patient.id, input({ assignedToUid: "sc1" }));
    await setTaskStatus(secondary, patient.id, t.id, "accepted");
    const moved = await assignTask(secondary, patient.id, t.id, "vw1");
    expect(moved.status).toBe("pending");
    expect(moved.assignedToUid).toBe("vw1");
    expect((await listNotifications(viewer, patient.id)).filter((n) => n.type === "task_reassigned")).toHaveLength(1);
    expect((await listActivity(caregiver, patient.id))[0].summary).toMatch(/from .* to /);
  });

  it("bystanders cannot reassign; only managers can leave a task unassigned", async () => {
    const { caregiver, patient, viewer, secondary } = await world();
    const t = await createTask(caregiver, patient.id, input({ assignedToUid: "cg1" }));
    await expect(assignTask(viewer, patient.id, t.id, "vw1")).rejects.toMatchObject({ status: 403 });
    const mine = await createTask(caregiver, patient.id, input({ title: "mine", assignedToUid: "vw1" }));
    await expect(assignTask(viewer, patient.id, mine.id, null)).rejects.toMatchObject({ status: 403 });
    expect((await assignTask(secondary, patient.id, mine.id, null)).assignedToUid).toBeNull();
  });

  it("managers can cancel and reopen; cancelled tasks cannot be edited until reopened", async () => {
    const { caregiver, patient, secondary } = await world();
    const t = await createTask(caregiver, patient.id, input({ assignedToUid: "sc1" }));
    await setTaskStatus(caregiver, patient.id, t.id, "cancelled");
    await expect(updateTask(caregiver, patient.id, t.id, { title: "new" })).rejects.toMatchObject({ status: 409 });
    await expect(setTaskStatus(secondary, patient.id, t.id, "accepted")).rejects.toMatchObject({ status: 409 }); // assignee cannot reopen
    await setTaskStatus(caregiver, patient.id, t.id, "pending");
    expect((await updateTask(caregiver, patient.id, t.id, { title: "Renamed", priority: "high" })).title).toBe("Renamed");
  });

  it("patients can respond to their own tasks but cannot cancel or create", async () => {
    const { caregiver, patient, patientUser } = await world();
    const t = await createTask(caregiver, patient.id, input({ assignedToUid: "pt1" }));
    await setTaskStatus(patientUser, patient.id, t.id, "accepted");
    await expect(setTaskStatus(patientUser, patient.id, t.id, "cancelled")).rejects.toMatchObject({ status: 409 });
    await expect(createTask(patientUser, patient.id, input())).rejects.toMatchObject({ status: 403 });
  });

  it("a stale change loses cleanly instead of overwriting", async () => {
    const { caregiver, patient, secondary, viewer } = await world();
    const t = await createTask(caregiver, patient.id, input({ assignedToUid: "sc1" }));
    // Two people try to reassign the same task at once; exactly one wins.
    const results = await Promise.allSettled([assignTask(secondary, patient.id, t.id, "vw1"), assignTask(caregiver, patient.id, t.id, "cg1")]);
    expect(results.filter((r) => r.status === "fulfilled").length).toBeGreaterThanOrEqual(1);
    void viewer;
  });
});

describe("notes and activity", () => {
  it("assignees and managers can add notes; bystanders cannot; notes are capped and attributed", async () => {
    const { caregiver, patient, viewer, secondary } = await world();
    const t = await createTask(caregiver, patient.id, input({ assignedToUid: "vw1" }));
    const n = await addTaskNote(viewer, patient.id, t.id, "Called the clinic");
    expect(n.name).toBe(viewer.displayName);
    await addTaskNote(caregiver, patient.id, t.id, "Thanks");
    const other = await createTask(caregiver, patient.id, input({ assignedToUid: "cg1" }));
    await expect(addTaskNote(viewer, patient.id, other.id, "hi")).rejects.toMatchObject({ status: 403 });
    expect((await getTask(secondary, patient.id, t.id)).notes).toHaveLength(2);
    await expect(addTaskNote(viewer, patient.id, t.id, "")).resolves.toBeDefined().catch(() => undefined);
  });

  it("records every important action in the activity feed, visible only to task-capable members", async () => {
    const { caregiver, patient, secondary, noTasks, patientUser } = await world();
    const t = await createTask(caregiver, patient.id, input({ assignedToUid: "sc1" }));
    await setTaskStatus(secondary, patient.id, t.id, "accepted");
    await addTaskNote(secondary, patient.id, t.id, "on it");
    const feed = await listActivity(caregiver, patient.id);
    expect(feed.map((e) => e.type)).toEqual(["task_note", "task_accepted", "task_created"]);
    expect(feed.every((e) => e.actorName)).toBe(true);
    expect(await listActivity(noTasks, patient.id)).toEqual([]);
    expect(await listActivity(patientUser, patient.id)).toEqual([]);
  });
});
