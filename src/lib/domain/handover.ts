import type { Action } from "./permissions";
import type { Appointment, CareTask, DoseOccurrence } from "./types";
import { fmtDateTime, fmtTime } from "@/lib/format";

/**
 * Deterministic handover logic. Everything a handover says comes from here, as
 * source-tagged items. An AI may only REWORD these items (see ai/handover);
 * it never adds, removes or re-classifies one. All dose wording is
 * self-report language: nothing here says a medicine was verified as taken.
 */
export const SECTIONS = [
  "medication_unresolved",
  "medication_snoozed",
  "medication_not_sure",
  "medication_skipped",
  "medication_taken",
  "upcoming_doses",
  "appointments",
  "tasks",
  "prescriptions",
  "documents",
  "changes",
  "notes",
] as const;
export type SectionKey = (typeof SECTIONS)[number];

export const SECTION_TITLE: Record<SectionKey, string> = {
  medication_unresolved: "Reminders with no report yet",
  medication_snoozed: "Snoozed reminders",
  medication_not_sure: "Doses the patient was not sure about",
  medication_skipped: "Doses reported skipped",
  medication_taken: "Doses reported taken",
  upcoming_doses: "Coming up soon",
  appointments: "Upcoming appointments",
  tasks: "Open care tasks",
  prescriptions: "Prescriptions waiting to be checked",
  documents: "New documents",
  changes: "Changes to the care plan",
  notes: "Notes from caregivers",
};

export interface HandoverItem {
  /** Short stable id used to cite the item ("m1", "t2"). */
  id: string;
  section: SectionKey;
  /** Permission a reader needs to see this item. Used when sharing. */
  requires: Action;
  text: string;
  at: Date | null;
  /** Needs someone's attention: shown first and always kept in the summary. */
  attention: boolean;
  /** The real record(s) this came from. */
  sourceId: string;
}

export interface BuildInput {
  now: Date;
  periodStart: Date;
  timezone: string;
  /** null means the creator may not see this kind of data: it is omitted, never guessed. */
  doses: DoseOccurrence[] | null;
  upcomingDoses: DoseOccurrence[] | null;
  appointments: Appointment[] | null;
  tasks: CareTask[] | null;
  documents: { id: string; title: string; category: string; createdAt: Date; uploadedByName: string }[] | null;
  prescriptions: { id: string; medicineCount: number; createdAt: Date }[] | null;
  changes: { id: string; action: string; actorName: string; at: Date; requires: Action }[] | null;
}

const UNRESOLVED = new Set<DoseOccurrence["status"]>(["scheduled", "notified", "acknowledged", "missed_by_policy"]);

const doseLabel = (d: DoseOccurrence) => `${d.medicationName} (${d.doseText})`;

const CHANGE_TEXT: Record<string, string> = {
  "medication.create": "added a medicine",
  "medication.update": "updated a medicine",
  "medication.status_change": "changed a medicine's status",
  "appointment.create": "added an appointment",
  "appointment.update": "changed an appointment",
  "appointment.cancel": "cancelled an appointment",
  "document.upload": "uploaded a document",
  "document.delete": "deleted a document",
  "prescription.approve": "approved a medicine from a scanned prescription",
};
export const HANDOVER_CHANGE_ACTIONS = Object.keys(CHANGE_TEXT);

function unresolvedText(d: DoseOccurrence, tz: string) {
  const when = fmtDateTime(d.scheduledAt, tz);
  switch (d.status) {
    case "acknowledged":
      return `${doseLabel(d)} scheduled for ${when}: the reminder was seen, but no taken or skipped report was made.`;
    case "missed_by_policy":
      return `${doseLabel(d)} scheduled for ${when}: no response was recorded within the reminder rules.`;
    case "notified":
      return `${doseLabel(d)} scheduled for ${when}: a reminder was sent and no response was recorded.`;
    default:
      return `${doseLabel(d)} scheduled for ${when}: no response was recorded.`;
  }
}

