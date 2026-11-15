import Link from "next/link";
import { HeartHandshake, Settings } from "lucide-react";
import { requirePageUser } from "@/lib/auth/page";
import { SignOutButton } from "@/components/app/sign-out-button";
import { DemoBanner } from "@/components/app/demo-banner";
import { demoRoleOf, isDemoUid } from "@/lib/demo";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePageUser();
  return (
    <div className="min-h-dvh">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-2 px-4 py-2 sm:py-3">
          <Link href="/dashboard" className="inline-flex items-center gap-2 whitespace-nowrap rounded-lg text-lg font-extrabold text-primary sm:text-xl">
            <HeartHandshake aria-hidden="true" className="size-7" /> Care Circle
          </Link>
          <nav aria-label="Account" className="flex items-center gap-1">
            <span className="mr-2 hidden text-base text-muted-foreground sm:inline">Signed in as <strong className="text-foreground">{user.displayName}</strong></span>
            <Link href="/settings" className="inline-flex min-h-12 items-center gap-2 rounded-xl px-3 font-semibold hover:bg-accent sm:px-4">
              <Settings aria-hidden="true" className="size-5" /> <span className="sr-only sm:not-sr-only">Display settings</span>
            </Link>
            <SignOutButton />
          </nav>
        </div>
      </header>
      {isDemoUid(user.uid) && <DemoBanner current={demoRoleOf(user.uid)} />}
      {children}
    </div>
  );
}
