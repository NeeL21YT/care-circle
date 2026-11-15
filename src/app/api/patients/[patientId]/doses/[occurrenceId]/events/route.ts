import { route } from "@/lib/api/handler";
import { doseEventSchema } from "@/lib/domain/schemas";
import { listDoseEvents, recordDoseEvent } from "@/lib/services/doses";
import type { z } from "zod";

export const GET = route<"patientId" | "occurrenceId">({}, ({ user, params }) => listDoseEvents(user, params.patientId, params.occurrenceId));

export const POST = route<"patientId" | "occurrenceId", z.output<typeof doseEventSchema>>(
  { body: doseEventSchema },
  async ({ user, params, body }) => {
    const r = await recordDoseEvent(user, params.patientId, params.occurrenceId, body);
    return Response.json({ data: r }, { status: r.duplicate ? 200 : 201 });
  },
);
