import type { Metadata } from "next";
import { DateTime } from "luxon";
import { requirePagePatient } from "@/lib/auth/page";
import { listAudit } from "@/lib/services/audit";
import { listMembers } from "@/lib/services/care-circle";
import { PageHeader, EmptyState } from "@/components/ui/page-header";
import { History } from "lucide-react";

export const metadata: Metadata = { title: "Activity history" };
export const dynamic = "force-dynamic";

const LABEL: Record<string, string> = {
  "patient.create": "Created the patient profile", "patient.update": "Updated the profile", "patient.policy_update": "Changed the reminder rules",
  "member.invite": "Invited someone", "member.invite_revoke": "Cancelled an invitation", "member.accept": "Joined the care circle",
  "member.revoke": "Removed someone's access", "member.permissions_update": "Changed what a family member can see",
  "medication.create": "Added a medication", "medication.update": "Edited a medication", "medication.status_change": "Changed a medication's status",
  "dose.event": "Recorded a response to a dose", "appointment.create": "Added an appointment", "appointment.update": "Edited an appointment", "appointment.cancel": "Cancelled an appointment",
  "document.upload": "Uploaded a document", "document.delete": "Deleted a document", "document.access": "Opened a document", "preferences.update": "Changed notification settings",
};

/** Who did what and when, for caregivers. Never shows health details, only that something changed. */
export default async function ActivityPage({ params }: { params: Promise<{ patientId: string }> }) {
  const { patientId } = await params;
  const { user, patient } = await requirePagePatient(patientId, "audit:read");
  const [events, members] = await Promise.all([listAudit(user, patientId, 100), listMembers(user, patientId)]);
  const names = new Map(members.map((m) => [m.uid, m.displayName]));
  return (
    <>
      <PageHeader title="Activity history" description={`A record of changes to ${patient.fullName}'s care plan. It shows what changed and who changed it, not the details.`} />
      {events.length === 0 ? (
        <EmptyState icon={<History />} title="No activity yet">Changes to the care plan will be listed here.</EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border bg-card">
          <table className="w-full text-left text-base">
            <caption className="sr-only">Recent activity, newest first</caption>
            <thead className="bg-muted">
              <tr><th scope="col" className="px-4 py-3">When</th><th scope="col" className="px-4 py-3">Who</th><th scope="col" className="px-4 py-3">What</th></tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id} className="border-t border-border align-top">
                  <th scope="row" className="px-4 py-3 font-normal"><time dateTime={e.at.toISOString()}>{DateTime.fromJSDate(e.at, { zone: patient.timezone }).toFormat("d LLL yyyy, h:mm a")}</time></th>
                  <td className="px-4 py-3">{e.actorUid ? names.get(e.actorUid) ?? "Former member" : "Automatic"}</td>
                  <td className="px-4 py-3">{LABEL[e.action] ?? e.action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
