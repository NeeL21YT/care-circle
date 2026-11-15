"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  createUserWithEmailAndPassword, sendEmailVerification, sendPasswordResetEmail,
  signInWithEmailAndPassword, signOut, updateProfile,
} from "firebase/auth";
import { clientAuth, isFirebaseConfigured } from "@/lib/firebase/client";
import { api, errorMessage } from "@/lib/client/api";
import { authErrorMessage } from "@/lib/client/firebase-errors";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { Card } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { FormErrorSummary } from "@/components/ui/form-error-summary";
import { flattenErrors, useErrorSummary } from "@/components/ui/use-error-summary";
import { useAnnounce } from "@/components/a11y/announcer";
import { AccountTypePrompt, GoogleButton, OrDivider, startSession, type AccountType } from "./auth-parts";

/** Only same-site relative redirects are honoured (no open redirect). */
function safeNext(raw: string | null): string {
  return raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/dashboard";
}

function ConfigWarning() {
  if (isFirebaseConfigured()) return null;
  return <Alert variant="warning" title="Firebase is not configured">Add the NEXT_PUBLIC_FIREBASE_* variables from .env.example and restart the server.</Alert>;
}


// ---------------- Login ----------------
const loginSchema = z.object({
  email: z.string().trim().email("Enter your email address."),
  password: z.string().min(1, "Enter your password."),
});
type LoginValues = z.infer<typeof loginSchema>;

export function LoginForm() {
  const router = useRouter();
  const next = safeNext(useSearchParams().get("next"));
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<LoginValues>({ resolver: zodResolver(loginSchema) });
  const { ref: summaryRef, ...summary } = useErrorSummary();
  const announce = useAnnounce();
  const list = flattenErrors(errors, "login", { email: "Email", password: "Password" });
  const [choosing, setChoosing] = useState(false);

  async function finish(accountType?: AccountType) {
    const r = await startSession(accountType);
    if (r.needsAccountType) { setChoosing(true); return; }
    announce("Signed in.");
    router.replace(next);
    router.refresh();
  }

  async function onSubmit(v: LoginValues) {
    summary.setServerMessage(undefined);
    try {
      await signInWithEmailAndPassword(clientAuth(), v.email, v.password);
      await finish();
    } catch (e) {
      summary.setServerMessage(e instanceof Error && e.name === "ApiError" ? errorMessage(e) : authErrorMessage(e));
      summary.focusSummary();
    }
  }

  if (choosing) return <AccountTypePrompt onChoose={(t) => finish(t)} />;

  return (
    <Card>
      <h1 id="page-title" tabIndex={-1} className="text-3xl font-extrabold">Sign in</h1>
      <p className="mt-2 text-lg text-muted-foreground">Welcome back. Sign in to see today&apos;s care plan.</p>
      <div className="mt-6 space-y-5">
        <ConfigWarning />
        <GoogleButton onAuthenticated={() => finish()} onError={(m) => { summary.setServerMessage(m); announce(m, "assertive"); summary.focusSummary(); }} />
        <OrDivider />
      </div>
      <form className="mt-5 space-y-5" noValidate onSubmit={handleSubmit(onSubmit, summary.focusSummary)} aria-describedby={undefined}>
        <FormErrorSummary ref={summaryRef} errors={list} message={summary.serverMessage} />
        <Field id="login-email" label="Email address" required error={errors.email?.message}>
          {(a) => <Input {...a} type="email" autoComplete="email" inputMode="email" {...register("email")} />}
        </Field>
        <Field id="login-password" label="Password" required error={errors.password?.message}>
          {(a) => <Input {...a} type="password" autoComplete="current-password" {...register("password")} />}
        </Field>
        <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>{isSubmitting ? "Signing in…" : "Sign in"}</Button>
      </form>
      <p className="mt-6 text-base">
        <Link href="/forgot-password" className="font-semibold text-primary underline">Forgot your password?</Link>
      </p>
      <p className="mt-2 text-base">
        New here? <Link href={`/register${next !== "/dashboard" ? `?next=${encodeURIComponent(next)}` : ""}`} className="font-semibold text-primary underline">Create an account</Link>
      </p>
    </Card>
  );
}

