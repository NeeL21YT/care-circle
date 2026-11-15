import "server-only";
import { serverEnv } from "@/lib/env";
import { invitationEmail, type RenderedEmail } from "./templates";
import type { Invitation } from "@/lib/services/care-circle";

export interface SendResult {
  sent: boolean;
  providerMessageId: string | null;
  error: string | null;
  /** "not_configured" when BREVO_API_KEY is absent (dev/demo). */
  skipped?: "not_configured";
}

let sender: ((args: { to: string; email: RenderedEmail; idempotencyKey?: string }) => Promise<SendResult>) | null = null;

/** Test seam. */
export function __setEmailSender(s: typeof sender) {
  sender = s;
}

/**
 * Sends one transactional email through Brevo (https://developers.brevo.com).
 * The provider outcome is recorded by the caller as DELIVERY status, which is
 * entirely separate from patient acknowledgement of a dose.
 *
 * Duplicate protection: Brevo has no idempotency-key header, so we rely on our
 * own lease-based claim and deterministic notification ids. The only residual
 * case is "provider accepted the email but the response was lost", which can
 * cause one repeat on retry.
 */
export async function sendEmail(args: { to: string; email: RenderedEmail; idempotencyKey?: string }): Promise<SendResult> {
  if (sender) return sender(args);
  const env = serverEnv();
  if (!env.BREVO_API_KEY) {
    return { sent: false, providerMessageId: null, error: null, skipped: "not_configured" };
  }
  try {
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": env.BREVO_API_KEY, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        sender: { name: env.EMAIL_FROM_NAME, email: env.EMAIL_FROM_ADDRESS },
        to: [{ email: args.to }],
        subject: args.email.subject,
        htmlContent: args.email.html,
        textContent: args.email.text,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json().catch(() => ({}))) as { messageId?: string; code?: string; message?: string };
    if (!res.ok) return { sent: false, providerMessageId: null, error: `Brevo ${res.status}: ${json.code ?? ""} ${json.message ?? ""}`.trim() };
    return { sent: true, providerMessageId: json.messageId ?? null, error: null };
  } catch (e) {
    return { sent: false, providerMessageId: null, error: e instanceof Error ? e.message : "send failed" };
  }
}

const ROLE_LABEL = { patient: "the patient", primary_caregiver: "a primary caregiver", family: "a family member" } as const;

export async function sendInvitationEmail({ invitation, token }: { invitation: Invitation; token: string }) {
  const env = serverEnv();
  const email = invitationEmail({
    inviterName: invitation.invitedByName,
    patientName: invitation.patientName,
    roleLabel: ROLE_LABEL[invitation.role],
    expiresText: "in 7 days",
    acceptUrl: `${env.APP_URL}/invite/${token}`,
  });
  return sendEmail({ to: invitation.email, email, idempotencyKey: `invite_${invitation.id}` });
}
