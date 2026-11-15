import { NextResponse } from "next/server";
import { route } from "@/lib/api/handler";
import { sessionSchema } from "@/lib/domain/schemas";
import { adminAuth } from "@/lib/firebase/admin";
import { col } from "@/lib/db";
import { createSession } from "@/lib/auth/session";
import { LIMITS } from "@/lib/api/rate-limit";
import { unauthorized } from "@/lib/api/errors";

/**
 * Exchanges a fresh Firebase ID token for an httpOnly session cookie and
 * creates the user's profile document on first sign-in. Called after
 * register, login and email verification.
 */
export const POST = route({ auth: "none", body: sessionSchema, rateLimit: LIMITS.auth }, async ({ body }) => {
  let decoded;
  try {
    decoded = await adminAuth().verifyIdToken(body.idToken, true);
  } catch {
    throw unauthorized("Your sign-in could not be verified. Please try again.");
  }
  const ref = col.users().doc(decoded.uid);
  const snap = await ref.get();
  if (!snap.exists) {
    // First sign-in with no chosen account type (e.g. Google on the login page):
    // do NOT guess. Ask the client to choose; no session is created yet.
    if (!body.accountType) return NextResponse.json({ data: { needsAccountType: true } }, { headers: { "Cache-Control": "no-store" } });
    await ref.set({
      uid: decoded.uid,
      email: (decoded.email ?? "").toLowerCase(),
      displayName: decoded.name ?? decoded.email ?? "",
      accountType: body.accountType,
      createdAt: new Date(),
    });
  }
  const cookie = await createSession(body.idToken);
  const res = NextResponse.json({ data: { uid: decoded.uid, emailVerified: decoded.email_verified === true } });
  res.cookies.set(cookie.name, cookie.value, cookie.options);
  return res;
});