// ---------------- Register ----------------
const registerSchema = z.object({
  displayName: z.string().trim().min(2, "Enter your name.").max(80),
  email: z.string().trim().email("Enter a valid email address."),
  accountType: z.enum(["caregiver", "patient", "family"]),
  password: z.string().min(8, "Use at least 8 characters.").max(128),
});
type RegisterValues = z.infer<typeof registerSchema>;

export function RegisterForm() {
  const router = useRouter();
  const next = safeNext(useSearchParams().get("next"));
  const { register, handleSubmit, control, formState: { errors, isSubmitting } } = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema), defaultValues: { accountType: "caregiver" },
  });
  const { ref: summaryRef, ...summary } = useErrorSummary();
  const announce = useAnnounce();
  const list = flattenErrors(errors, "reg", { displayName: "Your name", email: "Email", accountType: "Account type", password: "Password" });
  const chosenType = useWatch({ control, name: "accountType" });

  async function googleDone() {
    await startSession(chosenType);
    announce("Signed in with Google.");
    router.replace(next);
    router.refresh();
  }

  async function onSubmit(v: RegisterValues) {
    summary.setServerMessage(undefined);
    try {
      const cred = await createUserWithEmailAndPassword(clientAuth(), v.email, v.password);
      await updateProfile(cred.user, { displayName: v.displayName });
      await sendEmailVerification(cred.user);
      await startSession(v.accountType);
      announce("Account created. Check your email to verify your address.");
      router.replace(`/verify-email${next !== "/dashboard" ? `?next=${encodeURIComponent(next)}` : ""}`);
      router.refresh();
    } catch (e) {
      summary.setServerMessage(e instanceof Error && e.name === "ApiError" ? errorMessage(e) : authErrorMessage(e));
      summary.focusSummary();
    }
  }

  return (
    <Card>
      <h1 id="page-title" tabIndex={-1} className="text-3xl font-extrabold">Create your account</h1>
      <p className="mt-2 text-lg text-muted-foreground">Everyone in a care circle has their own account. Please do not share logins.</p>
      <form className="mt-6 space-y-5" noValidate onSubmit={handleSubmit(onSubmit, summary.focusSummary)}>
        <ConfigWarning />
        <FormErrorSummary ref={summaryRef} errors={list} message={summary.serverMessage} />
        <Field id="reg-displayName" label="Your name" required error={errors.displayName?.message}>
          {(a) => <Input {...a} autoComplete="name" {...register("displayName")} />}
        </Field>
        <Field id="reg-email" label="Email address" required error={errors.email?.message} hint="If you were invited to a care circle, use the email address the invitation was sent to.">
          {(a) => <Input {...a} type="email" autoComplete="email" inputMode="email" {...register("email")} />}
        </Field>
        <Field id="reg-accountType" label="I am a" required error={errors.accountType?.message} hint="This sets up the right home screen. Your access to a patient is decided by the care circle, not by this choice.">
          {(a) => (
            <Select {...a} {...register("accountType")}>
              <option value="caregiver">Caregiver (I manage someone&apos;s care)</option>
              <option value="patient">Patient (I need care)</option>
              <option value="family">Family member (I support someone)</option>
            </Select>
          )}
        </Field>
        <Field id="reg-password" label="Password" required error={errors.password?.message} hint="At least 8 characters.">
          {(a) => <Input {...a} type="password" autoComplete="new-password" {...register("password")} />}
        </Field>
        <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>{isSubmitting ? "Creating account…" : "Create account"}</Button>
        <OrDivider />
        <GoogleButton onAuthenticated={googleDone} onError={(m) => { summary.setServerMessage(m); announce(m, "assertive"); summary.focusSummary(); }} />
        <p className="text-[0.95rem] text-muted-foreground">Google sign-up uses the “I am a” choice above.</p>
      </form>
      <p className="mt-6 text-base">
        Already have an account? <Link href="/login" className="font-semibold text-primary underline">Sign in</Link>
      </p>
    </Card>
  );
}

// ---------------- Forgot password ----------------
const forgotSchema = z.object({ email: z.string().trim().email("Enter your email address.") });

