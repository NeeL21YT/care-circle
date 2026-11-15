import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Accessibility, ArrowRightLeft, BellRing, CalendarDays, CheckCircle2, ClipboardCheck, Clock, HeartHandshake, Pill, ScanLine, ShieldCheck, UserPlus, Users,
} from "lucide-react";
import { getCurrentUser } from "@/lib/auth/session";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusChip } from "@/components/ui/status";
import { DemoRoleButtons } from "@/components/app/demo-start";
import { demoEnabled } from "@/lib/demo";

export const dynamic = "force-dynamic";

const FEATURES = [
  { icon: <Pill />, title: "Medicine reminders", text: "Clear schedules, gentle reminders, and a simple way to say taken, skipped, or remind me later." },
  { icon: <Users />, title: "A shared care circle", text: "Patients, caregivers and family each see exactly what they should, and nothing more." },
  { icon: <CalendarDays />, title: "Appointments and documents", text: "Doctor visits, prescriptions and reports in one private place." },
  { icon: <BellRing />, title: "Reminders that escalate kindly", text: "Patient first, then a follow-up, then the caregiver, on rules you control." },
  { icon: <ScanLine />, title: "Prescription scanner", text: "Photograph a prescription. AI drafts it, you check every detail, and nothing is added until you approve." },
  { icon: <Accessibility />, title: "Made for everyone", text: "Works with screen readers and keyboards, with large text, high contrast and read-aloud." },
];

const STEPS = [
  { icon: <UserPlus />, title: "Add the person you care for", text: "Create a profile and their medicines in a few minutes." },
  { icon: <Users />, title: "Invite family and choose what they see", text: "Each person gets their own access that you can change or remove." },
  { icon: <ClipboardCheck />, title: "Share the load", text: "Reminders, tasks and handovers keep everyone on the same page." },
];

/** Decorative illustration with made-up data. Hidden from assistive technology, which gets the feature list instead. */
function ExampleScreen() {
  return (
    <figure aria-hidden="true" className="mx-auto w-full max-w-md">
      <div className="card-surface space-y-4 rounded-3xl border border-border bg-card p-5 shadow-[0_12px_40px_rgba(11,107,99,0.12)]">
        <div className="flex items-center justify-between">
          <p className="text-lg font-bold">Good morning</p>
          <StatusChip tone="info" icon={<Clock />}>Today</StatusChip>
        </div>
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-surface-tint p-4">
            <div>
              <p className="text-lg font-bold">Morning tablet</p>
              <p className="text-base text-muted-foreground">8:00 AM · with breakfast</p>
            </div>
            <StatusChip tone="success" icon={<CheckCircle2 />}>Reported taken</StatusChip>
          </div>
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-border p-4">
            <div>
              <p className="text-lg font-bold">Evening tablet</p>
              <p className="text-base text-muted-foreground">8:00 PM</p>
            </div>
            <StatusChip tone="neutral" icon={<Clock />}>Reminder at 8 PM</StatusChip>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-2xl bg-secondary p-4 text-secondary-foreground">
          <ArrowRightLeft className="size-6 shrink-0" />
          <p className="text-base font-semibold">Meera shared a handover with Rahul.</p>
        </div>
      </div>
      <figcaption className="mt-3 text-center text-sm text-muted-foreground">Example screen with made-up information</figcaption>
    </figure>
  );
}

