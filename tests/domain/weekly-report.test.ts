import { describe, expect, it } from "vitest";
import { buildWeeklyReport, checkinSchema, isoWeekKey, type ReportDose, type ReportInput } from "@/lib/domain/weekly-report";

const now = new Date("2026-11-15T10:00:00Z");
const ago = (h: number) => new Date(now.getTime() - h * 3600_000);
const dose = (status: ReportDose["status"], h = 5): ReportDose => ({ status, scheduledAt: ago(h) });
const input = (over: Partial<ReportInput> = {}): ReportInput => ({
  now, timezone: "Asia/Kolkata", doses: [], tasks: [], appointments: [], documentDates: [], scansWaiting: 0, handoverDates: [], ...over,
});

describe("weekly report builder", () => {
  it("counts doses and uses self-report wording", () => {
    const doses = [
      ...Array.from({ length: 10 }, () => dose("reported_taken")),
      dose("reported_skipped"), dose("missed_by_policy"), dose("cancelled"),
      { status: "reported_taken", scheduledAt: ago(24 * 9) } as ReportDose, // outside the week
    ];
    const r = buildWeeklyReport(input({ doses }));
    expect(r.doses).toMatchObject({ scheduled: 12, reportedTaken: 10, reportedSkipped: 1, noReport: 1, adherencePercent: 83 });
    expect(r.sentences.slice(0, 2)).toEqual([
      "12 doses were scheduled this week.",
      "10 were reported taken, 1 was reported skipped and 1 has no report yet.",
    ]);
    expect(r.sentences.join(" ")).not.toMatch(/\btaken\b(?<!reported taken)/);
    expect(r.attention.some((a) => a.id === "doses-no-report")).toBe(true);
  });

  it("separates snoozed and not sure, and has null adherence when nothing was due", () => {
    const r = buildWeeklyReport(input({ doses: [dose("snoozed"), dose("unknown")] }));
    expect(r.doses).toMatchObject({ snoozed: 1, notSure: 1, noReport: 0 });
    const none = buildWeeklyReport(input({ doses: [dose("scheduled", -3)] }));
    expect(none.doses!.adherencePercent).toBeNull();
    expect(buildWeeklyReport(input()).sentences[0]).toBe("No doses were scheduled this week.");
  });

  it("computes task, appointment, document, scan and handover stats", () => {
    const r = buildWeeklyReport(input({
      tasks: [
        { status: "completed", assignedToUid: "a", dueAt: null, completedAt: ago(10) },
        { status: "pending", assignedToUid: null, dueAt: ago(2), completedAt: null },
        { status: "in_progress", assignedToUid: "a", dueAt: null, completedAt: null },
        { status: "cancelled", assignedToUid: null, dueAt: null, completedAt: null },
      ],
      appointments: [
        { id: "1", doctorName: "Dr A", startsAt: ago(30), status: "completed" },
        { id: "2", doctorName: "Dr B", startsAt: new Date(now.getTime() + 86400_000 * 3), status: "scheduled" },
        { id: "3", doctorName: "Dr C", startsAt: ago(20), status: "cancelled" },
      ],
      documentDates: [ago(1), ago(500)],
      scansWaiting: 2,
      handoverDates: [ago(3)],
    }));
    expect(r.tasks).toEqual({ completed: 1, open: 2, overdue: 1, unassigned: 1 });
    expect(r.appointments!.past).toBe(1);
    expect(r.appointments!.next?.doctorName).toBe("Dr B");
    expect(r.documents!.added).toBe(1);
    expect(r.scans!.waiting).toBe(2);
    expect(r.handovers!.count).toBe(1);
    expect(r.attention.map((a) => a.id)).toEqual(expect.arrayContaining(["tasks-overdue", "tasks-unassigned", "scans-waiting"]));
  });

  it("lists omitted sections when data is hidden", () => {
    const r = buildWeeklyReport(input({ doses: null, scansWaiting: null, handoverDates: null }));
    expect(r.doses).toBeNull();
    expect(r.omitted).toEqual(["medicine doses", "prescription scans", "care handovers"]);
  });
});

describe("check-in schema and week key", () => {
  it("accepts valid levels and trims notes", () => {
    expect(checkinSchema.parse({ level: "comfortable" })).toEqual({ level: "comfortable", note: "" });
    expect(checkinSchema.parse({ level: "very_difficult", note: "  tired " }).note).toBe("tired");
  });
  it("rejects unknown levels and long notes", () => {
    expect(checkinSchema.safeParse({ level: "burnout" }).success).toBe(false);
    expect(checkinSchema.safeParse({ level: "comfortable", note: "x".repeat(501) }).success).toBe(false);
  });
  it("builds ISO week keys in the patient timezone", () => {
    expect(isoWeekKey(new Date("2026-11-15T10:00:00Z"), "Asia/Kolkata")).toBe("2026-W46");
    expect(isoWeekKey(new Date("2026-01-01T00:00:00Z"), "UTC")).toBe("2026-W01");
    expect(isoWeekKey(new Date("2027-01-01T12:00:00Z"), "UTC")).toBe("2026-W53");
  });
});
