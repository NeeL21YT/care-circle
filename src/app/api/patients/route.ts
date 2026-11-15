import { route } from "@/lib/api/handler";
import { patientInputSchema } from "@/lib/domain/schemas";
import { createPatient, listPatientsForUser } from "@/lib/services/patients";

export const GET = route({}, ({ user }) => listPatientsForUser(user.uid));

export const POST = route({ body: patientInputSchema }, async ({ user, body }) => {
  const patient = await createPatient(user, body);
  return Response.json({ data: patient }, { status: 201 });
});
