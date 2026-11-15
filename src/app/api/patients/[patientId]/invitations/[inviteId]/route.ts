import { route } from "@/lib/api/handler";
import { revokeInvitation } from "@/lib/services/care-circle";

export const DELETE = route<"patientId" | "inviteId">({}, async ({ user, params }) => {
  await revokeInvitation(user, params.patientId, params.inviteId);
  return { revoked: true };
});
