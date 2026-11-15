import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus, UserRound } from "lucide-react";
import { requirePageUser } from "@/lib/auth/page";
import { getCaregiverOverview } from "@/lib/services/dashboards";
import { photoUrl } from "@/lib/services/patients";
import { PageHeader, EmptyState } from "@/components/ui/page-header";
import { buttonVariants } from "@/components/ui/button";
import { PatientOverviewCard } from "@/components/app/patient-overview-card";
import { StatCard } from "@/components/app/home-sections";
import { Alert } from "@/components/ui/alert";

export const metadata: Metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await requirePageUser();
  const now = new Date();
  const overview = await getCaregiverOverview(user.uid, now);
  const { patients, totals } = overview;

  // A patient with a single care profile goes straight to their own day.
  if (patients.length === 1 && patients[0].role === "patient") redirect(`/patients/${patients[0].patient.id}`);

  const isCaregiver = user.accountType === "caregiver" || patients.some((p) => p.role === "primary_caregiver");
  const photos = await Promise.all(patients.map((p) => photoUrl(p.patient.photoPath)));

  return (
    <main id="main-content" className="mx-auto max-w-7xl px-4 py-8">
      <PageHeader
        title={`Hello, ${user.displayName.split(" ")[0]}`}
        description={isCaregiver ? "Everything you manage, in one place." : "The people you are connected to."}
        actions={user.accountType === "caregiver" ? (
          <Link href="/patients/new" className={buttonVariants({ size: "lg" })}><Plus aria-hidden="true" /> Add a patient</Link>
        ) : undefined}
      />

      {patients.length === 0 ? (
        user.accountType === "caregiver" ? (
          <EmptyState icon={<UserRound />} title="Add the first patient" action={<Link href="/patients/new" className={buttonVariants({ size: "lg" })}>Create a patient profile</Link>}>
            Start by creating a profile for the person you care for. You can then add their medicines, appointments and documents, and invite family.
          </EmptyState>
        ) : (
          <EmptyState icon={<UserRound />} title="You are not in a care circle yet">
            A primary caregiver needs to invite you. Ask them to send an invitation to <strong>{user.email}</strong>, then open the link in that email.
          </EmptyState>
        )
      ) : (
        <div className="space-y-10">
          {isCaregiver && (
            <section aria-labelledby="totals-heading">
              <h2 id="totals-heading" className="mb-3 text-2xl font-bold">Today across your patients</h2>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                <StatCard label="Patients managed" value={totals.patients} />
                <StatCard label="Active medications" value={totals.activeMedications} />
                <StatCard label="Doses scheduled today" value={totals.todayScheduled} />
                <StatCard label="Reported taken today" value={totals.todayTaken} hint="Self-reported, not verified" />
                <StatCard label="Unresolved today" value={totals.todayUnresolved} hint="No answer, snoozed or no response" />
                <StatCard label="Upcoming appointments" value={totals.upcomingAppointments} hint="Patients with one booked" />
              </div>
              {totals.todayUnresolved > 0 && <div className="mt-4"><Alert variant="warning" title={`${totals.todayUnresolved} ${totals.todayUnresolved === 1 ? "dose is" : "doses are"} waiting for an answer today`}>Open a patient below to see which ones.</Alert></div>}
            </section>
          )}
          <section aria-labelledby="patients-heading">
            <h2 id="patients-heading" className="mb-3 text-2xl font-bold">{isCaregiver ? "Patient overview" : "Your care circles"}</h2>
            <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {patients.map((s, i) => (
                <li key={s.patient.id}><PatientOverviewCard snap={s} photo={photos[i]} /></li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </main>
  );
}
