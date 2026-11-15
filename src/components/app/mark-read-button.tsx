"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useAnnounce } from "@/components/a11y/announcer";
import { api, errorMessage } from "@/lib/client/api";

export function MarkReadButton({ id, title }: { id: string; title: string }) {
  const router = useRouter();
  const announce = useAnnounce();
  const [busy, setBusy] = useState(false);
  return (
    <Button variant="outline" size="sm" loading={busy} onClick={async () => {
      setBusy(true);
      try { await api(`/api/notifications/${id}/read`, { method: "PATCH" }); announce("Marked as read."); router.refresh(); }
      catch (e) { announce(errorMessage(e), "assertive"); }
      finally { setBusy(false); }
    }}>
      Mark as read<span className="sr-only">: {title}</span>
    </Button>
  );
}
