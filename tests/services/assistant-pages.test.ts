import { beforeEach, describe, expect, it } from "vitest";
import { standardWorld, addMember, makeUser, MED_INPUT, PATIENT_INPUT } from "../helpers";
import { __setAiClientForTests, type AiClient, type ChatContent, type ToolTurnResult } from "@/lib/ai/client";
import { __resetModelCache } from "@/lib/ai/model-router";
import { ASSISTANT_PAGES, ASSISTANT_PAGE_KEYS, pageKeyFromPath, pagePath } from "@/lib/ai/assistant/pages";
import { createTask } from "@/lib/services/care-tasks";
import { createAppointment } from "@/lib/services/appointments";
import { createPatient } from "@/lib/services/patients";
import { getConversation, sendMessage } from "@/lib/services/assistant";
import { prepareHandover, shareHandover } from "@/lib/services/handovers";
import { appointmentInputSchema, taskCreateSchema } from "@/lib/domain/schemas";
import { createMedication } from "@/lib/services/medications";

type Step = (contents: ChatContent[]) => Partial<ToolTurnResult>;
let steps: Step[] = [];
let seen: ChatContent[][] = [];
let systems: string[] = [];
const call = (name: string, args: Record<string, unknown> = {}) => ({ text: "", calls: [{ name, args }] });
const say = (text: string) => ({ text, calls: [] as { name: string; args: Record<string, unknown> }[] });
const ai: AiClient = {
  async generateJson() { throw new Error("unused"); },
  async listModels() { return [{ name: "gemini-x-flash", actions: ["generateContent"] }]; },
  async generateWithTools({ contents, system }) {
    seen.push(structuredClone(contents)); systems.push(system);
    const r = (steps.shift() ?? (() => say("ok")))(contents);
    return { content: { role: "model", parts: [{ text: r.text ?? "" }] }, text: r.text ?? "", calls: r.calls ?? [], usage: { inputTokens: 1, outputTokens: 1 }, model: "gemini-x-flash" };
  },
};
const lastResult = () => ((seen.at(-1)!.at(-1)!.parts[0] as { functionResponse: { response: Record<string, unknown> } }).functionResponse.response);

async function world() {
  const w = await standardWorld();
  __resetModelCache(); __setAiClientForTests(ai); steps = []; seen = []; systems = [];
  const secondary = await addMember(w.fake, w.caregiver, w.patient.id, "sc1", "family", { tasks: true, manageCare: true, medications: true, adherence: true, appointments: true, documents: true });
  const noTasks = await addMember(w.fake, w.caregiver, w.patient.id, "nt1", "family", { appointments: true });
  return { ...w, secondary, noTasks };
}
beforeEach(() => { steps = []; });

describe("page list", () => {
  it("maps browser paths to pages and builds server-side paths", () => {
    expect(pageKeyFromPath("/patients/p1", "p1")).toBe("overview");
    expect(pageKeyFromPath("/patients/p1/tasks", "p1")).toBe("tasks");
    expect(pageKeyFromPath("/patients/p1/appointments/a9/brief", "p1")).toBe("appointments");
    expect(pageKeyFromPath("/patients/p1/care-circle", "p1")).toBe("care-circle");
    expect(pageKeyFromPath("/patients/other/tasks", "p1")).toBeNull();
    expect(pageKeyFromPath("/dashboard", "p1")).toBeNull();
    expect(pagePath("p1", "handover")).toBe("/patients/p1/handover");
    expect(ASSISTANT_PAGE_KEYS.every((k) => ASSISTANT_PAGES[k].suggestions.length > 0)).toBe(true);
  });
});

