import type { Metadata } from "next";
import Link from "next/link";
import { DateTime } from "luxon";
import { Pill, Plus } from "lucide-react";
import { requirePagePatient } from "@/lib/auth/page";
import { can } from "@/lib/domain/permissions";
import { listMedications } from "@/lib/services/medications";
import { describeSchedule } from "@/lib/domain/schedule-text";
import type { Medication, MedicationStatus } from "@/lib/domain/types";
import { PageHeader, EmptyState } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { MedicationActions } from "@/components/app/medication-actions";
import { MedicationStatusChip } from "@/components/app/medication-status";

export const metadata: Metadata = { title: "Medications" };

const ORDER: MedicationStatus[] = ["active", "on_hold", "draft", "completed", "discontinued"];
const doseLabel = (m: Medication) => `${m.doseAmount} ${m.doseUnit}${m.strength ? ` (${m.strength})` : ""}`;
const day = (iso: string) => DateTime.fromISO(iso).toFormat("d LLL yyyy");
const dates = (m: Medication) => `From ${day(m.startDate)}${m.endDate ? ` to ${day(m.endDate)}` : ", no end date"}`;

export default async function MedicationsPage({ params }: { params: Promise<{ patientId: string }> }) {
  const { patientId } = await params;
  const { user, patient, membership } = await requirePagePatient(patientId, "medications:read");
  const canWrite = can(membership, "medications:write");
  const all = await listMedications(user, patientId);
  const meds = all
    .filter((m) => canWrite || m.status !== "draft")
    .sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || a.name.localeCompare(b.name));
  const mine = membership.role === "patient";

  const addButton = canWrite && (
    <Link href={`/patients/${patientId}/medications/new`} className={buttonVariants({ size: "lg" })}>
      <Plus aria-hidden="true" />Add medication
    </Link>
  );

  return (
    <>
      <PageHeader
        title={mine ? "My medicines" : "Medications"}
        description={mine ? "Your medicines and when to take them, exactly as your care team entered them." : `Medicines and reminder schedules for ${patient.fullName}.`}
        actions={addButton}
      />
      {meds.length === 0 ? (
        <EmptyState icon={<Pill />} title="No medications yet" action={addButton || undefined}>
          {canWrite ? "Add the first medicine to start dose reminders." : "Your care team has not added any medicines yet."}
        </EmptyState>
      ) : canWrite ? (
        <div className="overflow-x-auto rounded-2xl border border-border bg-surface">
          <table className="w-full min-w-[56rem] border-collapse text-left text-base">
            <caption className="p-4 text-left text-lg font-bold">Medications for {patient.fullName}, active first</caption>
            <thead>
              <tr className="border-y border-border bg-muted">
                {["Medicine", "Dose", "When", "Dates", "Status", "Actions"].map((h) => <th key={h} scope="col" className="px-4 py-3 font-bold">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {meds.map((m) => (
                <tr key={m.id} className="border-b border-border align-top last:border-0">
                  <th scope="row" className="px-4 py-3 font-bold">
                    {m.name}
                    {m.instructions && <span className="mt-1 block text-[0.95rem] font-normal text-muted-foreground">{m.instructions}</span>}
                  </th>
                  <td className="px-4 py-3">{doseLabel(m)}<span className="block text-[0.95rem] text-muted-foreground">{m.form}, {m.route.toLowerCase()}</span></td>
                  <td className="px-4 py-3">{describeSchedule(m.schedule)}</td>
                  <td className="px-4 py-3">{dates(m)}</td>
                  <td className="px-4 py-3"><MedicationStatusChip status={m.status} /></td>
                  <td className="px-4 py-3"><MedicationActions patientId={patientId} medicationId={m.id} name={m.name} status={m.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <ul className="space-y-4">
          {meds.map((m) => (
            <li key={m.id}>
              <Card>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <h2 className="text-2xl font-bold">{m.name}</h2>
                  <MedicationStatusChip status={m.status} />
                </div>
                <dl className="mt-3 space-y-2 text-lg">
                  <div><dt className="inline font-semibold">Dose: </dt><dd className="inline">{doseLabel(m)}</dd></div>
                  <div><dt className="inline font-semibold">When: </dt><dd className="inline">{describeSchedule(m.schedule)}</dd></div>
                  {m.instructions && <div><dt className="inline font-semibold">Instructions: </dt><dd className="inline">{m.instructions}</dd></div>}
                  <div className="text-base text-muted-foreground"><dt className="sr-only">Dates</dt><dd>{dates(m)}</dd></div>
                </dl>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
