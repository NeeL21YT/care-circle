import { route } from "@/lib/api/handler";
import { listMembers } from "@/lib/services/care-circle";

export const GET = route<"patientId">({}, ({ user, params }) => listMembers(user, params.patientId));
