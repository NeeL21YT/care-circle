import "server-only";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser, type CurrentUser } from "./session";
import { requirePatientAccess, type PatientAccess } from "./access";
import { serverEnv } from "@/lib/env";
import type { Action } from "@/lib/domain/permissions";
import { ForbiddenError } from "@/lib/domain/permissions";
import { HttpError } from "@/lib/api/errors";

/** For Server Components/pages: redirects to sign-in / verification instead of throwing. */
export async function requirePageUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (serverEnv().REQUIRE_EMAIL_VERIFICATION && !user.emailVerified) redirect("/verify-email");
  return user;
}

/**
 * Page-level patient authorization. Non-members get the 404 page; members who
 * lack `action` get the 404 page too (no hint that the section exists).
 */
export async function requirePagePatient(patientId: string, action: Action): Promise<{ user: CurrentUser } & PatientAccess> {
  const user = await requirePageUser();
  try {
    return { user, ...(await requirePatientAccess(user.uid, patientId, action)) };
  } catch (e) {
    if (e instanceof HttpError || e instanceof ForbiddenError) notFound();
    throw e;
  }
}
