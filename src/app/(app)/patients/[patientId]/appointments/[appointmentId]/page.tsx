import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DateTime } from "luxon";
import { requirePagePatient } from "@/lib/auth/page";
import { listAppointments } from "@/lib/services/appointments";
import { PageHeader } from "@/components/ui/page-header";
import { AppointmentForm } from "@/components/app/appointment-form";

export const metadata: Metadata = { title: "Edit appointment" };

export default async function Page({ params }: { params: Promise<{ patientId: string; appointmentId: string }> }) {
  const { patientId, appointmentId } = await params;
  const { user, patient } = await requirePagePatient(patientId, "appointments:write");
  const appt = (await listAppointments(user, patientId, { scope: "all" })).find((a) => a.id === appointmentId);
  if (!appt) notFound();
  const local = DateTime.fromJSDate(appt.startsAt, { zone: patient.timezone });
  return (
    <>
      <PageHeader title="Edit appointment" description={`With ${appt.doctorName} for ${patient.fullName}.`} />
      <AppointmentForm
        patientId={patientId}
        initial={{
          id: appt.id, doctorName: appt.doctorName, facility: appt.facility ?? "", date: local.toFormat("yyyy-MM-dd"), time: local.toFormat("HH:mm"),
          location: appt.location ?? "", appointmentType: appt.appointmentType, notes: appt.notes ?? "", reminderOffsetsMinutes: appt.reminderOffsetsMinutes,
        }}
      />
    </>
  );
}
