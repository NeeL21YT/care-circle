"use client";
import { useEffect, useRef, useState } from "react";
import { GoogleAuthProvider, signInWithPopup } from "firebase/auth";
import { clientAuth } from "@/lib/firebase/client";
import { api, errorMessage } from "@/lib/client/api";
import { authErrorMessage } from "@/lib/client/firebase-errors";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";

export type AccountType = "caregiver" | "patient" | "family";

/** Returns `needsAccountType` when the server has no profile yet and none was chosen. */
export async function startSession(accountType?: AccountType): Promise<{ needsAccountType: boolean }> {
  const user = clientAuth().currentUser;
  if (!user) throw new Error("no user");
  const idToken = await user.getIdToken(true);
  const r = await api<{ needsAccountType?: boolean }>("/api/auth/session", { method: "POST", body: { idToken, accountType } });
  return { needsAccountType: Boolean(r?.needsAccountType) };
}

function GoogleIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5">
      <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.8z" />
      <path fill="#34A853" d="M12 24c3.2 0 6-1.1 7.9-2.9l-3.9-3c-1.1.7-2.5 1.2-4 1.2-3.1 0-5.7-2.1-6.6-4.9H1.4v3.1A12 12 0 0 0 12 24z" />
      <path fill="#FBBC05" d="M5.4 14.4a7.2 7.2 0 0 1 0-4.6V6.7H1.4a12 12 0 0 0 0 10.8l4-3.1z" />
      <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.4 6.7l4 3.1C6.3 6.9 8.9 4.8 12 4.8z" />
    </svg>
  );
}

/**
 * "Continue with Google" using Firebase's popup flow. Google accounts arrive
 * with a verified email, so they skip the verification step. The visible text
 * carries the meaning; the logo is decorative.
 */
export function GoogleButton({ onAuthenticated, onError, disabled }: { onAuthenticated: () => Promise<void>; onError: (m: string) => void; disabled?: boolean }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button type="button" size="lg" variant="outline" className="w-full" loading={busy} disabled={disabled} onClick={async () => {
      setBusy(true);
      try {
        await signInWithPopup(clientAuth(), new GoogleAuthProvider());
        await onAuthenticated();
      } catch (e) {
        onError(e instanceof Error && e.name === "ApiError" ? errorMessage(e) : authErrorMessage(e));
      } finally { setBusy(false); }
    }}>
      <GoogleIcon /> Continue with Google
    </Button>
  );
}

export function OrDivider() {
  return (
    <div className="flex items-center gap-3 text-base text-muted-foreground" role="separator" aria-label="or">
      <span aria-hidden="true" className="h-px flex-1 bg-border" /><span aria-hidden="true">or</span><span aria-hidden="true" className="h-px flex-1 bg-border" />
    </div>
  );
}

const TYPE_OPTIONS: { value: AccountType; label: string; hint: string }[] = [
  { value: "caregiver", label: "Caregiver", hint: "I manage someone's care." },
  { value: "patient", label: "Patient", hint: "I need care and want my reminders." },
  { value: "family", label: "Family member", hint: "I support someone." },
];

/** Asked once, for people signing in for the first time without choosing a role. */
export function AccountTypePrompt({ onChoose }: { onChoose: (t: AccountType) => Promise<void> }) {
  const [type, setType] = useState<AccountType>("caregiver");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { headingRef.current?.focus(); }, []);
  return (
    <Card>
      <h1 ref={headingRef} id="page-title" tabIndex={-1} className="text-3xl font-extrabold">One last step</h1>
      <p className="mt-2 text-lg text-muted-foreground">Tell us how you will use Care Circle. This sets up your home screen. Access to a patient is always decided by the care circle, never by this choice.</p>
      <form className="mt-6 space-y-5" onSubmit={async (e) => {
        e.preventDefault(); setBusy(true); setError(null);
        try { await onChoose(type); } catch (err) { setError(err instanceof Error && err.name === "ApiError" ? errorMessage(err) : authErrorMessage(err)); } finally { setBusy(false); }
      }}>
        {error && <Alert variant="error" title={error} />}
        <fieldset className="space-y-3">
          <legend className="text-base font-semibold">I am a</legend>
          {TYPE_OPTIONS.map((o) => (
            <div key={o.value} className="flex items-start gap-3 rounded-xl border-2 border-border bg-surface p-4 has-[:checked]:border-primary has-[:checked]:bg-secondary">
              <input id={`type-${o.value}`} type="radio" name="accountType" value={o.value} checked={type === o.value} onChange={() => setType(o.value)} className="mt-1 size-6 accent-[var(--primary)]" />
              <label htmlFor={`type-${o.value}`} className="text-base"><span className="font-semibold">{o.label}</span><span className="block text-[0.95rem] text-muted-foreground">{o.hint}</span></label>
            </div>
          ))}
        </fieldset>
        <Button type="submit" size="lg" className="w-full" loading={busy}>Continue</Button>
      </form>
    </Card>
  );
}
