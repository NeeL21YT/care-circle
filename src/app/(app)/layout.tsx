import Link from "next/link";
import { HeartHandshake, Settings } from "lucide-react";
import { requirePageUser } from "@/lib/auth/page";
import { SignOutButton } from "@/components/app/sign-out-button";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePageUser();
  return (
    <div className="min-h-dvh">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <Link href="/dashboard" className="inline-flex items-center gap-2 rounded-lg text-xl font-extrabold text-primary">
            <HeartHandshake aria-hidden="true" className="size-7" /> Care Circle
          </Link>
          <nav aria-label="Account" className="flex flex-wrap items-center gap-1">
            <span className="mr-2 hidden text-base text-muted-foreground sm:inline">Signed in as <strong className="text-foreground">{user.displayName}</strong></span>
            <Link href="/settings" className="inline-flex min-h-12 items-center gap-2 rounded-xl px-4 font-semibold hover:bg-accent">
              <Settings aria-hidden="true" className="size-5" /> Display settings
            </Link>
            <SignOutButton />
          </nav>
        </div>
      </header>
      {children}
    </div>
  );
}
