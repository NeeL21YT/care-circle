"use client";
import * as React from "react";

/**
 * Shown above a form after a failed submit. It takes focus so screen-reader
 * users hear what went wrong, and links straight to each invalid field.
 */
export const FormErrorSummary = React.forwardRef<HTMLDivElement, { errors: { id: string; message: string; label?: string }[]; message?: string }>(function FormErrorSummary({ errors, message }, ref) {
  if (!errors.length && !message) return null;
  return (
    <div ref={ref} tabIndex={-1} role="alert" className="rounded-xl border-2 border-destructive bg-danger-bg p-4" aria-labelledby="form-error-title">
      <h2 id="form-error-title" className="text-lg font-bold">
        {errors.length ? `There ${errors.length === 1 ? "is 1 problem" : `are ${errors.length} problems`} with this form` : "We could not complete that"}
      </h2>
      {message && <p className="mt-1">{message}</p>}
      {errors.length > 0 && (
        <ul className="mt-2 list-disc space-y-1 pl-6">
          {errors.map((e) => (
            <li key={e.id}>
              <a className="font-semibold underline" href={`#${e.id}`} onClick={(ev) => { ev.preventDefault(); document.getElementById(e.id)?.focus(); }}>
                {e.label ? `${e.label}: ` : ""}{e.message}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
});
