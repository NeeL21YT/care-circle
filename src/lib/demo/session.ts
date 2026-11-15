import "server-only";
import { adminAuth } from "@/lib/firebase/admin";
import { createSession } from "@/lib/auth/session";
import { HttpError } from "@/lib/api/errors";
import { DEMO_UIDS, type DemoRole } from "./index";
import { ensureDemoWorld } from "./seed";

/**
 * Signs a visitor in as one of the three demo people. Uses a Firebase custom
 * token (minted by the server for a fixed demo uid only) exchanged for an ID
 * token, then the SAME session cookie as a normal sign-in.
 */
export async function startDemoSession(role: DemoRole) {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  if (!apiKey) throw new HttpError(503, "demo_unavailable", "The demo is not configured on this server.");
  // Independent steps run together: checking the demo data and minting the sign-in token.
  const [patientId, customToken] = await Promise.all([ensureDemoWorld(), adminAuth().createCustomToken(DEMO_UIDS[role])]);
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: customToken, returnSecureToken: true }),
  });
  const json = (await res.json().catch(() => ({}))) as { idToken?: string };
  if (!res.ok || !json.idToken) throw new HttpError(503, "demo_unavailable", "The demo could not start. Please try again.");
  return { cookie: await createSession(json.idToken), patientId };
}
