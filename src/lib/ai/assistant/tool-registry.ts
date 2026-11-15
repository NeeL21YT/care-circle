import "server-only";
import { DateTime } from "luxon";
import { z } from "zod";
import { col, fromSnap } from "@/lib/db";
import { HttpError, notFound } from "@/lib/api/errors";
import { requirePatientAccess } from "@/lib/auth/access";
import type { CurrentUser } from "@/lib/auth/session";
import { ForbiddenError } from "@/lib/domain/permissions";
import { InvalidTransitionError, nextStatus, SNOOZE_OPTIONS_MINUTES, STATUS_LABEL } from "@/lib/domain/dose-state";
import { describeSchedule } from "@/lib/domain/schedule-text";
import type { DoseOccurrence } from "@/lib/domain/types";
import { fmtDate, fmtDateTime, fmtTime } from "@/lib/format";
import { listAppointments } from "@/lib/services/appointments";
import { listDocuments } from "@/lib/services/documents";
import { listDoses } from "@/lib/services/doses";
import { getMedication, listMedications } from "@/lib/services/medications";
import { getPreferences } from "@/lib/services/preferences";
import { toModelSchema, type ToolDeclaration } from "../client";

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
const tool = <S extends z.ZodType>(t: ToolDef<S>) => t;

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
  return TOOLS.map((t) => ({ name: t.name, description: t.description, parameters: toModelSchema(z.toJSONSchema(t.schema as z.ZodType)) }));
}

export type ToolOutcome = { ok: true; result: unknown } | { ok: false; error: string };

/** Validates and runs one model-requested call. Errors are reduced to safe, generic text. */
export async function runTool(ctx: ToolContext, name: string, rawArgs: unknown): Promise<ToolOutcome> {
  const def = TOOLS.find((t) => t.name === name);
  if (!def) return { ok: false, error: "That tool does not exist." };
  const parsed = def.schema.safeParse(rawArgs ?? {});
  if (!parsed.success) return { ok: false, error: `Invalid arguments: ${parsed.error.issues.map((i) => i.message).join("; ")}` };
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { ok: true, result: await def.run(ctx, parsed.data as any) };
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, error: "This person is not allowed to see or do that." };
    if (e instanceof InvalidTransitionError) return { ok: false, error: e.message };
    if (e instanceof HttpError && e.status < 500) return { ok: false, error: e.message };
    return { ok: false, error: "That information could not be loaded right now." };
  }
}
