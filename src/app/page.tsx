import Link from "next/link";
import { redirect } from "next/navigation";
import { BellRing, CalendarDays, HeartHandshake, Mic, Pill, Users } from "lucide-react";
import { getCurrentUser } from "@/lib/auth/session";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export const dynamic = "force-dynamic";

const FEATURES = [
  { icon: <Pill />, title: "Medicine reminders", text: "Clear schedules, gentle reminders, and a simple way to say taken, skipped, or remind me later." },
  { icon: <Users />, title: "A shared care circle", text: "Patients, caregivers and family each see exactly what they should, and nothing more." },
  { icon: <CalendarDays />, title: "Appointments and documents", text: "Doctor visits, prescriptions and reports in one private place." },
  { icon: <BellRing />, title: "Reminders that escalate kindly", text: "Patient first, then a follow-up, then the caregiver, on rules you control." },
  { icon: <Mic />, title: "Made for everyone", text: "Works with screen readers and keyboards, with large text, high contrast and read-aloud." },
];

export default async function Home() {
  if (await getCurrentUser()) redirect("/dashboard");
  return (
    <div className="mx-auto flex min-h-dvh max-w-5xl flex-col px-4 py-8">
      <header className="flex items-center justify-between">
        <p className="flex items-center gap-2 text-2xl font-extrabold text-primary"><HeartHandshake aria-hidden="true" className="size-8" /> Care Circle</p>
        <nav aria-label="Account" className="flex gap-2">
          <Link href="/login" className={buttonVariants({ variant: "ghost" })}>Sign in</Link>
          <Link href="/register" className={buttonVariants()}>Create account</Link>
        </nav>
      </header>
      <main id="main-content" className="flex-1 py-12">
        <h1 id="page-title" tabIndex={-1} className="max-w-3xl text-4xl font-extrabold sm:text-6xl">Care that stays simple, for everyone involved.</h1>
        <p className="mt-6 max-w-2xl text-xl text-muted-foreground">Care Circle helps older adults follow their medicine routines and helps families and caregivers stay informed, without the confusion.</p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/register" className={buttonVariants({ size: "xl" })}>Get started</Link>
          <Link href="/login" className={buttonVariants({ size: "xl", variant: "outline" })}>Sign in</Link>
        </div>
        <section aria-labelledby="features" className="mt-16">
          <h2 id="features" className="text-2xl font-bold">What it does</h2>
          <ul className="mt-4 grid gap-4 sm:grid-cols-2">
            {FEATURES.map((f) => (
              <li key={f.title}>
                <Card className="h-full">
                  <span aria-hidden="true" className="mb-3 flex size-12 items-center justify-center rounded-xl bg-secondary text-primary [&_svg]:size-6">{f.icon}</span>
                  <h3 className="text-xl font-bold">{f.title}</h3>
                  <p className="mt-1 text-base text-muted-foreground">{f.text}</p>
                </Card>
              </li>
            ))}
          </ul>
        </section>
        <p className="mt-12 max-w-2xl text-base text-muted-foreground">Care Circle does not give medical advice, diagnose, or change any medicine. It records what people report and helps them follow the plan their own doctor gave them.</p>
      </main>
      <footer className="border-t border-border pt-6 text-base">
        <Link href="/accessibility" className="font-semibold text-primary underline">Accessibility statement</Link>
      </footer>
    </div>
  );
}
