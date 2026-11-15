import { describe, expect, it } from "vitest";
import { describeSchedule, formatClock } from "@/lib/domain/schedule-text";

describe("schedule text", () => {
  it("formats clock times", () => {
    expect(formatClock("08:00")).toBe("8:00 AM");
    expect(formatClock("00:30")).toBe("12:30 AM");
    expect(formatClock("12:00")).toBe("12:00 PM");
    expect(formatClock("20:05")).toBe("8:05 PM");
  });
  it("describes daily, weekly and every-N-day schedules", () => {
    expect(describeSchedule({ frequency: "daily", times: ["20:00", "08:00"] })).toBe("Every day at 8:00 AM and 8:00 PM");
    expect(describeSchedule({ frequency: "weekly", times: ["09:00"], daysOfWeek: [4, 1] })).toBe("Every Monday and Thursday at 9:00 AM");
    expect(describeSchedule({ frequency: "weekly", times: ["09:00"], daysOfWeek: [1, 3, 5] })).toBe("Every Monday, Wednesday and Friday at 9:00 AM");
    expect(describeSchedule({ frequency: "every_n_days", times: ["09:00"], intervalDays: 3 })).toBe("Every 3 days at 9:00 AM");
  });
  it("is empty when incomplete", () => {
    expect(describeSchedule({ frequency: "daily", times: [] })).toBe("");
    expect(describeSchedule({ frequency: "weekly", times: ["09:00"], daysOfWeek: [] })).toBe("");
  });
});
