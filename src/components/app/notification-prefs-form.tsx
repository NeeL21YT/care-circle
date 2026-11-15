"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Checkbox, Field, Input } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { useAnnounce } from "@/components/a11y/announcer";
import { api, errorMessage } from "@/lib/client/api";
import type { EmailPreferences, QuietHours } from "@/lib/domain/types";

const ITEMS: { key: keyof EmailPreferences; label: string; hint: string; roles: ("patient" | "primary_caregiver" | "family")[] }[] = [
  { key: "upcomingDose", label: "Heads-up before a dose", hint: "A short note a few minutes before a medicine is due.", roles: ["patient", "primary_caregiver"] },
  { key: "doseReminder", label: "Medicine reminders", hint: "When a dose is due.", roles: ["patient", "primary_caregiver"] },
  { key: "doseFollowUp", label: "Gentle follow-ups", hint: "If a dose has not been answered a little while later.", roles: ["patient", "primary_caregiver"] },
  { key: "doseMissed", label: "No-response alerts", hint: "When a dose has had no response for the whole reminder period.", roles: ["primary_caregiver", "family"] },
  { key: "appointment", label: "Appointment reminders", hint: "Before doctor appointments.", roles: ["patient", "primary_caregiver", "family"] },
];

/** Email preferences + quiet hours. The in-app inbox always keeps a record. */
export function NotificationPrefsForm({ patientId, role, email, quietHours }: { patientId: string; role: "patient" | "primary_caregiver" | "family"; email: EmailPreferences; quietHours: QuietHours }) {
  const router = useRouter();
  const announce = useAnnounce();
  const [e, setE] = useState(email);
  const [q, setQ] = useState(quietHours);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  async function save(ev: React.FormEvent) {
    ev.preventDefault();
    setBusy(true); setMsg(null);
    try {
      await api("/api/notification-preferences", { method: "PATCH", body: { patientId, email: e, quietHours: q } });
      setMsg({ kind: "success", text: "Notification settings saved." }); announce("Notification settings saved."); router.refresh();
    } catch (err) { setMsg({ kind: "error", text: errorMessage(err) }); announce(errorMessage(err), "assertive"); }
    finally { setBusy(false); }
  }

  return (
    <form className="space-y-8" onSubmit={save} noValidate>
      {msg && <Alert variant={msg.kind} title={msg.text} />}
      <Card>
        <fieldset className="space-y-4">
          <legend className="text-xl font-bold">Emails I want to receive</legend>
          <p className="text-base text-muted-foreground">Everything is also kept in your Notifications page, whatever you choose here.</p>
          {ITEMS.filter((i) => i.roles.includes(role)).map((i) => (
            <Checkbox key={i.key} id={`pref-${i.key}`} label={i.label} description={i.hint} checked={e[i.key]} onChange={(ev) => setE({ ...e, [i.key]: ev.target.checked })} />
          ))}
        </fieldset>
      </Card>
      <Card>
        <CardTitle>Quiet hours</CardTitle>
        <p className="mt-1 text-base text-muted-foreground">Emails are held during quiet hours and sent when they end. Reminders that were answered in the meantime are not sent.</p>
        <div className="mt-4 space-y-4">
          <Checkbox id="quiet-enabled" label="Use quiet hours" checked={q.enabled} onChange={(ev) => setQ({ ...q, enabled: ev.target.checked })} />
          {q.enabled && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="quiet-start" label="Quiet hours start" required>{(a) => <Input {...a} type="time" value={q.start} onChange={(ev) => setQ({ ...q, start: ev.target.value })} />}</Field>
              <Field id="quiet-end" label="Quiet hours end" required>{(a) => <Input {...a} type="time" value={q.end} onChange={(ev) => setQ({ ...q, end: ev.target.value })} />}</Field>
              <p className="text-[0.95rem] text-muted-foreground sm:col-span-2">Times use the {q.timezone.replace(/_/g, " ")} timezone.</p>
            </div>
          )}
        </div>
      </Card>
      <Button type="submit" size="lg" loading={busy}>Save notification settings</Button>
    </form>
  );
}
