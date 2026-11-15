"use client";
import * as React from "react";
import { usePathname } from "next/navigation";
import { MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { AssistantChat } from "@/components/app/assistant-chat";
import { ASSISTANT_PAGES, pageKeyFromPath } from "@/lib/ai/assistant/pages";

interface Ctx {
  /** Opens the assistant (on every patient page) and, if given, asks the question right away. */
  ask: (question?: string) => void;
}
const AssistantContext = React.createContext<Ctx>({ ask: () => undefined });
export const useAssistant = () => React.useContext(AssistantContext);

/**
 * The assistant is part of every patient page, not a separate place: a button on every screen opens
 * it beside what you are looking at, it knows which page that is, and its replies can take you to
 * other pages. Pages can also hand it a question ("Ask about these tasks").
 */
export function AssistantProvider({ patientId, canAct, children }: { patientId: string; canAct: boolean; children: React.ReactNode }) {
  const pathname = usePathname();
  const page = pageKeyFromPath(pathname, patientId);
  const [open, setOpen] = React.useState(false);
  const [question, setQuestion] = React.useState<{ id: number; text: string } | null>(null);
  const seq = React.useRef(0);

  const ask = React.useCallback((q?: string) => {
    if (q) setQuestion({ id: ++seq.current, text: q });
    setOpen(true);
  }, []);

  // The full assistant page already IS the assistant: no second one on top of it.
  const onAssistantPage = page === "assistant";

  return (
    <AssistantContext.Provider value={{ ask }}>
      {children}
      {!onAssistantPage && (
        <>
          <Button type="button" size="lg" onClick={() => ask()} className="print-hide fixed bottom-4 right-4 z-30 gap-2 rounded-full shadow-lg sm:bottom-6 sm:right-6">
            <MessageCircle aria-hidden="true" /> <span>Ask the assistant</span>
          </Button>
          <Sheet open={open} onOpenChange={setOpen} title="Care assistant" description={page ? `You are on: ${ASSISTANT_PAGES[page].label}` : undefined}>
            <AssistantChat patientId={patientId} conversations={[]} initial={null} canAct={canAct} compact page={page ?? undefined} question={question} onNavigate={() => setOpen(false)} />
          </Sheet>
        </>
      )}
    </AssistantContext.Provider>
  );
}

/** A small "Ask the assistant" button a page can place next to its own content. */
export function AskAssistant({ question, children, variant = "outline" }: { question: string; children?: React.ReactNode; variant?: "outline" | "ghost" | "secondary" }) {
  const { ask } = useAssistant();
  return (
    <Button type="button" variant={variant} onClick={() => ask(question)}>
      <MessageCircle aria-hidden="true" /> {children ?? "Ask the assistant"}
    </Button>
  );
}
