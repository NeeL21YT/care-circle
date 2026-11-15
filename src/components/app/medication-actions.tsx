"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Pause, Pencil, Play, Trash2 } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Alert } from "@/components/ui/alert";
import { api, errorMessage } from "@/lib/client/api";
import { useAnnounce } from "@/components/a11y/announcer";
import type { MedicationStatus } from "@/lib/domain/types";
import { cn } from "@/lib/utils";

/** Allowed moves mirror the server (services/medications.ts). completed/discontinued are final. */
export function MedicationActions({ patientId, medicationId, name, status, size = "sm" }: {
  patientId: string; medicationId: string; name: string; status: MedicationStatus; size?: "sm" | "default";
}) {
  const router = useRouter();
  const announce = useAnnounce();
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const base = `/api/patients/${patientId}/medications/${medicationId}`;
  const final = status === "completed" || status === "discontinued";

  async function run(key: string, call: () => Promise<unknown>, done: string) {
    setBusy(key);
    setError(null);
    try {
      await call();
      announce(done);
      setConfirm(false);
      router.refresh();
    } catch (e) {
      const msg = errorMessage(e);
      setError(msg);
      announce(msg, "assertive");
    } finally {
      setBusy(null);
    }
  }
  const setStatus = (key: string, next: MedicationStatus, done: string) =>
    run(key, () => api(base, { method: "PATCH", body: { status: next } }), done);

  if (final) return <span className="text-base text-muted-foreground">No actions. History is kept.</span>;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Link href={`/patients/${patientId}/medications/${medicationId}`} className={cn(buttonVariants({ variant: "outline", size }))}>
        <Pencil aria-hidden="true" />Edit{" "}<span className="sr-only">{name}</span>
      </Link>
      {status === "active" && (
        <Button variant="outline" size={size} loading={busy === "hold"} onClick={() => setStatus("hold", "on_hold", `${name} is on hold. Reminders are paused.`)}>
          <Pause aria-hidden="true" />Hold{" "}<span className="sr-only">{name}</span>
        </Button>
      )}
      {status === "on_hold" && (
        <Button variant="outline" size={size} loading={busy === "resume"} onClick={() => setStatus("resume", "active", `${name} resumed. Reminders are on again.`)}>
          <Play aria-hidden="true" />Resume{" "}<span className="sr-only">{name}</span>
        </Button>
      )}
      {(status === "active" || status === "on_hold") && (
        <Button variant="outline" size={size} loading={busy === "complete"} onClick={() => setStatus("complete", "completed", `${name} marked as completed.`)}>
          <Check aria-hidden="true" />Mark completed{" "}<span className="sr-only">{name}</span>
        </Button>
      )}
      <Button variant="destructive" size={size} onClick={() => { setError(null); setConfirm(true); }}>
        <Trash2 aria-hidden="true" />Discontinue{" "}<span className="sr-only">{name}</span>
      </Button>
      {error && !confirm && <Alert variant="error" title={error} className="basis-full" />}
      <Dialog open={confirm} onOpenChange={setConfirm} title={`Discontinue ${name}?`} description="This stops the medicine for good.">
        <ul className="list-disc space-y-1 pl-6 text-base">
          <li>All past reminders and responses are kept in the history.</li>
          <li>Future reminders will be cancelled.</li>
          <li>To start it again later, add it as a new medication.</li>
        </ul>
        {error && <Alert variant="error" title={error} className="mt-4" />}
        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <Button variant="outline" onClick={() => setConfirm(false)}>Keep it</Button>
          <Button variant="destructive" loading={busy === "discontinue"} onClick={() => run("discontinue", () => api(base, { method: "DELETE" }), `${name} discontinued. Future reminders are cancelled.`)}>
            Yes, discontinue
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
