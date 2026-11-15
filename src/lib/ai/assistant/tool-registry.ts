import "server-only";
import { DateTime } from "luxon";
import { z } from "zod";
import { col, fromSnap } from "@/lib/db";
import { HttpError, notFound } from "@/lib/api/errors";
import { requirePatientAccess } from "@/lib/auth/access";
import type { CurrentUser } from "@/lib/auth/session";
import { can, ForbiddenError } from "@/lib/domain/permissions";
import { InvalidTransitionError, nextStatus, SNOOZE_OPTIONS_MINUTES, STATUS_LABEL } from "@/lib/domain/dose-state";
import { describeSchedule } from "@/lib/domain/schedule-text";
import type { DoseOccurrence } from "@/lib/domain/types";
import { fmtDate, fmtDateTime, fmtTime } from "@/lib/format";
import { listActivity } from "@/lib/services/care-activity";
import { listTasks } from "@/lib/services/care-tasks";
import { getHandover, listHandovers } from "@/lib/services/handovers";
import { listAppointments } from "@/lib/services/appointments";
import { listDocuments } from "@/lib/services/documents";
import { listDoses } from "@/lib/services/doses";
import { getMedication, listMedications } from "@/lib/services/medications";
import { getPreferences } from "@/lib/services/preferences";
import { toModelSchema, type ToolDeclaration } from "../client";
import { ASSISTANT_PAGES, ASSISTANT_PAGE_KEYS, pagePath, type AssistantLink } from "./pages";

/**
 * Application tools the model may REQUEST. The backend validates every call.
 *
 * - patientId is NEVER a model-supplied argument. It is bound by the server
 *   from the authorized URL, so the model cannot ask for another patient.
 * - Every tool goes through the same services (and `requirePatientAccess`) as
 *   the REST API, so role and share permissions apply automatically.
 * - Read tools return minimal, pre-formatted data.
 * - "propose" tools change NOTHING: they record a pending action that a human
 *   must confirm with a button click (see services/assistant.ts).
 */
export interface ProposedAction {
  type: "snooze" | "dose_response";
  doseId: string;
  params: { minutes?: number; response?: "taken" | "skipped" | "unsure" };
  summary: string;
}

export interface ToolContext {
  user: CurrentUser;
  patientId: string;
  timezone: string;
  now: Date;
  proposals: ProposedAction[];
  /** Buttons to show under the reply. Built by the server from a fixed page list, never from model text. */
  links: AssistantLink[];
}

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.");
const range = z.object({ fromDate: day, toDate: day.optional() });
const id = z.string().min(1).max(64);

interface ToolDef<S extends z.ZodType> {
  name: string;
  description: string;
  schema: S;
  run(ctx: ToolContext, args: z.infer<S>): Promise<unknown>;
}
export type ToolOutcome = { ok: true; result: unknown } | { ok: false; error: string };

/** Binds a tool to its own schema so validated arguments reach `run` fully typed, with no casts at the call site. */
const tool = <S extends z.ZodType>(t: ToolDef<S>) => ({
  name: t.name,
  description: t.description,
  schema: t.schema as z.ZodType,
  async execute(ctx: ToolContext, rawArgs: unknown): Promise<ToolOutcome> {
    const parsed = t.schema.safeParse(rawArgs ?? {});
    if (!parsed.success) return { ok: false, error: `Invalid arguments: ${parsed.error.issues.map((i) => i.message).join("; ")}` };
    return { ok: true, result: await t.run(ctx, parsed.data) };
  },
});

const MAX_DAYS = 14;
const MAX_ROWS = 60;

function window(ctx: ToolContext, a: z.infer<typeof range>) {
  const from = DateTime.fromISO(a.fromDate, { zone: ctx.timezone }).startOf("day");
  const to = DateTime.fromISO(a.toDate ?? a.fromDate, { zone: ctx.timezone }).startOf("day").plus({ days: 1 });
  if (!from.isValid || !to.isValid || to <= from) throw new HttpError(400, "bad_range", "Invalid date range.");
  if (to.diff(from, "days").days > MAX_DAYS) throw new HttpError(400, "bad_range", `Ask for at most ${MAX_DAYS} days at a time.`);
  return { from: from.toJSDate(), to: to.toJSDate() };
}

