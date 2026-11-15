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
    firestoreInstance.settings({ ignoreUndefinedProperties: true });
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
