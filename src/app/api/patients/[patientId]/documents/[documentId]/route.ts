import { route } from "@/lib/api/handler";
import { deleteDocument } from "@/lib/services/documents";

export const DELETE = route<"patientId" | "documentId">({}, async ({ user, params }) => {
  await deleteDocument(user, params.patientId, params.documentId);
  return { deleted: true };
});
