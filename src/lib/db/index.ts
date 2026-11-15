import "server-only";
import { Timestamp, type DocumentSnapshot, type Firestore } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase/admin";

/**
 * Firestore access helpers. Collections are patient-scoped:
 *   users/{uid}
 *   patients/{patientId}
 *     memberships/{uid}  medications/{id}  doseOccurrences/{id}  doseEvents/{id}
 *     appointments/{id}  documents/{id}  notificationPreferences/{uid}
 *     notifications/{id} auditEvents/{id}
 *   invitations/{tokenHash}
 */
export const db = (): Firestore => adminDb();

export const col = {
  users: () => db().collection("users"),
  patients: () => db().collection("patients"),
  invitations: () => db().collection("invitations"),
  sub: (patientId: string, name: SubCollection) =>
    db().collection("patients").doc(patientId).collection(name),
};

export type SubCollection =
  | "memberships"
  | "medications"
  | "doseOccurrences"
  | "doseEvents"
  | "appointments"
  | "documents"
  | "notificationPreferences"
  | "notifications"
  | "auditEvents"
  | "prescriptionExtractions"
  | "aiUsage"
  | "aiConversations"
  | "careTasks"
  | "careActivity"
  | "careHandovers"
  | "prescriptionReconciliations";

/** Recursively converts Firestore Timestamps to Dates. */
export function fromData<T>(value: unknown): T {
  return convert(value) as T;
}

function convert(v: unknown): unknown {
  if (v instanceof Timestamp) return v.toDate();
  // Duck-typing keeps the in-memory test fake interchangeable.
  if (v && typeof v === "object" && "toDate" in (v as object) && typeof (v as { toDate: unknown }).toDate === "function") {
    return (v as { toDate: () => Date }).toDate();
  }
  if (Array.isArray(v)) return v.map(convert);
  if (v && typeof v === "object" && !(v instanceof Date)) {
    return Object.fromEntries(Object.entries(v).map(([k, val]) => [k, convert(val)]));
  }
  return v;
}

/** Snapshot -> typed object with `id` populated. */
export function fromSnap<T>(snap: DocumentSnapshot): (T & { id: string }) | null {
  if (!snap.exists) return null;
  return { ...fromData<T>(snap.data()), id: snap.id } as T & { id: string };
}

/** Strips `id` (kept in the doc path) before writing. */
export function toData<T extends { id?: string }>(obj: T): Omit<T, "id"> {
  const { id: _id, ...rest } = obj;
  void _id;
  return rest;
}

export const nowDate = () => new Date();
