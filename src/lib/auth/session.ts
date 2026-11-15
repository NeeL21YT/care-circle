import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { SESSION_COOKIE, SESSION_MAX_AGE_MS, serverEnv } from "@/lib/env";
import { adminAuth } from "@/lib/firebase/admin";
import { col, fromSnap } from "@/lib/db";
import { unauthorized } from "@/lib/api/errors";
import { ACCOUNT_TYPES } from "@/lib/domain/schemas";

export type AccountType = (typeof ACCOUNT_TYPES)[number];

export interface CurrentUser {
  uid: string;
  email: string;
  emailVerified: boolean;
  displayName: string;
  accountType: AccountType;
}

interface UserDoc {
  email: string;
  displayName: string;
  accountType: AccountType;
}

export async function createSession(idToken: string) {
  // Admin SDK only mints a session cookie for a recently-issued ID token.
  const value = await adminAuth().createSessionCookie(idToken, { expiresIn: SESSION_MAX_AGE_MS });
  return {
    name: SESSION_COOKIE,
    value,
    options: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax" as const,
      path: "/",
      maxAge: SESSION_MAX_AGE_MS / 1000,
    },
  };
}

async function resolveUser(token: { uid: string; email?: string; email_verified?: boolean; name?: string }): Promise<CurrentUser | null> {
  const snap = await col.users().doc(token.uid).get();
  const doc = fromSnap<UserDoc>(snap);
  // A valid Firebase identity without a profile doc means registration was not
  // completed through /api/auth/session; treat as signed-out.
  if (!doc) return null;
  return {
    uid: token.uid,
    email: doc.email ?? token.email ?? "",
    emailVerified: token.email_verified === true,
    displayName: doc.displayName || token.name || doc.email,
    accountType: doc.accountType,
  };
}

/**
 * Current user from the session cookie, or an `Authorization: Bearer <idToken>`
 * header (so future clients such as the AI assistant can call the same API).
 * Verifies against Firebase and checks for revoked sessions.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const h = await headers();
  const bearer = h.get("authorization")?.match(/^Bearer (.+)$/i)?.[1];
  try {
    if (bearer) {
      return await resolveUser(await adminAuth().verifyIdToken(bearer, true));
    }
    const cookie = (await cookies()).get(SESSION_COOKIE)?.value;
    if (!cookie) return null;
    return await resolveUser(await adminAuth().verifySessionCookie(cookie, true));
  } catch (e) {
    // Log the Firebase error CODE only (never the token) so misconfiguration is diagnosable.
    console.error("[auth] session verification failed:", (e as { code?: string })?.code ?? "no-code", e instanceof Error ? e.message.slice(0, 200) : "");
    return null;
  }
});

export async function requireUser(opts: { allowUnverified?: boolean } = {}): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw unauthorized();
  if (!opts.allowUnverified && serverEnv().REQUIRE_EMAIL_VERIFICATION && !user.emailVerified) {
    throw unauthorized("Please verify your email address to continue.");
  }
  return user;
}
