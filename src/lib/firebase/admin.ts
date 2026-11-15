import "server-only";
import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { serverEnv } from "@/lib/env";

/** Lazily-initialized Firebase Admin. Credentials never leave the server. */
function adminApp(): App {
  const existing = getApps()[0];
  if (existing) return existing;
  const env = serverEnv();
  return initializeApp({
    credential: cert({
      projectId: env.FIREBASE_PROJECT_ID,
      clientEmail: env.FIREBASE_CLIENT_EMAIL,
      // Env files escape newlines in the private key.
      privateKey: env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    }),
  });
}

let firestoreOverride: Firestore | null = null;
let firestoreInstance: Firestore | null = null;

export function adminDb(): Firestore {
  if (firestoreOverride) return firestoreOverride;
  if (!firestoreInstance) {
    firestoreInstance = getFirestore(adminApp());
    try {
      // FIRESTORE_TRANSPORT=rest avoids gRPC connection stalls seen on some home/office networks (useful for local
    // development). On Vercel the default (gRPC) is fine and slightly faster.
    firestoreInstance.settings({ ignoreUndefinedProperties: true, ...(process.env.FIRESTORE_TRANSPORT === "rest" ? { preferRest: true } : {}) });
    } catch {
      // After a hot reload (dev) or a warm serverless instance the shared Firestore client was already
      // configured by an earlier module instance. That is fine: the setting is already in place.
    }
  }
  return firestoreInstance;
}

/** Test seam: inject an in-memory Firestore fake. */
export function __setDbForTests(db: unknown | null) {
  firestoreOverride = db as Firestore | null;
}

export function adminAuth(): Auth {
  return getAuth(adminApp());
}
