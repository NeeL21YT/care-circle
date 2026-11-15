import { z } from "zod";
import { route } from "@/lib/api/handler";
import { shareHandover } from "@/lib/services/handovers";

const body = z.object({ recipientUid: z.string().min(1).max(128) });

/** The author reviews the draft, then explicitly shares it with one authorized member. */
export const POST = route<"patientId" | "handoverId", z.infer<typeof body>>({ body }, ({ user, params, body }) =>
  shareHandover(user, params.patientId, params.handoverId, body.recipientUid),
);
