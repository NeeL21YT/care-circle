import { z } from "zod";
import { route } from "@/lib/api/handler";
import { resolvePendingAction } from "@/lib/services/assistant";

const body = z.object({ decision: z.enum(["confirm", "cancel"]) });

/** Pressing Confirm in the UI is the only thing that executes an assistant suggestion. */
export const POST = route<"patientId" | "conversationId" | "actionId", z.infer<typeof body>>({ body }, ({ user, params, body }) =>
  resolvePendingAction(user, params.patientId, params.conversationId, params.actionId, body.decision),
);
