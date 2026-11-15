import type { MedicationSchedule } from "./types";

/** "08:00" -> "8:00 AM". Local wall-clock text; no timezone math. */
export function formatClock(hhmm: string): string {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm);
  if (!m) return hhmm;
  const h = Number(m[1]);
  return `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${h < 12 ? "AM" : "PM"}`;
}

export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

function joinList(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

/** Plain-language schedule, e.g. "Every day at 8:00 AM and 8:00 PM". Empty when incomplete. */
export function describeSchedule(s: Partial<MedicationSchedule>): string {
  const times = [...(s.times ?? [])].filter((t) => /^\d{2}:\d{2}$/.test(t)).sort().map(formatClock);
  if (!times.length) return "";
  const at = `at ${joinList(times)}`;
  switch (s.frequency) {
    case "weekly": {
      const days = [...new Set(s.daysOfWeek ?? [])].filter((d) => d >= 1 && d <= 7).sort((a, b) => a - b).map((d) => WEEKDAYS[d - 1]);
      return days.length ? `Every ${joinList(days)} ${at}` : "";
    }
    case "every_n_days":
      return s.intervalDays && s.intervalDays >= 2 ? `Every ${s.intervalDays} days ${at}` : "";
    default:
      return `Every day ${at}`;
  }
}
