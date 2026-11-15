import type { Metadata } from "next";
import { requirePagePatient } from "@/lib/auth/page";
import { can } from "@/lib/domain/permissions";
import { listAppointments } from "@/lib/services/appointments";
import { PageHeader } from "@/components/ui/page-header";
import { AppointmentsView } from "@/components/app/appointments-view";
import { AskAssistant } from "@/components/app/assistant-provider";

export const metadata: Metadata = { title: "Appointments" };

export default async function Page({ params }: { params: Promise<{ patientId: string }> }) {
  const { patientId } = await params;
  const { user, patient, membership } = await requirePagePatient(patientId, "appointments:read");
  const appointments = await listAppointments(user, patientId, { scope: "all" });
  const mine = membership.role === "patient";
  return (
    <>
      <PageHeader title={mine ? "My appointments" : "Appointments"} description={`Doctor visits for ${patient.fullName}. Times are shown in ${patient.timezone}.`} actions={<AskAssistant question="What is the next appointment, and where and when is it?">Ask about appointments</AskAssistant>} />
      <AppointmentsView appointments={appointments} timezone={patient.timezone} canWrite={can(membership, "appointments:write")} patientId={patientId} now={new Date().toISOString()} />
    </>
  );
}
