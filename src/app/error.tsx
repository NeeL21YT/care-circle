"use client";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error("[ui] route error", error.digest ?? ""); }, [error]);
  return (
    <main id="main-content" role="alert" className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center px-4 py-8">
      <h1 id="page-title" tabIndex={-1} className="text-4xl font-extrabold">Something went wrong</h1>
      <p className="mt-3 text-lg text-muted-foreground">We could not load this page. Your information is safe. Please try again.</p>
      <p className="mt-6"><Button size="lg" onClick={reset}>Try again</Button></p>
    </main>
  );
}
