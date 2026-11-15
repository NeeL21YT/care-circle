"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/field";
import { useAnnounce } from "@/components/a11y/announcer";
import { api, errorMessage } from "@/lib/client/api";
import { CHECKIN_LABEL, CHECKIN_LEVELS, checkinMessage, type CheckinLevel } from "@/lib/domain/weekly-report";

export interface CheckinView { id: string; weekKey: string; level: CheckinLevel; note: string }

export function CheckinForm({ patientId, current, history }: { patientId: string; current: CheckinView | null; history: CheckinView[] }) {
  const router = useRouter();
  const announce = useAnnounce();
  const [level, setLevel] = useState<CheckinLevel | "">(current?.level ?? "");
  const [note, setNote] = useState(current?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<CheckinLevel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  const base = `/patients/${patientId}`;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({}); setError(null); setSaved(null);
    if (!level) { setErrors({ level: "Choose one of the options." }); return; }
    setBusy(true);
    try {
      await api(`/api/patients/${patientId}/checkins`, { body: { level, note } });
      setSaved(level);
      announce("Your check-in was saved.", "polite");
      router.refresh();
    } catch (err) {
      const f = (err as { fields?: Record<string, string> }).fields;
      if (f) setErrors(f);
      setError(errorMessage(err));
      announce(errorMessage(err), "assertive");
    } finally {
      setBusy(false);
      requestAnimationFrame(() => statusRef.current?.focus());
    }
  }

  return (
    <div className="space-y-6">
      <p className="max-w-prose text-base">
        This is optional and private. Only you can see your answers, not other family members or caregivers. It is not a test or a diagnosis.
      </p>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <fieldset className="space-y-2" aria-describedby={errors.level ? "ck-level-error" : undefined}>
          <legend className="text-lg font-semibold">How manageable has caregiving felt this week?</legend>
          {CHECKIN_LEVELS.map((l) => (
            <label key={l} className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border-2 p-3 has-[:checked]:border-primary has-[:checked]:bg-secondary">
              <input type="radio" name="level" value={l} checked={level === l} onChange={() => setLevel(l)} className="size-6 shrink-0 accent-[var(--primary)]" />
              <span className="text-base font-medium">{CHECKIN_LABEL[l]}</span>
            </label>
          ))}
          {errors.level && <p id="ck-level-error" className="font-medium text-destructive"><span aria-hidden="true">⚠ </span><span className="sr-only">Error: </span>{errors.level}</p>}
        </fieldset>
        <Field id="ck-note" label="Anything you want to note for yourself?" hint="Up to 500 characters. Only you will see this." error={errors.note}>
          {(p) => <Textarea {...p} rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />}
        </Field>
        <Button type="submit" loading={busy}>{busy ? "Saving…" : current ? "Update this week's check-in" : "Save check-in"}</Button>
      </form>

      <div ref={statusRef} tabIndex={-1} aria-live="polite" className="space-y-3">
        {error && <Alert variant="error" title={error} />}
        {saved && (
          <Alert variant="success" title="Check-in saved.">
            <p>{checkinMessage(saved)}</p>
            {saved === "very_difficult" && (
              <div className="mt-2 space-y-1">
                <p>Some practical steps that may help:</p>
                <ul className="list-disc space-y-1 pl-6">
                  <li><Link href={`${base}/tasks`} className="font-semibold underline">Hand over a task</Link> to someone in the care circle.</li>
                  <li><Link href={`${base}/handover`} className="font-semibold underline">Prepare a handover</Link> so someone else can cover for a while.</li>
                  <li>Consider talking to someone you trust or a healthcare professional.</li>
                </ul>
              </div>
            )}
          </Alert>
        )}
      </div>

      <section aria-labelledby="ck-history" className="space-y-2">
        <h3 id="ck-history" className="text-lg font-bold">Your recent check-ins</h3>
        {history.length === 0 ? <p>No check-ins yet.</p> : (
          <ul className="space-y-2">
            {history.map((c) => (
              <li key={c.id} className="rounded-xl border-2 p-3">
                <strong>{c.weekKey}:</strong> {CHECKIN_LABEL[c.level]}
                {c.note && <span className="block text-muted-foreground">{c.note}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
