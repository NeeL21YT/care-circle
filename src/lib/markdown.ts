/**
 * A deliberately tiny, SAFE markdown subset for AI replies: paragraphs, bullet
 * and numbered lists, **bold**, *italic* and `code`. Everything else (HTML,
 * links, images, headings) stays plain text. The output is a data structure
 * that React renders as elements, so model output can never inject markup.
 */
export type Inline = { kind: "text" | "bold" | "italic" | "code"; text: string };
export type Block =
  | { kind: "p"; lines: Inline[][] }
  | { kind: "ul" | "ol"; items: Inline[][] };

const BULLET = /^\s*(?:[-*•])\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  const re = /\*\*([^*]+?)\*\*|__([^_]+?)__|`([^`]+?)`|(?<![*\w])\*([^*\s][^*]*?)\*(?!\*)|(?<![_\w])_([^_\s][^_]*?)_(?![_\w])/g;
  let last = 0;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    if (m.index > last) out.push({ kind: "text", text: src.slice(last, m.index) });
    if (m[1] !== undefined || m[2] !== undefined) out.push({ kind: "bold", text: m[1] ?? m[2] });
    else if (m[3] !== undefined) out.push({ kind: "code", text: m[3] });
    else out.push({ kind: "italic", text: m[4] ?? m[5] });
    last = m.index + m[0].length;
  }
  if (last < src.length) out.push({ kind: "text", text: src.slice(last) });
  return out.length ? out : [{ kind: "text", text: "" }];
}

export function parseMarkdown(src: string): Block[] {
  const blocks: Block[] = [];
  let cur: Block | null = null;
  const flush = () => { if (cur) blocks.push(cur); cur = null; };
  for (const raw of src.replace(/\r\n?/g, "\n").split("\n")) {
    // Headings become ordinary text: "## Today" -> "Today".
    const line = raw.replace(/^\s{0,3}#{1,6}\s+/, "");
    if (!line.trim()) { flush(); continue; }
    const b = BULLET.exec(line);
    const n = NUMBERED.exec(line);
    const kind = b ? "ul" : n ? "ol" : "p";
    const text = b ? b[1] : n ? n[1] : line.trim();
    if (!cur || cur.kind !== kind) { flush(); cur = kind === "p" ? { kind: "p", lines: [] } : { kind, items: [] }; }
    if (cur.kind === "p") cur.lines.push(parseInline(text));
    else cur.items.push(parseInline(text));
  }
  flush();
  return blocks;
}

/** The same text without any markers: for read-aloud, screen-reader announcements and stored summaries. */
export function stripMarkdown(src: string): string {
  return parseMarkdown(src)
    .map((b) => (b.kind === "p" ? b.lines : b.items).map((l) => l.map((i) => i.text).join("")).join(b.kind === "p" ? " " : "\n"))
    .join("\n")
    .trim();
}
