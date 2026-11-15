import type { Metadata } from "next";
import { requirePagePatient } from "@/lib/auth/page";
import { can } from "@/lib/domain/permissions";
import { listActivity } from "@/lib/services/care-activity";
import { listCircleMembers, listTasks } from "@/lib/services/care-tasks";
import { PageHeader } from "@/components/ui/page-header";
import { TasksBoard } from "@/components/app/tasks-board";
import { AskAssistant } from "@/components/app/assistant-provider";

export const metadata: Metadata = { title: "Care tasks" };

export default async function Page({ params, searchParams }: { params: Promise<{ patientId: string }>; searchParams: Promise<{ filter?: string }> }) {
  const { patientId } = await params;
  const { filter: f } = await searchParams;
  const filter = (["open", "mine", "unassigned", "all"] as const).find((x) => x === f) ?? "open";
  const { user, patient, membership } = await requirePagePatient(patientId, "tasks:read");
  const [tasks, members, activity] = await Promise.all([listTasks(user, patientId, { filter }), listCircleMembers(user, patientId, "tasks"), listActivity(user, patientId, 15)]);
  return (
    <>
      <PageHeader title={membership.role === "patient" ? "My tasks" : "Care tasks"} description={`Who is doing what for ${patient.fullName}. Everyone can see who is responsible and what is still open.`} actions={<AskAssistant question="Which care tasks are open, overdue, or have nobody responsible?">Ask about these tasks</AskAssistant>} />
      <TasksBoard
        patientId={patientId}
        tasks={JSON.parse(JSON.stringify(tasks))}
        members={members}
        activity={JSON.parse(JSON.stringify(activity.map((a) => ({ id: a.id, summary: a.summary, at: a.at }))))}
        currentUid={user.uid}
        canManage={can(membership, "tasks:write")}
        canRespond={can(membership, "tasks:respond")}
        timezone={patient.timezone}
        filter={filter}
        now={new Date().toISOString()}
      />
    </>
  );
}
