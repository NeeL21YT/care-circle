"use client";
import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";

/** Public web config only. Safe to ship to the browser. */
function config() {
  return {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  };
}

export function isFirebaseConfigured(): boolean {
  const c = config();
  return Boolean(c.apiKey && c.authDomain && c.projectId && c.appId);
}

export function firebaseApp(): FirebaseApp {
  return getApps().length ? getApp() : initializeApp(config());
}

export function clientAuth(): Auth {
  return getAuth(firebaseApp());
}
