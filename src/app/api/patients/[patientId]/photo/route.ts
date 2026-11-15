import { route } from "@/lib/api/handler";
import { badRequest } from "@/lib/api/errors";
import { LIMITS } from "@/lib/api/rate-limit";
import { uploadPatientPhoto } from "@/lib/services/patients";

/** multipart/form-data with a single `file` (JPG/PNG, max 1 MB). */
export const POST = route<"patientId">({ rateLimit: LIMITS.upload }, async ({ req, user, params }) => {
  let form: FormData;
  try { form = await req.formData(); } catch { throw badRequest("The upload could not be read."); }
  const file = form.get("file");
  if (!(file instanceof File)) throw badRequest("Choose a photo to upload.");
  return uploadPatientPhoto(user, params.patientId, new Uint8Array(await file.arrayBuffer()));
});
