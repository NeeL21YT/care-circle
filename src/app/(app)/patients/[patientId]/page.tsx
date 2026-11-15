import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePagePatient } from "@/lib/auth/page";
import { getPatientSnapshot } from "@/lib/services/dashboards";
import { listNotifications } from "@/lib/services/notifications";
import { can } from "@/lib/domain/permissions";
import { PatientHome } from "@/components/app/patient-home";
import { CaregiverPatientHome } from "@/components/app/caregiver-patient-home";
import { FamilyHome } from "@/components/app/family-home";

export const metadata: Metadata = { title: "Overview" };
export const dynamic = "force-dynamic";

export default async function PatientPage({ params }: { params: Promise<{ patientId: string }> }) {
  const { patientId } = await params;
  const { user, membership } = await requirePagePatient(patientId, "patient:read");
  const now = new Date();
  const snap = await getPatientSnapshot(user.uid, patientId, now);
  if (!snap) notFound();

  if (membership.role === "patient") return <PatientHome snap={snap} now={now} patientId={patientId} />;
  if (membership.role === "primary_caregiver") {
    return <CaregiverPatientHome snap={snap} now={now} patientId={patientId} canWrite={can(membership, "medications:write")} />;
  }
  const notifications = await listNotifications(user, patientId, { limit: 5 });
  return <FamilyHome snap={snap} now={now} patientId={patientId} notifications={notifications} />;
}
