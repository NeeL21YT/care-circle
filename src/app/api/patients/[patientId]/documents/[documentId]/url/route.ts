import { route } from "@/lib/api/handler";
import { getDocumentDownloadUrl } from "@/lib/services/documents";

/** Returns a short-lived signed URL (5 minutes) after authorization. */
export const GET = route<"patientId" | "documentId">({}, ({ user, params }) => getDocumentDownloadUrl(user, params.patientId, params.documentId));
