import type { Metadata } from "next";
import { requirePagePatient } from "@/lib/auth/page";
import { PageHeader } from "@/components/ui/page-header";
import { AppointmentForm } from "@/components/app/appointment-form";

export const metadata: Metadata = { title: "Add appointment" };

export default async function Page({ params }: { params: Promise<{ patientId: string }> }) {
  const { patientId } = await params;
  const { patient } = await requirePagePatient(patientId, "appointments:write");
  return (
    <>
      <PageHeader title="Add appointment" description={`For ${patient.fullName}. Times use ${patient.timezone}.`} />
      <AppointmentForm patientId={patientId} />
    </>
  );
}
