import { describe, expect, it } from "vitest";
import { generateOccurrences, occurrenceId, validateSchedule } from "@/lib/domain/scheduling";

const base = { id: "med1", startDate: "2026-11-01", endDate: null as string | null };

describe("generateOccurrences", () => {
  it("twice daily creates one occurrence per time per day (India, no DST)", () => {
    const slots = generateOccurrences(
      { ...base, schedule: { frequency: "daily", times: ["08:00", "20:00"] } },
      "Asia/Kolkata",
      new Date("2026-11-15T00:00:00Z"),
      new Date("2026-11-17T00:00:00Z"),
    );
    // 08:00 IST = 02:30Z, 20:00 IST = 14:30Z
    expect(slots.map((s) => s.scheduledAt.toISOString())).toEqual([
      "2026-11-15T02:30:00.000Z",
      "2026-11-15T14:30:00.000Z",
      "2026-11-16T02:30:00.000Z",
      "2026-11-16T14:30:00.000Z",
    ]);
  });

  it("is deterministic: same inputs give identical ids", () => {
    const args: Parameters<typeof generateOccurrences> = [
      { ...base, schedule: { frequency: "daily", times: ["08:00"] } },
      "Asia/Kolkata",
      new Date("2026-11-15T00:00:00Z"),
      new Date("2026-11-20T00:00:00Z"),
    ];
    expect(generateOccurrences(...args).map((s) => s.id)).toEqual(generateOccurrences(...args).map((s) => s.id));
    expect(occurrenceId("m", new Date("2026-11-15T02:30:00Z"))).toBe("m_20261115T0230Z");
  });

  it("windows are half-open so adjacent windows never duplicate an occurrence", () => {
    const med = { ...base, schedule: { frequency: "daily" as const, times: ["08:00"] } };
    const a = generateOccurrences(med, "UTC", new Date("2026-11-15T00:00:00Z"), new Date("2026-11-16T08:00:00Z"));
    const b = generateOccurrences(med, "UTC", new Date("2026-11-16T08:00:00Z"), new Date("2026-11-18T00:00:00Z"));
    const ids = [...a, ...b].map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("handles DST: wall-clock time stays 08:00 local across the US fall-back", () => {
    const slots = generateOccurrences(
      { id: "m", startDate: "2026-10-01", endDate: null, schedule: { frequency: "daily", times: ["08:00"] } },
      "America/New_York",
      new Date("2026-10-31T00:00:00Z"),
      new Date("2026-11-03T00:00:00Z"),
    );
    // 08:00 EDT = 12:00Z until Nov 1 2026, then 08:00 EST = 13:00Z
    expect(slots.map((s) => s.scheduledAt.toISOString())).toEqual([
      "2026-10-31T12:00:00.000Z",
      "2026-11-01T13:00:00.000Z",
      "2026-11-02T13:00:00.000Z",
    ]);
  });

  it("handles DST spring-forward: nonexistent 02:30 shifts forward, never skipped", () => {
    const slots = generateOccurrences(
      { id: "m", startDate: "2026-03-01", endDate: null, schedule: { frequency: "daily", times: ["02:30"] } },
      "America/New_York",
      new Date("2026-03-08T00:00:00Z"),
      new Date("2026-03-09T12:00:00Z"),
    );
    expect(slots).toHaveLength(2);
  });

  it("respects start and end dates in the patient's local calendar", () => {
    const slots = generateOccurrences(
      { id: "m", startDate: "2026-11-16", endDate: "2026-11-17", schedule: { frequency: "daily", times: ["08:00"] } },
      "Asia/Kolkata",
      new Date("2026-11-10T00:00:00Z"),
      new Date("2026-11-30T00:00:00Z"),
    );
    expect(slots).toHaveLength(2);
  });

  it("weekly honours days of week (ISO Mon=1)", () => {
    const slots = generateOccurrences(
      { id: "m", startDate: "2026-11-01", endDate: null, schedule: { frequency: "weekly", times: ["09:00"], daysOfWeek: [1, 4] } },
      "UTC",
      new Date("2026-11-16T00:00:00Z"), // Monday
      new Date("2026-11-23T00:00:00Z"),
    );
    expect(slots.map((s) => s.scheduledAt.toISOString())).toEqual([
      "2026-11-16T09:00:00.000Z",
      "2026-11-19T09:00:00.000Z",
    ]);
  });

  it("every_n_days is anchored at the start date", () => {
    const slots = generateOccurrences(
      { id: "m", startDate: "2026-11-01", endDate: null, schedule: { frequency: "every_n_days", times: ["09:00"], intervalDays: 3 } },
      "UTC",
      new Date("2026-11-01T00:00:00Z"),
      new Date("2026-11-11T00:00:00Z"),
    );
    expect(slots.map((s) => s.scheduledAt.getUTCDate())).toEqual([1, 4, 7, 10]);
  });
});

describe("validateSchedule", () => {
  it("rejects empty, duplicate and malformed times", () => {
    expect(validateSchedule({ frequency: "daily", times: [] }, "2026-11-01", null)).not.toHaveLength(0);
    expect(validateSchedule({ frequency: "daily", times: ["08:00", "08:00"] }, "2026-11-01", null)).not.toHaveLength(0);
    expect(validateSchedule({ frequency: "daily", times: ["25:00"] }, "2026-11-01", null)).not.toHaveLength(0);
  });
  it("rejects end before start and weekly without days", () => {
    expect(validateSchedule({ frequency: "daily", times: ["08:00"] }, "2026-11-10", "2026-11-01")).not.toHaveLength(0);
    expect(validateSchedule({ frequency: "weekly", times: ["08:00"] }, "2026-11-01", null)).not.toHaveLength(0);
  });
  it("accepts a valid schedule", () => {
    expect(validateSchedule({ frequency: "daily", times: ["08:00", "20:00"] }, "2026-11-01", "2026-12-01")).toEqual([]);
  });
});
