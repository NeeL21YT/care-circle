import { route } from "@/lib/api/handler";
import { rejectExtraction } from "@/lib/services/prescriptions";

export const POST = route<"patientId" | "extractionId">({}, ({ user, params }) => rejectExtraction(user, params.patientId, params.extractionId));
