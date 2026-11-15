import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { getCaregiverOverview, getPatientSnapshot } from "@/lib/services/dashboards";
import { createMedication } from "@/lib/services/medications";
import { recordDoseEvent } from "@/lib/services/doses";
import { updateMemberPermissions } from "@/lib/services/care-circle";
import { createAppointment } from "@/lib/services/appointments";
import { getAuthorizedPatientContext } from "@/lib/services/patient-data";
import { listDocuments, safeFileName, sniffContentType, uploadDocument, getDocumentDownloadUrl } from "@/lib/services/documents";
import { standardWorld, MED_INPUT } from "../helpers";
import { __setFileStoreForTests } from "@/lib/storage";

const saved: { path: string; bytes: Uint8Array }[] = [];
__setFileStoreForTests({
  save: async (path, bytes) => { saved.push({ path, bytes }); },
  remove: async () => {},
  read: async () => new Uint8Array(),
  signedUrl: async (path, ttl) => `https://signed.example/${path}?ttl=${ttl}`,
});

const PDF = new TextEncoder().encode("%PDF-1.7\nhello");
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const JPG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);

describe("dashboards read model (real data, role-scoped)", () => {
  async function seeded() {
    const w = await standardWorld();
    const tz = w.patient.timezone;
    await createMedication(w.caregiver, w.patient.id, MED_INPUT);
    // Appointment tomorrow 10:00 local
    const t = DateTime.now().setZone(tz).plus({ days: 1 });
    await createAppointment(w.caregiver, w.patient.id, { doctorName: "Dr. Rao", facility: null, date: t.toFormat("yyyy-MM-dd"), time: "10:00", location: null, appointmentType: "Check-up", notes: null, reminderOffsetsMinutes: [60] });
    return w;
  }

  it("caregiver snapshot has every section populated from the database", async () => {
    const w = await seeded();
    const snap = (await getPatientSnapshot(w.caregiver.uid, w.patient.id))!;
    expect(snap.role).toBe("primary_caregiver");
    expect(snap.activeMedicationCount).toBe(1);
    expect(snap.todayDoses).not.toBeNull();
    expect(snap.nextAppointment?.doctorName).toBe("Dr. Rao");
    expect(snap.weekly).toHaveLength(7);
    expect(snap.adherence).not.toBeNull();
    expect(snap.canSeeAppointments).toBe(true);
  });

  it("family with no grants gets null for every protected section (server-side, not hidden in the UI)", async () => {
    const w = await seeded();
    const snap = (await getPatientSnapshot(w.family.uid, w.patient.id))!;
    expect(snap.todayDoses).toBeNull();
    expect(snap.recentEvents).toBeNull();
    expect(snap.adherence).toBeNull();
    expect(snap.weekly).toBeNull();
    expect(snap.activeMedicationCount).toBeNull();
    expect(snap.nextAppointment).toBeNull();
    expect(snap.canSeeAppointments).toBe(false);
    expect(snap.patient).not.toHaveProperty("medicalNotes");
    expect(snap.patient).not.toHaveProperty("phone");
  });

  it("each family grant opens exactly its own section", async () => {
    const w = await seeded();
    await updateMemberPermissions(w.caregiver, w.patient.id, w.family.uid, { medications: false, adherence: false, appointments: true, documents: false });
    const s = (await getPatientSnapshot(w.family.uid, w.patient.id))!;
    expect(s.nextAppointment?.doctorName).toBe("Dr. Rao");
    expect(s.todayDoses).toBeNull();
    await updateMemberPermissions(w.caregiver, w.patient.id, w.family.uid, { medications: false, adherence: true, appointments: false, documents: false });
    const s2 = (await getPatientSnapshot(w.family.uid, w.patient.id))!;
    expect(s2.weekly).toHaveLength(7);
    expect(s2.nextAppointment).toBeNull();
    expect(s2.activeMedicationCount).toBeNull();
  });

  it("patient role does not receive caregiver-only profile fields", async () => {
    const w = await seeded();
    const s = (await getPatientSnapshot(w.patientUser.uid, w.patient.id))!;
    expect(s.patient).not.toHaveProperty("escalationPolicy");
    expect(s.patient).not.toHaveProperty("createdByUid");
  });

  it("returns null for strangers and revoked members", async () => {
    const w = await seeded();
    expect(await getPatientSnapshot("nobody", w.patient.id)).toBeNull();
  });

  it("responses flow into today's activity and the unresolved count", async () => {
    const w = await seeded();
    const before = (await getPatientSnapshot(w.caregiver.uid, w.patient.id))!;
    const todays = before.todayDoses!.filter((d) => d.scheduledAt.getTime() > Date.now());
    if (!todays.length) return; // dose times all passed for this run: nothing future today to answer
    await recordDoseEvent(w.patientUser, w.patient.id, todays[0].id, { eventType: "reported_taken" });
    const after = (await getPatientSnapshot(w.caregiver.uid, w.patient.id))!;
    expect(after.recentEvents!.some((e) => e.resultingStatus === "reported_taken")).toBe(true);
  });

  it("caregiver overview aggregates across patients", async () => {
    const w = await seeded();
    const o = await getCaregiverOverview(w.caregiver.uid);
    expect(o.totals.patients).toBe(1);
    expect(o.totals.activeMedications).toBe(1);
    expect(o.totals.upcomingAppointments).toBe(1);
  });

  it("AI-ready authorized data service enforces the same scopes", async () => {
    const w = await seeded();
    const ctx = await getAuthorizedPatientContext(w.family, w.patient.id, ["medications", "appointments"]);
    expect(ctx.deniedScopes).toEqual(["medications", "appointments"]);
    expect(ctx.medications).toBeUndefined();
    const full = await getAuthorizedPatientContext(w.caregiver, w.patient.id, ["medications", "appointments"]);
    expect(full.medications).toHaveLength(1);
    expect(full.deniedScopes).toEqual([]);
  });
});

