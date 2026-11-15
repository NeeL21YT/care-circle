import { z } from "zod";
import {
  APPOINTMENT_STATUSES,
  DOCUMENT_CATEGORIES,
  FREQUENCIES,
  MEDICATION_STATUSES,
  ROLES,
  SHARE_CATEGORIES,
  TASK_PRIORITIES,
  TASK_STATUSES,
} from "./types";
import { DATE_RE, TIME_RE, isValidTimezone, validateSchedule } from "./scheduling";
import { SNOOZE_OPTIONS_MINUTES, USER_EVENT_TYPES } from "./dose-state";

/** Zod schemas: the single validation source for API input and forms. */

const trimmed = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

/**
 * For PARTIAL updates: an omitted field must stay omitted (leave the stored value alone),
 * while an explicit empty value clears it. `optionalText` would turn "omitted" into null.
 */
const patchText = (max: number) =>
  z.string().trim().max(max).nullable().optional().transform((v) => (v === undefined ? undefined : v ? v : null));

const e164ish = z
  .string()
  .trim()
  .regex(/^[+]?[0-9\s().-]{7,20}$/, "Enter a valid phone number.");

export const tzSchema = z.string().refine(isValidTimezone, "Choose a valid timezone.");
export const dateSchema = z
  .string()
  .regex(DATE_RE, "Enter a date as YYYY-MM-DD.");

// ---- Auth ----
export const ACCOUNT_TYPES = ["caregiver", "patient", "family"] as const;
export const sessionSchema = z.object({
  idToken: z.string().min(20),
  accountType: z.enum(ACCOUNT_TYPES).optional(),
});

// ---- Patients ----
export const patientInputSchema = z.object({
  fullName: trimmed(120).min(1, "Enter the patient's full name."),
  dateOfBirth: dateSchema.refine((d) => d <= new Date().toISOString().slice(0, 10), "Date of birth cannot be in the future."),
  gender: optionalText(40),
  phone: e164ish.optional().nullable().or(z.literal("").transform(() => null)),
  email: z.string().trim().email("Enter a valid email address.").optional().nullable().or(z.literal("").transform(() => null)),
  preferredLanguage: trimmed(40).min(1).default("English"),
  timezone: tzSchema,
  emergencyContactName: optionalText(120),
  emergencyContactPhone: e164ish.optional().nullable().or(z.literal("").transform(() => null)),
  medicalNotes: optionalText(2000),
});
export type PatientInput = z.infer<typeof patientInputSchema>;
export const patientUpdateSchema = patientInputSchema.partial();

export const escalationPolicySchema = z.object({
  upcomingLeadMinutes: z.number().int().min(0).max(120),
  followUpAfterMinutes: z.number().int().min(5).max(240),
  escalateAfterMinutes: z.number().int().min(10).max(480),
});

// ---- Care circle ----
export const sharePermissionsSchema = z.object(
  // `tasks` and `manageCare` default to off so older clients and records stay valid.
  Object.fromEntries(SHARE_CATEGORIES.map((c) => [c, c === "tasks" || c === "manageCare" ? z.boolean().default(false) : z.boolean()])) as Record<
    (typeof SHARE_CATEGORIES)[number],
    z.ZodBoolean
  >,
);
export const invitationSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  role: z.enum(ROLES),
  permissions: sharePermissionsSchema.optional(),
});
export const membershipUpdateSchema = z.object({ permissions: sharePermissionsSchema });

// ---- Medications ----
export const scheduleSchema = z.object({
  frequency: z.enum(FREQUENCIES),
  times: z.array(z.string().regex(TIME_RE, "Use HH:MM, 24-hour.")).min(1, "Add at least one reminder time.").max(12),
  daysOfWeek: z.array(z.number().int().min(1).max(7)).max(7).optional(),
  intervalDays: z.number().int().min(2).max(90).optional(),
});

export const medicationInputSchema = z
  .object({
    name: trimmed(120).min(1, "Enter the medication name."),
    activeIngredient: optionalText(120),
    strength: optionalText(60),
    doseAmount: z.number().positive("Dose amount must be more than zero.").max(10000),
    doseUnit: trimmed(30).min(1, "Choose a dose unit."),
    form: trimmed(40).min(1, "Choose a dosage form."),
    route: trimmed(40).min(1, "Choose a route."),
    schedule: scheduleSchema,
    startDate: dateSchema,
    endDate: dateSchema.optional().nullable().transform((v) => v ?? null),
    prescriber: optionalText(120),
    instructions: optionalText(1000),
    status: z.enum(MEDICATION_STATUSES).default("active"),
  })
  .superRefine((m, ctx) => {
    for (const issue of validateSchedule(m.schedule, m.startDate, m.endDate)) {
      ctx.addIssue({ code: "custom", message: issue.message, path: [issue.field === "times" || issue.field === "daysOfWeek" || issue.field === "intervalDays" ? "schedule" : issue.field] });
    }
  });
export type MedicationInput = z.infer<typeof medicationInputSchema>;

export const medicationUpdateSchema = z.object({
  name: trimmed(120).min(1).optional(),
  activeIngredient: patchText(120),
  strength: patchText(60),
  doseAmount: z.number().positive().max(10000).optional(),
  doseUnit: trimmed(30).min(1).optional(),
  form: trimmed(40).min(1).optional(),
  route: trimmed(40).min(1).optional(),
  schedule: scheduleSchema.optional(),
  startDate: dateSchema.optional(),
  endDate: dateSchema.nullable().optional(),
  prescriber: patchText(120),
  instructions: patchText(1000),
  status: z.enum(MEDICATION_STATUSES).optional(),
});

