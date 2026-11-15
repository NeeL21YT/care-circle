import { describe, expect, it } from "vitest";
import { InvalidTransitionError, nextStatus } from "@/lib/domain/dose-state";

describe("dose state machine", () => {
  it("lets a person answer and re-answer (correction keeps history via events)", () => {
    expect(nextStatus({ current: "notified", event: "reported_taken", byUser: true })).toBe("reported_taken");
    expect(nextStatus({ current: "reported_taken", event: "reported_skipped", byUser: true })).toBe("reported_skipped");
  });
  it("maps 'I am not sure' to unknown, never taken or missed", () => {
    expect(nextStatus({ current: "scheduled", event: "reported_unsure", byUser: true })).toBe("unknown");
  });
  it("cancelled is terminal for everyone", () => {
    expect(() => nextStatus({ current: "cancelled", event: "reported_taken", byUser: true })).toThrow(InvalidTransitionError);
    expect(() => nextStatus({ current: "cancelled", event: "notified", byUser: false })).toThrow(InvalidTransitionError);
  });
  it("the system can never overwrite a patient's answer", () => {
    for (const s of ["reported_taken", "reported_skipped", "unknown"] as const) {
      expect(() => nextStatus({ current: s, event: "missed_by_policy", byUser: false })).toThrow(InvalidTransitionError);
    }
  });
  it("the system advances unresolved doses", () => {
    expect(nextStatus({ current: "scheduled", event: "notified", byUser: false })).toBe("notified");
    expect(nextStatus({ current: "notified", event: "missed_by_policy", byUser: false })).toBe("missed_by_policy");
  });
  it("people cannot submit system-only events", () => {
    expect(() => nextStatus({ current: "scheduled", event: "missed_by_policy", byUser: true })).toThrow(InvalidTransitionError);
    expect(() => nextStatus({ current: "scheduled", event: "cancelled", byUser: true })).toThrow(InvalidTransitionError);
  });
});
