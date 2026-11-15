import type { Metadata } from "next";
import { requirePagePatient } from "@/lib/auth/page";
import { can } from "@/lib/domain/permissions";
import { photoUrl } from "@/lib/services/patients";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { PatientForm } from "@/components/app/patient-form";
import { PolicyForm } from "@/components/app/policy-form";
import { PhotoUpload } from "@/components/app/photo-upload";

export const metadata: Metadata = { title: "Profile" };
export const dynamic = "force-dynamic";

export default async function PatientSettingsPage({ params }: { params: Promise<{ patientId: string }> }) {
  const { patientId } = await params;
  const { patient, membership } = await requirePagePatient(patientId, "patient:updatePreferences");
  const caregiver = can(membership, "patient:update");
  const photo = caregiver ? await photoUrl(patient.photoPath) : null;
  return (
    <div className="space-y-8">
      <PageHeader title={caregiver ? "Profile and reminder rules" : "My profile"} description={caregiver ? `Details and reminder settings for ${patient.fullName}.` : "Your contact details and language."} />
      {caregiver && <Card><PhotoUpload patientId={patientId} name={patient.fullName} photo={photo} /></Card>}
      <Card>
        <PatientForm
          limited={!caregiver}
          initial={{ id: patientId, fullName: patient.fullName, dateOfBirth: patient.dateOfBirth, gender: patient.gender ?? "", phone: patient.phone ?? "", email: patient.email ?? "", preferredLanguage: patient.preferredLanguage, timezone: patient.timezone, emergencyContactName: patient.emergencyContactName ?? "", emergencyContactPhone: patient.emergencyContactPhone ?? "", medicalNotes: patient.medicalNotes ?? "" }}
        />
      </Card>
      {caregiver && <PolicyForm patientId={patientId} initial={patient.escalationPolicy} />}
    </div>
  );
}
