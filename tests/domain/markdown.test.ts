import { describe, expect, it } from "vitest";
import { parseInline, parseMarkdown, stripMarkdown } from "@/lib/markdown";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { SafeMarkdown } from "@/components/ui/safe-markdown";

describe("markdown subset", () => {
  it("parses bold, italic and code without leaving markers behind", () => {
    expect(parseInline("a **b** c *d* `e`").map((i) => `${i.kind}:${i.text}`)).toEqual(["text:a ", "bold:b", "text: c ", "italic:d", "text: ", "code:e"]);
    expect(stripMarkdown("**Metformin** at 8:00 AM")).toBe("Metformin at 8:00 AM");
  });

  it("turns the reported reply into a paragraph and a real list", () => {
    const md = "Yes, you reported taking your morning medicines today:\n- **Metformin** at 8:00 AM (reported taken)\n- **Amlodipine** at 9:00 AM (reported taken)";
    const blocks = parseMarkdown(md);
    expect(blocks.map((b) => b.kind)).toEqual(["p", "ul"]);
    const html = renderToStaticMarkup(createElement(SafeMarkdown, { text: md }));
    expect(html).toContain("<ul");
    expect(html).toContain("<strong>Metformin</strong>");
    expect(html).not.toContain("**");
    expect(html.match(/<li>/g)).toHaveLength(2);
  });

  it("supports numbered lists, star bullets, line breaks and heading markers", () => {
    expect(parseMarkdown("1. one\n2) two").map((b) => b.kind)).toEqual(["ol"]);
    expect(parseMarkdown("* a\n• b")[0]).toMatchObject({ kind: "ul" });
    expect(stripMarkdown("## Today\nLine one\nLine two")).toBe("Today Line one Line two");
    expect(renderToStaticMarkup(createElement(SafeMarkdown, { text: "one\ntwo" }))).toContain("<br/>");
  });

  it("never renders HTML or links from model output", () => {
    const html = renderToStaticMarkup(createElement(SafeMarkdown, { text: '<script>alert(1)</script> [click](javascript:alert(1)) <img src=x onerror=alert(1)> **ok**' }));
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<a ");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("<strong>ok</strong>");
  });

  it("leaves ordinary text alone, including stray asterisks and snake_case", () => {
    expect(stripMarkdown("5 * 3 and snake_case_name and a*b")).toBe("5 * 3 and snake_case_name and a*b");
    expect(parseMarkdown("")).toEqual([]);
  });
});
