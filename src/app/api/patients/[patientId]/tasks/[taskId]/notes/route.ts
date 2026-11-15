import type { z } from "zod";
import { route } from "@/lib/api/handler";
import { taskNoteSchema } from "@/lib/domain/schemas";
import { addTaskNote } from "@/lib/services/care-tasks";

export const POST = route<"patientId" | "taskId", z.infer<typeof taskNoteSchema>>({ body: taskNoteSchema }, async ({ user, params, body }) =>
  Response.json({ data: await addTaskNote(user, params.patientId, params.taskId, body.text) }, { status: 201 }),
);
