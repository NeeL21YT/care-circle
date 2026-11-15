import * as React from "react";
import { AlertTriangle, CheckCircle2, Circle, Clock, HelpCircle, Info, MinusCircle, XCircle, BellRing, Eye, PauseCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DoseStatus } from "@/lib/domain/types";
import { STATUS_DESCRIPTION, STATUS_LABEL } from "@/lib/domain/dose-state";

type Tone = "neutral" | "success" | "warning" | "danger" | "info";
const TONE: Record<Tone, string> = {
  neutral: "bg-muted text-foreground border-border",
  success: "bg-success-bg text-success border-success",
  warning: "bg-warning-bg text-warning border-warning",
  danger: "bg-danger-bg text-destructive border-destructive",
  info: "bg-info-bg text-info border-info",
};

/** Status is always icon + text, never colour alone (WCAG 1.4.1). */
export function StatusChip({ tone = "neutral", icon, children, title, className }: { tone?: Tone; icon?: React.ReactNode; children: React.ReactNode; title?: string; className?: string }) {
  return (
    <span title={title} className={cn("status-chip inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[0.9rem] font-semibold", TONE[tone], className)}>
      {icon && <span aria-hidden="true" className="[&_svg]:size-4">{icon}</span>}
      {children}
    </span>
  );
}

const DOSE_VISUAL: Record<DoseStatus, { tone: Tone; icon: React.ReactNode }> = {
  scheduled: { tone: "neutral", icon: <Clock /> },
  notified: { tone: "info", icon: <BellRing /> },
  acknowledged: { tone: "info", icon: <Eye /> },
  reported_taken: { tone: "success", icon: <CheckCircle2 /> },
  reported_skipped: { tone: "warning", icon: <MinusCircle /> },
  snoozed: { tone: "info", icon: <PauseCircle /> },
  missed_by_policy: { tone: "danger", icon: <AlertTriangle /> },
  unknown: { tone: "warning", icon: <HelpCircle /> },
  cancelled: { tone: "neutral", icon: <XCircle /> },
};

export function DoseStatusChip({ status }: { status: DoseStatus }) {
  const v = DOSE_VISUAL[status];
  return (
    <StatusChip tone={v.tone} icon={v.icon} title={STATUS_DESCRIPTION[status]}>
      {STATUS_LABEL[status]}
      <span className="sr-only">. {STATUS_DESCRIPTION[status]}</span>
    </StatusChip>
  );
}

export { Circle, Info };
