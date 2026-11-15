import { describe, expect, it } from "vitest";
import { deliverAfter, dueStages, validatePolicy } from "@/lib/domain/escalation";
import { DEFAULT_ESCALATION_POLICY as policy } from "@/lib/domain/types";

const at = new Date("2026-11-15T08:00:00Z");
const m = (min: number) => new Date(at.getTime() + min * 60_000);

describe("dueStages", () => {
  const base = { scheduledAt: at, snoozedUntil: null, policy };
  it("walks upcoming -> due -> follow_up -> escalate over time", () => {
    expect(dueStages({ ...base, status: "scheduled", now: m(-5) })).toEqual(["upcoming"]);
    expect(dueStages({ ...base, status: "scheduled", now: m(-30) })).toEqual([]);
    expect(dueStages({ ...base, status: "notified", now: m(0) })).toEqual(["due"]);
    expect(dueStages({ ...base, status: "notified", now: m(20) })).toEqual(["due", "follow_up"]);
    expect(dueStages({ ...base, status: "notified", now: m(60) })).toEqual(["due", "follow_up", "escalate"]);
  });
  it("stops everything once the patient answered", () => {
    for (const status of ["reported_taken", "reported_skipped", "unknown", "cancelled"] as const) {
      expect(dueStages({ ...base, status, now: m(120) })).toEqual([]);
    }
  });
  it("a snoozed dose waits for the snooze before reminding, but still escalates", () => {
    const snoozedUntil = m(30);
    expect(dueStages({ ...base, status: "snoozed", snoozedUntil, now: m(20) })).toEqual([]);
    expect(dueStages({ ...base, status: "snoozed", snoozedUntil, now: m(31) })).toEqual(["due", "follow_up"]);
    expect(dueStages({ ...base, status: "snoozed", snoozedUntil, now: m(50) })).toContain("escalate");
  });
  it("heads-up can be disabled", () => {
    expect(dueStages({ ...base, policy: { ...policy, upcomingLeadMinutes: 0 }, status: "scheduled", now: m(-5) })).toEqual([]);
  });
});

describe("validatePolicy", () => {
  it("requires escalation after follow-up", () => {
    expect(validatePolicy({ ...policy, followUpAfterMinutes: 60, escalateAfterMinutes: 30 })).toBeTruthy();
    expect(validatePolicy(policy)).toBeNull();
  });
});

describe("quiet hours", () => {
  const q = { enabled: true, start: "22:00", end: "07:00", timezone: "Asia/Kolkata" };
  it("delivers immediately outside quiet hours", () => {
    const now = new Date("2026-11-15T06:30:00Z"); // 12:00 IST
    expect(deliverAfter(now, q)).toEqual(now);
  });
  it("defers to the end of an overnight window", () => {
    const now = new Date("2026-11-15T17:30:00Z"); // 23:00 IST
    expect(deliverAfter(now, q).toISOString()).toBe("2026-11-16T01:30:00.000Z"); // 07:00 IST
  });
  it("defers early-morning times to the same morning's end", () => {
    const now = new Date("2026-11-15T22:00:00Z"); // 03:30 IST on the 16th
    expect(deliverAfter(now, q).toISOString()).toBe("2026-11-16T01:30:00.000Z");
  });
  it("is a no-op when disabled", () => {
    const now = new Date("2026-11-15T17:30:00Z");
    expect(deliverAfter(now, { ...q, enabled: false })).toEqual(now);
  });
});
