import { describe, expect, it } from "vitest";
import { summarizeAdherence, weeklyActivity } from "@/lib/domain/adherence";
import type { DoseStatus } from "@/lib/domain/types";

const now = new Date("2026-11-15T12:00:00Z");
const d = (status: DoseStatus, iso: string) => ({ status, scheduledAt: new Date(iso) });

describe("summarizeAdherence", () => {
  it("excludes cancelled and future doses from the denominator", () => {
    const s = summarizeAdherence(
      [
        d("reported_taken", "2026-11-15T01:00:00Z"),
        d("cancelled", "2026-11-15T02:00:00Z"),
        d("scheduled", "2026-11-15T20:00:00Z"), // future
      ],
      now,
    );
    expect(s).toMatchObject({ due: 1, taken: 1, upcoming: 1, cancelled: 1, percentage: 100 });
  });

  it("never counts unknown, skipped or unresolved as taken", () => {
    const s = summarizeAdherence(
      [
        d("reported_taken", "2026-11-14T01:00:00Z"),
        d("reported_skipped", "2026-11-14T02:00:00Z"),
        d("unknown", "2026-11-14T03:00:00Z"),
        d("notified", "2026-11-14T04:00:00Z"),
        d("missed_by_policy", "2026-11-14T05:00:00Z"),
        d("acknowledged", "2026-11-14T06:00:00Z"), // seen is not taken
      ],
      now,
    );
    expect(s.taken).toBe(1);
    expect(s.skipped).toBe(1);
    expect(s.unknown).toBe(1);
    expect(s.unresolved).toBe(3);
    expect(s.due).toBe(6);
    expect(s.percentage).toBe(17);
  });

  it("returns null percentage, not 0 or 100, when nothing is due", () => {
    expect(summarizeAdherence([], now).percentage).toBeNull();
    expect(summarizeAdherence([d("scheduled", "2026-11-16T01:00:00Z")], now).percentage).toBeNull();
  });
});

describe("weeklyActivity", () => {
  it("returns 7 local days ending today, bucketed by patient timezone", () => {
    const days = weeklyActivity(
      [
        d("reported_taken", "2026-11-15T01:00:00Z"),
        // 19:00Z on the 14th is already the 15th in Kolkata (00:30 IST)
        d("reported_skipped", "2026-11-14T19:00:00Z"),
      ],
      now,
      "Asia/Kolkata",
    );
    expect(days).toHaveLength(7);
    expect(days[6].date).toBe("2026-11-15");
    expect(days[6].taken).toBe(1);
    expect(days[6].skipped).toBe(1);
    expect(days[5].due).toBe(0);
  });
});
