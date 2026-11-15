import { z } from "zod";
import { route } from "@/lib/api/handler";
import { appointmentInputSchema } from "@/lib/domain/schemas";
import { badRequest } from "@/lib/api/errors";
import { createAppointment, listAppointments } from "@/lib/services/appointments";

const query = z.object({
  scope: z.enum(["upcoming", "past", "all"]).default("all"),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

export const GET = route<"patientId">({}, ({ req, user, params }) => {
  const q = query.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!q.success) throw badRequest("Invalid filter.");
  return listAppointments(user, params.patientId, {
    scope: q.data.scope, from: q.data.from ? new Date(q.data.from) : undefined, to: q.data.to ? new Date(q.data.to) : undefined,
  });
});

export const POST = route<"patientId", z.output<typeof appointmentInputSchema>>(
  { body: appointmentInputSchema },
  async ({ user, params, body }) => Response.json({ data: await createAppointment(user, params.patientId, body) }, { status: 201 }),
);
