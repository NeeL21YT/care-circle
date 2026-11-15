import type { Metadata } from "next";
import { requirePagePatient } from "@/lib/auth/page";
import { getPreferences } from "@/lib/services/preferences";
import { PageHeader } from "@/components/ui/page-header";
import { NotificationPrefsForm } from "@/components/app/notification-prefs-form";

export const metadata: Metadata = { title: "Notification settings" };
export const dynamic = "force-dynamic";

export default async function NotificationSettingsPage({ params }: { params: Promise<{ patientId: string }> }) {
  const { patientId } = await params;
  const { user, patient, membership } = await requirePagePatient(patientId, "notifications:read");
  const prefs = await getPreferences(user, patientId);
  return (
    <>
      <PageHeader title="Notification settings" description={`Choose which emails you get about ${patient.fullName}.`} />
      <NotificationPrefsForm patientId={patientId} role={membership.role} email={prefs.email} quietHours={prefs.quietHours} />
    </>
  );
}
