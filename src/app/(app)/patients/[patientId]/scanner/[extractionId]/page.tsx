import type { Metadata } from "next";
import { requirePagePatient } from "@/lib/auth/page";
import { getExtraction } from "@/lib/services/prescriptions";
import { getReconciliation } from "@/lib/services/reconciliation";
import { getDocumentDownloadUrl } from "@/lib/services/documents";
import { PageHeader } from "@/components/ui/page-header";
import { PrescriptionReview } from "@/components/app/prescription-review";
import { AiError } from "@/lib/ai/errors";
import type { AiFailureCode } from "@/lib/ai/errors";

export const metadata: Metadata = { title: "Review prescription" };

export default async function Page({ params }: { params: Promise<{ patientId: string; extractionId: string }> }) {
  const { patientId, extractionId } = await params;
  const { user } = await requirePagePatient(patientId, "medications:write");
  const [x, recon] = await Promise.all([getExtraction(user, patientId, extractionId), getReconciliation(user, patientId, extractionId)]);
  const file = await getDocumentDownloadUrl(user, patientId, x.sourceDocumentId).catch(() => null);
  const failureMessage = x.failureCode ? new AiError(x.failureCode as AiFailureCode).message : null;
  return (
    <>
      <PageHeader title="Review prescription" description={`Status: ${x.status.replace("_", " ")}. Model suggestions are drafts until you approve them.`} />
      <PrescriptionReview
        patientId={patientId}
        extractionId={extractionId}
        status={x.status}
        meds={x.reviewedMedications}
        warnings={x.extractedData?.documentWarnings ?? []}
        approvals={x.approvals}
        previewUrl={file?.url ?? null}
        contentType={file?.contentType ?? "image/png"}
        failureMessage={failureMessage}
        recon={JSON.parse(JSON.stringify({ items: recon.items, absent: recon.absent }))}
      />
    </>
  );
}
