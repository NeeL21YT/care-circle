import type { ExtractedMedication } from "@/lib/ai/prescription/schemas";
import type { Finding, MedSummary, ReconStatus } from "@/lib/domain/reconciliation";
import type { Draft } from "@/lib/client/prescription-draft";

export interface ReconView {
  key: string; index: number | null; incomingName: string | null; existing: MedSummary | null; findings: Finding[];
  decision: { status: ReconStatus; decidedByName: string; decidedAt: string; note: string | null } | null; settled: boolean;
}

const DIFF_KIND: Record<string, string> = { changed_strength: "Strength", changed_dose: "Dose", changed_frequency: "How often" };

/** Side-by-side comparison with the medicine already on the list. It reports POSSIBLE differences only. */
export function Comparison({ item, draft, med }: { item: ReconView; draft: Draft; med: ExtractedMedication }) {
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

export function Findings({ findings }: { findings: Finding[] }) {
  const shown = findings.filter((f) => !["low_confidence", "missing_strength"].includes(f.kind) || f.attention);
  if (!shown.length) return null;
  return (
    <ul className="list-disc space-y-1 pl-5">
      {shown.map((f, i) => <li key={i}>{f.attention && <strong>Please check: </strong>}{f.text}{f.existing && f.incoming ? ` (list: ${f.existing}; prescription: ${f.incoming})` : ""}</li>)}
    </ul>
  );
}