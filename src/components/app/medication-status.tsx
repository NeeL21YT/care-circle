import { Ban, CheckCheck, CircleCheck, PauseCircle, Pencil } from "lucide-react";
import { StatusChip } from "@/components/ui/status";
import type { MedicationStatus } from "@/lib/domain/types";

const META: Record<MedicationStatus, { label: string; tone: "neutral" | "success" | "warning" | "info"; icon: React.ReactNode; description: string }> = {
  draft: { label: "Draft", tone: "neutral", icon: <Pencil />, description: "Not active yet. No reminders are sent." },
  active: { label: "Active", tone: "success", icon: <CircleCheck />, description: "Reminders are being sent." },
  on_hold: { label: "On hold", tone: "warning", icon: <PauseCircle />, description: "Paused. No reminders are sent until resumed." },
  completed: { label: "Completed", tone: "info", icon: <CheckCheck />, description: "The course is finished." },
  discontinued: { label: "Discontinued", tone: "neutral", icon: <Ban />, description: "Stopped. History is kept." },
};

export const isFinalStatus = (s: MedicationStatus) => s === "completed" || s === "discontinued";

/** Icon + text, never colour alone. */
export function MedicationStatusChip({ status }: { status: MedicationStatus }) {
  const m = META[status];
  return (
    <StatusChip tone={m.tone} icon={m.icon} title={m.description}>
      {m.label}
      <span className="sr-only">. {m.description}</span>
    </StatusChip>
  );
}
