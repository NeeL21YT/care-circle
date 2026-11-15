import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Avatar } from "./avatar";
import { DoseStatusChip } from "@/components/ui/status";
import { fmtDateTime, fmtTime } from "@/lib/format";
import type { PatientSnapshot } from "@/lib/services/dashboards";

const ROLE_LABEL = { patient: "You", primary_caregiver: "Primary caregiver", family: "Family member" } as const;

export function PatientOverviewCard({ snap, photo, headingLevel = "h3" }: { snap: PatientSnapshot; photo: string | null; headingLevel?: "h2" | "h3" }) {
  const H = headingLevel;
  const tz = snap.timezone;
  const name = snap.patient.fullName ?? "Patient";
  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-center gap-4">
        <Avatar name={name} src={photo} />
        <div className="min-w-0">
          <H className="truncate text-xl font-bold">{name}</H>
          <p className="text-base text-muted-foreground">Your role: {ROLE_LABEL[snap.role]}</p>
        </div>
      </div>
      <dl className="grid gap-3 text-base">
        {snap.canSeeMedications && (
          <div>
            <dt className="font-semibold">Next medicine</dt>
            <dd className="mt-0.5">
              {snap.nextDose ? (
                <span className="flex flex-wrap items-center gap-2">
                  {snap.nextDose.medicationName} at <time dateTime={snap.nextDose.scheduledAt.toISOString()}>{fmtTime(snap.nextDose.scheduledAt, tz)}</time>
                  <DoseStatusChip status={snap.nextDose.status} />
                </span>
              ) : "None coming up"}
            </dd>
          </div>
        )}
        {snap.unresolvedToday !== null && (
          <div><dt className="font-semibold">Unresolved today</dt><dd className="mt-0.5">{snap.unresolvedToday} {snap.unresolvedToday === 1 ? "dose" : "doses"}</dd></div>
        )}
        {snap.canSeeAppointments && (
          <div>
            <dt className="font-semibold">Next appointment</dt>
            <dd className="mt-0.5">{snap.nextAppointment ? <>{snap.nextAppointment.doctorName}, <time dateTime={snap.nextAppointment.startsAt.toISOString()}>{fmtDateTime(snap.nextAppointment.startsAt, tz)}</time></> : "None booked"}</dd>
          </div>
        )}
      </dl>
      <Link href={`/patients/${snap.patient.id}`} className="mt-auto inline-flex min-h-12 items-center gap-2 font-semibold text-primary underline">
        Open {name}&apos;s care plan <ArrowRight aria-hidden="true" className="size-4" />
      </Link>
    </Card>
  );
}
