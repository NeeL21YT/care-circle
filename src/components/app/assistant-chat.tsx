"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bot, Plus, Send, Trash2, User } from "lucide-react";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import { ReadAloud } from "@/components/a11y/read-aloud";
import { SafeMarkdown } from "@/components/ui/safe-markdown";
import { stripMarkdown } from "@/lib/markdown";
import { ASSISTANT_PAGES, type AssistantLink, type AssistantPageKey } from "@/lib/ai/assistant/pages";
import { useAnnounce } from "@/components/a11y/announcer";
import { api, errorMessage } from "@/lib/client/api";
import { cn } from "@/lib/utils";

export interface ChatMessage { id: string; role: "user" | "assistant"; content: string; pendingActionIds: string[]; errorStatus: string | null; links?: AssistantLink[] }
export interface ChatPending { id: string; summary: string; status: string }
export interface ChatConversation { id: string; title: string; updatedAt: string }
interface ConversationPayload { conversation: { id: string }; messages: ChatMessage[]; pendingActions: ChatPending[] }

export function AssistantChat({ patientId, conversations, initial, canAct, compact = false, page, question, onNavigate }: {
  patientId: string; conversations: ChatConversation[]; initial: ConversationPayload | null; canAct: boolean;
  /** Side-panel mode: single column, no conversation list. */
  compact?: boolean;
  /** The app page the person is on, so "what is this?" makes sense. */
  page?: AssistantPageKey;
  /** A question handed over by a page ("Ask about these tasks"); it is sent as soon as it arrives. */
  question?: { id: number; text: string } | null;
  onNavigate?: () => void;
}) {
  const SUGGESTIONS = ASSISTANT_PAGES[page ?? "assistant"].suggestions;
  const router = useRouter();
  const announce = useAnnounce();
  const [cid, setCid] = useState<string | null>(initial?.conversation.id ?? null);
  const [messages, setMessages] = useState<ChatMessage[]>(initial?.messages ?? []);
  const [pending, setPending] = useState<ChatPending[]>(initial?.pendingActions ?? []);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const lastCount = useRef(messages.length);

  // Keep the newest message in view; announce a new assistant reply to screen readers.
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
    const last = messages.at(-1);
    if (messages.length > lastCount.current && last?.role === "assistant") announce(`Assistant says: ${stripMarkdown(last.content)}`, "polite");
    lastCount.current = messages.length;
  }, [messages, announce]);

  // A question from a page button: send it once per request, as if typed.
  const lastQuestion = useRef(0);
  const sendRef = useRef<(m: string) => void>(() => undefined);
  useEffect(() => {
    if (question && question.id !== lastQuestion.current) {
      lastQuestion.current = question.id;
      sendRef.current(question.text);
    }
  }, [question]);

  function apply(p: ConversationPayload) {
    setCid(p.conversation.id);
    setMessages(p.messages);
    setPending(p.pendingActions);
  }

  async function send(message: string) {
    const m = message.trim();
    if (!m || busy) return;
    setBusy(true);
    setError(null);
    setText("");
    setMessages((x) => [...x, { id: `tmp-${Date.now()}`, role: "user", content: m, pendingActionIds: [], errorStatus: null }]);
    try {
      apply(await api<ConversationPayload>(`/api/patients/${patientId}/assistant/chat`, { body: { conversationId: cid ?? undefined, message: m, page } }));
      if (!compact) router.refresh();
    } catch (e) {
      setError(errorMessage(e));
      setText(m);
      setMessages((x) => x.slice(0, -1));
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  sendRef.current = (m: string) => { void send(m); };

  async function decide(actionId: string, decision: "confirm" | "cancel") {
    if (!cid || busy) return;
    setBusy(true);
    setError(null);
    try {
      apply(await api<ConversationPayload>(`/api/patients/${patientId}/assistant/conversations/${cid}/actions/${actionId}`, { body: { decision } }));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!cid || !window.confirm("Delete this conversation? This cannot be undone.")) return;
    try {
      await api(`/api/patients/${patientId}/assistant/conversations/${cid}`, { method: "DELETE" });
      announce("Conversation deleted.");
      newChat();
      router.refresh();
    } catch (e) { setError(errorMessage(e)); }
  }

  function newChat() {
    setCid(null);
    setMessages([]);
    setPending([]);
    setError(null);
    if (!compact) router.replace(`/patients/${patientId}/assistant`);
    inputRef.current?.focus();
  }

  const pendingById = new Map(pending.map((p) => [p.id, p]));

  return (
    <div className={compact ? "space-y-4" : "grid grid-cols-1 gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]"}>
      {!compact && <aside aria-label="Your conversations" className="space-y-2">
        <Button type="button" variant="outline" className="w-full" onClick={newChat}><Plus aria-hidden="true" /> New conversation</Button>
        <ul className="space-y-1">
          {conversations.map((c) => (
            <li key={c.id}>
              <a href={`/patients/${patientId}/assistant?c=${c.id}`} aria-current={c.id === cid ? "page" : undefined}
                className={cn("block min-h-12 rounded-xl border-2 px-3 py-2 font-semibold", c.id === cid ? "border-primary bg-secondary" : "border-transparent hover:bg-accent")}>
                {c.title}
              </a>
            </li>
          ))}
        </ul>
      </aside>}

      <section aria-labelledby="chat-h" className="space-y-4">
        <h2 id="chat-h" className="sr-only">Conversation</h2>
        {compact ? (
          <p className="rounded-xl border-2 border-info bg-info-bg p-3 text-sm"><strong>AI can make mistakes.</strong> It reads your Care Circle records. It cannot give medical advice or change a dose: ask your doctor or pharmacist.</p>
        ) : (
          <Alert variant="info" title="This helper uses AI and can make mistakes.">
            It reads your Care Circle records. It cannot give medical advice, change a dose, or tell you to stop a medicine. Ask your doctor or pharmacist about those.
          </Alert>
        )}

        {compact && cid && <Button type="button" variant="outline" size="sm" onClick={newChat}><Plus aria-hidden="true" /> New conversation</Button>}

        <div ref={logRef} role="log" aria-label="Messages" aria-live="off" tabIndex={0} className={cn("space-y-4 overflow-y-auto rounded-xl border-2 p-3 sm:p-4", compact ? "max-h-[48vh] min-h-40" : "max-h-[55vh] min-h-48")}>
          {messages.length === 0 && (
            <div className="space-y-3">
              <p className={compact ? "text-base" : "text-lg"}>Hello. What would you like to know?</p>
              <ul className="flex flex-wrap gap-2" aria-label="Suggested questions">
                {SUGGESTIONS.map((s) => (
                  <li key={s}><Button type="button" variant="outline" onClick={() => send(s)} disabled={busy}>{s}</Button></li>
                ))}
              </ul>
            </div>
          )}
          {messages.map((m) => (
            <article key={m.id} aria-label={m.role === "user" ? "You said" : "Assistant said"} className={cn("flex gap-3", m.role === "user" && "flex-row-reverse")}>
              <span aria-hidden="true" className={cn("mt-1 size-9 shrink-0 items-center justify-center rounded-full bg-secondary [&_svg]:size-5", compact ? "hidden" : "flex")}>{m.role === "user" ? <User /> : <Bot />}</span>
              <div className={cn("space-y-2 rounded-2xl border-2 py-3", compact ? "min-w-0 max-w-full px-3" : "max-w-[85%] px-4", m.role === "user" ? "bg-primary text-primary-foreground" : "bg-card")}>
                <div className={compact ? "text-base" : "text-lg"}>
                  <span className="sr-only">{m.role === "user" ? "You: " : "Assistant: "}</span>
                  {m.role === "assistant" ? <SafeMarkdown text={m.content} /> : <p className="whitespace-pre-wrap">{m.content}</p>}
                </div>
                {m.role === "assistant" && !m.id.startsWith("tmp-") && <ReadAloud text={stripMarkdown(m.content)} label="Read this reply aloud" />}
                {m.pendingActionIds.map((id) => {
                  const a = pendingById.get(id);
                  if (!a) return null;
                  return (
                    <div key={id} className="space-y-2 rounded-xl border-2 border-warning bg-warning-bg p-3 text-foreground">
                      <p className="font-bold">Please confirm</p>
                      <p>{a.summary}</p>
                      {a.status === "pending" && canAct ? (
                        <div className="flex flex-wrap gap-2">
                          <Button type="button" onClick={() => decide(id, "confirm")} disabled={busy}>Yes, do it</Button>
                          <Button type="button" variant="outline" onClick={() => decide(id, "cancel")} disabled={busy}>No, cancel</Button>
                        </div>
                      ) : (
                        <p className="font-semibold">{a.status === "confirmed" ? "Confirmed." : a.status === "cancelled" ? "Cancelled." : a.status === "expired" ? "This request timed out. Ask again." : a.status === "failed" ? "This did not work." : ""}</p>
                      )}
                    </div>
                  );
                })}
                {(m.links?.length ?? 0) > 0 && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {m.links!.map((l) => <Link key={l.path} href={l.path} onClick={onNavigate} className={buttonVariants({ variant: "outline" })}>{l.label}</Link>)}
                  </div>
                )}
                {m.errorStatus && <p className="text-sm">You can try your question again.</p>}
              </div>
            </article>
          ))}
          {busy && <p role="status" className="italic text-muted-foreground">The assistant is thinking…</p>}
        </div>

        {error && <Alert variant="error" title={error} />}

        <form onSubmit={(e) => { e.preventDefault(); void send(text); }} className="space-y-2">
          <label htmlFor="chat-input" className="block text-base font-semibold">Ask a question</label>
          <Textarea id="chat-input" ref={inputRef} rows={2} value={text} maxLength={1000} disabled={busy}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(text); } }}
            aria-describedby="chat-hint" />
          <p id="chat-hint" className="text-sm text-muted-foreground">Press Enter to send. Shift and Enter adds a new line.</p>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={busy || !text.trim()}><Send aria-hidden="true" /> Send</Button>
            {cid && <Button type="button" variant="outline" onClick={remove} disabled={busy}><Trash2 aria-hidden="true" /> Delete this conversation</Button>}
          </div>
        </form>
      </section>
    </div>
  );
}
