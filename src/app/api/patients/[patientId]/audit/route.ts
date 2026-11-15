import { route } from "@/lib/api/handler";
import { listAudit } from "@/lib/services/audit";

export const GET = route<"patientId">({}, ({ user, params }) => listAudit(user, params.patientId));
