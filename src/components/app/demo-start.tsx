"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { useAnnounce } from "@/components/a11y/announcer";
import { api, errorMessage } from "@/lib/client/api";
import { fullPageLoad } from "@/lib/client/navigate";
import { DEMO_PEOPLE, DEMO_ROLES, type DemoRole } from "@/lib/demo/roles";

/** Starts the demo as one of the made-up people. Shared by the landing page and the in-app banner. */
export function DemoRoleButtons({ current, size = "default", inline = false }: { current?: DemoRole | null; size?: "default" | "sm" | "lg"; inline?: boolean }) {
  const announce = useAnnounce();
  const [busy, setBusy] = useState<DemoRole | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function start(role: DemoRole) {
    setBusy(role);
    setError(null);
    announce(`Opening the demo as ${DEMO_PEOPLE[role].label}. This takes a few seconds.`, "polite");
    try {
      const r = await api<{ patientId: string }>("/api/demo/start", { body: { role } });
      // A full page load, on purpose: the signed-in person just changed, so every part of the page
      // (header, banner, navigation, data) must be rebuilt for them. It also renders the page once, not twice.
      fullPageLoad(`/patients/${r.patientId}`);
    } catch (e) {
      setError(errorMessage(e));
      announce(errorMessage(e), "assertive");
      setBusy(null);
    }
  }

  return (
    <div className="space-y-2">
      <div className={inline ? "flex flex-wrap gap-2" : "flex flex-col gap-2 sm:flex-row sm:flex-wrap"}>
        {DEMO_ROLES.map((r) => (
          <Button key={r} type="button" size={size} className={inline ? undefined : "w-full sm:w-auto"} variant={current === r ? "default" : "outline"} disabled={busy !== null} aria-pressed={current === r} aria-label={inline ? `View as ${DEMO_PEOPLE[r].label}` : undefined} onClick={() => start(r)}>
            {busy === r ? "Opening…" : inline ? DEMO_PEOPLE[r].short : DEMO_PEOPLE[r].label}
          </Button>
        ))}
      </div>
      {error && <Alert variant="error" title={error} />}
    </div>
  );
}
