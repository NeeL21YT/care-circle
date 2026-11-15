import type { Metadata } from "next";
import { requirePagePatient } from "@/lib/auth/page";
import { can } from "@/lib/domain/permissions";
import { listInvitations, listMembers } from "@/lib/services/care-circle";
import { PageHeader } from "@/components/ui/page-header";
import { CareCircleManager, type InviteView, type MemberView } from "@/components/app/care-circle-manager";

export const metadata: Metadata = { title: "Care circle" };
export const dynamic = "force-dynamic";

export default async function CareCirclePage({ params }: { params: Promise<{ patientId: string }> }) {
  const { patientId } = await params;
  const { user, patient, membership } = await requirePagePatient(patientId, "members:read");
  const canManage = can(membership, "members:invite");
  const [members, invites] = await Promise.all([
    listMembers(user, patientId),
    canManage ? listInvitations(user, patientId) : Promise.resolve([]),
  ]);
  const mine = membership.role === "patient";
  return (
    <>
      <PageHeader title={mine ? "My care team" : "Care circle"} description={mine ? "The people who help look after you." : `Who can see and help with ${patient.fullName}'s care.`} />
      <CareCircleManager
        patientId={patientId}
        patientName={patient.fullName}
        currentUid={user.uid}
        canManage={canManage}
        members={members as MemberView[]}
        invites={invites.map((i) => ({ inviteId: i.inviteId, email: i.email, role: i.role, permissions: i.permissions, expiresAt: i.expiresAt.toISOString() })) as InviteView[]}
      />
    </>
  );
}
