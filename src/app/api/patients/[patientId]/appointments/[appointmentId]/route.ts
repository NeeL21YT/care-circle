import { route } from "@/lib/api/handler";
import { appointmentUpdateSchema } from "@/lib/domain/schemas";
import { cancelAppointment, updateAppointment } from "@/lib/services/appointments";
import type { z } from "zod";

export const PATCH = route<"patientId" | "appointmentId", z.output<typeof appointmentUpdateSchema>>(
  { body: appointmentUpdateSchema },
  ({ user, params, body }) => updateAppointment(user, params.patientId, params.appointmentId, body),
);

/** DELETE cancels the appointment (the record is kept). */
export const DELETE = route<"patientId" | "appointmentId">({}, ({ user, params }) =>
  cancelAppointment(user, params.patientId, params.appointmentId),
);
