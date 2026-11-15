import Link from "next/link";
import { ArrowRightLeft, CalendarPlus, FileUp, Pill, ScanLine, UserPlus } from "lucide-react";
import { Card, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { DoseStatusChip } from "@/components/ui/status";
import type { PatientSnapshot } from "@/lib/services/dashboards";
import { ADHERENCE_DEFINITION } from "@/lib/domain/adherence";
import { fmtDate, fmtTime, greeting, relativeDay } from "@/lib/format";
import { cn } from "@/lib/utils";
import { AdherenceChart } from "./adherence-chart";
import { NextAppointmentCard, StatCard, TodaySchedule } from "./home-sections";
import { STATUS_LABEL } from "@/lib/domain/dose-state";
import { AskAssistant } from "@/components/app/assistant-provider";

export function adherenceSentence(a: NonNullable<PatientSnapshot["adherence"]>): string {
  if (a.percentage === null) return "No doses have been due yet, so there is no adherence figure.";
  return `${a.percentage}% of doses due in the last 7 days were reported as taken (${a.taken} of ${a.due}). ${a.skipped} reported skipped, ${a.unknown} not sure and ${a.unresolved} with no answer. This is based on self-reports and is not verified.`;
}

export function CaregiverPatientHome({ snap, now, patientId, canWrite }: { snap: PatientSnapshot; now: Date; patientId: string; canWrite: boolean }) {
  const tz = snap.timezone;
  const base = `/patients/${patientId}`;
  const today = snap.todayDoses ?? [];
  const live = today.filter((d) => d.status !== "cancelled");
  const taken = live.filter((d) => d.status === "reported_taken").length;
  const link = (href: string, icon: React.ReactNode, text: string) => (
    <Link href={href} className={cn(buttonVariants({ variant: "outline", size: "lg" }), "w-full justify-start")}>{icon}{text}</Link>
  );

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 id="page-title" tabIndex={-1} className="text-3xl font-extrabold sm:text-4xl">{snap.patient.fullName}</h1>
        <p className="text-lg text-muted-foreground">{greeting(now, tz)}. Here is {fmtDate(now, tz)} at a glance.</p>
        <div className="print-hide pt-1"><AskAssistant question="What needs my attention today?">What needs attention today?</AskAssistant></div>
      </header>

      {canWrite && (
        <nav aria-label="Quick actions" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {link(`${base}/medications/new`, <Pill aria-hidden="true" />, "Add medication")}
          {link(`${base}/appointments/new`, <CalendarPlus aria-hidden="true" />, "Add appointment")}
          {link(`${base}/scanner`, <ScanLine aria-hidden="true" />, "Scan a prescription")}
          {link(`${base}/documents`, <FileUp aria-hidden="true" />, "Upload document")}
          {link(`${base}/handover`, <ArrowRightLeft aria-hidden="true" />, "Prepare a handover")}
          {link(`${base}/care-circle`, <UserPlus aria-hidden="true" />, "Invite family member")}
        </nav>
      )}

      <section aria-labelledby="overview-heading">
        <h2 id="overview-heading" className="mb-3 text-2xl font-bold">Today</h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Active medications" value={snap.activeMedicationCount ?? "–"} />
          <StatCard label="Doses scheduled today" value={live.length} />
          <StatCard label="Reported taken" value={taken} hint="Self-reported, not verified" />
          <StatCard label="Unresolved" value={snap.unresolvedToday ?? 0} hint="No answer, snoozed or no response" />
        </div>
      </section>

      <TodaySchedule doses={today} patientId={patientId} timezone={tz} canRespond={canWrite} onBehalf />

      <section aria-labelledby="events-heading" className="space-y-3">
        <h2 id="events-heading" className="text-2xl font-bold">Medication activity today</h2>
        {snap.recentEvents && snap.recentEvents.length > 0 ? (
          <ol className="space-y-2">
            {snap.recentEvents.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-border bg-surface px-4 py-3 text-base">
                <time dateTime={e.recordedAt.toISOString()} className="font-semibold">{fmtTime(e.recordedAt, tz)}</time>
                <span>{e.medicationName ?? "Dose"}</span>
                <DoseStatusChip status={e.resultingStatus} />
                <span className="text-muted-foreground">
                  {e.source === "system" ? "Automatic" : e.source === "caregiver_ui" ? "Recorded by a caregiver" : "Reported by the patient"}
                  {e.note ? ` · “${e.note}”` : ""}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="rounded-xl bg-muted p-4 text-base">Nothing has happened yet today.</p>
        )}
      </section>

      {snap.weekly && snap.adherence && (
        <section aria-labelledby="adherence-heading" className="space-y-3">
          <h2 id="adherence-heading" className="text-2xl font-bold">Adherence</h2>
          <Card>
            <AdherenceChart days={snap.weekly} summaryText={adherenceSentence(snap.adherence)} />
          </Card>
          <p className="text-[0.95rem] text-muted-foreground"><strong>How this is calculated:</strong> {ADHERENCE_DEFINITION}</p>
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <NextAppointmentCard appt={snap.nextAppointment} now={now} timezone={tz} href={`${base}/appointments`} />
        <Card>
          <CardTitle>Next scheduled medicine</CardTitle>
          {snap.nextDose ? (
            <p className="mt-3 text-lg">
              <strong>{snap.nextDose.medicationName}</strong> at <time dateTime={snap.nextDose.scheduledAt.toISOString()}>{fmtTime(snap.nextDose.scheduledAt, tz)}</time>, {relativeDay(snap.nextDose.scheduledAt, now, tz)}. Status: {STATUS_LABEL[snap.nextDose.status]}.
            </p>
          ) : (
            <p className="mt-3 text-lg text-muted-foreground">No upcoming doses.</p>
          )}
        </Card>
      </div>
    </div>
  );
}
