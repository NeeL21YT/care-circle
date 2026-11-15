"use client";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { fmtDate } from "@/lib/format";
import type { WeeklyReport as Report } from "@/lib/domain/weekly-report";

/** Dates arrive as ISO strings after crossing the server/client boundary. */
export type WeeklyReportView = Omit<Report, "periodStart" | "periodEnd" | "appointments"> & {
  periodStart: string;
  periodEnd: string;
  appointments: { past: number; next: { id: string; doctorName: string; startsAt: string } | null } | null;
};

const LINK_LABEL = { tasks: "Open care tasks", scanner: "Open the prescription scanner" } as const;

export function WeeklyReport({ patientId, report }: { patientId: string; report: WeeklyReportView }) {
  const base = `/patients/${patientId}`;
  const stats: { label: string; value: string }[] = [];
  const d = report.doses;
  if (d) {
    stats.push(
      { label: "Doses scheduled", value: String(d.scheduled) },
      { label: "Reported taken", value: String(d.reportedTaken) },
      { label: "Reported skipped", value: String(d.reportedSkipped) },
      { label: "Snoozed", value: String(d.snoozed) },
      { label: "Marked not sure", value: String(d.notSure) },
      { label: "No report yet", value: String(d.noReport) },
      { label: "Reported-taken rate", value: d.adherencePercent === null ? "Not available" : `${d.adherencePercent}%` },
    );
  }
  if (report.tasks) {
    stats.push(
      { label: "Tasks completed", value: String(report.tasks.completed) },
      { label: "Tasks still open", value: String(report.tasks.open) },
      { label: "Tasks overdue", value: String(report.tasks.overdue) },
      { label: "Tasks with nobody responsible", value: String(report.tasks.unassigned) },
    );
  }
  if (report.appointments) stats.push({ label: "Appointments this week", value: String(report.appointments.past) });
  if (report.documents) stats.push({ label: "New documents", value: String(report.documents.added) });
  if (report.scans) stats.push({ label: "Scans waiting for review", value: String(report.scans.waiting) });
  if (report.handovers) stats.push({ label: "Handovers this week", value: String(report.handovers.count) });

  return (
    <div className="space-y-8">
      <p className="text-base text-muted-foreground">
        Covers {fmtDate(report.periodStart, report.timezone)} to {fmtDate(report.periodEnd, report.timezone)}. Worked out directly from your records, without AI.
        Doses are what was reported, not confirmed.
      </p>

      <section aria-labelledby="wr-attention" className="space-y-3">
        <h2 id="wr-attention" className="text-xl font-bold">Needs attention</h2>
        {report.attention.length === 0 ? (
          <Alert variant="success" title="Nothing needs attention from the records you can see." />
        ) : (
          <ul className="space-y-2">
            {report.attention.map((a) => (
              <li key={a.id}>
                <Card className="flex flex-wrap items-center justify-between gap-2 p-4">
                  <span><strong>Attention:</strong> {a.text}</span>
                  {a.link && <Link href={`${base}/${a.link}`} className="inline-flex min-h-11 items-center font-semibold underline">{LINK_LABEL[a.link]}</Link>}
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="wr-summary" className="space-y-3">
        <h2 id="wr-summary" className="text-xl font-bold">The week in words</h2>
        <ul className="list-disc space-y-1 pl-6 text-lg">
          {report.sentences.map((s, i) => <li key={i}>{s}</li>)}
        </ul>
      </section>

      <section aria-labelledby="wr-stats" className="space-y-3">
        <h2 id="wr-stats" className="text-xl font-bold">In numbers</h2>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {stats.map((s) => (
            <Card key={s.label} className="p-4">
              <dt className="text-base font-semibold">{s.label}</dt>
              <dd className="text-3xl font-extrabold">{s.value}</dd>
            </Card>
          ))}
        </dl>
        {report.appointments?.next && (
          <p>Next appointment: <strong>{report.appointments.next.doctorName}</strong>, {fmtDate(report.appointments.next.startsAt, report.timezone)}.</p>
        )}
      </section>

      {report.omitted.length > 0 && (
        <section aria-labelledby="wr-omitted">
          <Alert variant="info" title="Not included in this report">
            <h2 id="wr-omitted" className="sr-only">Omitted information</h2>
            <p>You do not have access to: {report.omitted.join(", ")}.</p>
          </Alert>
        </section>
      )}

      <nav aria-label="Related pages" className="flex flex-wrap gap-4">
        <Link href={`${base}/tasks`} className="inline-flex min-h-11 items-center font-semibold underline">Care tasks</Link>
        <Link href={`${base}/handover`} className="inline-flex min-h-11 items-center font-semibold underline">Prepare a handover</Link>
        {report.scans && <Link href={`${base}/scanner`} className="inline-flex min-h-11 items-center font-semibold underline">Prescription scanner</Link>}
      </nav>
    </div>
  );
}
