import { route } from "@/lib/api/handler";
import { invitationSchema } from "@/lib/domain/schemas";
import { createInvitation, listInvitations } from "@/lib/services/care-circle";
import { LIMITS } from "@/lib/api/rate-limit";
import type { z } from "zod";

export const GET = route<"patientId">({}, ({ user, params }) => listInvitations(user, params.patientId));

export const POST = route<"patientId", z.infer<typeof invitationSchema>>(
  { body: invitationSchema, rateLimit: LIMITS.sensitive },
  async ({ user, params, body }) => {
    const r = await createInvitation(user, params.patientId, body);
    return Response.json({ data: r }, { status: 201 });
  },
);
