import { DateTime } from "luxon";
import { z } from "zod";
import type { Appointment, DoseStatus, MedicationStatus } from "./types";
import { describeSchedule } from "./schedule-text";
import { fmtDateShort, fmtDateTime } from "@/lib/format";

export const BRIEF_MAX_NOTES = 30;
export const BRIEF_MAX_TEXT = 500;
export const ACTIVITY_DAYS = 14;
export const RECENT_CHANGE_DAYS = 30;
export const RECENT_DOCUMENTS = 5;

export const SELF_REPORTED_LABEL = "Self-reported by the patient. Not verified.";
export const FOOTER_TEXT = "by Care Circle from the family's own records. Not a medical report. Activity shown is self-reported.";

/* ---------- note storage + actions ---------- */

export interface BriefQuestion { id: string; text: string; done: boolean; addedByUid: string; addedByName: string; addedAt: Date }
export interface BriefObservation { id: string; uid: string; name: string; text: string; at: Date }
export interface BriefNotes { questions: BriefQuestion[]; observations: BriefObservation[] }

const noteText = z.string({ error: "Enter some text." }).trim().min(1, "Enter some text.").max(BRIEF_MAX_TEXT, `Keep it to ${BRIEF_MAX_TEXT} characters or fewer.`);
const noteId = z.string().trim().min(1).max(100);

export const briefActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("addQuestion"), text: noteText }),
  z.object({ type: z.literal("toggleQuestion"), id: noteId }),
  z.object({ type: z.literal("removeQuestion"), id: noteId }),
  z.object({ type: z.literal("addObservation"), text: noteText }),
  z.object({ type: z.literal("removeObservation"), id: noteId }),
]);
export type BriefAction = z.infer<typeof briefActionSchema>;

/* ---------- builder ---------- */

export interface BriefInput {
  now: Date;
  timezone: string;
  patient: { fullName: string; dateOfBirth: string; preferredLanguage: string };
  appointment: Pick<Appointment, "startsAt" | "appointmentType" | "doctorName" | "facility" | "location">;
  /** null = the viewer may not see it. */
  medications: { id: string; name: string; strength: string | null; doseAmount: number; doseUnit: string; schedule: Parameters<typeof describeSchedule>[0]; startDate: string; endDate: string | null; status: MedicationStatus; version: number; createdAt: Date; updatedAt: Date }[] | null;
  /** Count of scanned prescriptions in review_required; null = the viewer may not see it. */
  awaitingVerification: number | null;
  doses: { id: string; medicationName: string; scheduledAt: Date; status: DoseStatus }[] | null;
  documents: { id: string; title: string; category: string; createdAt: Date }[] | null;
  notes: BriefNotes;
}

export interface BriefMedication { name: string; strength: string; dose: string; schedule: string; start: string; end: string; onHold: boolean }
export interface BriefDoseLine { medicationName: string; when: string; outcome: "Reported skipped" | "Not sure" | "No report yet" }

export interface DoctorBrief {
  generatedAt: Date;
  generatedText: string;
  timezone: string;
  title: string;
  overview: { fullName: string; age: string; language: string; when: string; type: string; doctor: string; facility: string; location: string };
  medications: null | {
    current: BriefMedication[];
    recentChanges: { name: string; kind: "Recently added" | "Changed"; on: string }[];
    awaitingVerification: number | null;
  };
  activity: null | {
    label: string;
    days: number;
    reportedTaken: number;
    reportedSkipped: number;
    notSure: number;
    noReport: number;
    lines: BriefDoseLine[];
  };
  documents: null | { items: { title: string; category: string; added: string }[]; note: string };
  observations: (BriefObservation & { label: string; when: string })[];
  questions: BriefQuestion[];
  /** Section names the viewer cannot see, listed so the reader knows what is missing. */
  omitted: string[];
}

export function ageFrom(dateOfBirth: string, now: Date, tz: string): string {
  const dob = DateTime.fromISO(dateOfBirth, { zone: tz });
  if (!dob.isValid) return "Not recorded";
  const years = Math.floor(DateTime.fromJSDate(now, { zone: tz }).diff(dob, "years").years);
  return years >= 0 ? `${years} years` : "Not recorded";
}

export const CATEGORY_LABEL = (c: string) => c.replace(/_/g, " ").replace(/^./, (s) => s.toUpperCase());

