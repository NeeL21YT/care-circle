"use client";
import * as React from "react";
import { Dialog as D } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import { Button } from "./button";

/**
 * A side panel (bottom-right card on desktop, full screen on phones) on the same accessible
 * Base UI dialog as <Dialog>: focus is trapped, Escape closes, focus returns to the button that
 * opened it. Its content stays mounted while closed, so a conversation inside it is not lost.
 */
export function Sheet({ open, onOpenChange, title, description, children }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; description?: string; children: React.ReactNode;
}) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal keepMounted>
        <D.Backdrop className="print-hide fixed inset-0 z-40 bg-black/40 data-[closed]:hidden sm:bg-black/20" />
        <D.Popup className="print-hide fixed inset-0 z-50 flex flex-col bg-popover text-popover-foreground shadow-2xl data-[closed]:hidden sm:inset-auto sm:bottom-4 sm:right-4 sm:top-4 sm:w-[28rem] sm:rounded-2xl sm:border-2 sm:border-border">
          <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
            <div className="min-w-0">
              <D.Title className="text-xl font-bold">{title}</D.Title>
              {description && <D.Description className="text-sm text-muted-foreground">{description}</D.Description>}
            </div>
            <D.Close render={<Button variant="ghost" size="icon" aria-label="Close the assistant" />}><X aria-hidden="true" /></D.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
        </D.Popup>
      </D.Portal>
    </D.Root>
  );
}
