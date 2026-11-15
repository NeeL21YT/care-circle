import { DateTime } from "luxon";
import { z } from "zod";
import { summarizeAdherence } from "./adherence";
import { OPEN_TASK_STATUSES, type DoseStatus, type TaskStatus } from "./types";

/**
 * Weekly caregiver report. Every number is computed by code from real records
 * and every sentence comes from the fixed templates below. No AI is involved.
 * Dose wording is always "reported taken" / "reported skipped": these are
 * self-reports, never verified facts.
 */

export const REPORT_DAYS = 7;

export interface ReportDose { status: DoseStatus; scheduledAt: Date }
export interface ReportTask { status: TaskStatus; assignedToUid: string | null; dueAt: Date | null; completedAt: Date | null }
export interface ReportAppointment { id: string; doctorName: string; startsAt: Date; status: "scheduled" | "completed" | "cancelled" }

export interface DoseStats {
  scheduled: number;
  reportedTaken: number;
  reportedSkipped: number;
  snoozed: number;
  notSure: number;
  noReport: number;
  /** Doses due so far, excluding cancelled. */
  due: number;
  /** 0-100, or null when nothing was due. */
  adherencePercent: number | null;
}
export interface TaskStats { completed: number; open: number; overdue: number; unassigned: number }
export interface AppointmentStats { past: number; next: { id: string; doctorName: string; startsAt: Date } | null }

export interface AttentionItem { id: string; text: string; link: "tasks" | "scanner" | null }

export interface WeeklyReport {
  periodStart: Date;
  periodEnd: Date;
  days: number;
  timezone: string;
  doses: DoseStats | null;
  tasks: TaskStats | null;
  appointments: AppointmentStats | null;
  documents: { added: number } | null;
  scans: { waiting: number } | null;
  handovers: { count: number } | null;
  attention: AttentionItem[];
  /** Kinds of information this viewer cannot see, so a gap is never mistaken for "nothing happened". */
  omitted: string[];
  sentences: string[];
}

