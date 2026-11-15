import * as React from "react";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

type Variant = "info" | "success" | "warning" | "error";
const STYLE: Record<Variant, { box: string; icon: React.ReactNode; label: string }> = {
  info: { box: "border-info bg-info-bg text-foreground", icon: <Info />, label: "Information" },
  success: { box: "border-success bg-success-bg text-foreground", icon: <CheckCircle2 />, label: "Success" },
  warning: { box: "border-warning bg-warning-bg text-foreground", icon: <AlertTriangle />, label: "Warning" },
  error: { box: "border-destructive bg-danger-bg text-foreground", icon: <XCircle />, label: "Error" },
};

/** Errors use role=alert (assertive); everything else role=status (polite). */
export function Alert({ variant = "info", title, children, className, id }: { variant?: Variant; title?: string; children?: React.ReactNode; className?: string; id?: string }) {
  const s = STYLE[variant];
  return (
    <div id={id} role={variant === "error" ? "alert" : "status"} className={cn("flex gap-3 rounded-xl border-2 p-4", s.box, className)}>
      <span aria-hidden="true" className="mt-0.5 [&_svg]:size-6">{s.icon}</span>
      <div className="min-w-0 space-y-1">
        <p className="font-bold"><span className="sr-only">{s.label}:</span>{" "}{title}</p>
        {children && <div className="text-base">{children}</div>}
      </div>
    </div>
  );
}
