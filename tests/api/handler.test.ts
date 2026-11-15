import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { z } from "zod";

const user = { uid: "u1", email: "u1@example.com", emailVerified: true, displayName: "U", accountType: "caregiver" as const };
const requireUser = vi.fn(async () => user);
vi.mock("@/lib/auth/session", () => ({ requireUser: (...a: unknown[]) => requireUser(...(a as [])) }));

import { route } from "@/lib/api/handler";
import { HttpError, unauthorized } from "@/lib/api/errors";
import { ForbiddenError } from "@/lib/domain/permissions";
import { InvalidTransitionError } from "@/lib/domain/dose-state";
import { __setRateLimitStore, checkRateLimit } from "@/lib/api/rate-limit";

const req = (method = "GET", init: { body?: unknown; headers?: Record<string, string> } = {}) =>
  new NextRequest("http://localhost/api/x", {
    method,
    headers: { host: "localhost", "content-type": "application/json", ...init.headers },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
const ctx = { params: Promise.resolve({}) } as { params: Promise<Record<never, string>> };

beforeEach(() => {
  requireUser.mockReset();
  requireUser.mockImplementation(async () => user);
  // fresh limiter per test
  const hits = new Map<string, { count: number; resetAt: number }>();
  __setRateLimitStore({ hit: (k, w, now) => { const b = hits.get(k); if (!b || b.resetAt <= now) { const f = { count: 1, resetAt: now + w }; hits.set(k, f); return f; } b.count++; return b; } });
});

describe("route wrapper", () => {
  it("wraps results in {data} and disables caching", async () => {
    const res = await route({}, async () => ({ ok: 1 }))(req(), ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ data: { ok: 1 } });
  });

  it("401 when not signed in", async () => {
    requireUser.mockRejectedValueOnce(unauthorized());
    const res = await route({}, async () => 1)(req(), ctx);
    expect(res.status).toBe(401);
  });

  it("rejects cross-origin state-changing requests", async () => {
    const res = await route({}, async () => 1)(req("POST", { headers: { origin: "https://evil.example" }, body: {} }), ctx);
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("bad_origin");
    const ok = await route({}, async () => 1)(req("POST", { headers: { origin: "http://localhost" }, body: {} }), ctx);
    expect(ok.status).toBe(200);
  });

  it("validates bodies with zod and reports field errors", async () => {
    const h = route<never, { n: number }>({ body: z.object({ n: z.number().min(1, "Must be at least 1") }) }, async ({ body }) => body);
    const bad = await h(req("POST", { body: { n: 0 } }), ctx);
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.fields).toEqual({ n: "Must be at least 1" });
    const notJson = await h(new NextRequest("http://localhost/api/x", { method: "POST", headers: { host: "localhost" }, body: "{oops" }), ctx);
    expect(notJson.status).toBe(400);
    expect((await h(req("POST", { body: { n: 2 } }), ctx)).status).toBe(200);
  });

  it("maps domain errors to the right status and never leaks internals", async () => {
    const run = (e: unknown) => route({}, async () => { throw e; })(req(), ctx);
    expect((await run(new ForbiddenError())).status).toBe(403);
    expect((await run(new InvalidTransitionError("nope"))).status).toBe(409);
    expect((await run(new HttpError(404, "not_found", "gone"))).status).toBe(404);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await run(new Error("secret patient detail: Asha has diabetes"));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("Asha");
    spy.mockRestore();
  });

  it("rate limits per user and returns 429", async () => {
    const h = route({ rateLimit: { name: "t", limit: 2, windowSeconds: 60 } }, async () => 1);
    expect((await h(req(), ctx)).status).toBe(200);
    expect((await h(req(), ctx)).status).toBe(200);
    const third = await h(req(), ctx);
    expect(third.status).toBe(429);
    expect((await third.json()).error.code).toBe("rate_limited");
  });

  it("rate limiter windows reset", () => {
    const o = { name: "w", limit: 1, windowSeconds: 10 };
    expect(checkRateLimit(o, "a", 0)).toBeNull();
    expect(checkRateLimit(o, "a", 1000)).toBeGreaterThan(0);
    expect(checkRateLimit(o, "a", 11_000)).toBeNull();
  });

  it("auth:'none' endpoints skip the session requirement", async () => {
    const res = await route({ auth: "none" }, async () => "public")(req(), ctx);
    expect(res.status).toBe(200);
    expect(requireUser).not.toHaveBeenCalled();
  });
});
