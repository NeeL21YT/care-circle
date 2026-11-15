import Link from "next/link";
import { CalendarDays, FileText, Pill, Users, ArrowRight, MapPin } from "lucide-react";
import { Card, CardTitle } from "@/components/ui/card";
import { DoseCard, type DoseView } from "./dose-card";
import { DoseStatusChip } from "@/components/ui/status";
import { fmtDate, fmtTime, relativeDay } from "@/lib/format";
import type { Appointment, DoseOccurrence } from "@/lib/domain/types";

export const toDoseView = (d: DoseOccurrence): DoseView => ({
  id: d.id, medicationName: d.medicationName, doseText: d.doseText, instructions: d.instructions,
  scheduledAt: d.scheduledAt.toISOString(), status: d.status,
});

export function NextAppointmentCard({ appt, now, timezone, href }: { appt: Appointment | null; now: Date; timezone: string; href?: string }) {
  return (
    <Card>
      <CardTitle>Next doctor appointment</CardTitle>
      {appt ? (
        <div className="mt-3 space-y-1 text-lg">
          <p className="text-xl font-bold">{appt.doctorName}</p>
          <p>
            <time dateTime={appt.startsAt.toISOString()}>{relativeDay(appt.startsAt, now, timezone)}, {fmtDate(appt.startsAt, timezone)} at {fmtTime(appt.startsAt, timezone)}</time>
          </p>
          {(appt.facility || appt.location) && (
            <p className="flex items-start gap-2 text-muted-foreground"><MapPin aria-hidden="true" className="mt-1 size-5 shrink-0" />{[appt.facility, appt.location].filter(Boolean).join(", ")}</p>
          )}
          <p className="text-muted-foreground">{appt.appointmentType}</p>
        </div>
      ) : (
        <p className="mt-3 text-lg text-muted-foreground">No appointments are booked.</p>
      )}
      {href && <p className="mt-4"><Link href={href} className="inline-flex min-h-12 items-center gap-1 font-semibold text-primary underline">See all appointments <ArrowRight aria-hidden="true" className="size-4" /></Link></p>}
    </Card>
  );
}

/** Today's doses as an ordered list (a list, not a dense table, on patient screens). */
export function TodaySchedule({ doses, patientId, timezone, canRespond, onBehalf }: { doses: DoseOccurrence[]; patientId: string; timezone: string; canRespond: boolean; onBehalf?: boolean }) {
  const live = doses.filter((d) => d.status !== "cancelled");
  return (
    <section aria-labelledby="today-heading" className="space-y-4">
      <h2 id="today-heading" className="text-2xl font-bold">Today&apos;s medicines</h2>
      {live.length === 0 ? (
        <p className="rounded-2xl border-2 border-dashed border-border bg-surface p-6 text-lg">No medicines are scheduled for today.</p>
      ) : (
        <ol className="space-y-3">
          {live.map((d) => (
            <li key={d.id}><DoseCard patientId={patientId} dose={toDoseView(d)} timezone={timezone} canRespond={canRespond} onBehalf={onBehalf} /></li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function QuickLinks({ base, show }: { base: string; show: { medications?: boolean; appointments?: boolean; documents?: boolean; team?: boolean } }) {
  const items = [
    show.medications && { href: `${base}/medications`, label: "My medicines", icon: <Pill /> },
    show.appointments && { href: `${base}/appointments`, label: "My appointments", icon: <CalendarDays /> },
    show.documents && { href: `${base}/documents`, label: "My documents", icon: <FileText /> },
    show.team && { href: `${base}/care-circle`, label: "My care team", icon: <Users /> },
  ].filter(Boolean) as { href: string; label: string; icon: React.ReactNode }[];
  return (
    <nav aria-label="Quick actions">
      <ul className="grid gap-3 sm:grid-cols-2">
        {items.map((i) => (
          <li key={i.href}>
            <Link href={i.href} className="flex min-h-20 items-center gap-4 rounded-2xl border-2 border-border bg-surface p-4 text-xl font-bold hover:bg-accent">
              <span aria-hidden="true" className="flex size-12 items-center justify-center rounded-xl bg-secondary text-primary [&_svg]:size-6">{i.icon}</span>
              {i.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function StatCard({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <Card className="p-5">
      <p className="text-base font-semibold text-muted-foreground">{label}</p>
      <p className="mt-1 text-4xl font-extrabold">{value}</p>
      {hint && <p className="mt-1 text-[0.95rem] text-muted-foreground">{hint}</p>}
    </Card>
  );
}

export { DoseStatusChip };
