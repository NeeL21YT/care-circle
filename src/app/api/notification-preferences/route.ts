import { z } from "zod";
import { route } from "@/lib/api/handler";
import { notificationPreferencesSchema } from "@/lib/domain/schemas";
import { badRequest } from "@/lib/api/errors";
import { getPreferences, savePreferences } from "@/lib/services/preferences";

export const GET = route({}, ({ req, user }) => {
  const patientId = req.nextUrl.searchParams.get("patientId");
  if (!patientId) throw badRequest("patientId is required.");
  return getPreferences(user, patientId);
});

export const PATCH = route<never, z.output<typeof notificationPreferencesSchema>>(
  { body: notificationPreferencesSchema },
  ({ user, body }) => savePreferences(user, body),
);