export function buildHandover(i: BuildInput): { items: HandoverItem[]; omitted: string[] } {
  const items: HandoverItem[] = [];
  const omitted: string[] = [];
  const counters: Partial<Record<SectionKey, number>> = {};
  const add = (section: SectionKey, requires: Action, text: string, at: Date | null, attention: boolean, sourceId: string) => {
    const n = (counters[section] = (counters[section] ?? 0) + 1);
    items.push({ id: `${section.split("_").map((w) => w[0]).join("")}${n}`, section, requires, text, at, attention, sourceId });
  };
  const tz = i.timezone;

  if (i.doses === null) omitted.push("reported medicine activity");
  else {
    const inPeriod = i.doses.filter((d) => d.status !== "cancelled" && d.scheduledAt >= i.periodStart && d.scheduledAt <= i.now);
    for (const d of inPeriod) {
      if (d.status === "reported_taken") add("medication_taken", "doses:viewHistory", `${doseLabel(d)} scheduled for ${fmtTime(d.scheduledAt, tz)} was reported taken${d.respondedAt ? ` at ${fmtTime(d.respondedAt, tz)}` : ""}. This is a self-report, not verified.`, d.respondedAt ?? d.scheduledAt, false, d.id);
      else if (d.status === "reported_skipped") add("medication_skipped", "doses:viewHistory", `${doseLabel(d)} scheduled for ${fmtTime(d.scheduledAt, tz)} was reported skipped${d.respondedAt ? ` at ${fmtTime(d.respondedAt, tz)}` : ""}.`, d.respondedAt ?? d.scheduledAt, false, d.id);
      else if (d.status === "snoozed") add("medication_snoozed", "doses:viewHistory", `${doseLabel(d)} scheduled for ${fmtDateTime(d.scheduledAt, tz)} was snoozed${d.snoozedUntil ? ` until ${fmtTime(d.snoozedUntil, tz)}` : ""} and is still unresolved.`, d.scheduledAt, true, d.id);
      else if (d.status === "unknown") add("medication_not_sure", "doses:viewHistory", `The patient said they were not sure whether they took ${doseLabel(d)} scheduled for ${fmtDateTime(d.scheduledAt, tz)}.`, d.scheduledAt, true, d.id);
      else if (UNRESOLVED.has(d.status)) add("medication_unresolved", "doses:viewHistory", unresolvedText(d, tz), d.scheduledAt, true, d.id);
    }
  }

  if (i.upcomingDoses === null) omitted.push("upcoming doses");
  else {
    for (const d of i.upcomingDoses.filter((x) => x.status !== "cancelled" && x.scheduledAt > i.now)) {
      add("upcoming_doses", "doses:read", `${doseLabel(d)} is due at ${fmtDateTime(d.scheduledAt, tz)}.`, d.scheduledAt, false, d.id);
    }
  }

  if (i.appointments === null) omitted.push("appointments");
  else {
    for (const a of i.appointments.filter((x) => x.status !== "cancelled" && x.startsAt >= i.now)) {
      const soon = a.startsAt.getTime() - i.now.getTime() <= 48 * 3600_000;
      add("appointments", "appointments:read", `${a.appointmentType} with ${a.doctorName}${a.facility ? ` at ${a.facility}` : ""} on ${fmtDateTime(a.startsAt, tz)}.`, a.startsAt, soon, a.id);
    }
  }

  if (i.tasks === null) omitted.push("care tasks");
  else {
    for (const t of i.tasks.filter((x) => ["pending", "accepted", "in_progress", "needs_attention"].includes(x.status))) {
      const overdue = t.dueAt !== null && t.dueAt < i.now;
      const unassigned = !t.assignedToUid;
      const bits = [
        t.assignedToName ? `assigned to ${t.assignedToName}` : "not assigned to anyone yet",
        t.dueAt ? `${overdue ? "was due" : "due"} ${fmtDateTime(t.dueAt, tz)}` : null,
        t.status === "needs_attention" ? "flagged as needing attention" : t.status === "pending" ? "not yet accepted" : t.status.replace("_", " "),
      ].filter(Boolean);
      add("tasks", "tasks:read", `Task "${t.title}": ${bits.join(", ")}${overdue ? " (overdue)" : ""}.`, t.dueAt ?? t.createdAt, overdue || unassigned || t.status === "needs_attention", t.id);
    }
    for (const t of i.tasks) {
      for (const n of t.notes.filter((x) => x.at >= i.periodStart)) {
        add("notes", "tasks:read", `${n.name} wrote on the task "${t.title}": "${n.text}"`, n.at, false, `${t.id}:${n.id}`);
      }
    }
  }

  if (i.prescriptions === null) omitted.push("prescriptions waiting to be checked");
  else {
    for (const p of i.prescriptions) {
      add("prescriptions", "medications:read", `A scanned prescription with ${p.medicineCount} ${p.medicineCount === 1 ? "medicine" : "medicines"} is waiting for a caregiver to check it. Nothing from it is active yet.`, p.createdAt, true, p.id);
    }
  }

  if (i.documents === null) omitted.push("new documents");
  else {
    for (const d of i.documents.filter((x) => x.createdAt >= i.periodStart)) {
      add("documents", "documents:read", `${d.uploadedByName} uploaded the document "${d.title}" (${d.category.replace("_", " ")}) at ${fmtDateTime(d.createdAt, tz)}.`, d.createdAt, false, d.id);
    }
  }

  if (i.changes === null) omitted.push("changes to the care plan");
  else {
    for (const c of i.changes.filter((x) => x.at >= i.periodStart && CHANGE_TEXT[x.action])) {
      add("changes", c.requires, `${c.actorName} ${CHANGE_TEXT[c.action]} at ${fmtDateTime(c.at, tz)}.`, c.at, false, c.id);
    }
  }

  const order = (it: HandoverItem) => SECTIONS.indexOf(it.section);
  items.sort((a, b) => order(a) - order(b) || (a.at?.getTime() ?? 0) - (b.at?.getTime() ?? 0));
  return { items, omitted };
}

export interface SummaryLine {
  text: string;
  /** Ids of the items this line is based on. */
  refs: string[];
}

/** Always-available, fully deterministic summary: one line per item, grouped by section. */
export function templateSummary(items: HandoverItem[]): SummaryLine[] {
  if (!items.length) return [{ text: "No activity or outstanding items were found for this period.", refs: [] }];
  return items.map((it) => ({ text: it.text, refs: [it.id] }));
}

export const summaryToText = (lines: SummaryLine[]) => lines.map((l) => `- ${l.text}`).join("\n");

/** Friendly names for what a recipient is missing, by permission. */
export const REQUIRES_LABEL: Partial<Record<Action, string>> = {
  "doses:viewHistory": "reported medicine activity",
  "doses:read": "the dose schedule",
  "appointments:read": "appointments",
  "tasks:read": "care tasks",
  "documents:read": "documents",
  "medications:read": "medicines",
};
