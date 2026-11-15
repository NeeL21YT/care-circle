"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { useAnnounce } from "@/components/a11y/announcer";
import { api, errorMessage } from "@/lib/client/api";
import { fmtDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface TaskView {
  id: string; title: string; description: string | null; assignedToUid: string | null; assignedToName: string | null;
  createdByName: string; dueAt: string | null; priority: "low" | "normal" | "high"; status: string;
  notes: { id: string; name: string; text: string; at: string }[]; completedAt: string | null;
}
export interface MemberOption { uid: string; displayName: string; role: string }
export interface ActivityView { id: string; summary: string; at: string }

const STATUS_LABEL: Record<string, string> = {
  pending: "Waiting to be accepted", accepted: "Accepted", in_progress: "In progress",
  completed: "Completed", cancelled: "Cancelled", needs_attention: "Needs attention",
};
const OPEN = ["pending", "accepted", "in_progress", "needs_attention"];
const FILTERS = [["open", "All open"], ["mine", "Mine"], ["unassigned", "Nobody yet"], ["all", "Everything"]] as const;

export function TasksBoard({ patientId, tasks, members, activity, currentUid, canManage, canRespond, timezone, filter, now }: {
  patientId: string; tasks: TaskView[]; members: MemberOption[]; activity: ActivityView[]; currentUid: string;
  canManage: boolean; canRespond: boolean; timezone: string; filter: string; now: string;
}) {
  const router = useRouter();
  const announce = useAnnounce();
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [form, setForm] = useState({ title: "", description: "", assignedToUid: "", dueDate: "", dueTime: "", priority: "normal" });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");
  const msgRef = useRef<HTMLDivElement>(null);
  const requestId = useRef(crypto.randomUUID().replace(/-/g, ""));

  const say = (kind: "error" | "success", text: string) => {
    setMsg({ kind, text });
    announce(text, kind === "error" ? "assertive" : "polite");
    requestAnimationFrame(() => msgRef.current?.focus());
  };

  async function run(key: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(key);
    setMsg(null);
    try { await fn(); say("success", ok); router.refresh(); } catch (e) { say("error", errorMessage(e)); } finally { setBusy(null); }
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setFieldErrors({});
    setBusy("create");
    try {
      await api(`/api/patients/${patientId}/tasks`, { body: { ...form, assignedToUid: form.assignedToUid || null, dueDate: form.dueDate || null, dueTime: form.dueTime || null, description: form.description || null, clientRequestId: requestId.current } });
      requestId.current = crypto.randomUUID().replace(/-/g, "");
      setForm({ title: "", description: "", assignedToUid: "", dueDate: "", dueTime: "", priority: "normal" });
      say("success", "Task added.");
      router.refresh();
    } catch (err) {
      const f = (err as { fields?: Record<string, string> }).fields;
      if (f) setFieldErrors(f);
      say("error", errorMessage(err));
    } finally { setBusy(null); }
  }

  const status = (id: string, s: string, label: string) => run(`${id}-${s}`, () => api(`/api/patients/${patientId}/tasks/${id}/status`, { body: { status: s } }), label);
  const assign = (id: string, uid: string | null, label: string) => run(`${id}-assign`, () => api(`/api/patients/${patientId}/tasks/${id}/assign`, { body: { assignedToUid: uid } }), label);

  return (
    <div className="space-y-8">
      <div ref={msgRef} tabIndex={-1} aria-live="polite">{msg && <Alert variant={msg.kind} title={msg.text} />}</div>

      {canManage && (
        <form onSubmit={create} className="space-y-3 rounded-xl border-2 p-4" aria-labelledby="new-task-h">
          <h2 id="new-task-h" className="text-xl font-bold">Add a task</h2>
          <Field id="nt-title" label="What needs doing?" required error={fieldErrors.title}>{(p) => <Input {...p} value={form.title} maxLength={140} onChange={(e) => setForm({ ...form, title: e.target.value })} />}</Field>
          <Field id="nt-desc" label="More detail (optional)" error={fieldErrors.description}>{(p) => <Textarea {...p} rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />}</Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="nt-who" label="Who is responsible?" error={fieldErrors.assignedToUid}>{(p) => (
              <Select {...p} value={form.assignedToUid} onChange={(e) => setForm({ ...form, assignedToUid: e.target.value })}>
                <option value="">Nobody yet</option>
                {members.map((m) => <option key={m.uid} value={m.uid}>{m.displayName}{m.uid === currentUid ? " (me)" : ""}</option>)}
              </Select>
            )}</Field>
            <Field id="nt-pri" label="How important?">{(p) => (
              <Select {...p} value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option></Select>
            )}</Field>
            <Field id="nt-date" label="Due date (optional)" error={fieldErrors.dueDate}>{(p) => <Input {...p} type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />}</Field>
            <Field id="nt-time" label="Due time (optional)" hint="Without a time it is due at the end of that day." error={fieldErrors.dueTime}>{(p) => <Input {...p} type="time" value={form.dueTime} onChange={(e) => setForm({ ...form, dueTime: e.target.value })} />}</Field>
          </div>
          <Button type="submit" disabled={busy === "create" || !form.title.trim()}>{busy === "create" ? "Adding…" : "Add task"}</Button>
        </form>
      )}

      <section aria-labelledby="tasks-h" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="tasks-h" className="text-xl font-bold">Tasks</h2>
          <nav aria-label="Filter tasks" className="flex flex-wrap gap-2">
            {FILTERS.map(([k, label]) => (
              <a key={k} href={`?filter=${k}`} aria-current={filter === k ? "page" : undefined}
                className={cn("inline-flex min-h-11 items-center rounded-xl border-2 px-3 font-semibold", filter === k ? "border-primary bg-secondary" : "border-transparent hover:bg-accent")}>{label}</a>
            ))}
          </nav>
        </div>
        {tasks.length === 0 ? <p className="rounded-xl border-2 border-dashed p-6">No tasks here. {canManage ? "Add one above." : ""}</p> : (
          <ul className="space-y-3">
            {tasks.map((t) => {
              const open = OPEN.includes(t.status);
              const overdue = open && t.dueAt !== null && new Date(t.dueAt) < new Date(now);
              const mine = t.assignedToUid === currentUid;
              const can = canRespond && (mine || canManage);
              const isBusy = busy?.startsWith(t.id);
              return (
                <li key={t.id}>
                  <Card role="group" aria-labelledby={`t-${t.id}`} className="space-y-3 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <h3 id={`t-${t.id}`} className="text-lg font-bold">{t.title}</h3>
                      <span className="font-semibold">Status: {STATUS_LABEL[t.status] ?? t.status}</span>
                    </div>
                    {t.description && <p>{t.description}</p>}
                    <p className="text-base">
                      <strong>Responsible:</strong> {t.assignedToName ?? "Nobody yet"}
                      {t.dueAt && <> · <strong>Due:</strong> {fmtDateTime(t.dueAt, timezone)}{overdue && <strong className="text-destructive"> (overdue)</strong>}</>}
                      {t.priority === "high" && <> · <strong>High priority</strong></>}
                    </p>
                    {t.notes.length > 0 && (
                      <ul aria-label={`Notes on ${t.title}`} className="space-y-1 rounded-xl bg-muted p-3 text-base">
                        {t.notes.map((n) => <li key={n.id}><strong>{n.name}</strong> ({fmtDateTime(n.at, timezone)}): {n.text}</li>)}
                      </ul>
                    )}
                    {open && canRespond && (
                      <div className="flex flex-wrap gap-2">
                        {!t.assignedToUid && <Button type="button" disabled={isBusy} onClick={() => assign(t.id, currentUid, "You took this task.")}>I will do this<span className="sr-only">: {t.title}</span></Button>}
                        {t.assignedToUid && can && t.status === "pending" && <Button type="button" disabled={isBusy} onClick={() => status(t.id, "accepted", "Task accepted.")}>Accept<span className="sr-only"> {t.title}</span></Button>}
                        {t.assignedToUid && can && ["pending", "accepted", "needs_attention"].includes(t.status) && <Button type="button" variant="outline" disabled={isBusy} onClick={() => status(t.id, "in_progress", "Marked in progress.")}>Start<span className="sr-only"> {t.title}</span></Button>}
                        {t.assignedToUid && can && t.status !== "needs_attention" && <Button type="button" variant="outline" disabled={isBusy} onClick={() => status(t.id, "needs_attention", "Flagged as needing attention.")}>Needs attention<span className="sr-only">: {t.title}</span></Button>}
                        {t.assignedToUid && can && <Button type="button" disabled={isBusy} onClick={() => status(t.id, "completed", "Task completed.")}>Mark done<span className="sr-only">: {t.title}</span></Button>}
                        {t.assignedToUid && can && (
                          <span className="inline-flex items-center gap-2">
                            <label htmlFor={`h-${t.id}`} className="font-semibold">Hand over to</label>
                            <Select id={`h-${t.id}`} className="w-auto" value="" onChange={(e) => e.target.value && assign(t.id, e.target.value, "Task handed over.")}>
                              <option value="">Choose…</option>
                              {members.filter((m) => m.uid !== t.assignedToUid).map((m) => <option key={m.uid} value={m.uid}>{m.displayName}</option>)}
                            </Select>
                          </span>
                        )}
                        {can && <Button type="button" variant="outline" disabled={isBusy} onClick={() => setNoteFor(noteFor === t.id ? null : t.id)} aria-expanded={noteFor === t.id}>Add a note<span className="sr-only"> to {t.title}</span></Button>}
                        {canManage && <Button type="button" variant="outline" disabled={isBusy} onClick={() => window.confirm(`Cancel "${t.title}"?`) && status(t.id, "cancelled", "Task cancelled.")}>Cancel task<span className="sr-only">: {t.title}</span></Button>}
                      </div>
                    )}
                    {!open && canManage && <Button type="button" variant="outline" disabled={isBusy} onClick={() => status(t.id, "pending", "Task reopened.")}>Reopen<span className="sr-only"> {t.title}</span></Button>}
                    {noteFor === t.id && (
                      <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); void run(`${t.id}-note`, async () => { await api(`/api/patients/${patientId}/tasks/${t.id}/notes`, { body: { text: noteText } }); setNoteText(""); setNoteFor(null); }, "Note added."); }}>
                        <Field id={`n-${t.id}`} label="Your note">{(p) => <Textarea {...p} rows={2} maxLength={500} value={noteText} onChange={(e) => setNoteText(e.target.value)} />}</Field>
                        <Button type="submit" disabled={!noteText.trim() || isBusy}>Save note</Button>
                      </form>
                    )}
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {activity.length > 0 && (
        <section aria-labelledby="act-h" className="space-y-2">
          <h2 id="act-h" className="text-xl font-bold">Recent care activity</h2>
          <ul className="space-y-1">
            {activity.map((a) => <li key={a.id} className="rounded-lg border-l-4 border-primary bg-muted px-3 py-2"><span className="text-sm text-muted-foreground">{fmtDateTime(a.at, timezone)}</span><br />{a.summary}</li>)}
          </ul>
        </section>
      )}
    </div>
  );
}
