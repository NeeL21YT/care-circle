import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { VerifyEmailPanel } from "@/components/app/auth-forms";
import { getCurrentUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Verify your email" };

export default async function Page() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.emailVerified) redirect("/dashboard");
  return <Suspense><VerifyEmailPanel email={user.email} /></Suspense>;
}
