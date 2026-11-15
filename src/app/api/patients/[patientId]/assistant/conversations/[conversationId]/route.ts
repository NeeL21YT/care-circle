import { route } from "@/lib/api/handler";
import { deleteConversation, getConversation } from "@/lib/services/assistant";

export const GET = route<"patientId" | "conversationId">({}, ({ user, params }) => getConversation(user, params.patientId, params.conversationId));

export const DELETE = route<"patientId" | "conversationId">({}, async ({ user, params }) => {
  await deleteConversation(user, params.patientId, params.conversationId);
  return { deleted: true };
});
