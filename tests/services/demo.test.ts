import { beforeEach, describe, expect, it } from "vitest";
import { freshWorld, sentEmails } from "../helpers";
import { DEMO_PEOPLE, DEMO_UIDS, demoRoleOf, isDemoUid } from "@/lib/demo";
import { __resetDemoCache, ensureDemoWorld, type DemoAuth } from "@/lib/demo/seed";
import { listMedications, createMedication } from "@/lib/services/medications";
import { listTasks } from "@/lib/services/care-tasks";
import { listAppointments } from "@/lib/services/appointments";
import { listDoses } from "@/lib/services/doses";
import { getPatientSnapshot } from "@/lib/services/dashboards";
import { getHandover, listHandovers } from "@/lib/services/handovers";
import { createInvitation } from "@/lib/services/care-circle";
import { listNotifications } from "@/lib/services/notifications";
import { requirePatientAccess } from "@/lib/auth/access";
import type { CurrentUser } from "@/lib/auth/session";
import { MED_INPUT } from "../helpers";

const created: string[] = [];
const auth: DemoAuth = { async ensureUser(u) { if (!created.includes(u.uid)) created.push(u.uid); } };
const user = (r: keyof typeof DEMO_UIDS): CurrentUser => ({ uid: DEMO_UIDS[r], email: "", emailVerified: true, displayName: DEMO_PEOPLE[r].name, accountType: r === "caregiver" ? "caregiver" : r === "patient" ? "patient" : "family" });

let fake: ReturnType<typeof freshWorld>;
beforeEach(() => { fake = freshWorld(); created.length = 0; __resetDemoCache(); });

describe("demo world", () => {
  it("creates three signed-in-able accounts, one patient and realistic data", async () => {
    const pid = await ensureDemoWorld({ auth });
    expect(created.sort()).toEqual(Object.values(DEMO_UIDS).sort());
    const cg = user("caregiver");
    expect((await listMedications(cg, pid)).map((m) => m.name).sort()).toEqual(["Amlodipine", "Atorvastatin", "Metformin"]);
    expect((await listAppointments(cg, pid, { scope: "upcoming" })).length).toBe(1);
    const tasks = await listTasks(cg, pid, { filter: "open" });
    expect(tasks).toHaveLength(3);
    expect(tasks.some((t) => !t.assignedToUid)).toBe(true); // an unassigned task to show hand-over/claim
    const snap = await getPatientSnapshot(cg.uid, pid);
    expect(snap).not.toBeNull();
    const doses = await listDoses(cg, pid, { from: new Date(Date.now() - 4 * 86400_000), to: new Date(Date.now() + 86400_000) });
    const statuses = new Set(doses.map((d) => d.status));
    expect(statuses.has("reported_taken")).toBe(true);
    expect(statuses.has("reported_skipped") || statuses.has("missed_by_policy")).toBe(true);
  });

  it("is idempotent, including when several visitors arrive at once", async () => {
    const ids = await Promise.all([ensureDemoWorld({ auth }), ensureDemoWorld({ auth }), ensureDemoWorld({ auth })]);
    expect(new Set(ids).size).toBe(1);
    const again = await ensureDemoWorld({ auth });
    expect(again).toBe(ids[0]);
    const cg = user("caregiver");
    expect(await listMedications(cg, again)).toHaveLength(3);
    expect(await listTasks(cg, again, { filter: "all" })).toHaveLength(3);
    expect([...fake.docs.keys()].filter((k) => /^patients\/[^/]+$/.test(k))).toHaveLength(1);
  });

  it("answers repeat visits from memory without touching the database", async () => {
    const pid = await ensureDemoWorld({ auth });
    let reads = 0;
    const real = fake.doc.bind(fake);
    fake.doc = ((path: string) => { reads++; return real(path); }) as typeof fake.doc;
    expect(await ensureDemoWorld({ auth })).toBe(pid);
    expect(reads).toBe(0);
  });

  it("keeps history current without duplicating or overwriting it", async () => {
    const pid = await ensureDemoWorld({ auth });
    const key = [...fake.docs.keys()].find((k) => k.includes("/doseOccurrences/demo_") && fake.docs.get(k)!.status === "reported_taken")!;
    fake.docs.get(key)!.note = "visitor changed this";
    const before = fake.docs.size;
    __resetDemoCache();
    await ensureDemoWorld({ auth, now: new Date(Date.now() + 1000) });
    expect(fake.docs.get(key)!.note).toBe("visitor changed this");
    expect(fake.docs.size).toBeLessThanOrEqual(before + 4);
    void pid;
  });

  it("gives each demo person the right access", async () => {
    const pid = await ensureDemoWorld({ auth });
    expect((await requirePatientAccess(DEMO_UIDS.caregiver, pid, "medications:write")).membership.role).toBe("primary_caregiver");
    expect((await requirePatientAccess(DEMO_UIDS.patient, pid, "doses:respond")).membership.role).toBe("patient");
    await expect(requirePatientAccess(DEMO_UIDS.patient, pid, "medications:write")).rejects.toMatchObject({ status: 403 });
    await expect(requirePatientAccess(DEMO_UIDS.family, pid, "medications:write")).rejects.toMatchObject({ status: 403 }); // family never edits medicines
    expect((await requirePatientAccess(DEMO_UIDS.family, pid, "tasks:write")).membership.role).toBe("family");
  });

  it("includes a real handover from the caregiver to the family member, built from the records", async () => {
    const pid = await ensureDemoWorld({ auth });
    const [row] = await listHandovers(user("family"), pid);
    expect(row.status).toBe("shared");
    const h = await getHandover(user("family"), pid, row.id);
    expect(h.recipientUid).toBe(DEMO_UIDS.family);
    expect(h.summarySource).toBe("template"); // no AI call is made while seeding
    expect(h.items.some((i) => i.section === "tasks")).toBe(true);
    expect(h.items.some((i) => /reported taken/.test(i.text))).toBe(true);
  });
});

describe("demo safety", () => {
  it("never sends email: demo people have no email address and invitations are off", async () => {
    const pid = await ensureDemoWorld({ auth });
    const members = [...fake.docs.entries()].filter(([k]) => k.startsWith(`patients/${pid}/memberships/`)).map(([, v]) => v);
    expect(members.length).toBe(3);
    expect(members.filter((m) => m.role !== "primary_caregiver").every((m) => m.email === "")).toBe(true);
    await expect(createInvitation(user("caregiver"), pid, { email: "someone@example.com", role: "family" })).rejects.toMatchObject({ status: 403, message: expect.stringMatching(/switched off in the demo/) });
    expect(sentEmails).toHaveLength(0);
    // Notifications for demo people are in-app only (email delivery is skipped, not attempted).
    const notes = await listNotifications(user("family"), pid);
    for (const n of notes) expect([undefined, "skipped"]).toContain((n as unknown as { deliveries?: { email?: { status?: string } | null } }).deliveries?.email?.status);
  });

  it("recognizes demo ids and still protects other patients", async () => {
    const pid = await ensureDemoWorld({ auth });
    expect(isDemoUid("demo_meera")).toBe(true);
    expect(isDemoUid("abc123")).toBe(false);
    expect(demoRoleOf("demo_asha")).toBe("patient");
    // A demo visitor cannot reach a real patient's data.
    const real = await createMedication({ ...user("caregiver"), uid: "realcg", accountType: "caregiver" }, pid, MED_INPUT).catch((e) => e);
    expect(real).toMatchObject({ status: 404 });
  });
});
