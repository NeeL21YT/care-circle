"use client";
import * as React from "react";
import { Dialog as D } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import { Button } from "./button";
import { cn } from "@/lib/utils";

/**
 * Modal dialog on Base UI: focus is trapped, Escape closes, focus returns to
 * the trigger, the page behind is inert, and title/description are wired up as
 * the accessible name and description.
 */
export function Dialog({ open, onOpenChange, title, description, children, className }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Backdrop className="fixed inset-0 z-40 bg-black/50" />
        <D.Popup className={cn("fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[min(92vw,38rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border-2 border-border bg-popover p-6 text-popover-foreground shadow-xl", className)}>
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <D.Title className="text-xl font-bold">{title}</D.Title>
              {description && <D.Description className="mt-1 text-base text-muted-foreground">{description}</D.Description>}
            </div>
            <D.Close render={<Button variant="ghost" size="icon" aria-label="Close dialog" />}><X aria-hidden="true" /></D.Close>
          </div>
          {children}
        </D.Popup>
      </D.Portal>
    </D.Root>
  );
}