describe("assistant knows the whole app", () => {
  it("reads care tasks, respecting who may see them", async () => {
    const { caregiver, patient, patientUser, noTasks } = await world();
    await createTask(caregiver, patient.id, taskCreateSchema.parse({ title: "Arrange transport", assignedToUid: "cg1", dueDate: "2020-01-01" }));
    await createTask(caregiver, patient.id, taskCreateSchema.parse({ title: "Call the clinic" }));
    steps = [() => call("getCareTasks"), () => say("done")];
    await sendMessage(caregiver, patient.id, { message: "what tasks are open?" });
    const r = lastResult() as { records: { count: number; tasks: { title: string; overdue: boolean; responsible: string }[] } };
    expect(r.records.count).toBe(2);
    expect(r.records.tasks.find((t) => t.title === "Arrange transport")).toMatchObject({ overdue: true, responsible: expect.any(String) });
    expect(r.records.tasks.find((t) => t.title === "Call the clinic")!.responsible).toBe("Nobody yet");
    // The patient sees only tasks assigned to them; a member without task access sees an error.
    steps = [() => call("getCareTasks", { filter: "all" }), () => say("x")];
    await sendMessage(patientUser, patient.id, { message: "tasks?" });
    expect((lastResult() as { records: { count: number } }).records.count).toBe(0);
    steps = [() => call("getCareTasks"), () => say("x")];
    await sendMessage(noTasks, patient.id, { message: "tasks?" });
    expect(lastResult()).toHaveProperty("error");
  });

  it("reads recent family activity and the latest handover only for those allowed", async () => {
    const { caregiver, patient, secondary, noTasks, viewer } = await (async () => { const w = await world(); const viewer = await addMember(w.fake, w.caregiver, w.patient.id, "vw1", "family", { tasks: true }); return { ...w, viewer }; })();
    await createTask(caregiver, patient.id, taskCreateSchema.parse({ title: "Pick up prescription", assignedToUid: "sc1" }));
    steps = [() => call("getRecentCareActivity"), () => say("x")];
    await sendMessage(caregiver, patient.id, { message: "what happened recently?" });
    expect(JSON.stringify(lastResult())).toContain("Pick up prescription");
    steps = [() => call("getRecentCareActivity"), () => say("x")];
    await sendMessage(noTasks, patient.id, { message: "activity?" });
    expect(JSON.stringify(lastResult())).not.toContain("Pick up prescription");

    steps = [() => call("getLatestHandover"), () => say("x")];
    await sendMessage(caregiver, patient.id, { message: "latest handover?" });
    expect((lastResult() as { records: { found: boolean } }).records.found).toBe(false);
    const h = await prepareHandover(caregiver, patient.id, { useAi: false });
    await shareHandover(caregiver, patient.id, h.id, "sc1");
    steps = [() => call("getLatestHandover"), () => say("x")];
    await sendMessage(secondary, patient.id, { message: "latest handover?" });
    expect(lastResult()).toMatchObject({ records: { found: true, from: caregiver.displayName, acknowledged: false } });
    steps = [() => call("getLatestHandover"), () => say("x")];
    await sendMessage(viewer, patient.id, { message: "latest handover?" }); // not the recipient
    expect((lastResult() as { records: { found: boolean } }).records.found).toBe(false);
  });
});

describe("assistant links", () => {
  it("builds buttons on the server from a fixed list, and stores them with the message", async () => {
    const { caregiver, patient } = await world();
    steps = [() => call("openPage", { page: "scanner" }), () => call("openPage", { page: "scanner" }), () => say("Use the scanner.")];
    const res = await sendMessage(caregiver, patient.id, { message: "how do I scan a prescription?" });
    const msg = res.messages.at(-1)!;
    expect(msg.links).toEqual([{ label: "Open Prescription scanner", path: `/patients/${patient.id}/scanner` }]); // de-duplicated
    expect((await getConversation(caregiver, patient.id, res.conversation.id)).messages.at(-1)!.links).toHaveLength(1);
  });

  it("never offers a page the person cannot open, and rejects anything outside the list", async () => {
    const { patient, patientUser, caregiver } = await world();
    steps = [() => call("openPage", { page: "scanner" }), () => say("sorry")];
    const res = await sendMessage(patientUser, patient.id, { message: "open the scanner" });
    expect(lastResult()).toHaveProperty("error");
    expect(res.messages.at(-1)!.links ?? []).toEqual([]);
    steps = [() => call("openPage", { page: "https://evil.example/login" }), () => say("x")];
    const bad = await sendMessage(caregiver, patient.id, { message: "x" });
    expect(JSON.stringify(lastResult())).toMatch(/Invalid arguments/);
    expect(bad.messages.at(-1)!.links ?? []).toEqual([]);
  });

  it("links to a doctor brief only for a real appointment of THIS patient", async () => {
    const { caregiver, patient } = await world();
    const day = new Date(Date.now() + 3 * 86400_000).toISOString().slice(0, 10);
    const appt = await createAppointment(caregiver, patient.id, appointmentInputSchema.parse({ doctorName: "Dr Rao", facility: "City Clinic", date: day, time: "11:30", appointmentType: "Check-up" }));
    steps = [() => call("openDoctorBrief", { appointmentId: appt.id }), () => say("ok")];
    const res = await sendMessage(caregiver, patient.id, { message: "prepare a doctor brief" });
    expect(res.messages.at(-1)!.links![0].path).toBe(`/patients/${patient.id}/appointments/${appt.id}/brief`);
    const other = await createPatient(caregiver, { ...PATIENT_INPUT, fullName: "Other Person" });
    const otherAppt = await createAppointment(caregiver, other.id, appointmentInputSchema.parse({ doctorName: "Dr X", date: day, time: "10:00", appointmentType: "Check-up" }));
    steps = [() => call("openDoctorBrief", { appointmentId: otherAppt.id }), () => say("x")];
    const r2 = await sendMessage(caregiver, patient.id, { message: "brief for that" });
    expect(lastResult()).toHaveProperty("error");
    expect(r2.messages.at(-1)!.links ?? []).toEqual([]);
  });
});

