import * as React from "react";

/** Every page has exactly one <h1>; RouteFocus moves focus here after navigation. */
export function PageHeader({ title, description, actions, id = "page-title" }: { title: string; description?: React.ReactNode; actions?: React.ReactNode; id?: string }) {
  return (
    <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 id={id} tabIndex={-1} className="text-3xl font-extrabold sm:text-4xl">{title}</h1>
        {description && <p className="mt-2 max-w-prose text-lg text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-3">{actions}</div>}
    </header>
  );
}

export function EmptyState({ icon, title, children, action }: { icon?: React.ReactNode; title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border-2 border-dashed border-border bg-surface p-8 text-center">
      {icon && <div aria-hidden="true" className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-secondary text-primary [&_svg]:size-6">{icon}</div>}
      <h2 className="text-xl font-bold">{title}</h2>
      {children && <p className="mx-auto mt-2 max-w-prose text-base text-muted-foreground">{children}</p>}
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}

export function Skeleton({ label = "Loading" }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="animate-pulse space-y-3">
      <span className="sr-only">{label}…</span>
      <div className="h-8 w-1/2 rounded-lg bg-muted" />
      <div className="h-24 rounded-2xl bg-muted" />
      <div className="h-24 rounded-2xl bg-muted" />
    </div>
  );
}
