import { route } from "@/lib/api/handler";
import { getExtraction, updateReview } from "@/lib/services/prescriptions";

export const GET = route<"patientId" | "extractionId">({}, ({ user, params }) => getExtraction(user, params.patientId, params.extractionId));

/** Saves the caregiver's corrections (draft). Does not create any medicine. */
export const PATCH = route<"patientId" | "extractionId">({}, async ({ req, user, params }) =>
  updateReview(user, params.patientId, params.extractionId, await req.json().catch(() => null)),
);