const doseRow = (d: DoseOccurrence, tz: string) => ({
  doseId: d.id,
  medicationId: d.medicationId,
  medicine: d.medicationName,
  dose: d.doseText,
  date: fmtDate(d.scheduledAt, tz),
  time: fmtTime(d.scheduledAt, tz),
  status: STATUS_LABEL[d.status],
  note: d.instructions,
});

export const TOOLS = [
  tool({
    name: "getMedicationList",
    description: "List this person's medicines (name, strength, status). Use it to find a medicine's id.",
    schema: z.object({}),
    async run(ctx) {
      const meds = await listMedications(ctx.user, ctx.patientId);
      return meds.filter((m) => m.status !== "discontinued").map((m) => ({ medicationId: m.id, name: m.name, strength: m.strength, status: m.status }));
    },
  }),
  tool({
    name: "getMedicationSchedule",
    description: "Doses scheduled between two local dates (inclusive), with each dose's current status. Use fromDate = toDate for a single day. At most 14 days.",
    schema: range,
    async run(ctx, a) {
      const w = window(ctx, a);
      const doses = await listDoses(ctx.user, ctx.patientId, { from: w.from, to: w.to, limit: MAX_ROWS });
      return { count: doses.length, doses: doses.filter((d) => d.status !== "cancelled").map((d) => doseRow(d, ctx.timezone)) };
    },
  }),
  tool({
    name: "getMedicationDetails",
    description: "Details for one medicine by medicationId.",
    schema: z.object({ medicationId: id }),
    async run(ctx, a) {
      const m = await getMedication(ctx.user, ctx.patientId, a.medicationId);
      return {
        name: m.name, strength: m.strength, dose: `${m.doseAmount} ${m.doseUnit}`, form: m.form, route: m.route,
        schedule: describeSchedule(m.schedule), instructions: m.instructions, status: m.status, startDate: m.startDate, endDate: m.endDate, prescriber: m.prescriber,
      };
    },
  }),
  tool({
    name: "getDoseHistory",
    description: "Past doses between two local dates with what the person REPORTED (self-reported, not verified). At most 14 days.",
    schema: range,
    async run(ctx, a) {
      const w = window(ctx, a);
      const end = new Date(Math.min(w.to.getTime(), ctx.now.getTime()));
      const doses = await listDoses(ctx.user, ctx.patientId, { from: w.from, to: end, limit: MAX_ROWS });
      const rows = doses.filter((d) => d.status !== "cancelled");
      const count = (s: DoseOccurrence["status"]) => rows.filter((d) => d.status === s).length;
      return {
        note: "All statuses are self-reports or reminder records, never proof a medicine was taken.",
        total: rows.length, reportedTaken: count("reported_taken"), reportedSkipped: count("reported_skipped"),
        noResponseRecorded: count("missed_by_policy"), notSure: count("unknown"),
        doses: rows.map((d) => doseRow(d, ctx.timezone)),
      };
    },
  }),
  tool({
    name: "getUpcomingAppointments",
    description: "The next upcoming appointments (up to 10).",
    schema: z.object({}),
    async run(ctx) {
      const a = (await listAppointments(ctx.user, ctx.patientId, { scope: "upcoming" })).filter((x) => x.status !== "cancelled").slice(0, 10);
      return a.map((x) => ({ appointmentId: x.id, when: fmtDateTime(x.startsAt, ctx.timezone), doctor: x.doctorName, type: x.appointmentType, facility: x.facility }));
    },
  }),
  tool({
    name: "getAppointmentDetails",
    description: "Details for one appointment by appointmentId.",
    schema: z.object({ appointmentId: id }),
    async run(ctx, a) {
      const x = (await listAppointments(ctx.user, ctx.patientId, { scope: "all" })).find((r) => r.id === a.appointmentId);
      if (!x) throw notFound("That appointment");
      return { when: fmtDateTime(x.startsAt, ctx.timezone), doctor: x.doctorName, type: x.appointmentType, facility: x.facility, location: x.location, notes: x.notes, status: x.status };
    },
  }),
  tool({
    name: "getAuthorizedDocumentMetadata",
    description: "Titles, categories and dates of documents this user may see. Contents are not available here.",
    schema: z.object({}),
    async run(ctx) {
      const docs = await listDocuments(ctx.user, ctx.patientId);
      return docs.slice(0, 30).map((d) => ({ title: d.title, category: d.category, added: fmtDate(d.createdAt, ctx.timezone) }));
    },
  }),
  tool({
    name: "getPatientPreferences",
    description: "This user's own reminder settings (email on or off, quiet hours).",
    schema: z.object({}),
    async run(ctx) {
      const p = await getPreferences(ctx.user, ctx.patientId);
      return { email: p.email, quietHours: p.quietHours };
    },
  }),
  tool({
    name: "getCareTasks",
    description: "Shared care tasks: who is responsible, due dates, status. filter is open (default), mine, unassigned or all.",
    schema: z.object({ filter: z.enum(["open", "mine", "unassigned", "all"]).optional() }),
    async run(ctx, a) {
      const tasks = (await listTasks(ctx.user, ctx.patientId, { filter: a.filter ?? "open" })).slice(0, 30);
      return {
        count: tasks.length,
        tasks: tasks.map((t) => ({
          taskId: t.id, title: t.title, status: t.status.replace("_", " "), responsible: t.assignedToName ?? "Nobody yet",
          due: t.dueAt ? fmtDateTime(t.dueAt, ctx.timezone) : null,
          overdue: t.dueAt !== null && t.dueAt < ctx.now && ["pending", "accepted", "in_progress", "needs_attention"].includes(t.status),
          priority: t.priority,
        })),
      };
    },
  }),
  tool({
    name: "getRecentCareActivity",
    description: "What family members recently did in the app about tasks and handovers (who did what, when). Latest 15.",
    schema: z.object({}),
    async run(ctx) {
      const events = await listActivity(ctx.user, ctx.patientId, 15);
      return events.map((e) => ({ when: fmtDateTime(e.at, ctx.timezone), what: e.summary }));
    },
  }),
  tool({
    name: "getLatestHandover",
    description: "The most recent care handover this person may see: who wrote it, to whom, whether it was acknowledged, its summary and what needs attention.",
    schema: z.object({}),
    async run(ctx) {
      const list = await listHandovers(ctx.user, ctx.patientId);
      if (!list.length) return { found: false, note: "There are no handovers yet." };
      const h = await getHandover(ctx.user, ctx.patientId, list[0].id);
      return {
        found: true, from: h.createdByName, created: fmtDateTime(h.createdAt, ctx.timezone), status: h.status, to: h.recipientName,
        acknowledged: Boolean(h.acknowledgedAt), coversLastHours: h.periodHours,
        summary: h.summaryLines.slice(0, 12).map((l) => l.text), needsAttention: h.items.filter((i) => i.attention).slice(0, 8).map((i) => i.text),
        authorsNote: h.note || null,
      };
    },
  }),
  tool({
    name: "openPage",
    description: `Show the user a button that opens a page of the app. page is one of: ${ASSISTANT_PAGE_KEYS.join(", ")}. Use it whenever you explain where to do something. Never write URLs yourself.`,
    schema: z.object({ page: z.enum(ASSISTANT_PAGE_KEYS) }),
    async run(ctx, a) {
      const { membership } = await requirePatientAccess(ctx.user.uid, ctx.patientId, "patient:read");
      const page = ASSISTANT_PAGES[a.page];
      if (!can(membership, page.requires)) throw new ForbiddenError("This person cannot open that page.");
      if (!ctx.links.some((l) => l.label === `Open ${page.label}`)) ctx.links.push({ label: `Open ${page.label}`, path: pagePath(ctx.patientId, a.page) });
      return { status: "button_shown", label: page.label };
    },
  }),
  tool({
    name: "openDoctorBrief",
    description: "Show a button that opens the printable doctor-visit brief for one appointment (use the appointmentId from getUpcomingAppointments).",
    schema: z.object({ appointmentId: id }),
    async run(ctx, a) {
      const appt = (await listAppointments(ctx.user, ctx.patientId, { scope: "all" })).find((r) => r.id === a.appointmentId);
      if (!appt) throw notFound("That appointment");
      ctx.links.push({ label: `Open doctor brief for ${fmtDateTime(appt.startsAt, ctx.timezone)}`, path: `/patients/${ctx.patientId}/appointments/${appt.id}/brief` });
      return { status: "button_shown" };
    },
  }),
  tool({
    name: "proposeSnooze",
    description: `Ask the user to confirm snoozing a dose reminder. Does NOT snooze by itself. minutes must be one of ${SNOOZE_OPTIONS_MINUTES.join(", ")}.`,
    schema: z.object({ doseId: id, minutes: z.number().int().refine((n) => (SNOOZE_OPTIONS_MINUTES as readonly number[]).includes(n), `Choose ${SNOOZE_OPTIONS_MINUTES.join(", ")} minutes.`) }),
    async run(ctx, a) {
      const dose = await loadDose(ctx, a.doseId, "snoozed");
      const summary = `Snooze the reminder for ${dose.medicationName} (${fmtTime(dose.scheduledAt, ctx.timezone)}) for ${a.minutes} minutes.`;
      ctx.proposals.push({ type: "snooze", doseId: dose.id, params: { minutes: a.minutes }, summary });
      return { status: "awaiting_user_confirmation", summary };
    },
  }),
  tool({
    name: "proposeDoseResponse",
    description: "Ask the user to confirm recording what they report about a dose: taken, skipped or unsure. Does NOT record anything by itself.",
    schema: z.object({ doseId: id, response: z.enum(["taken", "skipped", "unsure"]) }),
    async run(ctx, a) {
      const event = a.response === "taken" ? "reported_taken" : a.response === "skipped" ? "reported_skipped" : "reported_unsure";
      const dose = await loadDose(ctx, a.doseId, event);
      const verb = a.response === "taken" ? "that you took" : a.response === "skipped" ? "that you skipped" : "that you are not sure about";
      const summary = `Record ${verb} ${dose.medicationName} (${fmtTime(dose.scheduledAt, ctx.timezone)}). This is your own report.`;
      ctx.proposals.push({ type: "dose_response", doseId: dose.id, params: { response: a.response }, summary });
      return { status: "awaiting_user_confirmation", summary };
    },
  }),
] as const;

