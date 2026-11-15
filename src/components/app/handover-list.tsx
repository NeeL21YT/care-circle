"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/field";
import { useAnnounce } from "@/components/a11y/announcer";
import { api, errorMessage } from "@/lib/client/api";
import { fmtDateTime } from "@/lib/format";

export interface HandoverRow { id: string; status: "draft" | "shared"; createdByName: string; createdAt: string; recipientName: string | null; acknowledgedAt: string | null; periodHours: number; mine: boolean; forMe: boolean }

export function HandoverList({ patientId, rows, canPrepare, timezone }: { patientId: string; rows: HandoverRow[]; canPrepare: boolean; timezone: string }) {
  const router = useRouter();
  const announce = useAnnounce();
  const [hours, setHours] = useState("24");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function prepare(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    announce("Preparing the handover from the latest records. This can take a few seconds.", "polite");
    try {
      const h = await api<{ id: string }>(`/api/patients/${patientId}/handovers`, { body: { periodHours: Number(hours) } });
      router.push(`/patients/${patientId}/handover/${h.id}`);
    } catch (err) { setError(errorMessage(err)); announce(errorMessage(err), "assertive"); setBusy(false); }
  }

  const waiting = rows.filter((r) => r.forMe && r.status === "shared" && !r.acknowledgedAt);
  return (
    <div className="space-y-6">
      {waiting.length > 0 && (
        <Alert variant="warning" title={`${waiting.length === 1 ? "A handover is" : `${waiting.length} handovers are`} waiting for you`}>
          <ul className="list-disc pl-5">{waiting.map((r) => <li key={r.id}><Link className="font-semibold underline" href={`/patients/${patientId}/handover/${r.id}`}>From {r.createdByName}, {fmtDateTime(r.createdAt, timezone)}</Link></li>)}</ul>
        </Alert>
      )}
      {canPrepare && (
        <form onSubmit={prepare} className="space-y-3 rounded-xl border-2 p-4" aria-labelledby="prep-h">
          <h2 id="prep-h" className="text-xl font-bold">Prepare a handover</h2>
          <p>Collects what happened recently from the app&apos;s records, so the next person knows what needs attention. You review it before anyone else sees it.</p>
          {error && <Alert variant="error" title={error} />}
          <Field id="ho-hours" label="How far back?">{(p) => (
            <Select {...p} value={hours} onChange={(e) => setHours(e.target.value)}>
              {[8, 12, 24, 48, 72].map((h) => <option key={h} value={h}>Last {h} hours</option>)}
            </Select>
          )}</Field>
          <Button type="submit" disabled={busy}>{busy ? "Preparing…" : "Prepare handover"}</Button>
        </form>
      )}
      <section aria-labelledby="hist-h" className="space-y-2">
        <h2 id="hist-h" className="text-xl font-bold">Handover history</h2>
        {rows.length === 0 ? <p className="rounded-xl border-2 border-dashed p-6">No handovers yet.</p> : (
          <ul className="space-y-2">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border-2 p-3">
                <span>
                  <strong>{r.status === "draft" ? "Draft" : `To ${r.recipientName}`}</strong> · from {r.createdByName} · {fmtDateTime(r.createdAt, timezone)} · last {r.periodHours}h
                </span>
                <span className="flex items-center gap-3">
                  <span className="font-semibold">{r.status === "draft" ? "Not shared yet" : r.acknowledgedAt ? `Acknowledged ${fmtDateTime(r.acknowledgedAt, timezone)}` : "Waiting to be acknowledged"}</span>
                  <Link className="font-semibold underline" href={`/patients/${patientId}/handover/${r.id}`}>Open<span className="sr-only"> handover from {r.createdByName}</span></Link>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
