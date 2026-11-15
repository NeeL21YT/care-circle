import { z } from "zod";
import { route } from "@/lib/api/handler";
import { listHandovers, prepareHandover } from "@/lib/services/handovers";

export const maxDuration = 60;

export const GET = route<"patientId">({}, ({ user, params }) => listHandovers(user, params.patientId));

const body = z.object({ periodHours: z.number().int().optional() });

/** Prepares a private DRAFT from real records. Nothing is shared yet. */
export const POST = route<"patientId", z.infer<typeof body>>(
  { body, rateLimit: { name: "ai:handover", limit: 6, windowSeconds: 300 } },
  async ({ user, params, body }) => Response.json({ data: await prepareHandover(user, params.patientId, body) }, { status: 201 }),
);
