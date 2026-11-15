"use client";
import { useEffect, useRef, useState } from "react";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { useAnnounce } from "@/components/a11y/announcer";
import { hasPin, isUnlocked, verifyPin } from "@/lib/client/pin";

/**
 * Convenience lock for the patient's own device. Content is rendered inert
 * (hidden from everyone, including screen readers) while locked. Wrong guesses
 * slow down. It deliberately does not replace sign-in.
 */
export function PinGate({ children }: { children: React.ReactNode }) {
  const [locked, setLocked] = useState<boolean | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [fails, setFails] = useState(0);
  const [waitUntil, setWaitUntil] = useState(0);
  const announce = useAnnounce();
  const input = useRef<HTMLInputElement>(null);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- reads browser-only storage/APIs after mount; doing it during render would cause a hydration mismatch
  useEffect(() => { setLocked(hasPin() && !isUnlocked()); }, []);
  useEffect(() => { if (locked) input.current?.focus(); }, [locked]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (Date.now() < waitUntil) { setError("Please wait a few seconds before trying again."); return; }
    if (await verifyPin(pin)) { setLocked(false); setPin(""); announce("Unlocked."); return; }
    const n = fails + 1;
    setFails(n); setPin("");
    if (n >= 3) setWaitUntil(Date.now() + Math.min(30, 2 ** n) * 1000);
    const m = "That PIN is not right. Try again, or sign out and sign in with your password.";
    setError(m); announce(m, "assertive"); input.current?.focus();
  }

  return (
    <>
      <div inert={locked ? true : undefined} aria-hidden={locked ? true : undefined}>{children}</div>
      {locked && (
        <div role="dialog" aria-modal="true" aria-labelledby="pin-title" className="fixed inset-0 z-50 flex items-center justify-center bg-background p-4">
          <form onSubmit={submit} className="w-full max-w-md space-y-5 rounded-2xl border-2 border-border bg-card p-8" noValidate>
            <h1 id="pin-title" className="flex items-center gap-3 text-3xl font-extrabold"><Lock aria-hidden="true" className="size-8" /> Enter your PIN</h1>
            <p className="text-lg text-muted-foreground">This screen is locked on this device.</p>
            <Field id="pin-input" label="PIN (4 to 6 digits)" required error={error}>
              {(a) => <Input {...a} ref={input} type="password" inputMode="numeric" autoComplete="off" pattern="[0-9]*" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} />}
            </Field>
            <Button type="submit" size="lg" className="w-full">Unlock</Button>
          </form>
        </div>
      )}
    </>
  );
}
