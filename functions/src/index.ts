import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineSecret, defineString } from "firebase-functions/params";

/**
 * Cloud Scheduler -> Cloud Function -> the app's idempotent worker.
 *
 * All reminder/escalation/email logic lives in the Next.js app
 * (src/lib/services/jobs.ts) so there is ONE implementation, shared by every
 * scheduler. This function only wakes it up every minute. Because the worker
 * is idempotent (deterministic ids + idempotency keys), overlapping or retried
 * invocations are safe.
 *
 * Setup:
 *   firebase functions:secrets:set CRON_SECRET     # same value as the app's CRON_SECRET
 *   firebase functions:config / params: APP_URL    # e.g. https://your-app.vercel.app
 *   cd functions && npm i && npm run deploy
 */
const APP_URL = defineString("APP_URL");
const CRON_SECRET = defineSecret("CRON_SECRET");

export const careCircleTick = onSchedule(
  { schedule: "every 1 minutes", timeZone: "Etc/UTC", secrets: [CRON_SECRET], retryCount: 2, timeoutSeconds: 120 },
  async () => {
    const res = await fetch(`${APP_URL.value().replace(/\/$/, "")}/api/jobs/tick`, {
      method: "POST",
      headers: { Authorization: `Bearer ${CRON_SECRET.value()}` },
    });
    if (!res.ok) throw new Error(`tick failed with HTTP ${res.status}`); // triggers the retry
    console.log("tick ok", JSON.stringify((await res.json()).data ?? {}));
  },
);
