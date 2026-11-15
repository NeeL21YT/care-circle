import Link from "next/link";
import { Card } from "@/components/ui/card";
import { ADHERENCE_DEFINITION } from "@/lib/domain/adherence";
import type { PatientSnapshot } from "@/lib/services/dashboards";
import type { AppNotification } from "@/lib/domain/types";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { AdherenceChart } from "./adherence-chart";
import { adherenceSentence } from "./caregiver-patient-home";
import { NextAppointmentCard, TodaySchedule } from "./home-sections";
import { Alert } from "@/components/ui/alert";
import { DoseStatusChip } from "@/components/ui/status";
import { fmtTime } from "@/lib/format";
import { AskAssistant } from "@/components/app/assistant-provider";

/** Family sees only what the caregiver shared; hidden sections simply do not exist. */
export function FamilyHome({ snap, now, patientId, notifications }: { snap: PatientSnapshot; now: Date; patientId: string; notifications: Pick<AppNotification, "id" | "title" | "body" | "createdAt" | "readAt">[] }) {
  const tz = snap.timezone;
  const nothingShared = !snap.canSeeMedications && snap.todayDoses === null && snap.weekly === null && !snap.canSeeAppointments;

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 id="page-title" tabIndex={-1} className="text-3xl font-extrabold sm:text-4xl">{snap.patient.fullName}</h1>
        <p className="text-lg text-muted-foreground">Shared with you by the care team · {fmtDate(now, tz)}</p>
        <div className="print-hide pt-1"><AskAssistant question="What needs attention for the patient today?">What needs attention today?</AskAssistant></div>
      </header>

      {nothingShared && (
        <Alert variant="info" title="Nothing is shared with you yet">The primary caregiver chooses what family members can see. You can ask them to share medications, appointments, activity or documents.</Alert>
      )}

      {snap.todayDoses && <TodaySchedule doses={snap.todayDoses} patientId={patientId} timezone={tz} canRespond={false} />}

      {snap.recentEvents && (
        <section aria-labelledby="fam-events" className="space-y-3">
          <h2 id="fam-events" className="text-2xl font-bold">Recent reported activity</h2>
          {snap.recentEvents.length ? (
            <ol className="space-y-2">
              {snap.recentEvents.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-border bg-surface px-4 py-3">
                  <time dateTime={e.recordedAt.toISOString()} className="font-semibold">{fmtTime(e.recordedAt, tz)}</time>
                  <span>{e.medicationName ?? "Dose"}</span>
                  <DoseStatusChip status={e.resultingStatus} />
                </li>
              ))}
            </ol>
          ) : <p className="rounded-xl bg-muted p-4">Nothing has happened yet today.</p>}
        </section>
      )}

      {snap.weekly && snap.adherence && (
        <section aria-labelledby="fam-adh" className="space-y-3">
          <h2 id="fam-adh" className="text-2xl font-bold">Adherence</h2>
          <Card><AdherenceChart days={snap.weekly} summaryText={adherenceSentence(snap.adherence)} /></Card>
          <p className="text-[0.95rem] text-muted-foreground">{ADHERENCE_DEFINITION}</p>
        </section>
      )}

      {snap.canSeeAppointments && <NextAppointmentCard appt={snap.nextAppointment} now={now} timezone={tz} />}

      <section aria-labelledby="fam-notifs" className="space-y-3">
        <h2 id="fam-notifs" className="text-2xl font-bold">Important notifications</h2>
        {notifications.length ? (
          <ul className="space-y-2">
            {notifications.map((n) => (
              <li key={n.id} className="rounded-xl border border-border bg-surface px-4 py-3">
                <p className="font-semibold">{n.title}{!n.readAt && <span className="ml-2 rounded-full bg-primary px-2 py-0.5 text-sm text-primary-foreground">New</span>}</p>
                <p className="text-base text-muted-foreground">{n.body}</p>
                <p className="text-sm text-muted-foreground">{fmtDateTime(n.createdAt, tz)}</p>
              </li>
            ))}
          </ul>
        ) : <p className="rounded-xl bg-muted p-4">No notifications yet.</p>}
        <p><Link href={`/patients/${patientId}/notifications`} className="font-semibold text-primary underline">See all notifications</Link></p>
      </section>
    </div>
  );
}
