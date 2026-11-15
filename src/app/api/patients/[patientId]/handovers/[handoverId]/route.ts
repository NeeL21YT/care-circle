import { z } from "zod";
import { route } from "@/lib/api/handler";
import { deleteDraft, getHandover, updateDraftNote } from "@/lib/services/handovers";

export const GET = route<"patientId" | "handoverId">({}, ({ user, params }) => getHandover(user, params.patientId, params.handoverId));

const body = z.object({ note: z.string().max(1000) });
export const PATCH = route<"patientId" | "handoverId", z.infer<typeof body>>({ body }, ({ user, params, body }) =>
  updateDraftNote(user, params.patientId, params.handoverId, body.note),
);

export const DELETE = route<"patientId" | "handoverId">({}, async ({ user, params }) => {
  await deleteDraft(user, params.patientId, params.handoverId);
  return { deleted: true };
});
