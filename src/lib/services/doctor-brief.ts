import "server-only";
import { randomUUID } from "node:crypto";
import { col, db, fromData, fromSnap, toData } from "@/lib/db";
import { conflict, notFound } from "@/lib/api/errors";
import { requirePatientAccess } from "@/lib/auth/access";
import type { CurrentUser } from "@/lib/auth/session";
import { can, ForbiddenError } from "@/lib/domain/permissions";
import { BRIEF_MAX_NOTES, buildDoctorBrief, type BriefAction, type BriefNotes } from "@/lib/domain/doctor-brief";
import type { Appointment } from "@/lib/domain/types";
import { audit } from "./audit";
import { listDocuments } from "./documents";
import { listDoses } from "./doses";
import { listMedications } from "./medications";
import { listExtractions } from "./prescriptions";

const briefs = (patientId: string) => col.sub(patientId, "doctorBriefs");

async function loadAppointment(patientId: string, appointmentId: string) {
  const appt = fromSnap<Appointment>(await col.sub(patientId, "appointments").doc(appointmentId).get());
  if (!appt) throw notFound("That appointment");
  return appt;
}

async function readNotes(patientId: string, appointmentId: string): Promise<BriefNotes> {
  const snap = await briefs(patientId).doc(appointmentId).get();
  if (!snap.exists) return { questions: [], observations: [] };
  const d = fromData<Partial<BriefNotes>>(snap.data());
  return { questions: d.questions ?? [], observations: d.observations ?? [] };
}

export async function getDoctorBrief(user: CurrentUser, patientId: string, appointmentId: string) {
  const { patient, membership } = await requirePatientAccess(user.uid, patientId, "appointments:read");
  const appointment = await loadAppointment(patientId, appointmentId);
  const now = new Date();
  const [medications, awaiting, doses, documents, notes] = await Promise.all([
    can(membership, "medications:read") ? listMedications(user, patientId) : null,
    can(membership, "medications:read") && can(membership, "medications:write") ? listExtractions(user, patientId) : null,
    can(membership, "doses:viewHistory") ? listDoses(user, patientId, { from: new Date(now.getTime() - 14 * 86400_000), to: now, limit: 500 }) : null,
    can(membership, "documents:read") ? listDocuments(user, patientId) : null,
    readNotes(patientId, appointmentId),
  ]);
  const brief = buildDoctorBrief({
    now, timezone: patient.timezone, patient, appointment, medications,
    awaitingVerification: awaiting ? awaiting.filter((p) => p.status === "review_required").length : null,
    doses, documents, notes,
  });
  return {
    brief,
    canEdit: can(membership, "tasks:write"),
    canRemoveAnyObservation: membership.role === "primary_caregiver",
    currentUid: user.uid,
  };
}

/** Read-modify-write inside a transaction so concurrent edits never lose each other. */
export async function updateBrief(user: CurrentUser, patientId: string, appointmentId: string, action: BriefAction) {
  const { membership } = await requirePatientAccess(user.uid, patientId, "appointments:read");
  await loadAppointment(patientId, appointmentId);
  const removesObservation = action.type === "removeObservation";
  if (!removesObservation && !can(membership, "tasks:write")) throw new ForbiddenError("Only a caregiver who manages care can change the doctor brief notes.");

  const ref = briefs(patientId).doc(appointmentId);
  const now = new Date();
  const notes = await db().runTransaction(async (tx) => {
    const t = tx as { get(r: unknown): Promise<{ exists: boolean; data(): unknown }>; set(r: unknown, d: unknown): void };
    const snap = await t.get(ref);
    const cur: BriefNotes = snap.exists ? { questions: [], observations: [], ...fromData<Partial<BriefNotes>>(snap.data()) } : { questions: [], observations: [] };
    let { questions, observations } = cur;
    switch (action.type) {
      case "addQuestion":
        if (questions.length >= BRIEF_MAX_NOTES) throw conflict(`A brief can hold up to ${BRIEF_MAX_NOTES} questions. Remove one first.`);
        questions = [...questions, { id: randomUUID(), text: action.text, done: false, addedByUid: user.uid, addedByName: user.displayName, addedAt: now }];
        break;
      case "toggleQuestion": {
        if (!questions.some((q) => q.id === action.id)) throw notFound("That question");
        questions = questions.map((q) => (q.id === action.id ? { ...q, done: !q.done } : q));
        break;
      }
      case "removeQuestion":
        if (!questions.some((q) => q.id === action.id)) throw notFound("That question");
        questions = questions.filter((q) => q.id !== action.id);
        break;
      case "addObservation":
        if (observations.length >= BRIEF_MAX_NOTES) throw conflict(`A brief can hold up to ${BRIEF_MAX_NOTES} observations. Remove one first.`);
        observations = [...observations, { id: randomUUID(), uid: user.uid, name: user.displayName, text: action.text, at: now }];
        break;
      case "removeObservation": {
        const o = observations.find((x) => x.id === action.id);
        if (!o) throw notFound("That observation");
        if (o.uid !== user.uid && membership.role !== "primary_caregiver") throw new ForbiddenError("Only the person who wrote this observation, or a primary caregiver, can remove it.");
        observations = observations.filter((x) => x.id !== action.id);
        break;
      }
    }
    t.set(ref, toData({ questions, observations, updatedAt: now } as { id?: string } & BriefNotes & { updatedAt: Date }));
    return { questions, observations };
  });
  await audit(patientId, user.uid, "brief.update", { type: "doctorBrief", id: appointmentId }, { action: action.type });
  return notes;
}
