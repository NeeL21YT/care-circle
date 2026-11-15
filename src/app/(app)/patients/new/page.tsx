import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requirePageUser } from "@/lib/auth/page";
import { PageHeader } from "@/components/ui/page-header";
import { PatientForm } from "@/components/app/patient-form";

export const metadata: Metadata = { title: "Add a patient" };

export default async function NewPatientPage() {
  const user = await requirePageUser();
  if (user.accountType !== "caregiver") redirect("/dashboard");
  return (
    <main id="main-content" className="mx-auto max-w-3xl px-4 py-8">
      <PageHeader title="Add a patient" description="Create a profile for the person you care for. You will be their primary caregiver and can invite others afterwards." />
      <PatientForm />
    </main>
  );
}
