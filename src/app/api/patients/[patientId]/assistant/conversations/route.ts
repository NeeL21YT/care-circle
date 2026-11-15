import { route } from "@/lib/api/handler";
import { listConversations } from "@/lib/services/assistant";

export const GET = route<"patientId">({}, ({ user, params }) => listConversations(user, params.patientId));
