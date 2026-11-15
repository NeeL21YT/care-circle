import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main id="main-content" className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center px-4 py-8">
      <h1 id="page-title" tabIndex={-1} className="text-4xl font-extrabold">We could not find that page</h1>
      <p className="mt-3 text-lg text-muted-foreground">It may have moved, or you may not have access to it.</p>
      <p className="mt-6"><Link href="/dashboard" className={buttonVariants({ size: "lg" })}>Go to my dashboard</Link></p>
    </main>
  );
}
