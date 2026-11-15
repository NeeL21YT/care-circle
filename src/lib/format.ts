import { DateTime } from "luxon";

/** Formatting helpers. Everything is rendered in the patient's timezone. */
export const fmtTime = (d: Date | string, tz: string) =>
  DateTime.fromJSDate(new Date(d), { zone: tz }).toFormat("h:mm a");
export const fmtDate = (d: Date | string, tz: string) =>
  DateTime.fromJSDate(new Date(d), { zone: tz }).toFormat("cccc d LLLL");
export const fmtDateTime = (d: Date | string, tz: string) =>
  DateTime.fromJSDate(new Date(d), { zone: tz }).toFormat("ccc d LLL, h:mm a");
export const fmtDateShort = (d: Date | string, tz: string) =>
  DateTime.fromJSDate(new Date(d), { zone: tz }).toFormat("d LLL yyyy");

export function greeting(now: Date, tz: string): string {
  const h = DateTime.fromJSDate(now, { zone: tz }).hour;
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export const firstName = (full: string) => full.trim().split(/\s+/)[0] ?? full;

/** "in 2 hours", "tomorrow at 10:00 AM" style text for appointments. */
export function relativeDay(d: Date | string, now: Date, tz: string): string {
  const t = DateTime.fromJSDate(new Date(d), { zone: tz }).startOf("day");
  const n = DateTime.fromJSDate(now, { zone: tz }).startOf("day");
  const days = Math.round(t.diff(n, "days").days);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days > 1 && days < 7) return `on ${t.toFormat("cccc")}`;
  return `on ${t.toFormat("cccc d LLLL")}`;
}
