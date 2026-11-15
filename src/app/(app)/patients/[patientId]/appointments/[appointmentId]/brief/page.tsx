import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePagePatient } from "@/lib/auth/page";
import { HttpError } from "@/lib/api/errors";
import { getDoctorBrief } from "@/lib/services/doctor-brief";
import { DoctorBriefView } from "@/components/app/doctor-brief";

export const metadata: Metadata = { title: "Doctor brief" };

export default async function Page({ params }: { params: Promise<{ patientId: string; appointmentId: string }> }) {
  const { patientId, appointmentId } = await params;
  const { user } = await requirePagePatient(patientId, "appointments:read");
  let r;
  try {
    r = await getDoctorBrief(user, patientId, appointmentId);
  } catch (e) {
    if (e instanceof HttpError) notFound();
    throw e;
  }
  return <DoctorBriefView patientId={patientId} appointmentId={appointmentId} brief={r.brief} canEdit={r.canEdit} canRemoveAnyObservation={r.canRemoveAnyObservation} currentUid={r.currentUid} />;
}
