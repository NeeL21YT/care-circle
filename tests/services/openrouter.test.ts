import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { OpenRouterClient, toOpenAiMessages, toOpenAiUserContent } from "@/lib/ai/openrouter";
import { aiClient, __setAiClientForTests } from "@/lib/ai/client";
import { isAiConfigured } from "@/lib/ai/config";

const ENV = ["OPENCODE_API_KEY", "OPENCODE_TEXT_MODEL", "OPENCODE_VISION_MODEL", "OPENCODE_BASE_URL", "GEMINI_API_KEY", "OPENROUTER_API_KEY", "OPENROUTER_TEXT_MODEL", "OPENROUTER_VISION_MODEL", "AI_PROVIDER"];
interface OaBody {
  model: string;
  provider?: { require_parameters: boolean };
  response_format: { type: string; json_schema: { strict: boolean } };
  messages: { role: string; tool_calls: { id: string }[]; tool_call_id: string }[];
  tools: { type: string }[];
}
let calls: { url: string; body: OaBody; headers: Record<string, string> }[] = [];
type Reply = { status?: number; json: unknown };
let replies: Reply[] = [];

beforeEach(() => {
  for (const k of ENV) delete process.env[k];
  __setAiClientForTests(null);
  calls = [];
  replies = [];
  vi.stubGlobal("fetch", async (url: string, init: { body: string; headers: Record<string, string> }) => {
    calls.push({ url, body: JSON.parse(init.body), headers: init.headers });
    const r = replies.shift() ?? { json: {} };
    return new Response(JSON.stringify(r.json), { status: r.status ?? 200 });
  });
});
afterEach(() => vi.unstubAllGlobals());

const schema = z.object({ name: z.string().max(50), dose: z.number().min(0).nullable() });
const ok = (content: string) => ({ json: { choices: [{ message: { content } }], usage: { prompt_tokens: 7, completion_tokens: 3 } } });

