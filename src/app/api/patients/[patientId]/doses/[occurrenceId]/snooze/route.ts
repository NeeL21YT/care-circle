import { route } from "@/lib/api/handler";
import { snoozeSchema } from "@/lib/domain/schemas";
import { snoozeDose } from "@/lib/services/doses";
import type { z } from "zod";

export const POST = route<"patientId" | "occurrenceId", z.output<typeof snoozeSchema>>(
  { body: snoozeSchema },
  ({ user, params, body }) => snoozeDose(user, params.patientId, params.occurrenceId, body.minutes, body.clientEventId),
);
