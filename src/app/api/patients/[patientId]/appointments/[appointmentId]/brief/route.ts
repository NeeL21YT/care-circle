import { route } from "@/lib/api/handler";
import { briefActionSchema, type BriefAction } from "@/lib/domain/doctor-brief";
import { getDoctorBrief, updateBrief } from "@/lib/services/doctor-brief";

export const GET = route<"patientId" | "appointmentId">({}, ({ user, params }) => getDoctorBrief(user, params.patientId, params.appointmentId));

export const POST = route<"patientId" | "appointmentId", BriefAction>({ body: briefActionSchema }, ({ user, params, body }) =>
  updateBrief(user, params.patientId, params.appointmentId, body),
);
