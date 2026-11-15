import { describe, expect, it } from "vitest";
import { buildHandover, templateSummary, type BuildInput } from "@/lib/domain/handover";
import type { Appointment, CareTask, DoseOccurrence } from "@/lib/domain/types";

const now = new Date("2026-11-15T10:00:00Z");
const hours = (h: number) => new Date(now.getTime() + h * 3600_000);
const dose = (over: Partial<DoseOccurrence>): DoseOccurrence => ({
  id: "d" + Math.random().toString(36).slice(2, 7), patientId: "p", medicationId: "m", medicationName: "Metformin", doseText: "1 tablet, 500 mg",
  instructions: null, scheduledAt: hours(-3), timezone: "Asia/Kolkata", status: "scheduled", gracePeriodMinutes: 30, notifiedAt: null,
  respondedAt: null, snoozedUntil: null, createdAt: now, updatedAt: now, ...over,
} as DoseOccurrence);
const base = (over: Partial<BuildInput> = {}): BuildInput => ({
  now, periodStart: hours(-24), timezone: "Asia/Kolkata",
  doses: [], upcomingDoses: [], appointments: [], tasks: [], documents: [], prescriptions: [], changes: [], ...over,
});
const task = (over: Partial<CareTask>): CareTask => ({
  id: "t1", patientId: "p", title: "Arrange transport", description: null, assignedToUid: null, assignedToName: null, createdByUid: "u", createdByName: "U",
  dueAt: null, priority: "normal", status: "pending", notes: [], related: null, createdAt: hours(-5), updatedAt: hours(-5), completedAt: null, completedByUid: null, ...over,
});

describe("buildHandover", () => {
  it("describes taken doses as self-reports, never as verified", () => {
    const { items } = buildHandover(base({ doses: [dose({ status: "reported_taken", respondedAt: hours(-2.8) })] }));
    expect(items[0].section).toBe("medication_taken");
    expect(items[0].text).toMatch(/reported taken/);
    expect(items[0].text).toMatch(/self-report, not verified/);
    expect(items[0].attention).toBe(false);
  });

  it("keeps unresolved, snoozed and not-sure doses unresolved and flags them", () => {
    const { items } = buildHandover(base({ doses: [
      dose({ status: "scheduled" }), dose({ status: "notified" }), dose({ status: "acknowledged" }), dose({ status: "missed_by_policy" }),
      dose({ status: "snoozed", snoozedUntil: hours(-2.5) }), dose({ status: "unknown" }),
    ] }));
    expect(items.filter((i) => i.section === "medication_unresolved")).toHaveLength(4);
    expect(items.find((i) => i.section === "medication_snoozed")!.text).toMatch(/still unresolved/);
    expect(items.find((i) => i.section === "medication_not_sure")!.attention).toBe(true);
    expect(items.every((i) => i.attention)).toBe(true);
    expect(items.map((i) => i.text).join(" ")).not.toMatch(/was taken|verified as|confirmed taken/);
  });

  it("excludes cancelled doses, future doses from the past section, and doses outside the period", () => {
    const { items } = buildHandover(base({ doses: [dose({ status: "cancelled" }), dose({ scheduledAt: hours(2) }), dose({ scheduledAt: hours(-48) })] }));
    expect(items).toHaveLength(0);
  });

  it("omits (never guesses) sections the author cannot see", () => {
    const r = buildHandover(base({ doses: null, tasks: null, documents: null, prescriptions: null }));
    expect(r.omitted).toEqual(expect.arrayContaining(["reported medicine activity", "care tasks", "new documents", "prescriptions waiting to be checked"]));
    expect(r.items).toHaveLength(0);
  });

  it("flags overdue, unassigned and flagged tasks, and includes recent notes", () => {
    const { items } = buildHandover(base({ tasks: [
      task({ id: "a", title: "Overdue one", assignedToUid: "x", assignedToName: "Ravi", dueAt: hours(-1) }),
      task({ id: "b", title: "Nobody owns this" }),
      task({ id: "c", title: "Fine", assignedToUid: "x", assignedToName: "Ravi", status: "accepted", dueAt: hours(30), notes: [{ id: "n1", uid: "x", name: "Ravi", text: "Called the clinic", at: hours(-2) }] }),
      task({ id: "d", title: "Done", status: "completed" }),
    ] }));
    const tasks = items.filter((i) => i.section === "tasks");
    expect(tasks).toHaveLength(3);
    expect(tasks.find((t) => t.sourceId === "a")!.text).toMatch(/overdue/);
    expect(tasks.find((t) => t.sourceId === "a")!.attention).toBe(true);
    expect(tasks.find((t) => t.sourceId === "b")!.text).toMatch(/not assigned to anyone yet/);
    expect(tasks.find((t) => t.sourceId === "c")!.attention).toBe(false);
    expect(items.filter((i) => i.section === "notes")).toHaveLength(1);
  });

  it("flags appointments within 48 hours and ignores cancelled or past ones", () => {
    const appt = (id: string, h: number, status = "scheduled") => ({ id, doctorName: "Dr Rao", facility: "City Clinic", startsAt: hours(h), appointmentType: "Check-up", status }) as Appointment;
    const { items } = buildHandover(base({ appointments: [appt("a", 20), appt("b", 100), appt("c", 10, "cancelled"), appt("d", -3)] }));
    expect(items.map((i) => i.sourceId)).toEqual(["a", "b"]);
    expect(items[0].attention).toBe(true);
    expect(items[1].attention).toBe(false);
  });

  it("flags prescriptions waiting for a check and lists care-plan changes without details", () => {
    const { items } = buildHandover(base({
      prescriptions: [{ id: "x", medicineCount: 2, createdAt: hours(-1) }],
      changes: [{ id: "c1", action: "medication.update", actorName: "Meera", at: hours(-4), requires: "medications:read" }, { id: "c2", action: "patient.update", actorName: "Meera", at: hours(-4), requires: "medications:read" }],
    }));
    expect(items.find((i) => i.section === "prescriptions")!.text).toMatch(/Nothing from it is active yet/);
    expect(items.filter((i) => i.section === "changes").map((i) => i.text)).toEqual([expect.stringMatching(/Meera updated a medicine/)]);
  });

  it("orders attention-bearing sections first and gives every item a unique id", () => {
    const { items } = buildHandover(base({ doses: [dose({ status: "reported_taken", respondedAt: hours(-2) }), dose({ status: "scheduled" })], tasks: [task({})] }));
    expect(items[0].section).toBe("medication_unresolved");
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
  });

  it("produces a truthful empty summary", () => {
    expect(templateSummary([])[0].text).toMatch(/No activity or outstanding items/);
  });
});
