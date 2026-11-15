import type { z } from "zod";
import { route } from "@/lib/api/handler";
import { taskAssignSchema } from "@/lib/domain/schemas";
import { assignTask } from "@/lib/services/care-tasks";

/** Assign, hand over, or take over a task. Always recorded in the activity feed. */
export const POST = route<"patientId" | "taskId", z.infer<typeof taskAssignSchema>>({ body: taskAssignSchema }, ({ user, params, body }) =>
  assignTask(user, params.patientId, params.taskId, body.assignedToUid),
);
