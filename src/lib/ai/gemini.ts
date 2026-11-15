import "server-only";
import { GoogleGenAI, type Content } from "@google/genai";
import { z } from "zod";
import type { AiClient, GenerateJsonRequest, TokenUsage, ToolTurnRequest, ToolTurnResult } from "./contracts";
import { AiError } from "./errors";
import { aiConfig } from "./config";
import { hedged, toModelSchema } from "./hedge";
import { modelsFor } from "./model-router";

export class GeminiClient implements AiClient {
  private sdk: GoogleGenAI;
  constructor(apiKey: string) {
    this.sdk = new GoogleGenAI({ apiKey });
  }

  async listModels() {
    const out: { name: string; actions: string[] }[] = [];
    for await (const m of await this.sdk.models.list({ config: { pageSize: 100 } })) {
      if (m.name) out.push({ name: m.name.replace(/^models\//, ""), actions: m.supportedActions ?? [] });
    }
    return out;
  }

  async generateJson<T>(req: GenerateJsonRequest<T>) {
    const models = await modelsFor(req.task);
    return hedged("gemini", models, (model, t) => this.jsonOnce(model, req, t), req.deadlineAt);
  }

  async generateWithTools(req: ToolTurnRequest) {
    const models = await modelsFor(req.task);
    return hedged("gemini", models, (model, t) => this.toolsOnce(model, req, t), req.deadlineAt);
  }

  private async jsonOnce<T>(model: string, req: GenerateJsonRequest<T>, timeoutMs: number) {
    let text: string | undefined;
    let usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
    try {
      const res = await this.sdk.models.generateContent({
        model,
        contents: [{ role: "user", parts: req.parts }],
        config: {
          systemInstruction: req.system,
          responseMimeType: "application/json",
          responseJsonSchema: toModelSchema(z.toJSONSchema(req.schema as z.ZodType)),
          temperature: 0,
          maxOutputTokens: 8192,
          httpOptions: { timeout: timeoutMs },
        },
      });
      text = res.text;
      usage = tokens(res);
    } catch (e) {
      throw mapSdkError(e);
    }
    if (!text) throw new AiError("ai_blocked");
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new AiError("ai_bad_output");
    }
    const parsed = req.schema.safeParse(json);
    if (!parsed.success) throw new AiError("ai_bad_output");
    return { data: parsed.data, usage };
  }

  private async toolsOnce(model: string, req: ToolTurnRequest, timeoutMs: number): Promise<ToolTurnResult> {
    try {
      const res = await this.sdk.models.generateContent({
        model,
        contents: req.contents as Content[], // neutral parts are the SDK's parts, plus fields (thought signatures) that must round-trip
        config: {
          systemInstruction: req.system,
          tools: [{ functionDeclarations: req.tools.map((t) => ({ name: t.name, description: t.description, parametersJsonSchema: t.parameters })) }],
          temperature: 0.2,
          maxOutputTokens: 2048,
          httpOptions: { timeout: timeoutMs },
        },
      });
      const content = res.candidates?.[0]?.content;
      const calls = (res.functionCalls ?? []).map((c) => ({ name: c.name ?? "", args: (c.args ?? {}) as Record<string, unknown> }));
      const text = (content?.parts ?? []).map((p) => (p.thought ? "" : (p.text ?? ""))).join("").trim();
      if (!content || (!text && !calls.length)) throw new AiError("ai_blocked");
      return { content: { role: "model", parts: content.parts ?? [] }, text, calls, usage: tokens(res), model };
    } catch (e) {
      throw e instanceof AiError ? e : mapSdkError(e);
    }
  }
}

const tokens = (res: { usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } }): TokenUsage => ({
  inputTokens: res.usageMetadata?.promptTokenCount ?? 0,
  outputTokens: res.usageMetadata?.candidatesTokenCount ?? 0,
});

function mapSdkError(e: unknown): AiError {
  const msg = e instanceof Error ? `${e.name} ${e.message}` : "";
  const status = (e as { status?: number })?.status;
  if (status === 404 || /not found|is not supported|no longer available|deprecated/i.test(msg)) return new AiError("ai_model_missing");
  if (/abort|timeout|timed out|deadline/i.test(msg) || status === 408 || status === 504 || /DEADLINE_EXCEEDED/.test(msg)) return new AiError("ai_timeout");
  // Do not log message text: SDK errors can echo request content.
  console.error("[ai:gemini] model call failed", status ?? "no-status");
  return new AiError("ai_unavailable");
}

export const geminiConfigured = () => Boolean(aiConfig().apiKey);
