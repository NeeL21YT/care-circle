import type { Metadata } from "next";
import { requirePagePatient } from "@/lib/auth/page";
import { getHandover } from "@/lib/services/handovers";
import { listCircleMembers } from "@/lib/services/care-tasks";
import { PageHeader } from "@/components/ui/page-header";
import { HandoverView } from "@/components/app/handover-view";

export const metadata: Metadata = { title: "Handover" };

export default async function Page({ params }: { params: Promise<{ patientId: string; handoverId: string }> }) {
  const { patientId, handoverId } = await params;
  const { user, patient } = await requirePagePatient(patientId, "handovers:read");
  const h = await getHandover(user, patientId, handoverId);
  const recipients = h.status === "draft" && h.createdByUid === user.uid ? (await listCircleMembers(user, patientId, "handovers")).filter((m) => m.uid !== user.uid) : [];
  const detail = JSON.parse(JSON.stringify({ ...h, items: h.items.map((i) => ({ id: i.id, section: i.section, text: i.text, attention: i.attention })) }));
  return (
    <>
      <PageHeader title={h.status === "draft" ? "Handover draft" : "Care handover"} description={`For ${patient.fullName}. ${h.status === "draft" ? "Only you can see this until you share it." : ""}`} />
      <HandoverView patientId={patientId} h={detail} recipients={recipients} timezone={patient.timezone} isAuthor={h.createdByUid === user.uid} isRecipient={h.recipientUid === user.uid} />
    </>
  );
}
