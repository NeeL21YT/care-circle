"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { RotateCw, ZoomIn, ZoomOut, ExternalLink } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { useAnnounce } from "@/components/a11y/announcer";
import { api, ApiError, errorMessage } from "@/lib/client/api";
import { LOW_CONFIDENCE } from "@/lib/ai/prescription/confidence";
import type { ExtractedMedication } from "@/lib/ai/prescription/schemas";
import { RECON_STATUS_LABEL, type Finding, type MedSummary, type ReconStatus } from "@/lib/domain/reconciliation";

const DOSE_UNITS = ["tablet", "capsule", "ml", "mg", "drop", "puff", "patch", "unit", "other"];
const FORMS = ["Tablet", "Capsule", "Liquid", "Injection", "Drops", "Inhaler", "Patch", "Cream or ointment", "Other"];
const ROUTES = ["Oral", "Topical", "Inhaled", "Injection", "Eye", "Ear", "Other"];
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const matchOption = (opts: string[], v: string | null) => opts.find((o) => o.toLowerCase() === (v ?? "").trim().toLowerCase()) ?? "";

interface Draft {
  name: string; strength: string; doseAmount: string; doseUnit: string; form: string; route: string;
  frequency: "daily" | "every_n_days"; intervalDays: string; times: string;
  startDate: string; endDate: string; instructions: string;
}

/** Missing values stay missing: nothing here is defaulted for the caregiver. */
function toDraft(m: ExtractedMedication): Draft {
  return {
    name: m.normalizedName ?? m.nameAsWritten,
    strength: m.strength ?? "",
    doseAmount: m.doseAmount == null ? "" : String(m.doseAmount),
    doseUnit: matchOption(DOSE_UNITS, m.doseUnit),
    form: matchOption(FORMS, m.dosageForm),
    route: matchOption(ROUTES, m.route),
    frequency: "daily", intervalDays: "", times: "",
    startDate: m.startDate ?? "", endDate: m.endDate ?? "",
    instructions: m.specialInstructions ?? "",
  };
}

function toMedicationInput(d: Draft) {
  const times = d.times.split(/[,\s]+/).filter(Boolean);
  return {
    name: d.name,
    strength: d.strength || null,
    doseAmount: d.doseAmount === "" ? 0 : Number(d.doseAmount),
    doseUnit: d.doseUnit,
    form: d.form,
    route: d.route,
    schedule: d.frequency === "daily" ? { frequency: "daily", times } : { frequency: "every_n_days", times, intervalDays: Number(d.intervalDays) },
    startDate: d.startDate,
    endDate: d.endDate || null,
    instructions: d.instructions || null,
    status: "active",
  };
}

function toExtracted(m: ExtractedMedication, d: Draft): ExtractedMedication {
  return {
    ...m,
    normalizedName: d.name || null,
    strength: d.strength || null,
    doseAmount: d.doseAmount !== "" && Number(d.doseAmount) > 0 ? Number(d.doseAmount) : null,
    doseUnit: d.doseUnit || null,
    dosageForm: d.form || null,
    route: d.route || null,
    startDate: d.startDate || null,
    endDate: d.endDate || null,
    specialInstructions: d.instructions || null,
  };
}

function Preview({ url, contentType }: { url: string; contentType: string }) {
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  if (contentType === "application/pdf") {
    return (
      <div className="space-y-2">
        <iframe src={url} title="Original prescription (PDF). Use the viewer's own controls to change page or zoom." className="h-[70vh] w-full rounded-xl border-2" />
        <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 font-semibold underline">
          <ExternalLink aria-hidden="true" className="size-4" /> Open the PDF in a new tab <span className="sr-only">(opens in a new tab)</span>
        </a>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <div role="group" aria-label="Prescription image controls" className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={() => setZoom((z) => Math.min(4, z + 0.25))}><ZoomIn aria-hidden="true" /> Zoom in</Button>
        <Button type="button" variant="outline" onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}><ZoomOut aria-hidden="true" /> Zoom out</Button>
        <Button type="button" variant="outline" onClick={() => setRotation((r) => (r + 90) % 360)}><RotateCw aria-hidden="true" /> Rotate</Button>
      </div>
      <p className="text-sm text-muted-foreground" aria-live="polite">Zoom {Math.round(zoom * 100)}%, rotated {rotation} degrees</p>
      <div className="max-h-[70vh] overflow-auto rounded-xl border-2 bg-muted" tabIndex={0} aria-label="Prescription image. Scroll to move around.">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt="The uploaded prescription" style={{ width: `${zoom * 100}%`, transform: `rotate(${rotation}deg)`, transformOrigin: "center" }} className="max-w-none" />
      </div>
    </div>
  );
}


