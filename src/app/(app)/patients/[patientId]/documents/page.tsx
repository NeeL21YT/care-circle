import type { Metadata } from "next";
import { requirePagePatient } from "@/lib/auth/page";
import { can } from "@/lib/domain/permissions";
import { listDocuments } from "@/lib/services/documents";
import { PageHeader } from "@/components/ui/page-header";
import { DocumentsView } from "@/components/app/documents-view";

export const metadata: Metadata = { title: "Documents" };

export default async function Page({ params }: { params: Promise<{ patientId: string }> }) {
  const { patientId } = await params;
  const { user, patient, membership } = await requirePagePatient(patientId, "documents:read");
  const documents = await listDocuments(user, patientId);
  return (
    <>
      <PageHeader title={membership.role === "patient" ? "My documents" : "Documents"} description={`Private health documents for ${patient.fullName}. Only people in the care circle with access can open them.`} />
      <DocumentsView documents={documents} patientId={patientId} timezone={patient.timezone} canUpload={can(membership, "documents:write")} canDelete={can(membership, "documents:delete")} />
    </>
  );
}
