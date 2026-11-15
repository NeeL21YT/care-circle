import type { Metadata } from "next";
import { requirePagePatient } from "@/lib/auth/page";
import { isAiConfigured } from "@/lib/ai/config";
import { listExtractions } from "@/lib/services/prescriptions";
import { listDocuments } from "@/lib/services/documents";
import { PageHeader } from "@/components/ui/page-header";
import { PrescriptionScanner } from "@/components/app/prescription-scanner";
import { AskAssistant } from "@/components/app/assistant-provider";

export const metadata: Metadata = { title: "Prescription scanner" };

export default async function Page({ params }: { params: Promise<{ patientId: string }> }) {
  const { patientId } = await params;
  const { user, patient } = await requirePagePatient(patientId, "medications:write");
  const [extractions, docs] = await Promise.all([listExtractions(user, patientId), listDocuments(user, patientId)]);
  const title = new Map(docs.map((d) => [d.id, d.title]));
  const scans = extractions.map((x) => ({ id: x.id, documentId: x.sourceDocumentId, documentTitle: title.get(x.sourceDocumentId) ?? "Prescription", status: x.status, createdAt: x.createdAt.toISOString() }));
  return (
    <>
      <PageHeader title="Prescription scanner" description={`Turn a prescription for ${patient.fullName} into medicine drafts that you check and approve.`} actions={<AskAssistant question="How does the prescription scanner work, and what happens after I scan a prescription?">How does this work?</AskAssistant>} />
      <PrescriptionScanner patientId={patientId} scans={scans} aiReady={isAiConfigured()} />
    </>
  );
}
