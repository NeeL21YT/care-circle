import { route } from "@/lib/api/handler";
import { medicationUpdateSchema } from "@/lib/domain/schemas";
import { discontinueMedication, getMedication, updateMedication } from "@/lib/services/medications";
import type { z } from "zod";

export const GET = route<"patientId" | "medicationId">({}, ({ user, params }) => getMedication(user, params.patientId, params.medicationId));

export const PATCH = route<"patientId" | "medicationId", z.output<typeof medicationUpdateSchema>>(
  { body: medicationUpdateSchema },
  ({ user, params, body }) => updateMedication(user, params.patientId, params.medicationId, body),
);

/** DELETE discontinues. History is preserved; see docs/API.md. */
export const DELETE = route<"patientId" | "medicationId">({}, ({ user, params }) =>
  discontinueMedication(user, params.patientId, params.medicationId),
);
