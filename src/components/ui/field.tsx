"use client";
import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Accessible form field: visible <label>, optional hint, inline error. The
 * input is wired with aria-describedby (hint + error), aria-invalid and
 * aria-required, and the error is announced when it appears.
 */
export interface FieldProps {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  className?: string;
  children: (a11y: {
    id: string;
    "aria-describedby"?: string;
    "aria-invalid"?: true;
    "aria-required"?: true;
  }) => React.ReactNode;
}

export function Field({ id, label, hint, error, required, className, children }: FieldProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={id} className="block text-base font-semibold">
        {label}
        {required ? <span className="font-normal text-muted-foreground"> (required)</span> : <span className="font-normal text-muted-foreground"> (optional)</span>}
      </label>
      {hint && <p id={hintId} className="text-[0.95rem] text-muted-foreground">{hint}</p>}
      {children({ id, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined, "aria-required": required ? true : undefined })}
      {error && (
        <p id={errId} className="flex items-start gap-1.5 text-[0.95rem] font-medium text-destructive">
          {/* Not colour-only: icon + the word "Error". */}
          <span aria-hidden="true">⚠</span>
          <span><span className="sr-only">Error:</span>{" "}{error}</span>
        </p>
      )}
    </div>
  );
}

const control =
  "block w-full min-h-12 rounded-xl border-2 border-input bg-surface px-4 py-2.5 text-base text-foreground placeholder:text-muted-foreground aria-[invalid=true]:border-destructive disabled:opacity-60";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...p }, ref) {
  return <input ref={ref} className={cn(control, className)} {...p} />;
});

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, rows = 4, ...p }, ref) {
  return <textarea ref={ref} rows={rows} className={cn(control, className)} {...p} />;
});

/** Native <select>: the most reliable control for screen readers, voice control and mobile. */
export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...p }, ref) {
  return (
    <select ref={ref} className={cn(control, "appearance-auto pr-8", className)} {...p}>
      {children}
    </select>
  );
});

export const Checkbox = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement> & { label: React.ReactNode; description?: string }>(function Checkbox(
  { className, label, description, id, ...p },
  ref,
) {
  const descId = description && id ? `${id}-desc` : undefined;
  return (
    <div className={cn("flex items-start gap-3", className)}>
      <input ref={ref} id={id} type="checkbox" aria-describedby={descId} className="mt-1 size-6 shrink-0 accent-[var(--primary)]" {...p} />
      <label htmlFor={id} className="text-base">
        <span className="font-medium">{label}</span>
        {description && <span id={descId} className="block text-[0.95rem] text-muted-foreground">{description}</span>}
      </label>
    </div>
  );
});
