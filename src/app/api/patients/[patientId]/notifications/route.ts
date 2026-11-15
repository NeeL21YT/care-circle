import { route } from "@/lib/api/handler";
import { listNotifications } from "@/lib/services/notifications";

export const GET = route<"patientId">({}, ({ user, params }) => listNotifications(user, params.patientId));
