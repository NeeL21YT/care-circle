import { z } from "zod";
import { route } from "@/lib/api/handler";
import { listExtractions, startExtraction } from "@/lib/services/prescriptions";

/** Model calls can take a while; allow the platform to wait. */
export const maxDuration = 60;

export const GET = route<"patientId">({}, ({ user, params }) => listExtractions(user, params.patientId));

const body = z.object({ documentId: z.string().min(1).max(64), retry: z.boolean().optional() });

/** Scans an already-uploaded document. Never activates anything. */
export const POST = route<"patientId", z.infer<typeof body>>(
  { body, rateLimit: { name: "ai:rx", limit: 6, windowSeconds: 300 } },
  async ({ user, params, body }) => startExtraction(user, params.patientId, body.documentId, { retry: body.retry }),
);
