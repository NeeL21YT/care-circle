/**
 * Fixed-window, in-memory rate limiter.
 *
 * LIMITATION (documented): state is per server instance, so on serverless it
 * is best-effort. It still blunts brute-force and runaway-client traffic. For
 * strict global limits swap `RateLimitStore` for Redis/Upstash or Firestore.
 */
export interface RateLimitStore {
  hit(key: string, windowMs: number, now: number): { count: number; resetAt: number };
}

class MemoryStore implements RateLimitStore {
  private buckets = new Map<string, { count: number; resetAt: number }>();
  hit(key: string, windowMs: number, now: number) {
    // Opportunistic cleanup so the map cannot grow without bound.
    if (this.buckets.size > 5000) {
      for (const [k, v] of this.buckets) if (v.resetAt <= now) this.buckets.delete(k);
    }
    const b = this.buckets.get(key);
    if (!b || b.resetAt <= now) {
      const fresh = { count: 1, resetAt: now + windowMs };
      this.buckets.set(key, fresh);
      return fresh;
    }
    b.count++;
    return b;
  }
}

let store: RateLimitStore = new MemoryStore();
export function __setRateLimitStore(s: RateLimitStore) {
  store = s;
}

export interface RateLimitOptions {
  /** Bucket name, e.g. "documents:upload". */
  name: string;
  limit: number;
  windowSeconds: number;
}

/** Returns seconds to wait if limited, else null. */
export function checkRateLimit(opts: RateLimitOptions, identity: string, now = Date.now()): number | null {
  const { count, resetAt } = store.hit(`${opts.name}:${identity}`, opts.windowSeconds * 1000, now);
  return count > opts.limit ? Math.max(1, Math.ceil((resetAt - now) / 1000)) : null;
}

export const LIMITS = {
  read: { name: "read", limit: 240, windowSeconds: 60 },
  write: { name: "write", limit: 60, windowSeconds: 60 },
  sensitive: { name: "sensitive", limit: 10, windowSeconds: 60 },
  upload: { name: "upload", limit: 10, windowSeconds: 300 },
  auth: { name: "auth", limit: 10, windowSeconds: 300 },
} satisfies Record<string, RateLimitOptions>;