describe("current page context", () => {
  it("tells the model which page the user is on, from a fixed label only", async () => {
    const { caregiver, patient } = await world();
    steps = [() => say("ok")];
    await sendMessage(caregiver, patient.id, { message: "what is this?", page: "tasks" });
    expect(systems.at(-1)).toContain('"Care tasks" page');
    steps = [() => say("ok")];
    await sendMessage(caregiver, patient.id, { message: "hello" });
    expect(systems.at(-1)).not.toContain("is looking at");
    expect(systems.at(-1)).toMatch(/Care tasks, Care handover/);
  });

  it("still keeps answers grounded in records when a medicine exists", async () => {
    const { caregiver, patient } = await world();
    await createMedication(caregiver, patient.id, MED_INPUT);
    steps = [() => call("getMedicationList"), () => say("Metformin.")];
    const res = await sendMessage(caregiver, patient.id, { message: "what is listed?", page: "medications" });
    expect(res.messages.at(-1)!.toolCalls[0]).toEqual({ name: "getMedicationList", ok: true });
    void makeUser;
  });
});

import { cleanReply } from "@/lib/ai/assistant/clean-reply";
describe("repairing replies where the model typed a tool call", () => {
  it("turns a typed openPage call into a page request and strips link syntax", () => {
    const r = cleanReply("You can prepare it on the handover page. [Open Care handover](command:default_api:openPage{page:handover}) Done.");
    expect(r.pages).toEqual(["handover"]);
    expect(r.text).toBe("You can prepare it on the handover page. Open Care handover Done.");
    expect(cleanReply("Try openPage(page: tasks) now").pages).toEqual(["tasks"]);
  });
  it("never trusts link targets from the model", () => {
    const r = cleanReply("Go to [your bank](https://evil.example/login) or [x](javascript:alert(1)).");
    expect(r.pages).toEqual([]);
    expect(r.text).toBe("Go to your bank or x.");
    expect(r.text).not.toMatch(/evil|javascript|https?:/);
  });
  it("ignores pages that are not in the fixed list and leaves normal text alone", () => {
    expect(cleanReply("openPage{page:admin}").pages).toEqual([]);
    const plain = "You have two medicines today.\n- Metformin at 8:00 AM\n- Amlodipine at 9:00 AM";
    expect(cleanReply(plain)).toEqual({ text: plain, pages: [] });
  });
  it("creates the real, permission-checked button from a typed call, and refuses what the person cannot open", async () => {
    const { caregiver, patient, patientUser } = await world();
    steps = [() => say("Scan it here. [Open scanner](command:default_api:openPage{page:scanner})")];
    const res = await sendMessage(caregiver, patient.id, { message: "how do I scan?" });
    expect(res.messages.at(-1)!.content).toBe("Scan it here. Open scanner");
    expect(res.messages.at(-1)!.links).toEqual([{ label: "Open Prescription scanner", path: `/patients/${patient.id}/scanner` }]);
    steps = [() => say("Scan it here. [Open scanner](command:default_api:openPage{page:scanner})")];
    const denied = await sendMessage(patientUser, patient.id, { message: "how do I scan?" });
    expect(denied.messages.at(-1)!.links ?? []).toEqual([]); // the patient cannot open the scanner
  });
});
