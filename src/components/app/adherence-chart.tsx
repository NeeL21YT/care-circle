"use client";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, XAxis, YAxis } from "recharts";
import type { DailyAdherence } from "@/lib/domain/adherence";
import { ADHERENCE_DEFINITION } from "@/lib/domain/adherence";

/**
 * Accessible chart. The SVG is hidden from assistive technology (charts are
 * poorly exposed to screen readers) and replaced by (1) a plain-language
 * summary and (2) a real data table that is always in the accessibility tree.
 * For sighted users the bars use distinct PATTERNS as well as colours, and a
 * visible "Show data table" disclosure offers the same numbers.
 */
const SERIES = [
  { key: "taken", label: "Reported taken", color: "#0b6b63", pattern: "solid" },
  { key: "skipped", label: "Reported skipped", color: "#b45309", pattern: "stripes" },
  { key: "unknown", label: "Not sure", color: "#6d28d9", pattern: "dots" },
  { key: "unresolved", label: "No answer yet", color: "#4b5563", pattern: "cross" },
] as const;

export function AdherenceChart({ days, summaryText }: { days: DailyAdherence[]; summaryText: string }) {
  const data = days.map((d) => ({ name: d.label.split(" ")[0], full: d.label, taken: d.taken, skipped: d.skipped, unknown: d.unknown, unresolved: d.unresolved }));
  const total = days.reduce((n, d) => n + d.due, 0);
  return (
    <figure className="space-y-4">
      <svg aria-hidden="true" focusable="false" width="0" height="0" style={{ position: "absolute" }}>
        <defs>
          <pattern id="p-stripes" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#b45309" /><rect width="2.5" height="6" fill="#fff" fillOpacity="0.55" /></pattern>
          <pattern id="p-dots" width="6" height="6" patternUnits="userSpaceOnUse"><rect width="6" height="6" fill="#6d28d9" /><circle cx="3" cy="3" r="1.3" fill="#fff" fillOpacity="0.7" /></pattern>
          <pattern id="p-cross" width="6" height="6" patternUnits="userSpaceOnUse"><rect width="6" height="6" fill="#4b5563" /><path d="M0 0L6 6M6 0L0 6" stroke="#fff" strokeOpacity="0.55" strokeWidth="1" /></pattern>
        </defs>
      </svg>
      <figcaption className="text-lg font-semibold">Last 7 days</figcaption>
      <p className="text-base">{summaryText}</p>
      {total === 0 ? (
        <p className="rounded-xl bg-muted p-4 text-base">No doses have been due in the last 7 days, so there is nothing to chart yet.</p>
      ) : (
        <div aria-hidden="true" className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 14 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 14 }} />
              <Bar dataKey="taken" stackId="a" fill="#0b6b63" isAnimationActive={false} />
              <Bar dataKey="skipped" stackId="a" fill="url(#p-stripes)" isAnimationActive={false} />
              <Bar dataKey="unknown" stackId="a" fill="url(#p-dots)" isAnimationActive={false} />
              <Bar dataKey="unresolved" stackId="a" fill="url(#p-cross)" isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
      <ul className="flex flex-wrap gap-x-5 gap-y-2 text-[0.95rem]" aria-label="Chart key">
        {SERIES.map((s) => (
          <li key={s.key} className="flex items-center gap-2">
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 18 18"><rect width="18" height="18" rx="3" fill={s.pattern === "solid" ? s.color : `url(#p-${s.pattern})`} /></svg>
            {s.label}
          </li>
        ))}
      </ul>
      <details className="rounded-xl border border-border bg-surface p-4">
        <summary className="cursor-pointer text-base font-semibold">Show data table</summary>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-base">
            <caption className="sr-only">Doses by day for the last 7 days</caption>
            <thead>
              <tr>
                <th scope="col" className="py-2 pr-4">Day</th>
                {SERIES.map((s) => <th key={s.key} scope="col" className="py-2 pr-4">{s.label}</th>)}
                <th scope="col" className="py-2">Due</th>
              </tr>
            </thead>
            <tbody>
              {days.map((d) => (
                <tr key={d.date} className="border-t border-border">
                  <th scope="row" className="py-2 pr-4 font-semibold">{d.label}</th>
                  <td className="py-2 pr-4">{d.taken}</td><td className="py-2 pr-4">{d.skipped}</td><td className="py-2 pr-4">{d.unknown}</td><td className="py-2 pr-4">{d.unresolved}</td><td className="py-2">{d.due}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[0.95rem] text-muted-foreground">{ADHERENCE_DEFINITION}</p>
      </details>
    </figure>
  );
}
