import { describe, expect, it } from "vitest";
import { createMedication, discontinueMedication, updateMedication, listMedications } from "@/lib/services/medications";
import { applySystemEvent, listDoseEvents, listDoses, recordDoseEvent, snoozeDose } from "@/lib/services/doses";
import { InvalidTransitionError } from "@/lib/domain/dose-state";
import { standardWorld, MED_INPUT } from "../helpers";
import type { DoseOccurrence } from "@/lib/domain/types";

const occs = (fake: Awaited<ReturnType<typeof standardWorld>>["fake"], pid: string) =>
  [...fake.docs.entries()].filter(([k]) => k.startsWith(`patients/${pid}/doseOccurrences/`)).map(([k, v]) => ({ id: k.split("/").pop()!, ...(v as object) }) as unknown as DoseOccurrence);

describe("medication management", () => {
  it("creates a medication and materializes ~14 days of occurrences (twice daily)", async () => {
    const { fake, caregiver, patient } = await standardWorld();
    const med = await createMedication(caregiver, patient.id, MED_INPUT);
    const list = occs(fake, patient.id);
    expect(list.length).toBeGreaterThanOrEqual(27);
    expect(list.length).toBeLessThanOrEqual(29);
    expect(list.every((o) => o.medicationId === med.id && o.status === "scheduled" && o.timezone === "Asia/Kolkata")).toBe(true);
    expect(med.verificationStatus).toBe("verified");
    expect(med.sourceDocumentId).toBeNull();
  });

  it("re-saving the same schedule creates no duplicates", async () => {
    const { fake, caregiver, patient } = await standardWorld();
    const med = await createMedication(caregiver, patient.id, MED_INPUT);
    const before = occs(fake, patient.id).length;
    await updateMedication(caregiver, patient.id, med.id, { instructions: "With breakfast" });
    expect(occs(fake, patient.id).length).toBe(before);
  });

  it("changing times cancels untouched future doses and creates new ones; keeps answered doses", async () => {
    const { fake, caregiver, patientUser, patient } = await standardWorld();
    const med = await createMedication(caregiver, patient.id, MED_INPUT);
    const first = occs(fake, patient.id).sort((a, b) => +a.scheduledAt - +b.scheduledAt)[0];
    await recordDoseEvent(patientUser, patient.id, first.id, { eventType: "reported_taken" });
    await updateMedication(caregiver, patient.id, med.id, { schedule: { frequency: "daily", times: ["09:00"] } });
    const all = occs(fake, patient.id);
    expect(all.find((o) => o.id === first.id)!.status).toBe("reported_taken"); // history kept
    const live = all.filter((o) => o.status !== "cancelled" && o.id !== first.id);
    expect(live.every((o) => new Date(o.scheduledAt).toISOString().includes("T03:30"))).toBe(true); // 09:00 IST
    expect(all.filter((o) => o.status === "cancelled").length).toBeGreaterThan(20);
  });

  it("discontinuing cancels future doses but never deletes history or the record", async () => {
    const { fake, caregiver, patientUser, patient } = await standardWorld();
    const med = await createMedication(caregiver, patient.id, MED_INPUT);
    const first = occs(fake, patient.id).sort((a, b) => +a.scheduledAt - +b.scheduledAt)[0];
    await recordDoseEvent(patientUser, patient.id, first.id, { eventType: "reported_skipped" });
    await discontinueMedication(caregiver, patient.id, med.id);
    const all = occs(fake, patient.id);
    expect(all.find((o) => o.id === first.id)!.status).toBe("reported_skipped");
    expect(all.filter((o) => o.id !== first.id).every((o) => o.status === "cancelled")).toBe(true);
    const meds = await listMedications(caregiver, patient.id);
    expect(meds[0].status).toBe("discontinued");
    // Version history is retained.
    const versions = [...fake.docs.keys()].filter((k) => k.includes(`/medications/${med.id}/versions/`));
    expect(versions.length).toBe(2);
    // Finished medications cannot be revived.
    await expect(updateMedication(caregiver, patient.id, med.id, { status: "active" })).rejects.toMatchObject({ status: 400 });
  });

  it("rejects invalid schedules at the service layer too", async () => {
    const { caregiver, patient } = await standardWorld();
    const med = await createMedication(caregiver, patient.id, MED_INPUT);
    await expect(updateMedication(caregiver, patient.id, med.id, { endDate: "2020-01-01" })).rejects.toMatchObject({ status: 400 });
  });

  it("on-hold stops future doses; resuming recreates them", async () => {
    const { fake, caregiver, patient } = await standardWorld();
    const med = await createMedication(caregiver, patient.id, MED_INPUT);
    await updateMedication(caregiver, patient.id, med.id, { status: "on_hold" });
    expect(occs(fake, patient.id).every((o) => o.status === "cancelled")).toBe(true);
    await updateMedication(caregiver, patient.id, med.id, { status: "active" });
    expect(occs(fake, patient.id).filter((o) => o.status === "scheduled").length).toBeGreaterThan(20);
  });
});

