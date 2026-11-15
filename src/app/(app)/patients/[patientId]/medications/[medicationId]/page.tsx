import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DateTime } from "luxon";
import { requirePagePatient } from "@/lib/auth/page";
import { getMedication } from "@/lib/services/medications";
import { HttpError } from "@/lib/api/errors";
import { PageHeader } from "@/components/ui/page-header";
import { Alert } from "@/components/ui/alert";
import { MedicationForm } from "@/components/app/medication-form";
import { MedicationActions } from "@/components/app/medication-actions";
import { MedicationStatusChip, isFinalStatus } from "@/components/app/medication-status";

export const metadata: Metadata = { title: "Edit medication" };

export default async function EditMedicationPage({ params }: { params: Promise<{ patientId: string; medicationId: string }> }) {
  const { patientId, medicationId } = await params;
  const { user, patient } = await requirePagePatient(patientId, "medications:write");
  let med;
  try {
    med = await getMedication(user, patientId, medicationId);
  } catch (e) {
    if (e instanceof HttpError) notFound();
    throw e;
  }
  const today = DateTime.now().setZone(patient.timezone).toFormat("yyyy-MM-dd");
  return (
    <>
      <PageHeader title={`Edit ${med.name}`} description={`Changes apply to future reminders. Past doses and their history stay as they were.`} actions={<MedicationStatusChip status={med.status} />} />
      {isFinalStatus(med.status) ? (
        <Alert variant="info" title={`This medication is ${med.status}.`}>It can no longer be edited. To start it again, add it as a new medication.</Alert>
      ) : (
        <div className="space-y-8">
          <MedicationActions patientId={patientId} medicationId={med.id} name={med.name} status={med.status} size="default" />
          <MedicationForm
            patientId={patientId} mode="edit" medicationId={med.id} today={today}
            initial={{
              name: med.name, activeIngredient: med.activeIngredient, strength: med.strength, doseAmount: med.doseAmount,
              doseUnit: med.doseUnit, form: med.form, route: med.route, schedule: med.schedule, startDate: med.startDate,
              endDate: med.endDate, prescriber: med.prescriber, instructions: med.instructions,
            }}
          />
        </div>
      )}
    </>
  );
}
