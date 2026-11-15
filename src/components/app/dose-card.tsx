"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, HelpCircle, Clock, SkipForward, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Select, Textarea } from "@/components/ui/field";
import { DoseStatusChip } from "@/components/ui/status";
import { Alert } from "@/components/ui/alert";
import { useAnnounce } from "@/components/a11y/announcer";
import { api, clientEventId, errorMessage } from "@/lib/client/api";
import { fmtTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { DoseStatus } from "@/lib/domain/types";
import { SNOOZE_OPTIONS_MINUTES } from "@/lib/domain/dose-state";

export interface DoseView {
  id: string;
  medicationName: string;
  doseText: string;
  instructions: string | null;
  scheduledAt: string; // ISO
  status: DoseStatus;
}

interface Props {
  patientId: string;
  dose: DoseView;
  timezone: string;
  /** Large card for "next medicine", compact row for the daily list. */
  variant?: "hero" | "row";
  /** Patients and caregivers can respond; family can only look. */
  canRespond: boolean;
  /** Wording changes when a caregiver records on the patient's behalf. */
  onBehalf?: boolean;
}

const OPEN: DoseStatus[] = ["scheduled", "notified", "acknowledged", "snoozed", "missed_by_policy"];

/**
 * One dose and its actions. Every control's accessible name includes the
 * medicine and time, so a screen-reader user tabbing through a list hears
 * "I took it, Metformin, 8:00 AM" rather than five identical "I took it".
 * Responses are announced through the live region and focus moves to the
 * status line, so nothing is lost when buttons change after an answer.
 */
export function DoseCard({ patientId, dose, timezone, variant = "row", canRespond, onBehalf }: Props) {
  const router = useRouter();
  const announce = useAnnounce();
  const [status, setStatus] = useState<DoseStatus>(dose.status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [changing, setChanging] = useState(false);
  const [dialog, setDialog] = useState<null | "snooze" | "skip">(null);
  const [minutes, setMinutes] = useState<number>(15);
  const [reason, setReason] = useState("");
  const statusRef = useRef<HTMLDivElement>(null);

  const time = fmtTime(dose.scheduledAt, timezone);
  const label = `${dose.medicationName}, ${time}`;
  const open = OPEN.includes(status);
  const showActions = canRespond && status !== "cancelled" && (open || changing);
  const hero = variant === "hero";

  async function send(body: Record<string, unknown>, path: "events" | "snooze", done: string, next: DoseStatus) {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/patients/${patientId}/doses/${dose.id}/${path}`, { method: "POST", body: { ...body, clientEventId: clientEventId() } });
      setStatus(next);
      setChanging(false);
      setDialog(null);
      announce(done);
      router.refresh();
      requestAnimationFrame(() => statusRef.current?.focus());
    } catch (e) {
      const msg = errorMessage(e);
      setError(msg);
      announce(`That did not save. ${msg}`, "assertive");
    } finally {
      setBusy(false);
    }
  }

  const who = onBehalf ? "recorded" : "noted";
  const took = () => send({ eventType: "reported_taken" }, "events", `Thank you. ${label} is ${who} as taken.`, "reported_taken");
  const unsure = () => send({ eventType: "reported_unsure" }, "events", `${label} is ${who} as not sure.`, "unknown");
  const skip = () => send({ eventType: "reported_skipped", note: reason.trim() || undefined }, "events", `${label} is ${who} as skipped.`, "reported_skipped");
  const snooze = () => send({ minutes }, "snooze", `We will remind you about ${dose.medicationName} in ${minutes} minutes.`, "snoozed");

  return (
    <article
      aria-label={label}
      className={cn("rounded-2xl border-2 border-border bg-card", hero ? "border-primary p-6 sm:p-8" : "p-4 sm:p-5")}
    >
      <div className={cn("flex flex-wrap items-start justify-between gap-3")}>
        <div className="min-w-0">
          <p className={cn("font-bold", hero ? "text-3xl" : "text-xl")}>{dose.medicationName}</p>
          <p className={cn("mt-1 text-muted-foreground", hero ? "text-xl" : "text-base")}>
            <time dateTime={dose.scheduledAt}>{time}</time> · {dose.doseText}
          </p>
          {dose.instructions && <p className={cn("mt-2", hero ? "text-lg" : "text-base")}><span className="font-semibold">Instructions:</span> {dose.instructions}</p>}
        </div>
        <div ref={statusRef} tabIndex={-1} aria-live="polite" className="rounded-lg">
          <DoseStatusChip status={status} />
        </div>
      </div>

      {error && <div className="mt-4"><Alert variant="error" title={error} /></div>}

      {showActions && (
        <div className={cn("mt-5 grid gap-3", hero ? "sm:grid-cols-2" : "sm:grid-cols-2 lg:grid-cols-4")}>
          <Button size={hero ? "xl" : "lg"} onClick={took} loading={busy}>
            <Check aria-hidden="true" /> {onBehalf ? "Taken" : "I took it"}<span className="sr-only">, {label}</span>
          </Button>
          <Button size={hero ? "xl" : "lg"} variant="secondary" onClick={() => setDialog("snooze")} disabled={busy}>
            <Clock aria-hidden="true" /> Remind me later<span className="sr-only">, {label}</span>
          </Button>
          <Button size={hero ? "lg" : "lg"} variant="outline" onClick={() => setDialog("skip")} disabled={busy}>
            <SkipForward aria-hidden="true" /> Skip{" "}<span className="sr-only">this dose, {label}</span>
          </Button>
          <Button size={hero ? "lg" : "lg"} variant="outline" onClick={unsure} disabled={busy}>
            <HelpCircle aria-hidden="true" /> I am not sure{" "}<span className="sr-only">if I took it, {label}</span>
          </Button>
        </div>
      )}

      {canRespond && !open && status !== "cancelled" && !changing && (
        <div className="mt-4">
          <Button variant="ghost" size="sm" onClick={() => setChanging(true)}>
            <Pencil aria-hidden="true" /> Change answer{" "}<span className="sr-only">for {label}</span>
          </Button>
        </div>
      )}
      {changing && (
        <div className="mt-3"><Button variant="ghost" size="sm" onClick={() => setChanging(false)}>Cancel change{" "}<span className="sr-only">for {label}</span></Button></div>
      )}

      <Dialog open={dialog === "snooze"} onOpenChange={(o) => !o && setDialog(null)} title="Remind me later" description={`When should we remind you about ${dose.medicationName}?`}>
        <Field id={`snooze-${dose.id}`} label="Remind me again in" required>
          {(a) => (
            <Select {...a} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
              {SNOOZE_OPTIONS_MINUTES.map((m) => <option key={m} value={m}>{m === 60 ? "1 hour" : `${m} minutes`}</option>)}
            </Select>
          )}
        </Field>
        <div className="mt-5 flex flex-wrap justify-end gap-3">
          <Button variant="outline" onClick={() => setDialog(null)}>Cancel</Button>
          <Button onClick={snooze} loading={busy}>Set reminder</Button>
        </div>
      </Dialog>

      <Dialog open={dialog === "skip"} onOpenChange={(o) => !o && setDialog(null)} title="Skip this dose" description={`You can add a short note for your care team about why you are skipping ${dose.medicationName}.`}>
        <Field id={`skip-${dose.id}`} label="Reason" hint="For example: felt unwell, ran out, doctor said to stop.">
          {(a) => <Textarea {...a} rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />}
        </Field>
        <p className="mt-3 text-[0.95rem] text-muted-foreground">If you are worried about missing a medicine, please ask your doctor or pharmacist.</p>
        <div className="mt-5 flex flex-wrap justify-end gap-3">
          <Button variant="outline" onClick={() => setDialog(null)}>Cancel</Button>
          <Button onClick={skip} loading={busy}>Skip this dose</Button>
        </div>
      </Dialog>
    </article>
  );
}
