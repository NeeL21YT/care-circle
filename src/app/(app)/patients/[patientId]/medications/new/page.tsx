import type { Metadata } from "next";
import { DateTime } from "luxon";
import { requirePagePatient } from "@/lib/auth/page";
import { PageHeader } from "@/components/ui/page-header";
import { MedicationForm } from "@/components/app/medication-form";

export const metadata: Metadata = { title: "Add medication" };

export default async function NewMedicationPage({ params }: { params: Promise<{ patientId: string }> }) {
  const { patientId } = await params;
  const { patient } = await requirePagePatient(patientId, "medications:write");
  const today = DateTime.now().setZone(patient.timezone).toFormat("yyyy-MM-dd");
  return (
    <>
      <PageHeader title="Add a medication" description={`Set up a medicine and its reminders for ${patient.fullName}. Times are in ${patient.timezone}.`} />
      <MedicationForm patientId={patientId} mode="create" today={today} />
    </>
  );
}
