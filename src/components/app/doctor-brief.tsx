"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Printer } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/field";
import { useAnnounce } from "@/components/a11y/announcer";
import { api, errorMessage } from "@/lib/client/api";
import { BRIEF_MAX_NOTES, BRIEF_MAX_TEXT, FOOTER_TEXT, type BriefAction, type DoctorBrief } from "@/lib/domain/doctor-brief";

const h2 = "text-xl font-bold border-b-2 border-black/70 pb-1 print:text-lg";
const th = "border border-black/60 px-2 py-1 text-left font-bold align-top";
const td = "border border-black/40 px-2 py-1 align-top";

export function DoctorBriefView({ patientId, appointmentId, brief, canEdit, canRemoveAnyObservation, currentUid }: {
  patientId: string; appointmentId: string; brief: DoctorBrief; canEdit: boolean; canRemoveAnyObservation: boolean; currentUid: string;
}) {
  const router = useRouter();
  const announce = useAnnounce();
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [o, setO] = useState("");
  const [errs, setErrs] = useState<Record<string, string>>({});
  const msgRef = useRef<HTMLDivElement>(null);
  const url = `/api/patients/${patientId}/appointments/${appointmentId}/brief`;
  const { overview: ov } = brief;

  async function run(action: BriefAction, ok: string, after?: () => void, field?: string) {
    setBusy(true);
    setMsg(null);
    setErrs({});
    try {
      await api(url, { body: action });
      after?.();
      setMsg({ kind: "success", text: ok });
      announce(ok);
      router.refresh();
    } catch (e) {
      const f = (e as { fields?: Record<string, string> }).fields;
      if (f && field) setErrs({ [field]: f.text ?? Object.values(f)[0] ?? "" });
      const text = errorMessage(e);
      setMsg({ kind: "error", text });
      announce(text, "assertive");
      requestAnimationFrame(() => msgRef.current?.focus());
    } finally {
      setBusy(false);
    }
  }

  return (
    <article aria-labelledby="brief-title" className="space-y-8 bg-white text-black print:space-y-5 print:text-[11pt]">
      <div className="print-hide flex flex-wrap items-center justify-between gap-3" data-print-hide>
        <p className="max-w-prose text-base">Check this page, add your own notes and questions, then print it or save it as a PDF to take to the appointment.</p>
        <Button type="button" onClick={() => window.print()}><Printer aria-hidden="true" /> Print or save as PDF</Button>
      </div>

      <div ref={msgRef} tabIndex={-1} aria-live="polite" className="print-hide" data-print-hide>{msg && <Alert variant={msg.kind} title={msg.text} />}</div>

      <div className="space-y-1">
        <h1 id="brief-title" className="text-3xl font-extrabold print:text-2xl">Doctor visit brief: {ov.fullName}</h1>
        <p className="text-lg">{ov.type} with {ov.doctor}, {ov.when}</p>
      </div>

      <section aria-labelledby="b-overview" className="space-y-2">
        <h2 id="b-overview" className={h2}>Patient overview</h2>
        <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
          {([["Full name", ov.fullName], ["Age", ov.age], ["Preferred language", ov.language], ["Appointment", ov.when], ["Type", ov.type], ["Doctor", ov.doctor], ["Facility", ov.facility], ["Location", ov.location]] as const).map(([k, v]) => (
            <div key={k} className="flex flex-wrap gap-x-2"><dt className="font-bold">{k}:</dt><dd>{v}</dd></div>
          ))}
        </dl>
      </section>

      {brief.medications && (
        <section aria-labelledby="b-meds" className="space-y-3">
          <h2 id="b-meds" className={h2}>Current medications</h2>
          {brief.medications.current.length === 0 ? <p>No active medicines are recorded.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[0.95rem]">
                <caption className="pb-1 text-left font-semibold">Active and on-hold medicines</caption>
                <thead><tr><th scope="col" className={th}>Medicine</th><th scope="col" className={th}>Strength</th><th scope="col" className={th}>Dose</th><th scope="col" className={th}>Schedule</th><th scope="col" className={th}>Started</th><th scope="col" className={th}>Ends</th></tr></thead>
                <tbody>
                  {brief.medications.current.map((m, i) => (
                    <tr key={i}>
                      <th scope="row" className={`${td} text-left font-semibold`}>{m.name}{m.onHold ? " (on hold)" : ""}</th>
                      <td className={td}>{m.strength}</td><td className={td}>{m.dose}</td><td className={td}>{m.schedule}</td><td className={td}>{m.start}</td><td className={td}>{m.end}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <h3 className="text-lg font-bold">Recent changes</h3>
          {brief.medications.recentChanges.length === 0 ? <p>No changes recorded in the last 30 days.</p> : (
            <ul className="list-disc space-y-1 pl-6">{brief.medications.recentChanges.map((c, i) => <li key={i}>{c.name}: {c.kind.toLowerCase()} on {c.on}</li>)}</ul>
          )}
          {brief.medications.awaitingVerification !== null && (
            <p><span className="font-bold">Awaiting verification:</span> {brief.medications.awaitingVerification === 0 ? "No scanned prescriptions are waiting to be checked." : `${brief.medications.awaitingVerification} scanned prescription${brief.medications.awaitingVerification === 1 ? "" : "s"} not yet checked by a caregiver. Medicines from them are not listed above.`}</p>
          )}
        </section>
      )}

      {brief.activity && (
        <section aria-labelledby="b-act" className="space-y-3">
          <h2 id="b-act" className={h2}>Medication activity, last {brief.activity.days} days</h2>
          <p className="font-bold">{brief.activity.label}</p>
          <ul className="list-disc space-y-1 pl-6">
            <li>Reported taken: {brief.activity.reportedTaken}</li>
            <li>Reported skipped: {brief.activity.reportedSkipped}</li>
            <li>Not sure: {brief.activity.notSure}</li>
            <li>No report yet: {brief.activity.noReport}</li>
          </ul>
          {brief.activity.lines.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[0.95rem]">
                <caption className="pb-1 text-left font-semibold">Skipped and unresolved doses (self-reported, not verified)</caption>
                <thead><tr><th scope="col" className={th}>Medicine</th><th scope="col" className={th}>Scheduled</th><th scope="col" className={th}>Status</th></tr></thead>
                <tbody>{brief.activity.lines.map((l, i) => <tr key={i}><th scope="row" className={`${td} text-left font-semibold`}>{l.medicationName}</th><td className={td}>{l.when}</td><td className={td}>{l.outcome}</td></tr>)}</tbody>
              </table>
            </div>
          ) : <p>No skipped or unresolved doses in this period.</p>}
        </section>
      )}

      {brief.documents && (
        <section aria-labelledby="b-docs" className="space-y-2">
          <h2 id="b-docs" className={h2}>Recent health documents</h2>
          {brief.documents.items.length === 0 ? <p>No documents have been added.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[0.95rem]">
                <caption className="pb-1 text-left font-semibold">Latest documents (names only)</caption>
                <thead><tr><th scope="col" className={th}>Title</th><th scope="col" className={th}>Category</th><th scope="col" className={th}>Added</th></tr></thead>
                <tbody>{brief.documents.items.map((d, i) => <tr key={i}><th scope="row" className={`${td} text-left font-semibold`}>{d.title}</th><td className={td}>{d.category}</td><td className={td}>{d.added}</td></tr>)}</tbody>
              </table>
            </div>
          )}
          <p>{brief.documents.note}</p>
        </section>
      )}

      <section aria-labelledby="b-obs" className="space-y-3">
        <h2 id="b-obs" className={h2}>Family observations</h2>
        {brief.observations.length === 0 ? <p>No observations have been added.</p> : (
          <ul className="space-y-3">
            {brief.observations.map((ob) => (
              <li key={ob.id} className="space-y-1">
                <p className="whitespace-pre-wrap">{ob.text}</p>
                <p className="text-[0.95rem]"><span className="font-semibold">{ob.label}</span> by {ob.name}, {ob.when}</p>
                {(ob.uid === currentUid || canRemoveAnyObservation) && (
                  <Button type="button" variant="outline" size="sm" className="print-hide" data-print-hide disabled={busy} onClick={() => run({ type: "removeObservation", id: ob.id }, "Observation removed.")}>
                    Remove observation<span className="sr-only"> by {ob.name} from {ob.when}</span>
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {canEdit && (
          <form className="print-hide space-y-3 rounded-xl border-2 p-4" data-print-hide aria-label="Add an observation" onSubmit={(e) => { e.preventDefault(); void run({ type: "addObservation", text: o }, "Observation added.", () => setO(""), "o"); }}>
            <Field id="brief-obs" label="Add an observation" required error={errs.o} hint={`What you have noticed, in your own words. Up to ${BRIEF_MAX_TEXT} characters; at most ${BRIEF_MAX_NOTES} observations.`}>
              {(p) => <Textarea {...p} rows={3} maxLength={BRIEF_MAX_TEXT} value={o} onChange={(e) => setO(e.target.value)} />}
            </Field>
            <Button type="submit" disabled={busy || !o.trim()}>Add observation</Button>
          </form>
        )}
      </section>

      <section aria-labelledby="b-q" className="space-y-3">
        <h2 id="b-q" className={h2}>Questions for the doctor</h2>
        <p className="text-[0.95rem]">These are the family&apos;s own prompts, not medical advice.</p>
        {brief.questions.length === 0 ? <p>No questions have been added.</p> : (
          <ul className="space-y-2">
            {brief.questions.map((qq) => (
              <li key={qq.id} className="flex flex-wrap items-start gap-x-3 gap-y-1">
                {canEdit ? (
                  <label className="flex min-h-11 min-w-0 flex-1 items-start gap-3 print:min-h-0">
                    <input type="checkbox" className="mt-1 size-6 shrink-0 accent-black" checked={qq.done} disabled={busy} onChange={() => run({ type: "toggleQuestion", id: qq.id }, qq.done ? "Marked as not yet asked." : "Marked as asked.")} />
                    <span className="min-w-0 whitespace-pre-wrap break-words">{qq.text}{qq.done ? " (asked)" : ""}</span>
                  </label>
                ) : (
                  <p className="min-w-0 flex-1 whitespace-pre-wrap break-words"><span aria-hidden="true">{qq.done ? "[x] " : "[ ] "}</span>{qq.text}{qq.done ? " (asked)" : ""}</p>
                )}
                {canEdit && (
                  <Button type="button" variant="outline" size="sm" className="print-hide" data-print-hide disabled={busy} onClick={() => run({ type: "removeQuestion", id: qq.id }, "Question removed.")}>
                    Remove<span className="sr-only"> question: {qq.text.slice(0, 60)}</span>
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {canEdit && (
          <form className="print-hide space-y-3 rounded-xl border-2 p-4" data-print-hide aria-label="Add a question" onSubmit={(e) => { e.preventDefault(); void run({ type: "addQuestion", text: q }, "Question added.", () => setQ(""), "q"); }}>
            <Field id="brief-q" label="Add a question for the doctor" required error={errs.q} hint={`Up to ${BRIEF_MAX_TEXT} characters; at most ${BRIEF_MAX_NOTES} questions.`}>
              {(p) => <Textarea {...p} rows={2} maxLength={BRIEF_MAX_TEXT} value={q} onChange={(e) => setQ(e.target.value)} />}
            </Field>
            <Button type="submit" disabled={busy || !q.trim()}>Add question</Button>
          </form>
        )}
        {!canEdit && <p className="print-hide text-[0.95rem]" data-print-hide>You can read these notes. Caregivers who manage care can add to them.</p>}
      </section>

      {brief.omitted.length > 0 && (
        <section aria-labelledby="b-omit" className="space-y-1">
          <h2 id="b-omit" className={h2}>Not included because you cannot see it</h2>
          <ul className="list-disc pl-6">{brief.omitted.map((s) => <li key={s}>{s}</li>)}</ul>
        </section>
      )}

      <footer className="border-t-2 border-black/70 pt-2 text-[0.95rem]">
        <p>Generated on {brief.generatedText} {FOOTER_TEXT}</p>
      </footer>
    </article>
  );
}
