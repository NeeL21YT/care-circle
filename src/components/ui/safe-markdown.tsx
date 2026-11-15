import * as React from "react";
import { parseMarkdown, type Inline } from "@/lib/markdown";

function inline(items: Inline[]) {
  return items.map((i, k) =>
    i.kind === "bold" ? <strong key={k}>{i.text}</strong>
    : i.kind === "italic" ? <em key={k}>{i.text}</em>
    : i.kind === "code" ? <code key={k} className="rounded bg-muted px-1 font-mono text-[0.95em]">{i.text}</code>
    : <React.Fragment key={k}>{i.text}</React.Fragment>,
  );
}

/** Renders AI text as real paragraphs and lists (so screen readers announce them properly). */
export function SafeMarkdown({ text, className }: { text: string; className?: string }) {
  return (
    <div className={className}>
      {parseMarkdown(text).map((b, i) =>
        b.kind === "p" ? (
          <p key={i} className="[&:not(:first-child)]:mt-2">
            {b.lines.map((l, j) => <React.Fragment key={j}>{j > 0 && <br />}{inline(l)}</React.Fragment>)}
          </p>
        ) : b.kind === "ul" ? (
          <ul key={i} className="list-disc space-y-1 pl-6 [&:not(:first-child)]:mt-2">{b.items.map((l, j) => <li key={j}>{inline(l)}</li>)}</ul>
        ) : (
          <ol key={i} className="list-decimal space-y-1 pl-6 [&:not(:first-child)]:mt-2">{b.items.map((l, j) => <li key={j}>{inline(l)}</li>)}</ol>
        ),
      )}
    </div>
  );
}
