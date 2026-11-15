/**
 * Core domain types. Dates in these types are plain JS `Date` (UTC instants);
 * the Firestore layer converts to/from Firestore `Timestamp` at the boundary.
 */

export const ROLES = ["patient", "primary_caregiver", "family"] as const;
export type Role = (typeof ROLES)[number];

/** Categories of information a family member can be granted. */
export const SHARE_CATEGORIES = [
  "medications",
  "adherence",
  "appointments",
  "documents",
  /** Can see shared care tasks and handovers, and update tasks assigned to them. */
  "tasks",
  /** Can create/assign tasks and prepare handovers (a "secondary caregiver"). */
  "manageCare",
] as const;
export type ShareCategory = (typeof SHARE_CATEGORIES)[number];
/** `tasks` and `manageCare` are optional: members saved before they existed lack them (treated as off). */
export type SharePermissions = Record<Exclude<ShareCategory, "tasks" | "manageCare">, boolean> & Partial<Record<"tasks" | "manageCare", boolean>>;

export type MembershipStatus = "active" | "revoked";

export interface Membership {
  uid: string;
  patientId: string;
  role: Role;
  /** Only meaningful for `family`; patient/caregiver roles are fixed by role. */
  permissions: SharePermissions;
  status: MembershipStatus;
  displayName: string;
  email: string;
  invitedByUid: string | null;
  createdAt: Date;
  updatedAt: Date;
  revokedAt?: Date | null;
}

export const DOSE_STATUSES = [
  "scheduled",
  "notified",
  "acknowledged",
  "reported_taken",
  "reported_skipped",
  "snoozed",
  "missed_by_policy",
  "unknown",
  "cancelled",
] as const;
export type DoseStatus = (typeof DOSE_STATUSES)[number];

export const MEDICATION_STATUSES = [
  "draft",
  "active",
  "on_hold",
  "completed",
  "discontinued",
] as const;
export type MedicationStatus = (typeof MEDICATION_STATUSES)[number];

export const FREQUENCIES = ["daily", "weekly", "every_n_days"] as const;
export type Frequency = (typeof FREQUENCIES)[number];

export interface MedicationSchedule {
  frequency: Frequency;
  /** Local wall-clock times in the patient's timezone, "HH:mm" 24h. */
  times: string[];
  /** For `weekly`: ISO weekdays, 1 = Monday ... 7 = Sunday. */
  daysOfWeek?: number[];
  /** For `every_n_days`: interval, anchored at startDate. */
  intervalDays?: number;
}

