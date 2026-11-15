"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { DateTime } from "luxon";
import { CalendarClock, CalendarPlus, CheckCircle2, Clock, MapPin, XCircle, AlertTriangle } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/page-header";
import { StatusChip } from "@/components/ui/status";
import { AppointmentCalendar } from "./appointment-calendar";
import { AppointmentActions } from "./appointment-actions";
import { cn } from "@/lib/utils";
import type { Appointment } from "@/lib/domain/types";

type Tab = "upcoming" | "past" | "calendar";
const TABS: { id: Tab; label: string }[] = [
  { id: "upcoming", label: "Upcoming" },
  { id: "past", label: "Past and cancelled" },
  { id: "calendar", label: "Calendar" },
];

function Chip({ a, isPast }: { a: Appointment; isPast: boolean }) {
  if (a.status === "cancelled") return <StatusChip tone="neutral" icon={<XCircle />}>Cancelled</StatusChip>;
  if (a.status === "completed") return <StatusChip tone="success" icon={<CheckCircle2 />}>Completed</StatusChip>;
  if (isPast) return <StatusChip tone="warning" icon={<AlertTriangle />}>Needs update</StatusChip>;
  return <StatusChip tone="info" icon={<Clock />}>Upcoming</StatusChip>;
}

function AppointmentCard({ a, timezone, isPast, emphasize, canWrite, patientId }: { a: Appointment; timezone: string; isPast: boolean; emphasize?: boolean; canWrite: boolean; patientId: string }) {
  const local = DateTime.fromJSDate(a.startsAt, { zone: timezone });
  return (
    <Card className={cn(emphasize && "border-2 border-primary bg-surface-tint")}>
      {emphasize && <p className="mb-1 text-[0.95rem] font-bold uppercase tracking-wide text-primary">Next appointment</p>}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-xl font-bold">{a.doctorName}</h3>
          <p className="text-lg"><time dateTime={a.startsAt.toISOString()}>{local.toFormat("cccc d LLLL yyyy 'at' h:mm a")}</time></p>
        </div>
        <Chip a={a} isPast={isPast} />
      </div>
      <dl className="mt-3 grid gap-x-6 gap-y-1 text-base sm:grid-cols-2">
        <div><dt className="inline font-semibold">Type: </dt><dd className="inline">{a.appointmentType}</dd></div>
        {a.facility && <div><dt className="inline font-semibold">Clinic or hospital: </dt><dd className="inline">{a.facility}</dd></div>}
        {a.location && <div><dt className="inline font-semibold"><MapPin aria-hidden="true" className="mr-1 inline size-4" />Location: </dt><dd className="inline">{a.location}</dd></div>}
      </dl>
      {a.notes && <p className="mt-3 whitespace-pre-line text-base text-muted-foreground"><span className="font-semibold text-foreground">Notes: </span>{a.notes}</p>}
      {canWrite && (
        <div className="mt-4">
          <AppointmentActions patientId={patientId} appointmentId={a.id} doctorName={a.doctorName} status={a.status} reminderOffsetsMinutes={a.reminderOffsetsMinutes} editHref={`/patients/${patientId}/appointments/${a.id}`} />
        </div>
      )}
    </Card>
  );
}

export function AppointmentsView({ appointments, timezone, canWrite, patientId, now }: {
  appointments: Appointment[]; timezone: string; canWrite: boolean; patientId: string; now: string;
}) {
  const [tab, setTab] = useState<Tab>("upcoming");
  const refs = useRef<Record<Tab, HTMLButtonElement | null>>({ upcoming: null, past: null, calendar: null });
  const nowMs = new Date(now).getTime();
  const upcoming = appointments.filter((a) => a.status === "scheduled" && +a.startsAt >= nowMs).sort((x, y) => +x.startsAt - +y.startsAt);
  const past = appointments.filter((a) => !(a.status === "scheduled" && +a.startsAt >= nowMs)).sort((x, y) => +y.startsAt - +x.startsAt);
  const add = canWrite && (
    <Link href={`/patients/${patientId}/appointments/new`} className={buttonVariants({ size: "lg" })}><CalendarPlus aria-hidden="true" /> Add appointment</Link>
  );

  function onKey(e: React.KeyboardEvent) {
    const i = TABS.findIndex((t) => t.id === tab);
    let n = i;
    if (e.key === "ArrowRight") n = (i + 1) % TABS.length;
    else if (e.key === "ArrowLeft") n = (i - 1 + TABS.length) % TABS.length;
    else if (e.key === "Home") n = 0;
    else if (e.key === "End") n = TABS.length - 1;
    else return;
    e.preventDefault();
    setTab(TABS[n].id);
    refs.current[TABS[n].id]?.focus();
  }

  return (
    <div>
      <div role="tablist" aria-label="Appointment views" onKeyDown={onKey} className="mb-6 flex flex-wrap gap-2 border-b-2 border-border pb-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            ref={(el) => { refs.current[t.id] = el; }}
            role="tab"
            type="button"
            id={`appt-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`appt-panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => setTab(t.id)}
            className={cn("min-h-12 rounded-xl border-2 px-5 text-base font-semibold", tab === t.id ? "border-primary bg-secondary" : "border-transparent hover:bg-accent")}
          >
            {t.label}
            {t.id !== "calendar" && <span className="ml-1 text-muted-foreground"> ({t.id === "upcoming" ? upcoming.length : past.length})</span>}
          </button>
        ))}
      </div>

      <div role="tabpanel" id="appt-panel-upcoming" aria-labelledby="appt-tab-upcoming" hidden={tab !== "upcoming"} tabIndex={0}>
        {upcoming.length === 0 ? (
          <EmptyState icon={<CalendarClock />} title="No upcoming appointments" action={add || undefined}>
            {canWrite ? "Add the next doctor visit so reminders can be sent." : "When a caregiver adds an appointment, it will appear here."}
          </EmptyState>
        ) : (
          <ul className="space-y-4">
            {upcoming.map((a, i) => (
              <li key={a.id}><AppointmentCard a={a} timezone={timezone} isPast={false} emphasize={i === 0} canWrite={canWrite} patientId={patientId} /></li>
            ))}
          </ul>
        )}
      </div>

      <div role="tabpanel" id="appt-panel-past" aria-labelledby="appt-tab-past" hidden={tab !== "past"} tabIndex={0}>
        {past.length === 0 ? (
          <EmptyState icon={<CalendarClock />} title="Nothing here yet">Completed and cancelled appointments will be listed here.</EmptyState>
        ) : (
          <ul className="space-y-4">
            {past.map((a) => (
              <li key={a.id}><AppointmentCard a={a} timezone={timezone} isPast={+a.startsAt < nowMs} canWrite={canWrite} patientId={patientId} /></li>
            ))}
          </ul>
        )}
      </div>

      <div role="tabpanel" id="appt-panel-calendar" aria-labelledby="appt-tab-calendar" hidden={tab !== "calendar"} tabIndex={0}>
        {tab === "calendar" && <AppointmentCalendar appointments={appointments} timezone={timezone} today={now} canWrite={canWrite} basePath={`/patients/${patientId}/appointments`} />}
      </div>
    </div>
  );
}
