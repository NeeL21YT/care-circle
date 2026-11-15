import { DateTime } from "luxon";
import type { DoseStatus } from "./types";

/**
 * Adherence calculation.
 *
 * DENOMINATOR (documented, shown in the UI):
 *   all non-cancelled doses whose scheduled time has already passed ("due").
 *   Doses scheduled in the future are not counted yet.
 *
 * NUMERATOR:
 *   doses the patient SELF-REPORTED as taken.
 *
 * Skipped, "not sure" and unresolved doses stay in the denominator and never
 * count toward the numerator. Nothing is silently counted as taken, and this
 * is a self-report rate, not verified ingestion.
 */
export const ADHERENCE_DEFINITION =
  "Self-reported taken doses divided by all doses due so far. Cancelled doses and doses not yet due are excluded. Skipped, not-sure and unanswered doses are not counted as taken. This is based on what the patient reported and is not verified.";

export interface DoseLike {
  status: DoseStatus;
  scheduledAt: Date;
}

export interface AdherenceSummary {
  /** Doses due so far, excluding cancelled (the denominator). */
  due: number;
  taken: number;
  skipped: number;
  unknown: number;
  /** scheduled | notified | acknowledged | snoozed | missed_by_policy, already due. */
  unresolved: number;
  /** Future, non-cancelled doses. Not part of the denominator. */
  upcoming: number;
  cancelled: number;
  /** 0-100, rounded; null when nothing is due (never a misleading 0 or 100). */
  percentage: number | null;
}

export function summarizeAdherence(doses: DoseLike[], now: Date): AdherenceSummary {
  const s: AdherenceSummary = {
    due: 0, taken: 0, skipped: 0, unknown: 0, unresolved: 0,
    upcoming: 0, cancelled: 0, percentage: null,
  };
  for (const d of doses) {
    if (d.status === "cancelled") { s.cancelled++; continue; }
    if (d.scheduledAt.getTime() > now.getTime()) { s.upcoming++; continue; }
    s.due++;
    switch (d.status) {
      case "reported_taken": s.taken++; break;
      case "reported_skipped": s.skipped++; break;
      case "unknown": s.unknown++; break;
      default: s.unresolved++;
    }
  }
  s.percentage = s.due === 0 ? null : Math.round((s.taken / s.due) * 100);
  return s;
}

export interface DailyAdherence extends AdherenceSummary {
  /** Local date "YYYY-MM-DD" in the patient's timezone. */
  date: string;
  label: string;
}

/** One summary per local day for the `days` days ending today (inclusive). */
export function weeklyActivity(
  doses: DoseLike[],
  now: Date,
  timezone: string,
  days = 7,
): DailyAdherence[] {
  const today = DateTime.fromJSDate(now, { zone: timezone }).startOf("day");
  const out: DailyAdherence[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = today.minus({ days: i });
    const key = day.toFormat("yyyy-MM-dd");
    const dayDoses = doses.filter(
      (d) =>
        DateTime.fromJSDate(d.scheduledAt, { zone: timezone }).toFormat("yyyy-MM-dd") === key,
    );
    out.push({
      ...summarizeAdherence(dayDoses, now),
      date: key,
      label: day.toFormat("ccc d LLL"),
    });
  }
  return out;
}
