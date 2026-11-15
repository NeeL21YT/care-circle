import { route } from "@/lib/api/handler";
import { documentMetaSchema, MAX_DOCUMENT_BYTES } from "@/lib/domain/schemas";
import { badRequest } from "@/lib/api/errors";
import { LIMITS } from "@/lib/api/rate-limit";
import { listDocuments, uploadDocument } from "@/lib/services/documents";

export const GET = route<"patientId">({}, ({ user, params }) => listDocuments(user, params.patientId));

/** multipart/form-data: `file` + title, category, description?, sharedWithPatient? */
export const POST = route<"patientId">({ rateLimit: LIMITS.upload }, async ({ req, user, params }) => {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_DOCUMENT_BYTES + 64 * 1024) throw badRequest("That file is too large. The limit is 4 MB.");
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw badRequest("The upload could not be read.");
  }
  const file = form.get("file");
  if (!(file instanceof File)) throw badRequest("Choose a file to upload.", { file: "Choose a file to upload." });
  const meta = documentMetaSchema.safeParse({
    title: form.get("title"),
    category: form.get("category"),
    description: form.get("description") ?? undefined,
    sharedWithPatient: form.get("sharedWithPatient") ?? undefined,
  });
  if (!meta.success) {
    const fields: Record<string, string> = {};
    for (const i of meta.error.issues) fields[i.path.join(".")] ??= i.message;
    throw badRequest("Please check the highlighted fields.", fields);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const doc = await uploadDocument(user, params.patientId, { name: file.name, bytes }, meta.data);
  return Response.json({ data: doc }, { status: 201 });
});