export default async function Home() {
  if (await getCurrentUser()) redirect("/dashboard");
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-6">
        <p className="flex items-center gap-2 text-2xl font-extrabold text-primary"><HeartHandshake aria-hidden="true" className="size-8" /> Care Circle</p>
        <nav aria-label="Account" className="flex gap-2">
          <Link href="/login" className={buttonVariants({ variant: "ghost" })}>Sign in</Link>
          <Link href="/register" className={buttonVariants()}>Create account</Link>
        </nav>
      </header>

      <main id="main-content" className="flex-1">
        <section className="border-b border-border" style={{ backgroundImage: "linear-gradient(180deg, var(--surface-tint), var(--background))" }}>
          <div className="mx-auto grid w-full max-w-6xl items-center gap-12 px-4 py-14 lg:grid-cols-[1.1fr_0.9fr] lg:py-20">
            <div>
              <h1 id="page-title" tabIndex={-1} className="text-4xl font-extrabold sm:text-5xl lg:text-6xl">Care that stays simple, for everyone involved.</h1>
              <p className="mt-6 max-w-xl text-xl text-muted-foreground">Care Circle helps older adults follow their medicine routines and helps families and caregivers stay informed, without the confusion.</p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link href="/register" className={buttonVariants({ size: "xl" })}>Get started</Link>
                <Link href="/login" className={buttonVariants({ size: "xl", variant: "outline" })}>Sign in</Link>
              </div>
              {demoEnabled() && (
                <div className="mt-8 rounded-2xl border-2 border-primary bg-surface p-4">
                  <h2 className="text-lg font-bold">Just looking? Try the demo</h2>
                  <p className="mb-3 text-base text-muted-foreground">No sign-up. Explore the real app with made-up family data.</p>
                  <DemoRoleButtons />
                </div>
              )}
              <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-base font-semibold text-secondary-foreground">
                <li className="flex items-center gap-2"><ShieldCheck aria-hidden="true" className="size-5 text-primary" /> No medical advice</li>
                <li className="flex items-center gap-2"><Accessibility aria-hidden="true" className="size-5 text-primary" /> Built for screen readers</li>
                <li className="flex items-center gap-2"><Users aria-hidden="true" className="size-5 text-primary" /> You choose who sees what</li>
              </ul>
            </div>
            <ExampleScreen />
          </div>
        </section>

        <section aria-labelledby="features" className="mx-auto w-full max-w-6xl px-4 py-16">
          <h2 id="features" className="text-center text-3xl font-bold">Everything the family needs, in one place</h2>
          <ul className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <li key={f.title}>
                <Card className="h-full">
                  <span aria-hidden="true" className="mb-4 flex size-12 items-center justify-center rounded-xl bg-secondary text-primary [&_svg]:size-6">{f.icon}</span>
                  <h3 className="text-xl font-bold">{f.title}</h3>
                  <p className="mt-2 text-base text-muted-foreground">{f.text}</p>
                </Card>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="how" className="border-y border-border bg-surface">
          <div className="mx-auto w-full max-w-6xl px-4 py-16">
            <h2 id="how" className="text-center text-3xl font-bold">How it works</h2>
            <ol className="mt-10 grid gap-8 md:grid-cols-3">
              {STEPS.map((s, i) => (
                <li key={s.title} className="flex flex-col items-center text-center">
                  <span className="flex size-14 items-center justify-center rounded-full bg-primary text-xl font-extrabold text-primary-foreground"><span className="sr-only">Step </span>{i + 1}</span>
                  <h3 className="mt-4 text-xl font-bold">{s.title}</h3>
                  <p className="mt-2 max-w-xs text-base text-muted-foreground">{s.text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section aria-labelledby="trust" className="mx-auto w-full max-w-4xl px-4 py-16">
          <div className="card-surface rounded-3xl border border-border bg-secondary p-8 text-center text-secondary-foreground">
            <ShieldCheck aria-hidden="true" className="mx-auto size-10 text-primary" />
            <h2 id="trust" className="mt-3 text-2xl font-bold">Careful by design</h2>
            <p className="mx-auto mt-3 max-w-2xl text-lg">Care Circle does not give medical advice, diagnose, or change any medicine. It records what people report and helps them follow the plan their own doctor gave them. &quot;Reported taken&quot; always means the person said so, never that it was checked.</p>
          </div>
          <div className="mt-12 text-center">
            <h2 className="text-2xl font-bold">Ready to bring the family together?</h2>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Link href="/register" className={buttonVariants({ size: "xl" })}>Create a free account</Link>
              <Link href="/login" className={buttonVariants({ size: "xl", variant: "outline" })}>Sign in</Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-base">
          <p className="flex items-center gap-2 font-bold text-primary"><HeartHandshake aria-hidden="true" className="size-5" /> Care Circle</p>
          <Link href="/accessibility" className="font-semibold text-primary underline">Accessibility statement</Link>
        </div>
      </footer>
    </div>
  );
}
