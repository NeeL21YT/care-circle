import { describe, expect, it } from "vitest";
import type { DoseStatus } from "@/lib/domain/types";
import { ageFrom, briefActionSchema, buildDoctorBrief, SELF_REPORTED_LABEL, type BriefInput } from "@/lib/domain/doctor-brief";

const now = new Date("2026-11-15T06:30:00Z");
const day = 86400_000;
const base: BriefInput = {
  now, timezone: "Asia/Kolkata",
  patient: { fullName: "Asha Verma", dateOfBirth: "1946-03-02", preferredLanguage: "English" },
  appointment: { startsAt: new Date("2026-11-20T05:00:00Z"), appointmentType: "Checkup", doctorName: "Dr Rao", facility: null, location: null },
  medications: [], awaitingVerification: 0, doses: [], documents: [], notes: { questions: [], observations: [] },
};
const dose = (status: string, ago: number, name = "Metformin") => ({ id: `${status}${ago}`, medicationName: name, scheduledAt: new Date(now.getTime() - ago), status: status as DoseStatus });
const med = (over: Record<string, unknown> = {}) => ({ id: "m", name: "Metformin", strength: "500 mg", doseAmount: 1, doseUnit: "tablet", schedule: { frequency: "daily" as const, times: ["08:00"] }, startDate: "2026-01-01", endDate: null, status: "active" as const, version: 1, createdAt: new Date(now.getTime() - 100 * day), updatedAt: new Date(now.getTime() - 100 * day), ...over });

describe("buildDoctorBrief", () => {
  it("computes age in the patient timezone and fills the overview", () => {
    const b = buildDoctorBrief(base);
    expect(b.overview.age).toBe("80 years");
    expect(b.overview.facility).toBe("Not recorded");
    expect(ageFrom("garbage", now, "UTC")).toBe("Not recorded");
  });

  it("lists active and on-hold medicines only, and flags recent changes without saying what changed", () => {
    const b = buildDoctorBrief({ ...base, medications: [med(), med({ id: "2", name: "Old", status: "discontinued" }), med({ id: "3", name: "Held", status: "on_hold", version: 3 }), med({ id: "4", name: "New", createdAt: new Date(now.getTime() - 2 * day), updatedAt: new Date(now.getTime() - 2 * day) })] });
    expect(b.medications!.current.map((m) => m.name)).toEqual(["Metformin", "Held", "New"]);
    expect(b.medications!.current[0].schedule).toBe("Every day at 8:00 AM");
    expect(b.medications!.recentChanges.map((c) => `${c.name}:${c.kind}`)).toEqual(["Held:Changed", "New:Recently added"]);
  });

  it("counts self-reported doses, ignores future and cancelled doses, and never claims a dose was taken as fact", () => {
    const b = buildDoctorBrief({ ...base, doses: [dose("reported_taken", day), dose("reported_taken", 2 * day), dose("reported_skipped", 3 * day), dose("unknown", 4 * day), dose("missed_by_policy", 5 * day), dose("notified", 1000), dose("cancelled", day), dose("scheduled", -day), dose("reported_skipped", 20 * day)] });
    const a = b.activity!;
    expect([a.reportedTaken, a.reportedSkipped, a.notSure, a.noReport]).toEqual([2, 1, 1, 2]);
    expect(a.lines).toHaveLength(4);
    expect(a.label).toBe(SELF_REPORTED_LABEL);
    expect(JSON.stringify(b)).not.toMatch(/was taken|were taken/i);
  });

  it("omits sections the viewer cannot see and lists them", () => {
    const b = buildDoctorBrief({ ...base, medications: null, awaitingVerification: null, doses: null, documents: null });
    expect(b.medications).toBeNull();
    expect(b.activity).toBeNull();
    expect(b.documents).toBeNull();
    expect(b.omitted).toEqual(["Current medications", "Medication activity", "Recent health documents"]);
  });

  it("notes a hidden verification queue when medicines are visible but not writable", () => {
    expect(buildDoctorBrief({ ...base, awaitingVerification: null }).omitted).toEqual(["Scanned prescriptions awaiting verification"]);
  });

  it("shows the last five documents, newest first, names only", () => {
    const docs = Array.from({ length: 7 }, (_, i) => ({ id: `d${i}`, title: `Doc ${i}`, category: "lab_report", createdAt: new Date(now.getTime() - i * day) }));
    const b = buildDoctorBrief({ ...base, documents: docs });
    expect(b.documents!.items.map((d) => d.title)).toEqual(["Doc 0", "Doc 1", "Doc 2", "Doc 3", "Doc 4"]);
    expect(b.documents!.items[0].category).toBe("Lab report");
    expect(b.documents!.note).toMatch(/AI summaries are not part/);
  });

  it("labels observations as family-reported", () => {
    const b = buildDoctorBrief({ ...base, notes: { questions: [], observations: [{ id: "o", uid: "u", name: "Ravi", text: "Dizzy", at: now }] } });
    expect(b.observations[0].label).toBe("Family-reported observation");
  });
});

describe("briefActionSchema", () => {
  it("accepts valid actions and trims text", () => {
    expect(briefActionSchema.parse({ type: "addQuestion", text: "  Is this ok?  " })).toEqual({ type: "addQuestion", text: "Is this ok?" });
    expect(briefActionSchema.parse({ type: "toggleQuestion", id: "x" }).type).toBe("toggleQuestion");
  });
  it("rejects empty, too long and unknown actions", () => {
    expect(briefActionSchema.safeParse({ type: "addQuestion", text: "   " }).success).toBe(false);
    expect(briefActionSchema.safeParse({ type: "addObservation", text: "x".repeat(501) }).success).toBe(false);
    expect(briefActionSchema.safeParse({ type: "addObservation", text: "x".repeat(500) }).success).toBe(true);
    expect(briefActionSchema.safeParse({ type: "nope" }).success).toBe(false);
    expect(briefActionSchema.safeParse({ type: "removeQuestion" }).success).toBe(false);
  });
});
