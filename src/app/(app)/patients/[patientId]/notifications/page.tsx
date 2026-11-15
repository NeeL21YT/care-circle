import type { Metadata } from "next";
import Link from "next/link";
import { Bell } from "lucide-react";
import { requirePagePatient } from "@/lib/auth/page";
import { listNotifications } from "@/lib/services/notifications";
import { PageHeader, EmptyState } from "@/components/ui/page-header";
import { StatusChip } from "@/components/ui/status";
import { fmtDateTime } from "@/lib/format";
import { MarkReadButton } from "@/components/app/mark-read-button";

export const metadata: Metadata = { title: "Notifications" };
export const dynamic = "force-dynamic";

export default async function NotificationsPage({ params }: { params: Promise<{ patientId: string }> }) {
  const { patientId } = await params;
  const { user, patient } = await requirePagePatient(patientId, "notifications:read");
  const items = await listNotifications(user, patientId, { limit: 50 });
  return (
    <>
      <PageHeader
        title="Notifications"
        description={`Reminders and updates about ${patient.fullName}.`}
        actions={<Link href={`/patients/${patientId}/notification-settings`} className="inline-flex min-h-12 items-center font-semibold text-primary underline">Change which emails I get</Link>}
      />
      {items.length === 0 ? (
        <EmptyState icon={<Bell />} title="No notifications yet">Reminders and updates will appear here as they happen.</EmptyState>
      ) : (
        <ul className="space-y-3">
          {items.map((n) => {
            const email = n.deliveries.email;
            return (
              <li key={n.id} className="rounded-2xl border-2 border-border bg-card p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-lg font-bold">{n.title}{!n.readAt && <span className="ml-2"><StatusChip tone="info">New</StatusChip></span>}</h2>
                    <p className="mt-1 text-base">{n.body}</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      <time dateTime={n.createdAt.toISOString()}>{fmtDateTime(n.createdAt, patient.timezone)}</time>
                      {email && <> · Email: {email.status === "sent" ? "sent" : email.status === "skipped" ? "not sent (by your settings)" : email.status === "failed" ? "could not be sent" : "waiting to send"}</>}
                    </p>
                  </div>
                  {!n.readAt && <MarkReadButton id={n.id} title={n.title} />}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
