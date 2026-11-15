import { ASSISTANT_PAGE_KEYS, type AssistantPageKey } from "./pages";

/**
 * Small models sometimes TYPE a tool call into their reply (for example
 * "[Open Care handover](command:default_api:openPage{page:handover})") instead of calling the tool.
 * This repairs such replies: a typed openPage call becomes a request for the real, permission-checked
 * button (made by the server), and any other markdown link is reduced to its label. Link targets from
 * the model are never rendered or followed.
 */
const PAGE = ASSISTANT_PAGE_KEYS.join("|");
const TYPED_CALL = new RegExp(`(?:default_api:)?openPage\\s*[({]\\s*(?:page\\s*[:=]\\s*)?["']?(${PAGE})["']?\\s*[)}]`, "g");
const MD_LINK = /\[([^\]\n]{1,120})\]\(((?:[^()\n]|\([^()\n]*\)){0,300})\)/g; // one level of nested () allowed

export function cleanReply(text: string): { text: string; pages: AssistantPageKey[] } {
  const pages: AssistantPageKey[] = [];
  const collect = (s: string) => { for (const m of s.matchAll(TYPED_CALL)) if (!pages.includes(m[1] as AssistantPageKey)) pages.push(m[1] as AssistantPageKey); };
  collect(text);
  let out = text.replace(MD_LINK, (_m, label: string) => label); // "[label](anything)" -> "label"
  out = out.replace(TYPED_CALL, "");                              // bare typed calls
  out = out.replace(/\(?command:[A-Za-z_:.]*\)?/g, "");           // leftovers like "command:default_api:"
  out = out.replace(/[ \t]+\n/g, "\n").replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  return { text: out, pages };
}
