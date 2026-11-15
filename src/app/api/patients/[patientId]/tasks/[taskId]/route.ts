import { route } from "@/lib/api/handler";
import { taskUpdateSchema } from "@/lib/domain/schemas";
import { getTask, updateTask } from "@/lib/services/care-tasks";
import type { z } from "zod";

export const GET = route<"patientId" | "taskId">({}, ({ user, params }) => getTask(user, params.patientId, params.taskId));

export const PATCH = route<"patientId" | "taskId", z.infer<typeof taskUpdateSchema>>({ body: taskUpdateSchema }, ({ user, params, body }) =>
  updateTask(user, params.patientId, params.taskId, body),
);
