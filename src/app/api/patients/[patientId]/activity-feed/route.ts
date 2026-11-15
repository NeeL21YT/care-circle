import { route } from "@/lib/api/handler";
import { listActivity } from "@/lib/services/care-activity";

export const GET = route<"patientId">({}, ({ user, params }) => listActivity(user, params.patientId));
