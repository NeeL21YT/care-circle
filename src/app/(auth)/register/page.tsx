import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { RegisterForm } from "@/components/app/auth-forms";
import { getCurrentUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Create account" };

export default async function Page() {
  if (await getCurrentUser()) redirect("/dashboard");
  return <Suspense><RegisterForm /></Suspense>;
}
