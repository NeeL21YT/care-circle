"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { useAnnounce } from "@/components/a11y/announcer";
import { api, errorMessage } from "@/lib/client/api";
import { validatePolicy } from "@/lib/domain/escalation";
import type { EscalationPolicy } from "@/lib/domain/types";

/** Reminder rules are configurable application settings, not medical guidance. */
export function PolicyForm({ patientId, initial }: { patientId: string; initial: EscalationPolicy }) {
  const router = useRouter();
  const announce = useAnnounce();
  const [v, setV] = useState({ lead: String(initial.upcomingLeadMinutes), follow: String(initial.followUpAfterMinutes), escalate: String(initial.escalateAfterMinutes) });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const policy: EscalationPolicy = { upcomingLeadMinutes: Number(v.lead), followUpAfterMinutes: Number(v.follow), escalateAfterMinutes: Number(v.escalate) };
  const problem = [policy.upcomingLeadMinutes, policy.followUpAfterMinutes, policy.escalateAfterMinutes].some((n) => !Number.isInteger(n)) ? "Enter whole numbers of minutes." : validatePolicy(policy);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (problem) { setMsg({ kind: "error", text: problem }); announce(problem, "assertive"); return; }
    setBusy(true); setMsg(null);
    try {
      await api(`/api/patients/${patientId}/escalation-policy`, { method: "PUT", body: policy });
      setMsg({ kind: "success", text: "Reminder rules saved." });
      announce("Reminder rules saved.");
      router.refresh();
    } catch (err) { setMsg({ kind: "error", text: errorMessage(err) }); announce(errorMessage(err), "assertive"); }
    finally { setBusy(false); }
  }

  return (
    <Card>
      <CardTitle>Reminder rules</CardTitle>
      <p className="mt-1 text-base text-muted-foreground">When a dose is due, the patient is reminded first. If there is still no answer, a follow-up is sent, and later the caregivers are told. These are settings you control, not medical recommendations.</p>
      <form className="mt-5 space-y-5" onSubmit={save} noValidate>
        {msg && <Alert variant={msg.kind} title={msg.text} />}
        <Field id="policy-lead" label="Heads-up before a dose (minutes)" hint="0 turns the heads-up off. Email for heads-ups is off unless a person turns it on." required>
          {(a) => <Input {...a} type="number" inputMode="numeric" min={0} max={120} value={v.lead} onChange={(e) => setV({ ...v, lead: e.target.value })} />}
        </Field>
        <Field id="policy-follow" label="Send a follow-up after (minutes)" hint="If the patient has not answered this long after the dose time." required>
          {(a) => <Input {...a} type="number" inputMode="numeric" min={5} max={240} value={v.follow} onChange={(e) => setV({ ...v, follow: e.target.value })} />}
        </Field>
        <Field id="policy-escalate" label="Tell the caregivers after (minutes)" hint="The dose is then shown as “no response recorded”. This is a reminder rule, not a medical conclusion." required>
          {(a) => <Input {...a} type="number" inputMode="numeric" min={10} max={480} value={v.escalate} onChange={(e) => setV({ ...v, escalate: e.target.value })} />}
        </Field>
        <Button type="submit" size="lg" loading={busy}>Save reminder rules</Button>
      </form>
    </Card>
  );
}
