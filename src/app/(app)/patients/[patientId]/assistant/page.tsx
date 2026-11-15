import type { Metadata } from "next";
import { requirePagePatient } from "@/lib/auth/page";
import { can } from "@/lib/domain/permissions";
import { isAiConfigured } from "@/lib/ai/config";
import { getConversation, listConversations } from "@/lib/services/assistant";
import { PageHeader } from "@/components/ui/page-header";
import { Alert } from "@/components/ui/alert";
import { AssistantChat } from "@/components/app/assistant-chat";

export const metadata: Metadata = { title: "Care assistant" };

export default async function Page({ params, searchParams }: { params: Promise<{ patientId: string }>; searchParams: Promise<{ c?: string }> }) {
  const { patientId } = await params;
  const { c } = await searchParams;
  const { user, membership } = await requirePagePatient(patientId, "patient:read");
  const list = await listConversations(user, patientId);
  const initial = c ? await getConversation(user, patientId, c).catch(() => null) : null;
  return (
    <>
      <PageHeader title="Care assistant" description="Ask about medicines, doses you reported, and appointments. Answers come from your Care Circle records." />
      {!isAiConfigured() && <Alert variant="warning" title="The assistant is not set up yet">An administrator needs to add the Gemini API key.</Alert>}
      <AssistantChat
        patientId={patientId}
        conversations={list.map((x) => ({ id: x.id, title: x.title, updatedAt: x.updatedAt.toISOString() }))}
        initial={initial && JSON.parse(JSON.stringify({ conversation: { id: initial.conversation.id }, messages: initial.messages, pendingActions: initial.pendingActions }))}
        canAct={can(membership, "doses:respond")}
      />
    </>
  );
}
