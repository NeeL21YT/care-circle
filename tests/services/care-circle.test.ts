import { describe, expect, it } from "vitest";
import { createInvitation, acceptInvitation, listMembers, revokeMember, updateMemberPermissions, INVITE_TTL_MS } from "@/lib/services/care-circle";
import { createMedication, listMedications } from "@/lib/services/medications";
import { listAppointments, createAppointment } from "@/lib/services/appointments";
import { listDoses } from "@/lib/services/doses";
import { listDocuments } from "@/lib/services/documents";
import { createPatient } from "@/lib/services/patients";
import { ForbiddenError } from "@/lib/domain/permissions";
import { HttpError } from "@/lib/api/errors";
import { addMember, freshWorld, lastInviteToken, makeUser, MED_INPUT, PATIENT_INPUT, sentEmails, standardWorld } from "../helpers";

describe("invitations", () => {
  it("emails a single-use link and only the invited, verified account can accept", async () => {
    const fake = freshWorld();
    const cg = makeUser(fake, "cg", "caregiver");
    const p = await createPatient(cg, PATIENT_INPUT);
    await createInvitation(cg, p.id, { email: "Sam@Example.com", role: "family" });
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].to).toBe("sam@example.com");
    const token = lastInviteToken();

    // A different logged-in account holding the link: denied.
    const stranger = makeUser(fake, "stranger", "family", { email: "evil@example.com" });
    await expect(acceptInvitation(stranger, token)).rejects.toBeInstanceOf(ForbiddenError);
    // Right email but not verified: denied.
    const unverified = makeUser(fake, "sam", "family", { email: "sam@example.com", verified: false });
    await expect(acceptInvitation(unverified, token)).rejects.toBeInstanceOf(ForbiddenError);
    // Right email, verified: ok.
    const sam = makeUser(fake, "sam", "family", { email: "sam@example.com" });
    await expect(acceptInvitation(sam, token)).resolves.toMatchObject({ patientId: p.id, role: "family" });
    // Single use.
    await expect(acceptInvitation(sam, token)).rejects.toMatchObject({ status: 409 });
  });

  it("stores only a hash of the token, never the token itself", async () => {
    const fake = freshWorld();
    const cg = makeUser(fake, "cg", "caregiver");
    const p = await createPatient(cg, PATIENT_INPUT);
    await createInvitation(cg, p.id, { email: "a@b.co", role: "family" });
    const token = lastInviteToken();
    const keys = [...fake.docs.keys()].filter((k) => k.startsWith("invitations/"));
    expect(keys).toHaveLength(1);
    expect(keys[0]).not.toContain(token);
    expect(JSON.stringify([...fake.docs.values()])).not.toContain(token);
  });

  it("expired invitations cannot be accepted", async () => {
    const fake = freshWorld();
    const cg = makeUser(fake, "cg", "caregiver");
    const p = await createPatient(cg, PATIENT_INPUT);
    await createInvitation(cg, p.id, { email: "late@example.com", role: "family" });
    const token = lastInviteToken();
    const key = [...fake.docs.keys()].find((k) => k.startsWith("invitations/"))!;
    const doc = fake.docs.get(key)!;
    doc.expiresAt = new Date(Date.now() - 1000);
    expect(INVITE_TTL_MS).toBe(7 * 24 * 3600_000);
    const late = makeUser(fake, "late", "family", { email: "late@example.com" });
    await expect(acceptInvitation(late, token)).rejects.toMatchObject({ status: 409 });
  });

  it("only primary caregivers can invite", async () => {
    const { patientUser, family, patient } = await standardWorld();
    await expect(createInvitation(patientUser, patient.id, { email: "x@y.co", role: "family" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createInvitation(family, patient.id, { email: "x@y.co", role: "family" })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("knowing a patient's email grants nothing", async () => {
    const fake = freshWorld();
    const cg = makeUser(fake, "cg", "caregiver");
    const p = await createPatient(cg, { ...PATIENT_INPUT, email: "patient@example.com" });
    const attacker = makeUser(fake, "att", "family", { email: "patient@example.com" });
    await expect(listMedications(attacker, p.id)).rejects.toMatchObject({ status: 404 });
  });
});

describe("role enforcement in services", () => {
  it("patient: can read schedule, cannot edit medications or appointments", async () => {
    const { caregiver, patientUser, patient } = await standardWorld();
    await createMedication(caregiver, patient.id, MED_INPUT);
    expect(await listMedications(patientUser, patient.id)).toHaveLength(1);
    await expect(createMedication(patientUser, patient.id, MED_INPUT)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createAppointment(patientUser, patient.id, { doctorName: "D", facility: null, date: "2027-01-01", time: "10:00", location: null, appointmentType: "Checkup", notes: null, reminderOffsetsMinutes: [60] })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("family with no grants sees nothing; each grant opens exactly one category", async () => {
    const { fake, caregiver, patient, family } = await standardWorld();
    await createMedication(caregiver, patient.id, MED_INPUT);
    await expect(listMedications(family, patient.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listAppointments(family, patient.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listDocuments(family, patient.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listDoses(family, patient.id, {})).rejects.toBeInstanceOf(ForbiddenError);

    await updateMemberPermissions(caregiver, patient.id, family.uid, { medications: false, adherence: false, appointments: true, documents: false });
    expect(await listAppointments(family, patient.id)).toEqual([]);
    await expect(listMedications(family, patient.id)).rejects.toBeInstanceOf(ForbiddenError);
    void fake;
  });

  it("family with only the medication grant never sees past doses or responses", async () => {
    const { caregiver, patient, family } = await standardWorld();
    await createMedication(caregiver, patient.id, MED_INPUT);
    await updateMemberPermissions(caregiver, patient.id, family.uid, { medications: true, adherence: false, appointments: false, documents: false });
    const doses = await listDoses(family, patient.id, { from: new Date(Date.now() - 7 * 86400_000), to: new Date(Date.now() + 3 * 86400_000) });
    expect(doses.length).toBeGreaterThan(0);
    expect(doses.every((d) => d.scheduledAt.getTime() >= Date.now() - 1000)).toBe(true);
    expect(doses.every((d) => d.status === "scheduled")).toBe(true);
  });

  it("members list hides emails/permissions from non-caregivers", async () => {
    const { caregiver, patientUser, patient } = await standardWorld();
    const forCaregiver = await listMembers(caregiver, patient.id);
    expect(forCaregiver.every((m) => "email" in m)).toBe(true);
    const forPatient = await listMembers(patientUser, patient.id);
    expect(forPatient.some((m) => "email" in m || "permissions" in m)).toBe(false);
  });
});

describe("revocation", () => {
  it("revoked members immediately lose all access", async () => {
    const { caregiver, patient, family } = await standardWorld();
    await updateMemberPermissions(caregiver, patient.id, family.uid, { medications: true, adherence: true, appointments: true, documents: true });
    expect(await listAppointments(family, patient.id)).toEqual([]);
    await revokeMember(caregiver, patient.id, family.uid);
    await expect(listAppointments(family, patient.id)).rejects.toMatchObject({ status: 404 });
    await expect(listMedications(family, patient.id)).rejects.toBeInstanceOf(HttpError);
  });

  it("the last primary caregiver cannot be removed; a second one can be", async () => {
    const { fake, caregiver, patient } = await standardWorld();
    await expect(revokeMember(caregiver, patient.id, caregiver.uid)).rejects.toMatchObject({ status: 409 });
    const second = makeUser(fake, "cg2", "caregiver");
    await createInvitation(caregiver, patient.id, { email: second.email, role: "primary_caregiver" });
    await acceptInvitation(second, lastInviteToken());
    await revokeMember(second, patient.id, caregiver.uid);
    await expect(listMedications(caregiver, patient.id)).rejects.toMatchObject({ status: 404 });
  });

  it("a revoked member can be re-invited", async () => {
    const { caregiver, patient, family, fake } = await standardWorld();
    await revokeMember(caregiver, patient.id, family.uid);
    await createInvitation(caregiver, patient.id, { email: family.email, role: "family" });
    await acceptInvitation(makeUser(fake, family.uid, "family"), lastInviteToken());
    const m = await listMembers(caregiver, patient.id);
    expect(m.map((x) => x.uid)).toContain(family.uid);
  });
});

void addMember;
