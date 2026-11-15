import type { z } from "zod";
import { route } from "@/lib/api/handler";
import { taskStatusSchema } from "@/lib/domain/schemas";
import { setTaskStatus } from "@/lib/services/care-tasks";

export const POST = route<"patientId" | "taskId", z.infer<typeof taskStatusSchema>>({ body: taskStatusSchema }, ({ user, params, body }) =>
  setTaskStatus(user, params.patientId, params.taskId, body.status),
);