export const VERIFICATION_STATUSES = [
  "unverified",
  "pending_review",
  "verified",
] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export interface Medication {
  id: string;
  patientId: string;
  name: string;
  activeIngredient: string | null;
  strength: string | null;
  doseAmount: number;
  doseUnit: string;
  form: string;
  route: string;
  schedule: MedicationSchedule;
  /** Local calendar dates "YYYY-MM-DD" in the patient's timezone. */
  startDate: string;
  endDate: string | null;
  prescriber: string | null;
  instructions: string | null;
  status: MedicationStatus;
  /** Phase 2 hooks: set when a medication originates from a scanned document. */
  sourceDocumentId: string | null;
  verificationStatus: VerificationStatus;
  verifiedByUid: string | null;
  verifiedAt: Date | null;
  createdByUid: string;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

export interface DoseOccurrence {
  id: string;
  patientId: string;
  medicationId: string;
  /** Denormalized snapshot so patient screens never need a join. */
  medicationName: string;
  doseText: string;
  instructions: string | null;
  scheduledAt: Date;
  timezone: string;
  status: DoseStatus;
  gracePeriodMinutes: number;
  notifiedAt: Date | null;
  respondedAt: Date | null;
  snoozedUntil: Date | null;
  /** Stages already generated, so the worker is idempotent. */
  createdAt: Date;
  updatedAt: Date;
}

export const DOSE_EVENT_TYPES = [
  "notified",
  "acknowledged",
  "reported_taken",
  "reported_skipped",
  "snoozed",
  "reported_unsure",
  "missed_by_policy",
  "cancelled",
  "reinstated",
] as const;
export type DoseEventType = (typeof DOSE_EVENT_TYPES)[number];

export type DoseEventSource = "patient_ui" | "caregiver_ui" | "system";

export interface DoseEvent {
  id: string;
  patientId: string;
  doseOccurrenceId: string;
  eventType: DoseEventType;
  /** null for system-generated events. */
  userId: string | null;
  source: DoseEventSource;
  note: string | null;
  occurredAt: Date;
  recordedAt: Date;
  /** Client-generated id lets offline clients retry without duplicating. */
  clientEventId: string | null;
  snoozeMinutes?: number | null;
  previousStatus: DoseStatus;
  resultingStatus: DoseStatus;
}

export const APPOINTMENT_STATUSES = ["scheduled", "completed", "cancelled"] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export interface Appointment {
  id: string;
  patientId: string;
  doctorName: string;
  facility: string | null;
  startsAt: Date;
  timezone: string;
  location: string | null;
  appointmentType: string;
  notes: string | null;
  /** Minutes before startsAt at which reminders are generated. */
  reminderOffsetsMinutes: number[];
  status: AppointmentStatus;
  createdByUid: string;
  createdAt: Date;
  updatedAt: Date;
}

export const DOCUMENT_CATEGORIES = [
  "prescription",
  "lab_report",
  "medical_certificate",
  "discharge_summary",
  "other",
] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

/** Phase 2 (Gemini) hook; Phase 1 only ever writes `not_requested`. */
export const PROCESSING_STATUSES = [
  "not_requested",
  "queued",
  "processing",
  "completed",
  "failed",
] as const;
export type ProcessingStatus = (typeof PROCESSING_STATUSES)[number];

export interface HealthDocument {
  id: string;
  patientId: string;
  title: string;
  category: DocumentCategory;
  description: string | null;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  storagePath: string;
  uploadedByUid: string;
  uploadedByName: string;
  sharedWithPatient: boolean;
  processingStatus: ProcessingStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface EscalationPolicy {
  /** Minutes before the dose to send a heads-up (0 disables). */
  upcomingLeadMinutes: number;
  /** Minutes after the dose to send a follow-up if still unresolved. */
  followUpAfterMinutes: number;
  /** Minutes after the dose to mark missed-by-policy and notify caregivers. */
  escalateAfterMinutes: number;
}

export const DEFAULT_ESCALATION_POLICY: EscalationPolicy = {
  upcomingLeadMinutes: 10,
  followUpAfterMinutes: 15,
  escalateAfterMinutes: 45,
};

export interface Patient {
  id: string;
  fullName: string;
  photoPath: string | null;
  dateOfBirth: string;
  gender: string | null;
  phone: string | null;
  email: string | null;
  preferredLanguage: string;
  timezone: string;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  medicalNotes: string | null;
  escalationPolicy: EscalationPolicy;
  createdByUid: string;
  createdAt: Date;
  updatedAt: Date;
}

export type NotificationType =
  | "upcoming_dose"
  | "dose_reminder"
  | "dose_follow_up"
  | "dose_missed"
  | "appointment_upcoming"
  | "appointment_reminder"
  | "care_circle_invitation"
  | "task_assigned"
  | "task_reassigned"
  | "handover_shared";

export type NotificationChannel = "in_app" | "email" | "push";
export type DeliveryStatus =
  | "pending"
  | "sending"
  | "sent"
  | "failed"
  | "skipped";

export interface Delivery {
  channel: NotificationChannel;
  status: DeliveryStatus;
  attempts: number;
  providerMessageId: string | null;
  lastError: string | null;
  lastAttemptAt: Date | null;
  sentAt: Date | null;
  /** Quiet hours: do not send before this instant. */
  deliverAfter: Date | null;
  /** Lease for the in-flight attempt, so two workers never double-send. */
  leaseUntil: Date | null;
  skipReason: string | null;
}

export interface AppNotification {
  /** Deterministic id doubles as the idempotency key. */
  id: string;
  patientId: string;
  recipientUid: string;
  type: NotificationType;
  title: string;
  body: string;
  /** Resource the notification is about (occurrenceId / appointmentId). */
  resourceId: string | null;
  stage: string;
  scheduledFor: Date;
  readAt: Date | null;
  /** Patient acknowledgement is tracked on the dose, never here. */
  deliveries: Record<NotificationChannel, Delivery | null>;
  createdAt: Date;
}

export interface QuietHours {
  enabled: boolean;
  /** "HH:mm" local, in `timezone`. May wrap past midnight (22:00-07:00). */
  start: string;
  end: string;
  timezone: string;
}

export interface EmailPreferences {
  upcomingDose: boolean;
  doseReminder: boolean;
  doseFollowUp: boolean;
  doseMissed: boolean;
  appointment: boolean;
}

export interface NotificationPreferences {
  uid: string;
  patientId: string;
  email: EmailPreferences;
  quietHours: QuietHours;
  updatedAt: Date;
}

// ---- Care coordination ----
export const TASK_STATUSES = ["pending", "accepted", "in_progress", "completed", "cancelled", "needs_attention"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const TASK_PRIORITIES = ["low", "normal", "high"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];
export const OPEN_TASK_STATUSES: readonly TaskStatus[] = ["pending", "accepted", "in_progress", "needs_attention"];

export interface TaskNote {
  id: string;
  uid: string;
  name: string;
  text: string;
  at: Date;
}

export interface CareTask {
  id: string;
  patientId: string;
  title: string;
  description: string | null;
  assignedToUid: string | null;
  assignedToName: string | null;
  createdByUid: string;
  createdByName: string;
  dueAt: Date | null;
  priority: TaskPriority;
  status: TaskStatus;
  notes: TaskNote[];
  /** Optional link to what this task is about (e.g. an appointment or prescription scan). */
  related: { type: "appointment" | "prescription" | "document" | "medication"; id: string } | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  completedByUid: string | null;
}

export interface CareActivityEvent {
  id: string;
  patientId: string;
  /** Which permission gates who may read this event. */
  category: "task" | "handover";
  type: string;
  actorUid: string | null;
  actorName: string;
  summary: string;
  resourceType: string;
  resourceId: string;
  at: Date;
  /** Monotonic ordering key (events can share a millisecond). */
  seq?: number;
}
