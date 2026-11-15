/** Friendly, non-enumerating messages for Firebase Auth error codes. */
export function authErrorMessage(e: unknown): string {
  const code = (e as { code?: string })?.code ?? "";
  switch (code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
    case "auth/invalid-email":
      return "That email and password do not match. Check them and try again, or reset your password.";
    case "auth/email-already-in-use":
      return "An account with this email already exists. Try signing in instead.";
    case "auth/weak-password":
      return "Choose a stronger password with at least 8 characters.";
    case "auth/too-many-requests":
      return "Too many attempts. Please wait a few minutes and try again.";
    case "auth/network-request-failed":
      return "We could not reach the server. Check your internet connection and try again.";
    case "auth/user-disabled":
      return "This account has been disabled. Contact support for help.";
    case "auth/operation-not-allowed":
    case "auth/configuration-not-found":
      return "Email and password sign-in is not turned on for this project. In the Firebase console, open Authentication, then Sign-in method, and enable Email/Password.";
    case "auth/popup-closed-by-user":
    case "auth/cancelled-popup-request":
      return "Google sign-in was closed before it finished. Try again when you are ready.";
    case "auth/popup-blocked":
      return "Your browser blocked the Google sign-in window. Allow pop-ups for this site and try again.";
    case "auth/account-exists-with-different-credential":
      return "An account with this email already exists using a different sign-in method. Sign in with your password instead.";
    case "auth/unauthorized-domain":
      return "This web address is not allowed for sign-in. Add it under Authentication, Settings, Authorized domains in the Firebase console.";
    case "auth/invalid-api-key":
    case "auth/api-key-not-valid.-please-pass-a-valid-api-key.":
      return "The Firebase web API key is missing or wrong. Check the NEXT_PUBLIC_FIREBASE_* values and restart the server.";
    default:
      // Show the code while developing so setup problems are diagnosable.
      return process.env.NODE_ENV !== "production" && code
        ? `Something went wrong (${code}). Please try again.`
        : "Something went wrong. Please try again.";
  }
}
