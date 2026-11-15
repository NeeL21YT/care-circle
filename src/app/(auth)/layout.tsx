import Link from "next/link";
import { HeartHandshake } from "lucide-react";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-xl flex-col px-4 py-8">
      <header>
        <Link href="/" className="inline-flex items-center gap-2 rounded-lg text-xl font-extrabold text-primary">
          <HeartHandshake aria-hidden="true" className="size-7" /> Care Circle
        </Link>
      </header>
      <main id="main-content" className="flex flex-1 flex-col justify-center py-8">{children}</main>
      <footer className="text-center text-[0.95rem] text-muted-foreground">
        <Link href="/accessibility" className="underline">Accessibility statement</Link>
      </footer>
    </div>
  );
}
