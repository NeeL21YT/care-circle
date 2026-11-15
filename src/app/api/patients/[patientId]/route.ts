import { route } from "@/lib/api/handler";
import { patientUpdateSchema } from "@/lib/domain/schemas";
import { getPatientForUser, updatePatient } from "@/lib/services/patients";

export const GET = route<"patientId">({}, async ({ user, params }) => {
  const { patient, membership } = await getPatientForUser(user.uid, params.patientId);
  return { patient, role: membership.role };
});

export const PATCH = route<"patientId", ReturnType<typeof patientUpdateSchema.parse>>(
  { body: patientUpdateSchema },
  ({ user, params, body }) => updatePatient(user, params.patientId, body),
);
