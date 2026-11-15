import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { route } from "@/lib/api/handler";
import { SESSION_COOKIE } from "@/lib/env";
import { adminAuth } from "@/lib/firebase/admin";

export const POST = route({ auth: "none" }, async () => {
  const jar = await cookies();
  const value = jar.get(SESSION_COOKIE)?.value;
  if (value) {
    try {
      const claims = await adminAuth().verifySessionCookie(value);
      // Invalidate this session everywhere it might be copied.
      await adminAuth().revokeRefreshTokens(claims.uid);
    } catch {
      /* already invalid: fine */
    }
  }
  const res = NextResponse.json({ data: { ok: true } });
  res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
});
