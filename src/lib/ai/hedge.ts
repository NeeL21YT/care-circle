import "server-only";
import { aiConfig } from "./config";
import { AiError } from "./errors";

/** provider:model -> time until which it is deprioritized after a failure. */
const badUntil = new Map<string, number>();

/**
 * Hedged fallback: models start in order; the next one is started when the
 * previous fails OR has not answered within `hedgeMs`. First success wins, so
 * a slow or flaky model never eats the whole budget.
 */
export function hedged<R>(
  provider: string,
  models: string[],
  attempt: (model: string, timeoutMs: number) => Promise<R>,
  deadlineAt?: number,
): Promise<R & { model: string }> {
  const { timeoutMs, attemptTimeoutMs, hedgeMs } = aiConfig();
  if (!models.length) return Promise.reject(new AiError("ai_model_missing"));
  const now = Date.now();
  const key = (m: string) => `${provider}:${m}`;
  // Recently failed models go last, so one bad model is not tried first every time.
  const order = [...models].sort((a, b) => Number((badUntil.get(key(a)) ?? 0) > now) - Number((badUntil.get(key(b)) ?? 0) > now));
  const deadline = Math.min(now + timeoutMs, deadlineAt ?? Infinity);

  return new Promise((resolve, reject) => {
    let next = 0;
    let running = 0;
    let settled = false;
    let last: AiError = new AiError("ai_unavailable");
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      timers.forEach(clearTimeout);
      fn();
    };
    const start = () => {
      if (settled || next >= order.length) return;
      const remaining = deadline - Date.now();
      if (remaining < 3000) return;
      const model = order[next++];
      running++;
      attempt(model, Math.min(attemptTimeoutMs, remaining)).then(
        (out) => {
          badUntil.delete(key(model));
          finish(() => resolve({ ...out, model }));
        },
        (e) => {
          running--;
          if (!(e instanceof AiError)) return finish(() => reject(e));
          last = e;
          if (e.failure === "ai_blocked" || e.failure === "ai_quota_exceeded") return finish(() => reject(e));
          badUntil.set(key(model), Date.now() + 5 * 60_000);
          start();
          if (running === 0 && (next >= order.length || deadline - Date.now() < 3000)) finish(() => reject(last));
        },
      );
      if (next < order.length) {
        const t = setTimeout(() => {
          timers.delete(t);
          start();
        }, hedgeMs);
        timers.add(t);
      }
    };
    timers.add(setTimeout(() => finish(() => reject(new AiError("ai_timeout"))), Math.max(0, deadline - now) + 1000));
    start();
  });
}

/**
 * Providers reject many JSON Schema validation keywords (verified against the
 * live Gemini API: min/max, length and item limits return 400). Structure is
 * enough for the model; the SAME Zod schema re-validates every response.
 */
const VALIDATION_ONLY = new Set(["$schema", "pattern", "minLength", "maxLength", "minItems", "maxItems", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "format"]);
export function toModelSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(toModelSchema);
  if (node && typeof node === "object") {
    return Object.fromEntries(Object.entries(node).filter(([k]) => !VALIDATION_ONLY.has(k)).map(([k, v]) => [k, toModelSchema(v)]));
  }
  return node;
}