describe("OpenRouter structured output", () => {
  it("sends a strict json_schema request without validation keywords, and validates the reply", async () => {
    process.env.OPENROUTER_TEXT_MODEL = "vendor/model-a";
    replies = [ok('{"name":"Metformin","dose":1}')];
    const out = await new OpenRouterClient("k").generateJson({ task: "text", system: "sys", parts: [{ text: "x" }], schema });
    expect(out.data).toEqual({ name: "Metformin", dose: 1 });
    expect(out.usage).toEqual({ inputTokens: 7, outputTokens: 3 });
    expect(out.model).toBe("vendor/model-a");
    const c = calls[0];
    expect(c.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(c.headers.Authorization).toBe("Bearer k");
    expect(c.body.response_format.type).toBe("json_schema");
    expect(c.body.response_format.json_schema.strict).toBe(true);
    expect(JSON.stringify(c.body.response_format)).not.toMatch(/maxLength|minimum/);
    expect(c.body.provider).toEqual({ require_parameters: true });
    expect(JSON.stringify(c.headers)).not.toMatch(/example|@/); // no personal data in headers
  });

  it("encodes images as image_url and PDFs as file parts", () => {
    const c = toOpenAiUserContent([{ inlineData: { mimeType: "image/png", data: "AAA" } }, { inlineData: { mimeType: "application/pdf", data: "BBB" } }, { text: "go" }]) as { type: string; image_url?: unknown; file?: { file_data: string } }[];
    expect(c[0]).toEqual({ type: "image_url", image_url: { url: "data:image/png;base64,AAA" } });
    expect(c[1].type).toBe("file");
    expect(c[1].file?.file_data).toBe("data:application/pdf;base64,BBB");
    expect(c[2]).toEqual({ type: "text", text: "go" });
  });

  it("falls back to the next configured model when one fails, and maps errors", async () => {
    process.env.OPENROUTER_TEXT_MODEL = "m1,m2";
    replies = [{ status: 404, json: {} }, ok('{"name":"X","dose":null}')];
    const out = await new OpenRouterClient("k").generateJson({ task: "text", system: "s", parts: [{ text: "x" }], schema });
    expect(out.model).toBe("m2");
    expect(calls.map((c) => c.body.model)).toEqual(["m1", "m2"]);
  });

  it("rejects malformed output and surfaces upstream errors returned with HTTP 200", async () => {
    process.env.OPENROUTER_TEXT_MODEL = "solo";
    replies = [ok("not json")];
    await expect(new OpenRouterClient("k").generateJson({ task: "text", system: "s", parts: [{ text: "x" }], schema })).rejects.toMatchObject({ code: "ai_bad_output" });
    replies = [{ json: { error: { code: 429, message: "slow down" } } }];
    await expect(new OpenRouterClient("k").generateJson({ task: "text", system: "s", parts: [{ text: "x" }], schema })).rejects.toMatchObject({ code: "ai_unavailable" });
  });

  it("requires explicit models (no hidden defaults)", async () => {
    await expect(new OpenRouterClient("k").generateJson({ task: "text", system: "s", parts: [{ text: "x" }], schema })).rejects.toMatchObject({ code: "ai_model_missing" });
    expect(calls).toHaveLength(0);
  });
});

describe("OpenRouter tool calling", () => {
  it("converts neutral turns (including Gemini-shaped ones) and returns tool calls", async () => {
    process.env.OPENROUTER_TEXT_MODEL = "tool-model";
    replies = [{ json: { choices: [{ message: { content: null, tool_calls: [{ function: { name: "getMedicationList", arguments: "{}" } }] } }] } }];
    const contents = [
      { role: "user" as const, parts: [{ text: "hi" }] },
      { role: "model" as const, parts: [{ functionCall: { name: "getMedicationList", args: {} }, thoughtSignature: "abc" }] },
      { role: "user" as const, parts: [{ functionResponse: { name: "getMedicationList", response: { records: [] } } }] },
    ];
    const r = await new OpenRouterClient("k").generateWithTools({ task: "text", system: "s", contents, tools: [{ name: "getMedicationList", description: "d", parameters: { type: "object", properties: {} } }] });
    expect(r.calls).toEqual([{ name: "getMedicationList", args: {} }]);
    expect(r.model).toBe("openrouter:tool-model");
    const msgs = calls[0].body.messages;
    expect(msgs.map((m) => m.role)).toEqual(["system", "user", "assistant", "tool"]);
    expect(msgs[2].tool_calls[0].id).toBe(msgs[3].tool_call_id);
    expect(calls[0].body.tools[0].type).toBe("function");
  });

  it("tolerates malformed tool arguments (the tool's own validation rejects them later)", async () => {
    process.env.OPENROUTER_TEXT_MODEL = "t";
    replies = [{ json: { choices: [{ message: { tool_calls: [{ function: { name: "x", arguments: "{broken" } }] } }] } }];
    const r = await new OpenRouterClient("k").generateWithTools({ task: "text", system: "s", contents: [{ role: "user", parts: [{ text: "q" }] }], tools: [] });
    expect(r.calls).toEqual([{ name: "x", args: {} }]);
  });

  it("builds plain messages for text-only history", () => {
    expect(toOpenAiMessages("s", [{ role: "user", parts: [{ text: "a" }] }, { role: "model", parts: [{ text: "b" }] }]).map((m) => m.role)).toEqual(["system", "user", "assistant"]);
  });
});

describe("OpenCode Zen", () => {
  it("uses its own base URL, key and models, and sends no OpenRouter-only fields", async () => {
    process.env.OPENCODE_TEXT_MODEL = "zen-model";
    replies = [ok('{"name":"Z","dose":null}')];
    const { OpenCodeClient } = await import("@/lib/ai/opencode");
    const out = await new OpenCodeClient("zk").generateJson({ task: "text", system: "s", parts: [{ text: "x" }], schema });
    expect(out.data.name).toBe("Z");
    expect(calls[0].url).toBe("https://opencode.ai/zen/v1/chat/completions");
    expect(calls[0].headers.Authorization).toBe("Bearer zk");
    expect(calls[0].body.provider).toBeUndefined();
    expect(calls[0].body.model).toBe("zen-model");
  });

  it("is used when it is the only configured provider, and as a fallback after another provider fails", async () => {
    process.env.OPENCODE_API_KEY = "zk";
    process.env.OPENCODE_TEXT_MODEL = "zen-model";
    replies = [ok('{"name":"A","dose":1}')];
    expect((await aiClient().generateJson({ task: "text", system: "s", parts: [{ text: "x" }], schema })).data.name).toBe("A");
    // OpenRouter first (fails with 404 on its only model), then OpenCode answers.
    process.env.OPENROUTER_API_KEY = "ok";
    process.env.OPENROUTER_TEXT_MODEL = "or-model";
    replies = [{ status: 404, json: {} }, ok('{"name":"B","dose":1}')];
    calls = [];
    const out = await aiClient().generateJson({ task: "text", system: "s", parts: [{ text: "x" }], schema });
    expect(out.data.name).toBe("B");
    expect(calls.map((c) => c.url.split("/")[2])).toEqual(["openrouter.ai", "opencode.ai"]);
  });

  it("needs models as well as a key to count as configured", async () => {
    process.env.OPENCODE_API_KEY = "zk";
    expect(isAiConfigured()).toBe(false);
    process.env.OPENCODE_TEXT_MODEL = "m";
    expect(isAiConfigured()).toBe(true);
  });
});

describe("provider selection and cross-provider fallback", () => {
  it("is configured with either provider; OpenRouter also needs models", () => {
    expect(isAiConfigured()).toBe(false);
    process.env.OPENROUTER_API_KEY = "k";
    expect(isAiConfigured()).toBe(false);
    process.env.OPENROUTER_TEXT_MODEL = "m";
    expect(isAiConfigured()).toBe(true);
    delete process.env.OPENROUTER_API_KEY;
    process.env.GEMINI_API_KEY = "g";
    expect(isAiConfigured()).toBe(true);
  });

  it("uses OpenRouter when Gemini has no key, and reports not configured when neither does", async () => {
    await expect(aiClient().generateJson({ task: "text", system: "s", parts: [{ text: "x" }], schema })).rejects.toMatchObject({ code: "ai_not_configured" });
    process.env.OPENROUTER_API_KEY = "k";
    process.env.OPENROUTER_TEXT_MODEL = "or-model";
    replies = [ok('{"name":"Y","dose":2}')];
    const out = await aiClient().generateJson({ task: "text", system: "s", parts: [{ text: "x" }], schema });
    expect(out.data.name).toBe("Y");
  });

  it("honors AI_PROVIDER to restrict providers", async () => {
    process.env.OPENROUTER_API_KEY = "k";
    process.env.OPENROUTER_TEXT_MODEL = "or-model";
    process.env.AI_PROVIDER = "gemini";
    await expect(aiClient().generateJson({ task: "text", system: "s", parts: [{ text: "x" }], schema })).rejects.toMatchObject({ code: "ai_not_configured" });
    expect(calls).toHaveLength(0);
  });
});