/** Resolves a dose in THIS patient's collection, checks permission and that the move is allowed. */
async function loadDose(ctx: ToolContext, doseId: string, event: "snoozed" | "reported_taken" | "reported_skipped" | "reported_unsure") {
  await requirePatientAccess(ctx.user.uid, ctx.patientId, "doses:respond");
  const dose = fromSnap<DoseOccurrence>(await col.sub(ctx.patientId, "doseOccurrences").doc(doseId).get());
  if (!dose) throw notFound("That dose");
  nextStatus({ current: dose.status, event, byUser: true }); // throws InvalidTransitionError if not allowed
  return dose;
}

export function toolDeclarations(): ToolDeclaration[] {
  return TOOLS.map((t) => ({ name: t.name, description: t.description, parameters: toModelSchema(z.toJSONSchema(t.schema)) }));
}

/** Validates and runs one model-requested call. Errors are reduced to safe, generic text. */
export async function runTool(ctx: ToolContext, name: string, rawArgs: unknown): Promise<ToolOutcome> {
  const def = TOOLS.find((t) => t.name === name);
  if (!def) return { ok: false, error: "That tool does not exist." };
  try {
    return await def.execute(ctx, rawArgs);
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, error: "This person is not allowed to see or do that." };
    if (e instanceof InvalidTransitionError) return { ok: false, error: e.message };
    if (e instanceof HttpError && e.status < 500) return { ok: false, error: e.message };
    return { ok: false, error: "That information could not be loaded right now." };
  }
}