export function buildDoctorBrief(input: BriefInput): DoctorBrief {
  const { now, timezone: tz, patient, appointment: a } = input;
  const dash = "Not recorded";
  const omitted: string[] = [];

  let medications: DoctorBrief["medications"] = null;
  if (input.medications) {
    const cutoff = now.getTime() - RECENT_CHANGE_DAYS * 86400_000;
    const live = input.medications.filter((m) => m.status === "active" || m.status === "on_hold");
    medications = {
      current: live.map((m) => ({
        name: m.name,
        strength: m.strength ?? dash,
        dose: `${m.doseAmount} ${m.doseUnit}`,
        schedule: describeSchedule(m.schedule) || dash,
        start: m.startDate ? fmtDateShort(DateTime.fromISO(m.startDate, { zone: tz }).toJSDate(), tz) : dash,
        end: m.endDate ? fmtDateShort(DateTime.fromISO(m.endDate, { zone: tz }).toJSDate(), tz) : "No end date",
        onHold: m.status === "on_hold",
      })),
      recentChanges: live
        .filter((m) => m.version > 1 || m.updatedAt.getTime() >= cutoff)
        .map((m) => ({
          name: m.name,
          kind: m.version <= 1 && m.createdAt.getTime() >= cutoff ? ("Recently added" as const) : ("Changed" as const),
          on: fmtDateShort(m.updatedAt, tz),
        })),
      awaitingVerification: input.awaitingVerification,
    };
    if (input.awaitingVerification === null) omitted.push("Scanned prescriptions awaiting verification");
  } else {
    omitted.push("Current medications");
  }

  let activity: DoctorBrief["activity"] = null;
  if (input.doses) {
    const from = now.getTime() - ACTIVITY_DAYS * 86400_000;
    const past = input.doses.filter((d) => d.scheduledAt.getTime() >= from && d.scheduledAt.getTime() <= now.getTime() && d.status !== "cancelled");
    const outcome = (s: DoseStatus): BriefDoseLine["outcome"] | "taken" =>
      s === "reported_taken" ? "taken" : s === "reported_skipped" ? "Reported skipped" : s === "unknown" ? "Not sure" : "No report yet";
    const lines: BriefDoseLine[] = [];
    const counts = { taken: 0, skipped: 0, notSure: 0, none: 0 };
    for (const d of [...past].sort((x, y) => +x.scheduledAt - +y.scheduledAt)) {
      const o = outcome(d.status);
      if (o === "taken") { counts.taken++; continue; }
      if (o === "Reported skipped") counts.skipped++;
      else if (o === "Not sure") counts.notSure++;
      else counts.none++;
      lines.push({ medicationName: d.medicationName, when: fmtDateTime(d.scheduledAt, tz), outcome: o });
    }
    activity = { label: SELF_REPORTED_LABEL, days: ACTIVITY_DAYS, reportedTaken: counts.taken, reportedSkipped: counts.skipped, notSure: counts.notSure, noReport: counts.none, lines };
  } else {
    omitted.push("Medication activity");
  }

  let documents: DoctorBrief["documents"] = null;
  if (input.documents) {
    documents = {
      items: [...input.documents].sort((x, y) => +y.createdAt - +x.createdAt).slice(0, RECENT_DOCUMENTS).map((d) => ({ title: d.title, category: CATEGORY_LABEL(d.category), added: fmtDateShort(d.createdAt, tz) })),
      note: "Document names only. AI summaries are not part of this brief.",
    };
  } else {
    omitted.push("Recent health documents");
  }

  return {
    generatedAt: now,
    generatedText: fmtDateTime(now, tz),
    timezone: tz,
    title: `Doctor brief for ${patient.fullName}: ${a.appointmentType} with ${a.doctorName}, ${fmtDateTime(a.startsAt, tz)}`,
    overview: {
      fullName: patient.fullName,
      age: ageFrom(patient.dateOfBirth, now, tz),
      language: patient.preferredLanguage || dash,
      when: fmtDateTime(a.startsAt, tz),
      type: a.appointmentType,
      doctor: a.doctorName,
      facility: a.facility ?? dash,
      location: a.location ?? dash,
    },
    medications,
    activity,
    documents,
    observations: [...input.notes.observations]
      .sort((x, y) => +y.at - +x.at)
      .map((o) => ({ ...o, label: "Family-reported observation", when: fmtDateShort(o.at, tz) })),
    questions: input.notes.questions,
    omitted,
  };
}
