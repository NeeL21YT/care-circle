import type { Metadata } from "next";
import Link from "next/link";
import { HeartHandshake } from "lucide-react";
import { getCurrentUser } from "@/lib/auth/session";
import { getInvitationByToken, isExpired } from "@/lib/services/care-circle";
import { Card } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { AcceptInvite } from "@/components/app/accept-invite";

export const metadata: Metadata = { title: "Care circle invitation", robots: { index: false } };
export const dynamic = "force-dynamic";

const ROLE = { patient: "the patient", primary_caregiver: "a primary caregiver", family: "a family member" } as const;

/**
 * The page reveals only the patient's NAME and role to someone holding the
 * link, and only that. Access is granted by the accept API, which requires the
 * signed-in, verified email to match the invited email.
 */
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [inv, user] = await Promise.all([getInvitationByToken(token), getCurrentUser()]);
  const valid = inv && inv.status === "pending" && !isExpired(inv);
  const next = encodeURIComponent(`/invite/${token}`);

  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col px-4 py-8">
      <header><Link href="/" className="inline-flex items-center gap-2 text-xl font-extrabold text-primary"><HeartHandshake aria-hidden="true" className="size-7" /> Care Circle</Link></header>
      <main id="main-content" className="flex flex-1 flex-col justify-center py-8">
        <Card>
          <h1 id="page-title" tabIndex={-1} className="text-3xl font-extrabold">Care circle invitation</h1>
          {!valid ? (
            <div className="mt-6"><Alert variant="warning" title="This invitation is no longer valid">It may have expired, been cancelled, or already been used. Ask the caregiver to send a new one.</Alert></div>
          ) : (
            <>
              <p className="mt-4 text-xl"><strong>{inv.invitedByName}</strong> invited you to join the care circle for <strong>{inv.patientName}</strong> as <strong>{ROLE[inv.role]}</strong>.</p>
              <p className="mt-2 text-base text-muted-foreground">The invitation was sent to <strong>{inv.email.replace(/^(.).*(@.*)$/, "$1•••$2")}</strong>. You must sign in with that email address.</p>
              {user ? (
                user.email.toLowerCase() === inv.email ? (
                  user.emailVerified ? <AcceptInvite token={token} /> : (
                    <div className="mt-6 space-y-4"><Alert variant="warning" title="Verify your email first">We need to confirm this email address is yours before you can accept.</Alert><Link className={buttonVariants({ size: "lg" })} href={`/verify-email?next=${next}`}>Verify my email</Link></div>
                  )
                ) : (
                  <div className="mt-6"><Alert variant="error" title="Wrong account">You are signed in as {user.email}, but this invitation was sent to a different email address. Sign out and sign in with the invited account.</Alert></div>
                )
              ) : (
                <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                  <Link className={buttonVariants({ size: "lg" })} href={`/login?next=${next}`}>Sign in to accept</Link>
                  <Link className={buttonVariants({ size: "lg", variant: "outline" })} href={`/register?next=${next}`}>Create an account</Link>
                </div>
              )}
            </>
          )}
        </Card>
      </main>
    </div>
  );
}
