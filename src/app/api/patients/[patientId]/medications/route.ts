import { route } from "@/lib/api/handler";
import { medicationInputSchema } from "@/lib/domain/schemas";
import { createMedication, listMedications } from "@/lib/services/medications";
import type { z } from "zod";

export const GET = route<"patientId">({}, ({ user, params }) => listMedications(user, params.patientId));

export const POST = route<"patientId", z.output<typeof medicationInputSchema>>(
  { body: medicationInputSchema },
  async ({ user, params, body }) => Response.json({ data: await createMedication(user, params.patientId, body) }, { status: 201 }),
);
