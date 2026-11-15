"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, Pencil, RotateCcw, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Alert } from "@/components/ui/alert";
import { api, errorMessage } from "@/lib/client/api";
import { useAnnounce } from "@/components/a11y/announcer";

/**
 * Edit / mark completed / cancel (with confirmation) / restore.
 * NOTE: status PATCHes re-send the existing reminder offsets because the
 * server's partial schema re-applies its default offsets when omitted.
 */
export function AppointmentActions({ patientId, appointmentId, doctorName, status, reminderOffsetsMinutes, editHref }: {
  patientId: string;
  appointmentId: string;
  doctorName: string;
  status: "scheduled" | "completed" | "cancelled";
  reminderOffsetsMinutes: number[];
  editHref: string;
}) {
  const router = useRouter();
  const announce = useAnnounce();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const url = `/api/patients/${patientId}/appointments/${appointmentId}`;

  async function run(kind: string, fn: () => Promise<unknown>, done: string) {
    setBusy(kind); setError(null);
    try {
      await fn();
      announce(done);
      setConfirm(false);
      router.refresh();
    } catch (e) {
      setError(errorMessage(e));
      announce(errorMessage(e), "assertive");
    } finally { setBusy(null); }
  }
  const patch = (s: string) => api(url, { method: "PATCH", body: { status: s, reminderOffsetsMinutes } });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {status !== "cancelled" && (
          <Link href={editHref} className="inline-flex min-h-10 items-center gap-2 rounded-xl border-2 border-input bg-surface px-4 text-[0.95rem] font-semibold hover:bg-accent">
            <Pencil aria-hidden="true" className="size-5" /> Edit{" "}<span className="sr-only">appointment with {doctorName}</span>
          </Link>
        )}
        {status === "scheduled" && (
          <Button size="sm" variant="secondary" loading={busy === "complete"} onClick={() => run("complete", () => patch("completed"), `Appointment with ${doctorName} marked as completed.`)}>
            <CheckCircle2 aria-hidden="true" /> Mark completed{" "}<span className="sr-only">for appointment with {doctorName}</span>
          </Button>
        )}
        {status === "cancelled" ? (
          <Button size="sm" variant="secondary" loading={busy === "restore"} onClick={() => run("restore", () => patch("scheduled"), `Appointment with ${doctorName} restored.`)}>
            <RotateCcw aria-hidden="true" /> Restore{" "}<span className="sr-only">appointment with {doctorName}</span>
          </Button>
        ) : (
          <Button size="sm" variant="destructive" onClick={() => setConfirm(true)}>
            <XCircle aria-hidden="true" /> Cancel{" "}<span className="sr-only">appointment with {doctorName}</span>
          </Button>
        )}
      </div>
      {error && <Alert variant="error" title={error} />}
      <Dialog open={confirm} onOpenChange={setConfirm} title="Cancel this appointment?" description={`The appointment with ${doctorName} will be marked as cancelled and reminders will stop. You can restore it later.`}>
        <div className="flex flex-wrap justify-end gap-3">
          <Button variant="outline" onClick={() => setConfirm(false)}>Keep appointment</Button>
          <Button variant="destructive" loading={busy === "cancel"} onClick={() => run("cancel", () => api(url, { method: "DELETE" }), `Appointment with ${doctorName} cancelled.`)}>Yes, cancel it</Button>
        </div>
      </Dialog>
    </div>
  );
}
