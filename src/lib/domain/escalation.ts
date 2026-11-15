import { DateTime } from "luxon";
import type { DoseStatus, EscalationPolicy, QuietHours } from "./types";
import { TIME_RE } from "./scheduling";

/**
 * Notification escalation rules (configurable application rules, NOT universal
 * clinical recommendations). Given a dose and "now", decide which stages are
 * due. The worker turns each due stage into a notification whose deterministic
 * id is the idempotency key, so re-running the worker never duplicates sends.
 */

export type DoseStage = "upcoming" | "due" | "follow_up" | "escalate";

export interface StageInput {
  scheduledAt: Date;
  status: DoseStatus;
  snoozedUntil: Date | null;
  now: Date;
  policy: EscalationPolicy;
}

const MIN = 60_000;

/** Stages that are currently due for a dose (may be empty). */
export function dueStages(i: StageInput): DoseStage[] {
  const { scheduledAt, status, snoozedUntil, now, policy } = i;
  // Nothing fires once the patient answered or the dose was cancelled.
  if (
    status === "reported_taken" ||
    status === "reported_skipped" ||
    status === "unknown" ||
    status === "cancelled"
  ) {
    return [];
  }
  const t = now.getTime();
  const s = scheduledAt.getTime();
  const out: DoseStage[] = [];

  if (policy.upcomingLeadMinutes > 0 && t >= s - policy.upcomingLeadMinutes * MIN && t < s) {
    out.push("upcoming");
  }
  // While snoozed, the "due" reminder waits for the snooze to end.
  const snoozeActive = status === "snoozed" && snoozedUntil !== null && t < snoozedUntil.getTime();
  if (t >= s && !snoozeActive) out.push("due");
  if (t >= s + policy.followUpAfterMinutes * MIN && !snoozeActive) out.push("follow_up");
  if (t >= s + policy.escalateAfterMinutes * MIN) out.push("escalate");
  return out;
}

/** True when the policy values are internally consistent. */
export function validatePolicy(p: EscalationPolicy): string | null {
  if (p.upcomingLeadMinutes < 0 || p.upcomingLeadMinutes > 120) return "Heads-up must be between 0 and 120 minutes.";
  if (p.followUpAfterMinutes < 5 || p.followUpAfterMinutes > 240) return "Follow-up must be between 5 and 240 minutes.";
  if (p.escalateAfterMinutes < 10 || p.escalateAfterMinutes > 480) return "Caregiver alert must be between 10 and 480 minutes.";
  if (p.escalateAfterMinutes <= p.followUpAfterMinutes) return "The caregiver alert must come after the follow-up.";
  return null;
}

/**
 * Quiet hours. Returns the instant at which a notification may be delivered:
 * `now` if outside quiet hours, else the end of the current quiet window.
 */
export function deliverAfter(now: Date, q: QuietHours | null | undefined): Date {
  if (!q?.enabled || !TIME_RE.test(q.start) || !TIME_RE.test(q.end) || q.start === q.end) {
    return now;
  }
  const local = DateTime.fromJSDate(now, { zone: q.timezone });
  const [sh, sm] = q.start.split(":").map(Number);
  const [eh, em] = q.end.split(":").map(Number);
  const minutes = local.hour * 60 + local.minute;
  const startM = sh * 60 + sm;
  const endM = eh * 60 + em;
  const wraps = startM > endM;
  const inQuiet = wraps ? minutes >= startM || minutes < endM : minutes >= startM && minutes < endM;
  if (!inQuiet) return now;

  let end = local.set({ hour: eh, minute: em, second: 0, millisecond: 0 });
  if (end <= local) end = end.plus({ days: 1 });
  return end.toUTC().toJSDate();
}
