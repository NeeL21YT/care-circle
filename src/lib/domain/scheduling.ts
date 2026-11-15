import { DateTime } from "luxon";
import type { Medication, MedicationSchedule } from "./types";

/**
 * Pure scheduling engine. Turns a medication's local-time schedule into a list
 * of UTC instants. All wall-clock logic goes through Luxon with the patient's
 * IANA timezone, so DST transitions are handled (a time that does not exist on
 * the spring-forward day shifts forward; an ambiguous time resolves to the
 * first occurrence).
 */

export const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidTimezone(tz: string): boolean {
  return DateTime.local().setZone(tz).isValid;
}

export interface ScheduleIssue {
  field: string;
  message: string;
}

/** Validates a schedule and its date range; returns an empty list if valid. */
export function validateSchedule(
  schedule: MedicationSchedule,
  startDate: string,
  endDate: string | null,
): ScheduleIssue[] {
  const issues: ScheduleIssue[] = [];
  if (!schedule.times.length) {
    issues.push({ field: "times", message: "Add at least one reminder time." });
  }
  const seen = new Set<string>();
  for (const t of schedule.times) {
    if (!TIME_RE.test(t)) {
      issues.push({ field: "times", message: `"${t}" is not a valid time.` });
    } else if (seen.has(t)) {
      issues.push({ field: "times", message: `The time ${t} is listed twice.` });
    }
    seen.add(t);
  }
  if (schedule.frequency === "weekly") {
    const days = schedule.daysOfWeek ?? [];
    if (!days.length) {
      issues.push({ field: "daysOfWeek", message: "Choose at least one day of the week." });
    }
    if (days.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) {
      issues.push({ field: "daysOfWeek", message: "Days of the week must be Monday to Sunday." });
    }
  }
  if (schedule.frequency === "every_n_days") {
    const n = schedule.intervalDays;
    if (!n || !Number.isInteger(n) || n < 2 || n > 90) {
      issues.push({ field: "intervalDays", message: "Choose an interval between 2 and 90 days." });
    }
  }
  if (!DATE_RE.test(startDate) || !DateTime.fromISO(startDate).isValid) {
    issues.push({ field: "startDate", message: "Enter a valid start date." });
  }
  if (endDate !== null) {
    if (!DATE_RE.test(endDate) || !DateTime.fromISO(endDate).isValid) {
      issues.push({ field: "endDate", message: "Enter a valid end date." });
    } else if (endDate < startDate) {
      issues.push({ field: "endDate", message: "The end date cannot be before the start date." });
    }
  }
  return issues;
}

export interface OccurrenceSlot {
  id: string;
  scheduledAt: Date;
}

/** Deterministic id: same medication + same instant => same id, always. */
export function occurrenceId(medicationId: string, scheduledAt: Date): string {
  const stamp = DateTime.fromJSDate(scheduledAt, { zone: "utc" }).toFormat(
    "yyyyMMdd'T'HHmm'Z'",
  );
  return `${medicationId}_${stamp}`;
}

function dayMatches(
  schedule: MedicationSchedule,
  day: DateTime,
  start: DateTime,
): boolean {
  switch (schedule.frequency) {
    case "daily":
      return true;
    case "weekly":
      return (schedule.daysOfWeek ?? []).includes(day.weekday);
    case "every_n_days": {
      const n = schedule.intervalDays ?? 1;
      const diff = Math.round(day.startOf("day").diff(start.startOf("day"), "days").days);
      return diff >= 0 && diff % n === 0;
    }
  }
}

/**
 * Occurrences whose instant lies in [from, to). Respects start/end dates in the
 * patient's local calendar. Only meaningful for medications that should
 * generate doses; callers decide based on status.
 */
export function generateOccurrences(
  med: Pick<Medication, "id" | "schedule" | "startDate" | "endDate">,
  timezone: string,
  from: Date,
  to: Date,
): OccurrenceSlot[] {
  const slots: OccurrenceSlot[] = [];
  const start = DateTime.fromISO(med.startDate, { zone: timezone }).startOf("day");
  const end = med.endDate
    ? DateTime.fromISO(med.endDate, { zone: timezone }).endOf("day")
    : null;

  // Iterate local days from one day before `from` to one day after `to` so the
  // UTC window is fully covered regardless of offset.
  let day = DateTime.fromJSDate(from, { zone: timezone }).startOf("day").minus({ days: 1 });
  const last = DateTime.fromJSDate(to, { zone: timezone }).startOf("day").plus({ days: 1 });
  const times = [...med.schedule.times].sort();

  while (day <= last) {
    if (day >= start && (!end || day <= end) && dayMatches(med.schedule, day, start)) {
      for (const t of times) {
        const [h, m] = t.split(":").map(Number);
        const at = day.set({ hour: h, minute: m, second: 0, millisecond: 0 });
        if (!at.isValid) continue;
        const instant = at.toUTC().toJSDate();
        if (instant >= from && instant < to) {
          slots.push({ id: occurrenceId(med.id, instant), scheduledAt: instant });
        }
      }
    }
    day = day.plus({ days: 1 });
  }
  return slots.sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
}

/** Status values that should keep generating future occurrences. */
export function generatesDoses(status: Medication["status"]): boolean {
  return status === "active";
}

/** Formats an instant in the patient's timezone for display. */
export function formatLocal(
  instant: Date,
  timezone: string,
  format = "h:mm a",
): string {
  return DateTime.fromJSDate(instant, { zone: timezone }).toFormat(format);
}

export function localDateKey(instant: Date, timezone: string): string {
  return DateTime.fromJSDate(instant, { zone: timezone }).toFormat("yyyy-MM-dd");
}
