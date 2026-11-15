import { beforeEach, describe, expect, it, vi } from "vitest";

const revoke = vi.fn();
const verify = vi.fn();
let cookieValue: string | undefined;

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => (cookieValue ? { value: cookieValue } : undefined) }) }));
vi.mock("@/lib/firebase/admin", () => ({ adminAuth: () => ({ verifySessionCookie: verify, revokeRefreshTokens: revoke }), adminDb: () => ({}) }));

import { POST } from "@/app/api/auth/logout/route";
import type { NextRequest } from "next/server";

const call = () => POST(new Request("http://localhost/api/auth/logout", { method: "POST" }) as unknown as NextRequest, { params: Promise.resolve({}) });

beforeEach(() => { revoke.mockReset(); verify.mockReset(); cookieValue = "session"; });

describe("POST /api/auth/logout", () => {
  it("revokes a normal user's sessions and clears the cookie", async () => {
    verify.mockResolvedValue({ uid: "real_user_1" });
    const res = await call();
    expect(res.status).toBe(200);
    expect(revoke).toHaveBeenCalledWith("real_user_1");
    expect(res.headers.get("set-cookie")).toMatch(/__session=;/);
  });

  it("does NOT revoke the shared demo accounts, so one visitor cannot sign out the others", async () => {
    verify.mockResolvedValue({ uid: "demo_meera" });
    const res = await call();
    expect(res.status).toBe(200);
    expect(revoke).not.toHaveBeenCalled();
    expect(res.headers.get("set-cookie")).toMatch(/__session=;/); // this visitor is still signed out locally
  });

  it("still clears the cookie when the session is already invalid", async () => {
    verify.mockRejectedValue(new Error("expired"));
    const res = await call();
    expect(res.status).toBe(200);
    expect(revoke).not.toHaveBeenCalled();
  });
});
