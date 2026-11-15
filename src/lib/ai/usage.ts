import "server-only";
import { col, fromData } from "@/lib/db";
import { AiError } from "./errors";
import { aiConfig } from "./config";
import type { TokenUsage } from "./client";
import { runTx } from "@/lib/db/transaction";

export type AiFeature = "prescription" | "assistant" | "document" | "voice" | "handover";

const day = (d = new Date()) => d.toISOString().slice(0, 10);

interface UsageDoc {
  uid: string;
  day: string;
  requests: Record<string, number>;
  inputTokens: number;
  outputTokens: number;
  failures: number;
}

/**
 * Atomically counts one AI request against the user's daily quota for this
 * patient, or throws `ai_quota_exceeded`. Stores counts only, never content.
 */
export async function consumeQuota(patientId: string, uid: string, feature: AiFeature, now = new Date()) {
  const limit = aiConfig().dailyQuota[feature];
  const ref = col.sub(patientId, "aiUsage").doc(`${uid}_${day(now)}`);
  await runTx(async (t) => {
    const snap = await t.get(ref);
    const cur: UsageDoc = snap.exists
      ? fromData<UsageDoc>(snap.data())
      : { uid, day: day(now), requests: {}, inputTokens: 0, outputTokens: 0, failures: 0 };
    const used = cur.requests[feature] ?? 0;
    if (used >= limit) throw new AiError("ai_quota_exceeded");
    cur.requests[feature] = used + 1;
    t.set(ref, cur);
  });
}

/** Adds token counts / a failure tick after the call. Best effort; never throws. */
export async function recordUsage(patientId: string, uid: string, usage: TokenUsage | null, now = new Date()) {
  try {
    const ref = col.sub(patientId, "aiUsage").doc(`${uid}_${day(now)}`);
    const snap = await ref.get();
    if (!snap.exists) return;
    const cur = fromData<UsageDoc>(snap.data());
    await ref.set({
      ...cur,
      inputTokens: cur.inputTokens + (usage?.inputTokens ?? 0),
      outputTokens: cur.outputTokens + (usage?.outputTokens ?? 0),
      failures: cur.failures + (usage ? 0 : 1),
    });
  } catch {
    /* usage tracking must never break a feature */
  }
}
