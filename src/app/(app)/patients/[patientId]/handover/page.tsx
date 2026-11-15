import type { Metadata } from "next";
import { requirePagePatient } from "@/lib/auth/page";
import { can } from "@/lib/domain/permissions";
import { listHandovers } from "@/lib/services/handovers";
import { PageHeader } from "@/components/ui/page-header";
import { HandoverList } from "@/components/app/handover-list";
import { AskAssistant } from "@/components/app/assistant-provider";

export const metadata: Metadata = { title: "Care handover" };

export default async function Page({ params }: { params: Promise<{ patientId: string }> }) {
  const { patientId } = await params;
  const { user, patient, membership } = await requirePagePatient(patientId, "handovers:read");
  const list = await listHandovers(user, patientId);
  const rows = list.map((h) => ({ id: h.id, status: h.status, createdByName: h.createdByName, createdAt: h.createdAt.toISOString(), recipientName: h.recipientName, acknowledgedAt: h.acknowledgedAt?.toISOString() ?? null, periodHours: h.periodHours, mine: h.createdByUid === user.uid, forMe: h.recipientUid === user.uid }));
  return (
    <>
      <PageHeader title="Care handover" description={`Pass on what ${patient.fullName}'s next caregiver needs to know, from real records.`} actions={<AskAssistant question="What is in the latest handover, and what still needs attention?">Ask about the handover</AskAssistant>} />
      <HandoverList patientId={patientId} rows={rows} canPrepare={can(membership, "handovers:write")} timezone={patient.timezone} />
    </>
  );
}
