import "server-only";
import { col, db, fromData } from "@/lib/db";
import type { MedSummary, ReconStatus } from "@/lib/domain/reconciliation";

export interface ReconDecision {
  status: ReconStatus;
  decidedByUid: string;
  decidedByName: string;
  decidedAt: Date;
  note: string | null;
  /** Medicine created or changed by this decision, if any. */
  medicationId: string | null;
  /** What was compared when the person decided, kept for the audit trail. */
  snapshot: { incoming: { name: string | null; strength: string | null; dose: string | null; frequency: string | null } | null; existing: MedSummary | null };
}

interface Doc {
  extractionId: string;
  patientId: string;
  decisions: Record<string, ReconDecision>;
  updatedAt: Date;
}

const ref = (patientId: string, extractionId: string) => col.sub(patientId, "prescriptionReconciliations").doc(extractionId);

export async function readDecisions(patientId: string, extractionId: string): Promise<Record<string, ReconDecision>> {
  const snap = await ref(patientId, extractionId).get();
  return snap.exists ? fromData<Doc>(snap.data()).decisions ?? {} : {};
}

/** Read-modify-write in a transaction so two reviewers cannot overwrite each other's decisions. */
export async function writeDecision(
  patientId: string,
  extractionId: string,
  key: string,
  decision: ReconDecision,
  /** Return false to refuse the write (e.g. already decided). */
  allow: (current: ReconDecision | undefined) => boolean,
): Promise<boolean> {
  const r = ref(patientId, extractionId);
  return db().runTransaction(async (tx) => {
    const t = tx as { get(x: unknown): Promise<{ exists: boolean; data(): unknown }>; set(x: unknown, d: unknown): void };
    const snap = await t.get(r);
    const cur: Doc = snap.exists ? fromData<Doc>(snap.data()) : { extractionId, patientId, decisions: {}, updatedAt: new Date() };
    if (!allow(cur.decisions[key])) return false;
    t.set(r, { ...cur, decisions: { ...cur.decisions, [key]: decision }, updatedAt: new Date() });
    return true;
  });
}