export interface ReconView {
  key: string; index: number | null; incomingName: string | null; existing: MedSummary | null; findings: Finding[];
  decision: { status: ReconStatus; decidedByName: string; decidedAt: string; note: string | null } | null; settled: boolean;
}

const DIFF_KIND: Record<string, string> = { changed_strength: "Strength", changed_dose: "Dose", changed_frequency: "How often" };

/** Side-by-side comparison with the medicine already on the list. It reports POSSIBLE differences only. */
function Comparison({ item, draft, med }: { item: ReconView; draft: Draft; med: ExtractedMedication }) {
  const ex = item.existing;
  if (!ex) return null;
  const differs = new Set(item.findings.filter((f) => DIFF_KIND[f.kind]).map((f) => DIFF_KIND[f.kind]));
  const rows: [string, string, string, boolean][] = [
    ["Name", ex.name, draft.name || "Not entered", false],
    ["Strength", ex.strength ?? "Not recorded", draft.strength || "Not found", differs.has("Strength")],
    ["Dose", ex.dose, draft.doseAmount && draft.doseUnit ? `${draft.doseAmount} ${draft.doseUnit}` : "Not found", differs.has("Dose")],
    ["How often", ex.frequency, med.frequencyAsWritten ?? med.doseInstructionAsWritten ?? "Not found", differs.has("How often")],
    ["Status", ex.status.replace("_", " "), "Not yet added", false],
  ];
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-base">
        <caption className="mb-1 text-left font-bold">On your list now compared with this prescription</caption>
        <thead><tr><th scope="col" className="border-b-2 p-2">Detail</th><th scope="col" className="border-b-2 p-2">On your list now</th><th scope="col" className="border-b-2 p-2">On this prescription</th></tr></thead>
        <tbody>
          {rows.map(([k, a, b, diff]) => (
            <tr key={k} className={diff ? "bg-warning-bg" : undefined}>
              <th scope="row" className="border-b p-2 font-semibold">{k}</th>
              <td className="border-b p-2">{a}</td>
              <td className="border-b p-2">{b}{diff && <strong> (possibly different)</strong>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Findings({ findings }: { findings: Finding[] }) {
  const shown = findings.filter((f) => !["low_confidence", "missing_strength"].includes(f.kind) || f.attention);
  if (!shown.length) return null;
  return (
    <ul className="list-disc space-y-1 pl-5">
      {shown.map((f, i) => <li key={i}>{f.attention && <strong>Please check: </strong>}{f.text}{f.existing && f.incoming ? ` (list: ${f.existing}; prescription: ${f.incoming})` : ""}</li>)}
    </ul>
  );
}

export function PrescriptionReview({ patientId, extractionId, status, meds, warnings, approvals, previewUrl, contentType, failureMessage, recon }: {
  patientId: string; extractionId: string; status: string; meds: ExtractedMedication[]; warnings: string[];
  approvals: Record<string, string>; previewUrl: string | null; contentType: string; failureMessage: string | null;
  recon: { items: ReconView[]; absent: ReconView[] };
}) {
  const router = useRouter();
  const announce = useAnnounce();
  const [drafts, setDrafts] = useState<Draft[]>(() => meds.map(toDraft));
  const [errors, setErrors] = useState<Record<number, Record<string, string>>>({});
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<Record<number, boolean>>(() => Object.fromEntries(Object.entries(approvals).filter(([, v]) => v).map(([k]) => [Number(k), true])));
  const msgRef = useRef<HTMLDivElement>(null);
  const editable = status === "review_required";

  const set = (i: number, k: keyof Draft, v: string) => setDrafts((ds) => ds.map((d, j) => (j === i ? { ...d, [k]: v } : d)));
  const say = (kind: "error" | "success", text: string) => {
    setMsg({ kind, text });
    announce(text, kind === "error" ? "assertive" : "polite");
    requestAnimationFrame(() => msgRef.current?.focus());
  };

  async function saveDraft() {
    setBusy("save");
    try {
      await api(`/api/patients/${patientId}/prescriptions/${extractionId}`, { method: "PATCH", body: { medications: meds.map((m, i) => toExtracted(m, drafts[i])) } });
      say("success", "Draft saved. Reminder times are not saved in a draft; enter them again before approving.");
    } catch (e) { say("error", errorMessage(e)); } finally { setBusy(null); }
  }

  async function approve(i: number) {
    setBusy(`approve-${i}`);
    setErrors((e) => ({ ...e, [i]: {} }));
    const d = drafts[i];
    if (d.times.split(/[,\s]+/).filter(Boolean).some((t) => !TIME_RE.test(t)) || !d.times.trim()) {
      setErrors((e) => ({ ...e, [i]: { times: "Enter reminder times like 08:00, 20:00 (24-hour)." } }));
      say("error", "Check the reminder times.");
      setBusy(null);
      return;
    }
    try {
      const res = await api<{ extractionStatus: string }>(`/api/patients/${patientId}/prescriptions/${extractionId}/approve`, { method: "POST", body: { index: i, medication: toMedicationInput(d) } });
      setDone((x) => ({ ...x, [i]: true }));
      say("success", `${d.name} was added to the medicine list and its reminders are scheduled.`);
      if (res.extractionStatus === "approved") router.refresh();
    } catch (e) {
      if (e instanceof ApiError && e.fields) {
        const mapped: Record<string, string> = {};
        for (const [k, v] of Object.entries(e.fields)) mapped[k.split(".")[0]] = v;
        setErrors((x) => ({ ...x, [i]: mapped }));
      }
      say("error", errorMessage(e));
    } finally { setBusy(null); }
  }

  async function reject() {
    if (!window.confirm("Reject this scan? Nothing will be added to the medicine list.")) return;
    setBusy("reject");
    try {
      await api(`/api/patients/${patientId}/prescriptions/${extractionId}/reject`, { method: "POST" });
      router.push(`/patients/${patientId}/scanner`);
    } catch (e) { say("error", errorMessage(e)); setBusy(null); }
  }

  async function decide(key: string, decision: ReconStatus, extra: { medicationPatch?: unknown; createTask?: boolean } = {}, ok = "Saved.") {
    setBusy(`decide-${key}`);
    try {
      await api(`/api/patients/${patientId}/prescriptions/${extractionId}/reconciliation/${key}`, { body: { decision, ...extra } });
      say("success", ok);
      router.refresh();
    } catch (e) { say("error", errorMessage(e)); } finally { setBusy(null); }
  }

  /** Only the fields the person filled in are applied to the existing medicine; name and start date stay. */
  function changePatch(d: Draft) {
    const times = d.times.split(/[,\s]+/).filter(Boolean);
    const patch: Record<string, unknown> = {};
    if (d.strength.trim()) patch.strength = d.strength.trim();
    if (d.doseAmount !== "" && Number(d.doseAmount) > 0) patch.doseAmount = Number(d.doseAmount);
    if (d.doseUnit) patch.doseUnit = d.doseUnit;
    if (d.form) patch.form = d.form;
    if (d.route) patch.route = d.route;
    if (d.endDate) patch.endDate = d.endDate;
    if (d.instructions.trim()) patch.instructions = d.instructions.trim();
    if (times.length && times.every((t) => TIME_RE.test(t))) patch.schedule = d.frequency === "daily" ? { frequency: "daily", times } : { frequency: "every_n_days", times, intervalDays: Number(d.intervalDays) };
    return patch;
  }

  async function retry() {
    setBusy("retry");
    try {
      const sourceId = new URLSearchParams(window.location.search).get("doc");
      if (!sourceId) throw new Error("Open this scan from the scanner page to retry it.");
      const r = await api<{ id: string }>(`/api/patients/${patientId}/prescriptions`, { method: "POST", body: { documentId: sourceId, retry: true } });
      router.push(`/patients/${patientId}/scanner/${r.id}`);
    } catch (e) { say("error", errorMessage(e)); setBusy(null); }
  }

  return (
    <div className="space-y-6">
      <Alert variant="warning" title="AI-extracted information may contain errors.">
        Please verify all medication details against the original prescription before approval. Nothing is added until you approve it.
      </Alert>
      <div ref={msgRef} tabIndex={-1} aria-live="polite">{msg && <Alert variant={msg.kind} title={msg.text} />}</div>
      {failureMessage && (
        <Alert variant="error" title="The scan did not work">
          {failureMessage} <Button type="button" onClick={retry} disabled={busy !== null} className="mt-2">Try the scan again</Button>
        </Alert>
      )}
      {warnings.length > 0 && (
        <Alert variant="warning" title="Things to check on the document">
          <ul className="list-disc pl-5">{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </Alert>
      )}
      <div className="grid gap-6 xl:grid-cols-2">
        <section aria-labelledby="orig-h" className="space-y-2">
          <h2 id="orig-h" className="text-xl font-bold">Original prescription</h2>
          {previewUrl ? <Preview url={previewUrl} contentType={contentType} /> : <Alert variant="info" title="The original could not be loaded." />}
        </section>
        <section aria-labelledby="ext-h" className="space-y-4">
          <h2 id="ext-h" className="text-xl font-bold">What the AI read ({meds.length} {meds.length === 1 ? "medicine" : "medicines"})</h2>
          {meds.length === 0 && <p>No medicines were found. You can add one by hand from the medicines page.</p>}
          {meds.map((m, i) => {
            const d = drafts[i];
            const e = errors[i] ?? {};
            const low = (k: keyof ExtractedMedication["confidence"]) => m.confidence[k] < LOW_CONFIDENCE;
            const flag = (k: keyof ExtractedMedication["confidence"]) => (low(k) ? " (check this: the AI was unsure)" : "");
            const id = (f: string) => `m${i}-${f}`;
            const r = recon.items.find((x) => x.index === i);
            const settled = Boolean(r?.settled);
            const needsChoice = Boolean(r?.existing && ["active", "on_hold", "draft"].includes(r.existing.status) && r.decision?.status !== "confirmed_new" && !done[i]);
            const lockedHere = !editable || done[i] || (settled && r?.decision?.status !== "confirmed_new" && r?.decision?.status !== "needs_clarification");
            return (
              <Card key={i} className="space-y-3 p-4">
                <h3 className="text-lg font-bold">Medicine {i + 1}: {m.nameAsWritten}</h3>
                {done[i] && <Alert variant="success" title="Approved and added to the medicine list." />}
                {m.uncertainties.length > 0 && (
                  <div className="rounded-xl border-2 border-warning bg-warning-bg p-3">
                    <p className="font-bold">Please check:</p>
                    <ul className="list-disc pl-5">{m.uncertainties.map((u, j) => <li key={j}>{u}</li>)}</ul>
                  </div>
                )}
                {r && (
                  <section aria-label={`Comparison for ${m.nameAsWritten}`} className="space-y-3 rounded-xl border-2 border-info bg-info-bg p-3">
                    <h4 className="text-base font-bold">Compared with your current list</h4>
                    <Comparison item={r} draft={d} med={m} />
                    <Findings findings={r.findings} />
                    <p className="text-sm">These are possible differences found by comparing text. They do not tell you which is medically right. If unsure, ask the doctor.</p>
                    {r.decision && <p className="font-semibold">Decision: {RECON_STATUS_LABEL[r.decision.status]} (by {r.decision.decidedByName}).</p>}
                    {editable && !done[i] && (!r.settled || r.decision?.status === "needs_clarification") && r.decision?.status !== "confirmed_new" && (
                      <div className="flex flex-wrap gap-2">
                        {r.existing && ["active", "on_hold", "draft"].includes(r.existing.status) && (
                          <>
                            <Button type="button" disabled={busy !== null} onClick={() => window.confirm(`Apply the details you filled in to the existing "${r.existing!.name}"? The old details stay in its history.`) && decide(r.key, "confirmed_change", { medicationPatch: changePatch(d) }, `${r.existing!.name} was updated. The earlier version is kept in its history.`)}>
                              Update the existing medicine with these details
                            </Button>
                            <Button type="button" variant="outline" disabled={busy !== null} onClick={() => decide(r.key, "unchanged", {}, "Kept the existing medicine as it is.")}>It is the same: keep what is on the list</Button>
                            <Button type="button" variant="outline" disabled={busy !== null} onClick={() => decide(r.key, "confirmed_new", {}, "Confirmed as a separate medicine. You can now approve it below.")}>This is a separate, new medicine</Button>
                          </>
                        )}
                        <Button type="button" variant="outline" disabled={busy !== null} onClick={() => decide(r.key, "needs_clarification", { createTask: true }, "Marked for the doctor. A task was added for the family.")}>Ask the doctor</Button>
                        <Button type="button" variant="outline" disabled={busy !== null} onClick={() => window.confirm("Reject this entry? Nothing will be added or changed.") && decide(r.key, "rejected", {}, "Entry rejected.")}>Reject this entry</Button>
                      </div>
                    )}
                    {r.existing && editable && !done[i] && !r.settled && <p className="text-sm">The fields you filled in below are what gets applied if you choose to update. The name and start date stay as they are.</p>}
                  </section>
                )}
                <dl className="grid gap-1 rounded-xl bg-muted p-3 text-sm sm:grid-cols-2">
                  {([["Written dose", m.doseInstructionAsWritten], ["Written frequency", m.frequencyAsWritten], ["Written timing", m.timingAsWritten], ["Written duration", m.durationAsWritten]] as const).map(([k, v]) => (
                    <div key={k}><dt className="font-semibold">{k}</dt><dd>{v ?? "Not found on the prescription"}</dd></div>
                  ))}
                </dl>
                <fieldset disabled={lockedHere || busy !== null} className="space-y-3">
                  <legend className="sr-only">Details for {m.nameAsWritten}</legend>
                  <Field id={id("name")} label={`Medicine name${flag("name")}`} required error={e.name}>{(p) => <Input {...p} value={d.name} onChange={(x) => set(i, "name", x.target.value)} />}</Field>
                  <Field id={id("strength")} label={`Strength${flag("strength")}`}>{(p) => <Input {...p} value={d.strength} onChange={(x) => set(i, "strength", x.target.value)} />}</Field>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field id={id("doseAmount")} label={`Dose amount${flag("dose")}`} required error={e.doseAmount}>{(p) => <Input {...p} inputMode="decimal" value={d.doseAmount} onChange={(x) => set(i, "doseAmount", x.target.value)} />}</Field>
                    <Field id={id("doseUnit")} label="Dose unit" required error={e.doseUnit}>{(p) => (
                      <Select {...p} value={d.doseUnit} onChange={(x) => set(i, "doseUnit", x.target.value)}><option value="">Choose…</option>{DOSE_UNITS.map((o) => <option key={o}>{o}</option>)}</Select>
                    )}</Field>
                    <Field id={id("form")} label="Dosage form" required error={e.form}>{(p) => (
                      <Select {...p} value={d.form} onChange={(x) => set(i, "form", x.target.value)}><option value="">Choose…</option>{FORMS.map((o) => <option key={o}>{o}</option>)}</Select>
                    )}</Field>
                    <Field id={id("route")} label="How it is taken" required error={e.route}>{(p) => (
                      <Select {...p} value={d.route} onChange={(x) => set(i, "route", x.target.value)}><option value="">Choose…</option>{ROUTES.map((o) => <option key={o}>{o}</option>)}</Select>
                    )}</Field>
                  </div>
                  <Field id={id("frequency")} label={`How often${flag("frequency")}`} hint="Choose from what the prescription says. The AI does not choose this." required>{(p) => (
                    <Select {...p} value={d.frequency} onChange={(x) => set(i, "frequency", x.target.value)}><option value="daily">Every day</option><option value="every_n_days">Every few days</option></Select>
                  )}</Field>
                  {d.frequency === "every_n_days" && <Field id={id("intervalDays")} label="Number of days between doses" required error={e.schedule}>{(p) => <Input {...p} inputMode="numeric" value={d.intervalDays} onChange={(x) => set(i, "intervalDays", x.target.value)} />}</Field>}
                  <Field id={id("times")} label="Reminder times" hint="24-hour clock, separated by commas. Example: 08:00, 20:00" required error={e.times ?? e.schedule}>{(p) => <Input {...p} value={d.times} onChange={(x) => set(i, "times", x.target.value)} />}</Field>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field id={id("startDate")} label="Start date" required error={e.startDate}>{(p) => <Input {...p} type="date" value={d.startDate} onChange={(x) => set(i, "startDate", x.target.value)} />}</Field>
                    <Field id={id("endDate")} label={`End date${flag("duration")}`} error={e.endDate}>{(p) => <Input {...p} type="date" value={d.endDate} onChange={(x) => set(i, "endDate", x.target.value)} />}</Field>
                  </div>
                  <Field id={id("instructions")} label="Special instructions" error={e.instructions}>{(p) => <Textarea {...p} rows={2} value={d.instructions} onChange={(x) => set(i, "instructions", x.target.value)} />}</Field>
                </fieldset>
                {needsChoice && !lockedHere && <p className="font-semibold">Choose how to handle this above before adding it as a new medicine.</p>}
                {!lockedHere && !needsChoice && (
                  <Button type="button" onClick={() => approve(i)} disabled={busy !== null} className="w-full sm:w-auto">
                    {busy === `approve-${i}` ? "Adding…" : `I checked it. Approve ${d.name || "this medicine"}`}
                  </Button>
                )}
              </Card>
            );
          })}
        </section>
      </div>
      {recon.absent.length > 0 && (
        <section aria-labelledby="absent-h" className="space-y-3 rounded-xl border-2 p-4">
          <h2 id="absent-h" className="text-xl font-bold">On your list but not on this prescription</h2>
          <p>This does not mean they were stopped. It could mean they are unchanged, were left off, or were stopped. Only the doctor can say.</p>
          <ul className="space-y-3">
            {recon.absent.map((a) => (
              <li key={a.key} className="space-y-2 rounded-xl border-2 p-3">
                <p><strong>{a.existing!.name}</strong>{a.existing!.strength ? `, ${a.existing!.strength}` : ""} · {a.existing!.dose} · {a.existing!.frequency}</p>
                {a.decision ? <p className="font-semibold">Decision: {a.decision.status === "confirmed_change" ? "Confirmed as stopped" : RECON_STATUS_LABEL[a.decision.status]} (by {a.decision.decidedByName}).</p> : editable && (
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" disabled={busy !== null} onClick={() => decide(a.key, "unchanged", {}, "Kept as it is.")}>Keep it as it is<span className="sr-only">: {a.existing!.name}</span></Button>
                    <Button type="button" variant="outline" disabled={busy !== null} onClick={() => decide(a.key, "needs_clarification", { createTask: true }, "Marked for the doctor. A task was added for the family.")}>Ask the doctor<span className="sr-only"> about {a.existing!.name}</span></Button>
                    <Button type="button" variant="outline" disabled={busy !== null} onClick={() => window.confirm(`Mark "${a.existing!.name}" as stopped? Its future reminders will be cancelled. The history is kept.`) && decide(a.key, "confirmed_change", {}, `${a.existing!.name} was marked as stopped.`)}>The doctor stopped it<span className="sr-only">: {a.existing!.name}</span></Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className="flex flex-wrap gap-3">
        {editable && !Object.values(done).some(Boolean) && <Button type="button" variant="outline" onClick={saveDraft} disabled={busy !== null}>Save as draft</Button>}
        {editable && !Object.values(done).some(Boolean) && <Button type="button" variant="outline" onClick={reject} disabled={busy !== null}>Reject this scan</Button>}
        <Link href={`/patients/${patientId}/scanner`} className="inline-flex min-h-12 items-center font-semibold underline">Back to the scanner</Link>
      </div>
    </div>
  );
}