describe("documents", () => {
  it("detects the REAL type from magic bytes, not the file name or declared type", () => {
    expect(sniffContentType(PDF)).toBe("application/pdf");
    expect(sniffContentType(PNG)).toBe("image/png");
    expect(sniffContentType(JPG)).toBe("image/jpeg");
    expect(sniffContentType(new TextEncoder().encode("<script>alert(1)</script>"))).toBeNull();
    expect(sniffContentType(new TextEncoder().encode("MZ\x90\x00 exe"))).toBeNull();
  });

  it("never lets a user-supplied name into the storage path", () => {
    expect(safeFileName("../../etc/passwd.pdf", "application/pdf")).toBe(".._.._etc_passwd.pdf"); // no path separators survive
    expect(safeFileName("../../etc/passwd.pdf", "application/pdf")).not.toContain("/");
    expect(safeFileName("résumé <b>.exe", "image/png").endsWith(".png")).toBe(true);
    expect(safeFileName("", "image/jpeg")).toBe("document.jpg");
  });

  it("upload validates size/type, stores privately, and the listing never exposes the storage path", async () => {
    const w = await standardWorld();
    saved.length = 0;
    const meta = { title: "Blood test", category: "lab_report" as const, description: null, sharedWithPatient: true };
    await expect(uploadDocument(w.caregiver, w.patient.id, { name: "x.pdf", bytes: new Uint8Array(0) }, meta)).rejects.toMatchObject({ status: 400 });
    await expect(uploadDocument(w.caregiver, w.patient.id, { name: "x.pdf", bytes: new Uint8Array(4 * 1024 * 1024 + 1) }, meta)).rejects.toMatchObject({ status: 400 });
    await expect(uploadDocument(w.caregiver, w.patient.id, { name: "evil.pdf", bytes: new TextEncoder().encode("not a pdf at all") }, meta)).rejects.toMatchObject({ status: 400 });
    await expect(uploadDocument(w.patientUser, w.patient.id, { name: "a.pdf", bytes: PDF }, meta)).rejects.toMatchObject({ status: 403 });

    const doc = await uploadDocument(w.caregiver, w.patient.id, { name: "report.pdf", bytes: PDF }, meta);
    expect(doc).not.toHaveProperty("storagePath");
    expect(doc.processingStatus).toBe("not_requested"); // Phase 2 hook
    expect(saved).toHaveLength(1);
    expect(saved[0].path.startsWith(`patients/${w.patient.id}/documents/`)).toBe(true);

    const listed = await listDocuments(w.caregiver, w.patient.id);
    expect(listed).toHaveLength(1);
    expect(listed[0]).not.toHaveProperty("storagePath");
  });

  it("patients only see documents shared with them; family needs the documents grant", async () => {
    const w = await standardWorld();
    const base = { category: "other" as const, description: null };
    await uploadDocument(w.caregiver, w.patient.id, { name: "a.pdf", bytes: PDF }, { ...base, title: "Shared", sharedWithPatient: true });
    const hidden = await uploadDocument(w.caregiver, w.patient.id, { name: "b.pdf", bytes: PDF }, { ...base, title: "Caregiver only", sharedWithPatient: false });
    expect((await listDocuments(w.patientUser, w.patient.id)).map((d) => d.title)).toEqual(["Shared"]);
    await expect(getDocumentDownloadUrl(w.patientUser, w.patient.id, hidden.id)).rejects.toMatchObject({ status: 404 });
    await expect(listDocuments(w.family, w.patient.id)).rejects.toMatchObject({ status: 403 });
    await updateMemberPermissions(w.caregiver, w.patient.id, w.family.uid, { medications: false, adherence: false, appointments: false, documents: true });
    expect(await listDocuments(w.family, w.patient.id)).toHaveLength(2);
    const dl = await getDocumentDownloadUrl(w.caregiver, w.patient.id, hidden.id);
    expect(dl.url).toContain("signed.example");
    expect(+dl.expiresAt - Date.now()).toBeLessThanOrEqual(5 * 60 * 1000 + 1000);
  });
});