// ---- Doses ----
export const doseEventSchema = z.object({
  eventType: z.enum(USER_EVENT_TYPES),
  note: optionalText(500),
  clientEventId: z.string().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/).optional(),
  snoozeMinutes: z.number().int().refine((n) => (SNOOZE_OPTIONS_MINUTES as readonly number[]).includes(n), "Choose 10, 15, 30 or 60 minutes.").optional(),
  occurredAt: z.string().datetime().optional(),
});
export const snoozeSchema = z.object({
  minutes: z.number().int().refine((n) => (SNOOZE_OPTIONS_MINUTES as readonly number[]).includes(n), "Choose 10, 15, 30 or 60 minutes."),
  clientEventId: z.string().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/).optional(),
});
export const dosesQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

// ---- Appointments ----
const reminderOffsets = z.array(z.number().int().min(5).max(60 * 24 * 14)).max(4);
const appointmentFields = z.object({
  doctorName: trimmed(120).min(1, "Enter the doctor's name."),
  facility: optionalText(160),
  date: dateSchema,
  time: z.string().regex(TIME_RE, "Enter a time like 14:30."),
  location: optionalText(240),
  appointmentType: trimmed(60).min(1, "Choose an appointment type."),
  notes: optionalText(2000),
});
export const appointmentInputSchema = appointmentFields.extend({
  reminderOffsetsMinutes: reminderOffsets.default([1440, 60]),
});
export type AppointmentInput = z.infer<typeof appointmentInputSchema>;
// NOTE: no default here. A partial update (e.g. just {status}) must never
// silently reset the reminder offsets.
export const appointmentUpdateSchema = appointmentFields
  .partial()
  .extend({ reminderOffsetsMinutes: reminderOffsets.optional(), status: z.enum(APPOINTMENT_STATUSES).optional() });

// ---- Documents ----
export const MAX_DOCUMENT_BYTES = 4 * 1024 * 1024; // Vercel function body limit is 4.5MB
export const ALLOWED_DOCUMENT_TYPES = ["application/pdf", "image/jpeg", "image/png"] as const;
export const documentMetaSchema = z.object({
  title: trimmed(160).min(1, "Enter a title for the document."),
  category: z.enum(DOCUMENT_CATEGORIES),
  description: optionalText(1000),
  sharedWithPatient: z
    .union([z.boolean(), z.enum(["true", "false"]).transform((v) => v === "true")])
    .default(true),
});

// ---- Notification preferences ----
export const notificationPreferencesSchema = z.object({
  patientId: z.string().min(1),
  email: z.object({
    upcomingDose: z.boolean(),
    doseReminder: z.boolean(),
    doseFollowUp: z.boolean(),
    doseMissed: z.boolean(),
    appointment: z.boolean(),
  }),
  quietHours: z.object({
    enabled: z.boolean(),
    start: z.string().regex(TIME_RE),
    end: z.string().regex(TIME_RE),
    timezone: tzSchema,
  }),
});

// ---- Care tasks ----
const clientRequestId = z.string().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/);
export const taskCreateSchema = z.object({
  title: trimmed(140).min(1, "Give the task a short title."),
  description: optionalText(1000),
  assignedToUid: z.string().min(1).max(128).nullable().optional().transform((v) => v ?? null),
  /** Local date in the patient's timezone. Without a time, the task is due at the end of that day. */
  dueDate: dateSchema.nullable().optional().transform((v) => v ?? null),
  dueTime: z.string().regex(TIME_RE, "Use HH:MM, 24-hour.").nullable().optional().transform((v) => v ?? null),
  priority: z.enum(TASK_PRIORITIES).default("normal"),
  related: z.object({ type: z.enum(["appointment", "prescription", "document", "medication"]), id: z.string().min(1).max(64) }).nullable().optional().transform((v) => v ?? null),
  /** Makes a retry (double click, flaky network) create only one task. */
  clientRequestId: clientRequestId.optional(),
});
export type TaskCreateInput = z.infer<typeof taskCreateSchema>;

export const taskUpdateSchema = z.object({
  title: trimmed(140).min(1).optional(),
  description: optionalText(1000),
  dueDate: dateSchema.nullable().optional(),
  dueTime: z.string().regex(TIME_RE).nullable().optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
});
export const taskAssignSchema = z.object({ assignedToUid: z.string().min(1).max(128).nullable() });
export const taskStatusSchema = z.object({ status: z.enum(TASK_STATUSES) });
export const taskNoteSchema = z.object({ text: trimmed(500).min(1, "Write a note first.") });

// ---- Prescription reconciliation ----
export const reconciliationDecisionSchema = z.object({
  decision: z.enum(["confirmed_change", "confirmed_new", "unchanged", "needs_clarification", "rejected"]),
  note: optionalText(500),
  /** For confirmed_change: the exact fields the person chose to apply to the EXISTING medicine. */
  medicationPatch: z.unknown().optional(),
  /** For needs_clarification: also add a "ask the doctor" care task. */
  createTask: z.boolean().optional(),
});
export type ReconciliationDecisionInput = z.input<typeof reconciliationDecisionSchema>;
