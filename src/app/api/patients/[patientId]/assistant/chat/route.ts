import { z } from "zod";
import { route } from "@/lib/api/handler";
import { sendMessage } from "@/lib/services/assistant";

export const maxDuration = 60;

const body = z.object({ conversationId: z.string().min(1).max(64).optional(), message: z.string().max(2000) });

export const POST = route<"patientId", z.infer<typeof body>>(
  { body, rateLimit: { name: "ai:chat", limit: 20, windowSeconds: 60 } },
  ({ user, params, body }) => sendMessage(user, params.patientId, body),
);
