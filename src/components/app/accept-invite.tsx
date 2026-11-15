"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { useAnnounce } from "@/components/a11y/announcer";
import { api, errorMessage } from "@/lib/client/api";

export function AcceptInvite({ token }: { token: string }) {
  const router = useRouter();
  const announce = useAnnounce();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="mt-6 space-y-4">
      {error && <Alert variant="error" title={error} />}
      <Button size="lg" loading={busy} onClick={async () => {
        setBusy(true); setError(null);
        try {
          const r = await api<{ patientId: string }>("/api/invitations/accept", { method: "POST", body: { token } });
          announce("You have joined the care circle.");
          router.replace(`/patients/${r.patientId}`);
          router.refresh();
        } catch (e) { setError(errorMessage(e)); announce(errorMessage(e), "assertive"); }
        finally { setBusy(false); }
      }}>Accept invitation</Button>
    </div>
  );
}