export interface ReportInput {
  now: Date;
  timezone: string;
  /** null = the viewer may not see this kind of data. */
  doses: ReportDose[] | null;
  tasks: ReportTask[] | null;
  appointments: ReportAppointment[] | null;
  documentDates: Date[] | null;
  scansWaiting: number | null;
  handoverDates: Date[] | null;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const was = (n: number) => (n === 1 ? "was" : "were");

function joinList(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

export function computeDoseStats(doses: ReportDose[], now: Date): DoseStats {
  const live = doses.filter((d) => d.status !== "cancelled");
  const count = (s: DoseStatus) => live.filter((d) => d.status === s).length;
  const adherence = summarizeAdherence(doses, now);
  return {
    scheduled: live.length,
    reportedTaken: count("reported_taken"),
    reportedSkipped: count("reported_skipped"),
    snoozed: count("snoozed"),
    notSure: count("unknown"),
    noReport: live.filter((d) => ["scheduled", "notified", "acknowledged", "missed_by_policy"].includes(d.status)).length,
    due: adherence.due,
    adherencePercent: adherence.percentage,
  };
}

export function doseSentences(s: DoseStats): string[] {
  if (s.scheduled === 0) return ["No doses were scheduled this week."];
  const parts: string[] = [];
  if (s.reportedTaken) parts.push(`${s.reportedTaken} ${was(s.reportedTaken)} reported taken`);
  if (s.reportedSkipped) parts.push(`${s.reportedSkipped} ${was(s.reportedSkipped)} reported skipped`);
  if (s.snoozed) parts.push(`${s.snoozed} ${was(s.snoozed)} snoozed`);
  if (s.notSure) parts.push(`${s.notSure} ${was(s.notSure)} marked not sure`);
  if (s.noReport) parts.push(`${s.noReport} ${s.noReport === 1 ? "has" : "have"} no report yet`);
  const out = [`${plural(s.scheduled, "dose")} ${was(s.scheduled)} scheduled this week.`];
  if (parts.length) out.push(`${joinList(parts)}.`);
  out.push(
    s.adherencePercent === null
      ? "No doses were due yet, so no percentage is shown."
      : `${s.adherencePercent}% of the doses that were due were reported taken. This is based on what was reported and is not verified.`,
  );
  return out;
}

export function buildWeeklyReport(input: ReportInput): WeeklyReport {
  const { now, timezone } = input;
  const periodStart = new Date(now.getTime() - REPORT_DAYS * 86_400_000);
  const inWeek = (d: Date) => d >= periodStart && d <= now;
  const omitted: string[] = [];
  const sentences: string[] = [];
  const attention: AttentionItem[] = [];

  let doses: DoseStats | null = null;
  if (input.doses) {
    doses = computeDoseStats(input.doses.filter((d) => inWeek(d.scheduledAt)), now);
    sentences.push(...doseSentences(doses));
    if (doses.noReport) attention.push({ id: "doses-no-report", text: `${plural(doses.noReport, "dose")} ${doses.noReport === 1 ? "has" : "have"} no report yet.`, link: null });
  } else omitted.push("medicine doses");

  let tasks: TaskStats | null = null;
  if (input.tasks) {
    const open = input.tasks.filter((t) => OPEN_TASK_STATUSES.includes(t.status));
    tasks = {
      completed: input.tasks.filter((t) => t.status === "completed" && t.completedAt && inWeek(t.completedAt)).length,
      open: open.length,
      overdue: open.filter((t) => t.dueAt && t.dueAt < now).length,
      unassigned: open.filter((t) => !t.assignedToUid).length,
    };
    sentences.push(`${plural(tasks.completed, "care task")} ${was(tasks.completed)} completed this week. ${tasks.open} ${tasks.open === 1 ? "is" : "are"} still open.`);
    if (tasks.overdue) attention.push({ id: "tasks-overdue", text: `${plural(tasks.overdue, "task")} ${tasks.overdue === 1 ? "is" : "are"} overdue.`, link: "tasks" });
    if (tasks.unassigned) attention.push({ id: "tasks-unassigned", text: `${plural(tasks.unassigned, "open task")} ${tasks.unassigned === 1 ? "has" : "have"} nobody responsible yet.`, link: "tasks" });
  } else omitted.push("care tasks");

  let appointments: AppointmentStats | null = null;
  if (input.appointments) {
    const live = input.appointments.filter((a) => a.status !== "cancelled");
    const next = live.filter((a) => a.startsAt >= now).sort((a, b) => +a.startsAt - +b.startsAt)[0] ?? null;
    appointments = {
      past: live.filter((a) => inWeek(a.startsAt) && a.startsAt < now).length,
      next: next ? { id: next.id, doctorName: next.doctorName, startsAt: next.startsAt } : null,
    };
    sentences.push(
      `${plural(appointments.past, "appointment")} took place this week.` +
        (next ? ` The next one is with ${next.doctorName} on ${DateTime.fromJSDate(next.startsAt, { zone: timezone }).toFormat("cccc d LLLL 'at' h:mm a")}.` : " No upcoming appointment is booked."),
    );
  } else omitted.push("appointments");

  let documents: { added: number } | null = null;
  if (input.documentDates) {
    documents = { added: input.documentDates.filter(inWeek).length };
    sentences.push(`${plural(documents.added, "new document")} ${was(documents.added)} added this week.`);
  } else omitted.push("documents");

  let scans: { waiting: number } | null = null;
  if (input.scansWaiting !== null) {
    scans = { waiting: input.scansWaiting };
    if (scans.waiting) {
      sentences.push(`${plural(scans.waiting, "prescription scan")} ${scans.waiting === 1 ? "is" : "are"} waiting for review.`);
      attention.push({ id: "scans-waiting", text: `${plural(scans.waiting, "prescription scan")} ${scans.waiting === 1 ? "is" : "are"} waiting for review.`, link: "scanner" });
    }
  } else omitted.push("prescription scans");

  let handovers: { count: number } | null = null;
  if (input.handoverDates) {
    handovers = { count: input.handoverDates.filter(inWeek).length };
    sentences.push(`${plural(handovers.count, "care handover")} ${was(handovers.count)} created this week.`);
  } else omitted.push("care handovers");

  return { periodStart, periodEnd: now, days: REPORT_DAYS, timezone, doses, tasks, appointments, documents, scans, handovers, attention, omitted, sentences };
}

/* ---------------- wellbeing check-in (optional, private, non-diagnostic) ---------------- */

export const CHECKIN_LEVELS = ["comfortable", "somewhat_difficult", "very_difficult"] as const;
export type CheckinLevel = (typeof CHECKIN_LEVELS)[number];

export const CHECKIN_LABEL: Record<CheckinLevel, string> = {
  comfortable: "Comfortable",
  somewhat_difficult: "Somewhat difficult",
  very_difficult: "Very difficult",
};

export const checkinSchema = z.object({
  level: z.enum(CHECKIN_LEVELS, { message: "Choose one of the options." }),
  note: z.string().trim().max(500, "Keep the note under 500 characters.").optional().transform((v) => v ?? ""),
});
export type CheckinInput = z.infer<typeof checkinSchema>;

/** ISO week key in the given timezone, e.g. "2026-W46". */
export function isoWeekKey(date: Date, timezone: string): string {
  const d = DateTime.fromJSDate(date, { zone: timezone });
  return `${d.weekYear}-W${String(d.weekNumber).padStart(2, "0")}`;
}

/** Short, supportive, non-clinical message shown after saving. */
export function checkinMessage(level: CheckinLevel): string {
  switch (level) {
    case "comfortable":
      return "Thank you for checking in. It is good to hear this week has felt manageable.";
    case "somewhat_difficult":
      return "Thank you for checking in. Caring for someone can be demanding, and it is normal for some weeks to feel harder than others.";
    case "very_difficult":
      return "Thank you for being honest. A very difficult week is a sign to share the load, not a sign that you are doing anything wrong.";
  }
}
