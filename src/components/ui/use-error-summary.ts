"use client";
import { useCallback, useRef, useState } from "react";
import type { FieldErrors, FieldValues } from "react-hook-form";

export interface SummaryError { id: string; message: string; label?: string }

/** Flattens react-hook-form errors into links for FormErrorSummary. */
export function flattenErrors<T extends FieldValues>(
  errors: FieldErrors<T>,
  formId: string,
  labels: Record<string, string> = {},
  prefix = "",
): SummaryError[] {
  const out: SummaryError[] = [];
  for (const [key, val] of Object.entries(errors)) {
    if (!val) continue;
    const path = prefix ? `${prefix}.${key}` : key;
    const v = val as { message?: string; type?: string } & Record<string, unknown>;
    if (typeof v.message === "string" && v.message) {
      out.push({ id: `${formId}-${path.replace(/\./g, "-")}`, message: v.message, label: labels[path] });
    } else if (typeof v === "object") {
      out.push(...flattenErrors(v as FieldErrors<T>, formId, labels, path));
    }
  }
  return out;
}

/** Focus management for a form's error summary after a failed submit. */
export function useErrorSummary() {
  const ref = useRef<HTMLDivElement>(null);
  const [serverMessage, setServerMessage] = useState<string | undefined>();
  const [serverFields, setServerFields] = useState<Record<string, string>>({});
  const focusSummary = useCallback(() => {
    requestAnimationFrame(() => ref.current?.focus());
  }, []);
  return { ref, serverMessage, setServerMessage, serverFields, setServerFields, focusSummary };
}
