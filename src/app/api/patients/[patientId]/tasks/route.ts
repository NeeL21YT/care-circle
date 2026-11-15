import { z } from "zod";
import { route } from "@/lib/api/handler";
import { taskCreateSchema, type TaskCreateInput } from "@/lib/domain/schemas";
import { createTask, listTasks } from "@/lib/services/care-tasks";

const filter = z.enum(["open", "mine", "unassigned", "all"]).catch("open");

export const GET = route<"patientId">({}, ({ req, user, params }) =>
  listTasks(user, params.patientId, { filter: filter.parse(new URL(req.url).searchParams.get("filter") ?? undefined) }),
);

export const POST = route<"patientId", TaskCreateInput>({ body: taskCreateSchema }, async ({ user, params, body }) =>
  Response.json({ data: await createTask(user, params.patientId, body) }, { status: 201 }),
);
