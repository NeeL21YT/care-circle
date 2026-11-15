import * as React from "react";
import { cn } from "@/lib/utils";

export function Card({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("card-surface rounded-2xl border border-border bg-card p-6 text-card-foreground shadow-[0_1px_2px_rgba(20,40,42,0.06)]", className)} {...p} />;
}
export function CardTitle({ as: Tag = "h2", className, ...p }: React.HTMLAttributes<HTMLHeadingElement> & { as?: "h2" | "h3" | "h4" }) {
  return <Tag className={cn("text-xl font-bold", className)} {...p} />;
}
export function CardDescription({ className, ...p }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("mt-1 text-base text-muted-foreground", className)} {...p} />;
}
