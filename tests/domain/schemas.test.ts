import { describe, expect, it } from "vitest";
import { appointmentUpdateSchema, appointmentInputSchema, medicationInputSchema, doseEventSchema, patientInputSchema } from "@/lib/domain/schemas";

describe("schemas", () => {
  it("a partial appointment update never resets reminder offsets", () => {
    expect(appointmentUpdateSchema.parse({ status: "completed" })).toEqual({ status: "completed" });
    expect(appointmentInputSchema.parse({ doctorName: "A", date: "2027-01-01", time: "10:00", appointmentType: "Checkup" }).reminderOffsetsMinutes).toEqual([1440, 60]);
  });
  it("medication schema reports schedule problems against the right field", () => {
    const r = medicationInputSchema.safeParse({
      name: "X", doseAmount: 1, doseUnit: "tablet", form: "Tablet", route: "Oral",
      schedule: { frequency: "weekly", times: ["08:00"] }, startDate: "2026-11-01",
    });
    expect(r.success).toBe(false);
  });
  it("dose events reject system-only event types and bad snooze lengths", () => {
    expect(doseEventSchema.safeParse({ eventType: "missed_by_policy" }).success).toBe(false);
    expect(doseEventSchema.safeParse({ eventType: "snoozed", snoozeMinutes: 7 }).success).toBe(false);
    expect(doseEventSchema.safeParse({ eventType: "snoozed", snoozeMinutes: 15 }).success).toBe(true);
  });
  it("patient schema rejects future birth dates and bad timezones", () => {
    const base = { fullName: "A", dateOfBirth: "1950-01-01", preferredLanguage: "English", timezone: "Asia/Kolkata" };
    expect(patientInputSchema.safeParse(base).success).toBe(true);
    expect(patientInputSchema.safeParse({ ...base, dateOfBirth: "2999-01-01" }).success).toBe(false);
    expect(patientInputSchema.safeParse({ ...base, timezone: "Mars/Olympus" }).success).toBe(false);
  });
});
