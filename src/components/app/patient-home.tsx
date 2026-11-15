import { ReadAloud } from "@/components/a11y/read-aloud";
import { Card } from "@/components/ui/card";
import type { PatientSnapshot } from "@/lib/services/dashboards";
import { firstName, fmtDate, fmtTime, greeting, relativeDay } from "@/lib/format";
import { DoseCard } from "./dose-card";
import { NextAppointmentCard, QuickLinks, TodaySchedule, toDoseView } from "./home-sections";

/** The simplest screen in the app: one next action, a short list, big links. */
export function PatientHome({ snap, now, patientId }: { snap: PatientSnapshot; now: Date; patientId: string }) {
  const tz = snap.timezone;
  const name = firstName(snap.patient.fullName ?? "there");
  const today = snap.todayDoses ?? [];
  const live = today.filter((d) => d.status !== "cancelled");
  const open = live.filter((d) => ["scheduled", "notified", "acknowledged", "snoozed", "missed_by_policy"].includes(d.status) && d.scheduledAt <= new Date(now.getTime() + 24 * 3600_000));
  const dueSoon = open.length;
  const status =
    live.length === 0 ? "You have no medicines to take today."
    : dueSoon === 0 ? "You have answered every medicine for today. Thank you."
    : `You have ${dueSoon} ${dueSoon === 1 ? "medicine" : "medicines"} still to answer today.`;

  const next = snap.nextDose;
  const spoken = [
    `${greeting(now, tz)} ${name}. Today is ${fmtDate(now, tz)}.`,
    status,
    next ? `Your next medicine is ${next.medicationName}, ${next.doseText}, at ${fmtTime(next.scheduledAt, tz)}.${next.instructions ? ` Instructions: ${next.instructions}.` : ""}` : "",
    snap.nextAppointment ? `Your next appointment is with ${snap.nextAppointment.doctorName} ${relativeDay(snap.nextAppointment.startsAt, now, tz)} at ${fmtTime(snap.nextAppointment.startsAt, tz)}.` : "You have no upcoming appointments.",
  ].filter(Boolean).join(" ");

  return (
    <div className="space-y-8">
      <header>
        <h1 id="page-title" tabIndex={-1} className="text-4xl font-extrabold sm:text-5xl">{greeting(now, tz)}, {name}</h1>
        <p className="mt-2 text-xl text-muted-foreground"><time dateTime={now.toISOString()}>{fmtDate(now, tz)}</time></p>
        <p className="mt-3 text-2xl font-semibold" role="status">{status}</p>
        <div className="mt-4"><ReadAloud text={spoken} label="Read my day aloud" /></div>
      </header>

      <section aria-labelledby="next-heading">
        <h2 id="next-heading" className="mb-3 text-2xl font-bold">Your next medicine</h2>
        {next ? (
          <DoseCard patientId={patientId} dose={toDoseView(next)} timezone={tz} variant="hero" canRespond />
        ) : (
          <Card><p className="text-xl">Nothing is coming up. Enjoy your day.</p></Card>
        )}
      </section>

      <TodaySchedule doses={today} patientId={patientId} timezone={tz} canRespond />
      <NextAppointmentCard appt={snap.nextAppointment} now={now} timezone={tz} href={`/patients/${patientId}/appointments`} />

      <section aria-labelledby="quick-heading" className="space-y-3">
        <h2 id="quick-heading" className="text-2xl font-bold">Quick links</h2>
        <QuickLinks base={`/patients/${patientId}`} show={{ medications: true, appointments: true, documents: true, team: true }} />
      </section>
    </div>
  );
}
