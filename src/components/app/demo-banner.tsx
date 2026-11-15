import { Download, FlaskConical } from "lucide-react";
import { DemoRoleButtons } from "./demo-start";
import type { DemoRole } from "@/lib/demo/roles";

/** Always visible in the demo so nobody mistakes it for real data. */
export function DemoBanner({ current }: { current: DemoRole | null }) {
  return (
    <section aria-label="Demo mode" className="border-b-2 border-warning bg-warning-bg">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <p className="flex items-start gap-2 text-base text-foreground">
          <FlaskConical aria-hidden="true" className="mt-1 size-5 shrink-0" />
          <span><strong>Demo mode.</strong> Everything here is made up and shared with other visitors. Emails and invitations are switched off.</span>
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-base font-semibold">View as:</span>
          <DemoRoleButtons current={current} />
          <a href="/sample-prescription.png" download className="inline-flex min-h-12 items-center gap-2 rounded-xl border-2 border-border bg-surface px-4 font-semibold underline">
            <Download aria-hidden="true" className="size-5" /> Sample prescription to scan
          </a>
        </div>
      </div>
    </section>
  );
}
