import "server-only";
import { z } from "zod";
import type { AiClient, ChatContent, GenerateJsonRequest, TokenUsage, ToolTurnRequest, ToolTurnResult } from "./contracts";
import { AiError } from "./errors";
import { hedged, toModelSchema } from "./hedge";


type OaMessage =
  | { role: "system" | "user"; content: string | unknown[] }
  | { role: "assistant"; content: string | null; tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[] }
  | { role: "tool"; tool_call_id: string; content: string };

/**
 * Converts the neutral ChatContent turns to OpenAI-style messages. Tool calls
 * and results are paired by position (not provider ids), so a turn started by
 * Gemini can be continued by OpenRouter and vice versa.
 */
export function toOpenAiMessages(system: string, contents: ChatContent[]): OaMessage[] {
  const out: OaMessage[] = [{ role: "system", content: system }];
  let pendingIds: string[] = [];
  contents.forEach((c, i) => {
    const parts = c.parts as Record<string, unknown>[];
    if (c.role === "model") {
      const text = parts.map((p) => (typeof p.text === "string" && !p.thought ? p.text : "")).join("");
      const calls = parts.filter((p) => p.functionCall).map((p) => p.functionCall as { name: string; args?: unknown });
      pendingIds = calls.map((_, j) => `call_${i}_${j}`);
      out.push({
        role: "assistant",
        content: text || null,
        ...(calls.length ? { tool_calls: calls.map((fc, j) => ({ id: pendingIds[j], type: "function" as const, function: { name: fc.name, arguments: JSON.stringify(fc.args ?? {}) } })) } : {}),
      });
      return;
    }
    const responses = parts.filter((p) => p.functionResponse).map((p) => p.functionResponse as { name: string; response: unknown });
    if (responses.length) {
      responses.forEach((r, j) => out.push({ role: "tool", tool_call_id: pendingIds[j] ?? `call_${i}_${j}`, content: JSON.stringify(r.response ?? {}) }));
      return;
    }
    out.push({ role: "user", content: parts.map((p) => (typeof p.text === "string" ? p.text : "")).join("") });
  });
  return out;
}

export function toOpenAiUserContent(parts: GenerateJsonRequest<unknown>["parts"]): unknown[] {
  return parts.map((p) => {
    if ("text" in p) return { type: "text", text: p.text };
    const url = `data:${p.inlineData.mimeType};base64,${p.inlineData.data}`;
    return p.inlineData.mimeType === "application/pdf"
      ? { type: "file", file: { filename: "document.pdf", file_data: url } }
      : { type: "image_url", image_url: { url } };
  });
}

interface OaResponse {
  choices?: { message?: { content?: string | null; tool_calls?: { function?: { name?: string; arguments?: string } }[] } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { code?: number | string; message?: string };
}

function mapStatus(status: number, label: string): AiError {
  if (status === 404) return new AiError("ai_model_missing");
  if (status === 408 || status === 504) return new AiError("ai_timeout");
  // 401/402/403/429/5xx: this model or key cannot serve us right now. Log the code only.
  console.error(`[ai:${label}] request failed`, status);
  return new AiError("ai_unavailable");
}

export interface CompatOptions {
  /** Provider label used in logs, fallback bookkeeping and the returned model id. */
  name: string;
  baseUrl: string;
  key: string;
  /** Ordered model fallback lists, resolved from configuration. */
  models: (task: "text" | "vision" | "live") => string[];
  /** Extra static headers (generic app attribution only: never user or patient data). */
  headers?: Record<string, string>;
  /** Extra static body fields (e.g. OpenRouter routing preferences). */
  extraBody?: Record<string, unknown>;
}

/** Any OpenAI-compatible chat-completions gateway (OpenRouter, OpenCode Zen, ...). */
export class OpenAiCompatClient implements AiClient {
  constructor(private o: CompatOptions) {}

  private async post(body: unknown, timeoutMs: number): Promise<OaResponse> {
    let res: Response;
    try {
      res = await fetch(`${this.o.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.o.key}`,
          "Content-Type": "application/json",
          ...this.o.headers,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      if (e instanceof Error && /abort|timeout/i.test(`${e.name} ${e.message}`)) throw new AiError("ai_timeout");
      console.error(`[ai:${this.o.name}] network error`);
      throw new AiError("ai_unavailable");
    }
    if (!res.ok) throw mapStatus(res.status, this.o.name);
    const json = (await res.json().catch(() => null)) as OaResponse | null;
    if (!json) throw new AiError("ai_bad_output");
    // OpenRouter can return HTTP 200 with an error body when an upstream provider fails.
    if (json.error) throw mapStatus(Number(json.error.code) || 502, this.o.name);
    return json;
  }

  generateJson<T>(req: GenerateJsonRequest<T>) {
    return hedged(this.o.name, this.o.models(req.task), async (model, timeoutMs) => {
      const schema = toModelSchema(z.toJSONSchema(req.schema as z.ZodType));
      const json = await this.post(
        {
          model,
          messages: [
            { role: "system", content: req.system },
            { role: "user", content: toOpenAiUserContent(req.parts) },
          ],
          // No temperature: many models reject it, and with require_parameters that leaves no provider.
          max_tokens: 4096,
          response_format: { type: "json_schema", json_schema: { name: "result", strict: true, schema } },
          ...this.o.extraBody,
        },
        timeoutMs,
      );
      const text = json.choices?.[0]?.message?.content;
      if (!text) throw new AiError("ai_blocked");
      let data: unknown;
      try {
        data = JSON.parse(text);
      } catch {
        throw new AiError("ai_bad_output");
      }
      const parsed = req.schema.safeParse(data);
      if (!parsed.success) throw new AiError("ai_bad_output");
      return { data: parsed.data, usage: usage(json) };
    }, req.deadlineAt);
  }

  generateWithTools(req: ToolTurnRequest) {
    return hedged<Omit<ToolTurnResult, "model">>(this.o.name, this.o.models(req.task), async (model, timeoutMs) => {
      const json = await this.post(
        {
          model,
          messages: toOpenAiMessages(req.system, req.contents),
          tools: req.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } })),
          max_tokens: 2048,
          ...this.o.extraBody,
        },
        timeoutMs,
      );
      const msg = json.choices?.[0]?.message;
      const text = (msg?.content ?? "").trim();
      const calls = (msg?.tool_calls ?? []).map((c) => {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(c.function?.arguments || "{}");
        } catch {
          /* malformed arguments are rejected later by the tool's own validation */
        }
        return { name: c.function?.name ?? "", args };
      });
      if (!text && !calls.length) throw new AiError("ai_blocked");
      const parts: unknown[] = [...(text ? [{ text }] : []), ...calls.map((c) => ({ functionCall: { name: c.name, args: c.args } }))];
      return { content: { role: "model" as const, parts }, text, calls, usage: usage(json) };
    }, req.deadlineAt).then((r) => ({ ...r, model: `${this.o.name}:${r.model}` }));
  }

  /** The gateway's own model list, so people can choose what to configure. */
  async listModels() {
    const res = await fetch(`${this.o.baseUrl.replace(/\/$/, "")}/models`, { headers: { Authorization: `Bearer ${this.o.key}` } });
    if (!res.ok) throw mapStatus(res.status, this.o.name);
    const json = (await res.json()) as { data?: { id: string; supported_parameters?: string[] }[] };
    return (json.data ?? []).map((m) => ({ name: m.id, actions: m.supported_parameters ?? [] }));
  }
}

const usage = (j: OaResponse): TokenUsage => ({ inputTokens: j.usage?.prompt_tokens ?? 0, outputTokens: j.usage?.completion_tokens ?? 0 });