describe("dose events", () => {
  async function oneDose() {
    const w = await standardWorld();
    await createMedication(w.caregiver, w.patient.id, MED_INPUT);
    const occ = occs(w.fake, w.patient.id).sort((a, b) => +a.scheduledAt - +b.scheduledAt)[0];
    return { ...w, occ };
  }

  it("records events with who/when/what and keeps every event (history, not overwrite)", async () => {
    const { patientUser, patient, occ, caregiver } = await oneDose();
    await recordDoseEvent(patientUser, patient.id, occ.id, { eventType: "reported_taken", note: "after lunch" });
    await recordDoseEvent(patientUser, patient.id, occ.id, { eventType: "reported_skipped", note: "felt unwell" });
    const events = await listDoseEvents(caregiver, patient.id, occ.id);
    expect(events.map((e) => e.eventType)).toEqual(["reported_taken", "reported_skipped"]);
    expect(events[0]).toMatchObject({ userId: "pt1", source: "patient_ui", note: "after lunch", doseOccurrenceId: occ.id, previousStatus: "scheduled", resultingStatus: "reported_taken" });
    const doses = await listDoses(patientUser, patient.id, { from: occ.scheduledAt, to: new Date(+occ.scheduledAt + 1000) });
    expect(doses[0].status).toBe("reported_skipped");
  });

  it("is idempotent for retried client event ids (offline queue)", async () => {
    const { patientUser, patient, occ, caregiver } = await oneDose();
    const input = { eventType: "reported_taken" as const, clientEventId: "evt_abc12345" };
    const r1 = await recordDoseEvent(patientUser, patient.id, occ.id, input);
    const r2 = await recordDoseEvent(patientUser, patient.id, occ.id, input);
    expect(r1.duplicate).toBe(false);
    expect(r2.duplicate).toBe(true);
    expect(await listDoseEvents(caregiver, patient.id, occ.id)).toHaveLength(1);
  });

  it("'I am not sure' becomes unknown, never taken", async () => {
    const { patientUser, patient, occ } = await oneDose();
    const r = await recordDoseEvent(patientUser, patient.id, occ.id, { eventType: "reported_unsure" });
    expect(r.occurrence.status).toBe("unknown");
  });

  it("snooze sets snoozedUntil and status", async () => {
    const { patientUser, patient, occ } = await oneDose();
    const before = Date.now();
    const r = await snoozeDose(patientUser, patient.id, occ.id, 15);
    expect(r.occurrence.status).toBe("snoozed");
    expect(+r.occurrence.snoozedUntil! - before).toBeGreaterThanOrEqual(15 * 60_000 - 2000);
  });

  it("family cannot respond; caregiver responses are labelled as caregiver-sourced", async () => {
    const { family, caregiver, patient, occ } = await oneDose();
    await expect(recordDoseEvent(family, patient.id, occ.id, { eventType: "reported_taken" })).rejects.toMatchObject({ status: 403 });
    const r = await recordDoseEvent(caregiver, patient.id, occ.id, { eventType: "reported_taken" });
    expect(r.event.source).toBe("caregiver_ui");
  });

  it("system events can never overwrite a patient's answer", async () => {
    const { patientUser, patient, occ } = await oneDose();
    await recordDoseEvent(patientUser, patient.id, occ.id, { eventType: "reported_taken" });
    expect(await applySystemEvent(patient.id, occ.id, "missed_by_policy", new Date())).toBe(false);
    expect(await applySystemEvent(patient.id, occ.id, "notified", new Date())).toBe(false);
  });

  it("cancelled doses reject responses", async () => {
    const { patientUser, caregiver, patient, occ, fake } = await oneDose();
    await applySystemEvent(patient.id, occ.id, "cancelled", new Date());
    await expect(recordDoseEvent(patientUser, patient.id, occ.id, { eventType: "reported_taken" })).rejects.toBeInstanceOf(InvalidTransitionError);
    void caregiver; void fake;
  });

  it("ignores absurd client timestamps", async () => {
    const { patientUser, patient, occ } = await oneDose();
    const r = await recordDoseEvent(patientUser, patient.id, occ.id, { eventType: "reported_taken", occurredAt: new Date(Date.now() + 5 * 86400_000).toISOString() });
    expect(+r.event.occurredAt).toBeLessThanOrEqual(Date.now() + 1000);
  });
});
