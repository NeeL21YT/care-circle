import "server-only";
import { randomUUID } from "node:crypto";
import { col, fromData, fromSnap, toData } from "@/lib/db";
import { fileStore } from "@/lib/storage";
import { badRequest, notFound } from "@/lib/api/errors";
import type { DocumentCategory, HealthDocument } from "@/lib/domain/types";
import { ALLOWED_DOCUMENT_TYPES, MAX_DOCUMENT_BYTES } from "@/lib/domain/schemas";
import { requirePatientAccess } from "@/lib/auth/access";
import type { CurrentUser } from "@/lib/auth/session";
import { audit } from "./audit";

/** Detects the real file type from magic bytes; the client-declared type is never trusted. */
export function sniffContentType(buf: Uint8Array): (typeof ALLOWED_DOCUMENT_TYPES)[number] | null {
  const b = buf;
  if (b.length >= 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d) return "application/pdf";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "image/png";
  return null;
}

const EXT: Record<string, string> = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png" };

/** Never use the user's file name in a storage path. */
export function safeFileName(original: string, contentType: string): string {
  const base = original.replace(/\.[^.]*$/, "").replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 80) || "document";
  return `${base}.${EXT[contentType]}`;
}

export async function listDocuments(user: CurrentUser, patientId: string) {
  const { membership } = await requirePatientAccess(user.uid, patientId, "documents:read");
  const snap = await col.sub(patientId, "documents").orderBy("createdAt", "desc").get();
  return snap.docs
    .map((d) => ({ ...fromData<HealthDocument>(d.data()), id: d.id }))
    // Patients only see documents the caregiver chose to share with them.
    .filter((d) => membership.role !== "patient" || d.sharedWithPatient)
    // Internal storage path is never sent to clients.
    .map(({ storagePath: _s, ...rest }) => {
      void _s;
      return rest;
    });
}

export async function uploadDocument(
  user: CurrentUser,
  patientId: string,
  file: { name: string; bytes: Uint8Array },
  meta: { title: string; category: DocumentCategory; description: string | null; sharedWithPatient: boolean },
) {
  await requirePatientAccess(user.uid, patientId, "documents:write");
  if (file.bytes.length === 0) throw badRequest("That file is empty.");
  if (file.bytes.length > MAX_DOCUMENT_BYTES) throw badRequest("That file is too large. The limit is 4 MB.");
  const contentType = sniffContentType(file.bytes);
  if (!contentType) throw badRequest("Only PDF, JPG and PNG files can be uploaded.");

  const ref = col.sub(patientId, "documents").doc();
  const storagePath = `patients/${patientId}/documents/${ref.id}/${randomUUID()}-${safeFileName(file.name, contentType)}`;
  await fileStore().save(storagePath, file.bytes, contentType);
  const now = new Date();
  const doc: HealthDocument = {
    id: ref.id,
    patientId,
    title: meta.title,
    category: meta.category,
    description: meta.description,
    fileName: safeFileName(file.name, contentType),
    contentType,
    sizeBytes: file.bytes.length,
    storagePath,
    uploadedByUid: user.uid,
    uploadedByName: user.displayName,
    sharedWithPatient: meta.sharedWithPatient,
    // Phase 2 hook: Gemini processing is queued by changing this field.
    processingStatus: "not_requested",
    createdAt: now,
    updatedAt: now,
  };
  await ref.set(toData(doc));
  await audit(patientId, user.uid, "document.upload", { type: "document", id: ref.id }, { category: meta.category });
  const { storagePath: _s, ...publicDoc } = doc;
  void _s;
  return publicDoc;
}

/** Short-lived (5 min) signed URL, issued only after the same authorization checks. */
export async function getDocumentDownloadUrl(user: CurrentUser, patientId: string, documentId: string) {
  const { membership } = await requirePatientAccess(user.uid, patientId, "documents:read");
  const doc = fromSnap<HealthDocument>(await col.sub(patientId, "documents").doc(documentId).get());
  if (!doc || (membership.role === "patient" && !doc.sharedWithPatient)) throw notFound("That document");
  const ttl = 5 * 60;
  const expires = Date.now() + ttl * 1000;
  const url = await fileStore().signedUrl(doc.storagePath, ttl);
  await audit(patientId, user.uid, "document.access", { type: "document", id: documentId });
  return { url, expiresAt: new Date(expires), fileName: doc.fileName, contentType: doc.contentType };
}

export async function deleteDocument(user: CurrentUser, patientId: string, documentId: string) {
  await requirePatientAccess(user.uid, patientId, "documents:delete");
  const ref = col.sub(patientId, "documents").doc(documentId);
  const doc = fromSnap<HealthDocument>(await ref.get());
  if (!doc) throw notFound("That document");
  await fileStore().remove(doc.storagePath);
  await ref.delete();
  await audit(patientId, user.uid, "document.delete", { type: "document", id: documentId });
}