export function ForgotPasswordForm() {
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<{ email: string }>({ resolver: zodResolver(forgotSchema) });
  const [sent, setSent] = useState(false);
  const { ref: summaryRef, ...summary } = useErrorSummary();
  const announce = useAnnounce();
  const list = flattenErrors(errors, "forgot", { email: "Email" });

  async function onSubmit(v: { email: string }) {
    try { await sendPasswordResetEmail(clientAuth(), v.email); } catch { /* never reveal whether the account exists */ }
    setSent(true);
    announce("If an account exists for that email, a reset link has been sent.");
  }

  return (
    <Card>
      <h1 id="page-title" tabIndex={-1} className="text-3xl font-extrabold">Reset your password</h1>
      {sent ? (
        <div className="mt-6 space-y-4">
          <Alert variant="success" title="Check your email">If an account exists for that address, we have sent a link to choose a new password.</Alert>
          <Link href="/login" className="inline-block font-semibold text-primary underline">Back to sign in</Link>
        </div>
      ) : (
        <form className="mt-6 space-y-5" noValidate onSubmit={handleSubmit(onSubmit, summary.focusSummary)}>
          <ConfigWarning />
          <FormErrorSummary ref={summaryRef} errors={list} />
          <Field id="forgot-email" label="Email address" required error={errors.email?.message}>
            {(a) => <Input {...a} type="email" autoComplete="email" inputMode="email" {...register("email")} />}
          </Field>
          <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>Send reset link</Button>
          <p><Link href="/login" className="font-semibold text-primary underline">Back to sign in</Link></p>
        </form>
      )}
    </Card>
  );
}

// ---------------- Verify email ----------------
export function VerifyEmailPanel({ email }: { email: string }) {
  const router = useRouter();
  const next = safeNext(useSearchParams().get("next"));
  const announce = useAnnounce();
  const [busy, setBusy] = useState<"check" | "resend" | null>(null);
  const [message, setMessage] = useState<{ kind: "info" | "error" | "success"; text: string } | null>(null);
  const checked = useRef(false);

  async function check() {
    setBusy("check");
    try {
      const u = clientAuth().currentUser;
      if (!u) { router.replace("/login"); return; }
      await u.reload();
      if (u.emailVerified) {
        await startSession();
        announce("Email verified. Taking you to your dashboard.");
        router.replace(next);
        router.refresh();
      } else {
        setMessage({ kind: "info", text: "Your email is not verified yet. Open the link we sent, then try again." });
        announce("Your email is not verified yet.");
      }
    } catch (e) {
      setMessage({ kind: "error", text: authErrorMessage(e) });
    } finally { setBusy(null); }
  }
  async function resend() {
    setBusy("resend");
    try {
      const u = clientAuth().currentUser;
      if (!u) { router.replace("/login"); return; }
      await sendEmailVerification(u);
      setMessage({ kind: "success", text: `We sent a new verification link to ${email}.` });
      announce("Verification email sent.");
    } catch (e) {
      setMessage({ kind: "error", text: authErrorMessage(e) });
    } finally { setBusy(null); }
  }
  async function logout() {
    await api("/api/auth/logout", { method: "POST" }).catch(() => {});
    await signOut(clientAuth()).catch(() => {});
    router.replace("/login");
    router.refresh();
  }
  useEffect(() => { checked.current = true; }, []);

  return (
    <Card>
      <h1 id="page-title" tabIndex={-1} className="text-3xl font-extrabold">Verify your email</h1>
      <p className="mt-3 text-lg">We sent a verification link to <strong>{email}</strong>. Open it, then come back and choose <em>I have verified</em>.</p>
      <p className="mt-2 text-base text-muted-foreground">Verifying keeps patient information safe: only the person who owns this email address can accept care-circle invitations.</p>
      <div className="mt-6 space-y-3" aria-live="polite">
        {message && <Alert variant={message.kind === "error" ? "error" : message.kind === "success" ? "success" : "info"} title={message.text} />}
      </div>
      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <Button size="lg" onClick={check} loading={busy === "check"}>I have verified</Button>
        <Button size="lg" variant="outline" onClick={resend} loading={busy === "resend"}>Send the email again</Button>
      </div>
      <p className="mt-6"><button type="button" onClick={logout} className="font-semibold text-primary underline">Sign out</button></p>
    </Card>
  );
}
