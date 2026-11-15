import "server-only";
import { aiConfig } from "./config";
import type { AiClient, GenerateJsonRequest, ToolTurnRequest } from "./contracts";
import { AiError, type AiFailureCode } from "./errors";
import { GeminiClient } from "./gemini";
import { OpenCodeClient } from "./opencode";
import { OpenRouterClient } from "./openrouter";

export type { AiClient, AiTask, ChatContent, GenerateJsonRequest, TokenUsage, ToolDeclaration, ToolTurnRequest, ToolTurnResult } from "./contracts";
export { toModelSchema } from "./hedge";

let override: AiClient | null = null;
/** Test seam. */
export function __setAiClientForTests(c: AiClient | null) {
  override = c;
}

/** Failures after which the NEXT provider should be tried (the request itself was fine). */
const NEXT_PROVIDER: AiFailureCode[] = ["ai_unavailable", "ai_model_missing", "ai_timeout", "ai_bad_output", "ai_not_configured"];

function providers(): { name: string; client: AiClient }[] {
  const c = aiConfig();
  const out: { name: string; client: AiClient }[] = [];
  for (const name of c.providerOrder) {
    if (name === "gemini" && c.apiKey) out.push({ name, client: new GeminiClient(c.apiKey) });
    if (name === "openrouter" && c.openrouterKey) out.push({ name, client: new OpenRouterClient(c.openrouterKey) });
    if (name === "opencode" && c.opencodeKey) out.push({ name, client: new OpenCodeClient(c.opencodeKey) });
  }
  return out;
}

/**
 * Tries configured providers in order (AI_PROVIDER, default "gemini,openrouter,opencode").
 * Each provider does its own model fallback; this only moves on when a whole
 * provider is unavailable. One shared deadline bounds the entire request.
 */
async function acrossProviders<R>(call: (c: AiClient, deadlineAt: number) => Promise<R>, supports: (c: AiClient) => boolean): Promise<R> {
  const list = providers().filter((p) => supports(p.client));
  if (!list.length) throw new AiError("ai_not_configured");
  const deadlineAt = Date.now() + aiConfig().timeoutMs;
  let last: AiError = new AiError("ai_unavailable");
  for (const p of list) {
    if (deadlineAt - Date.now() < 3000) break;
    try {
      return await call(p.client, deadlineAt);
    } catch (e) {
      if (!(e instanceof AiError) || !NEXT_PROVIDER.includes(e.failure)) throw e;
      last = e;
    }
  }
  throw last;
}

const composite: AiClient = {
  generateJson: <T>(req: GenerateJsonRequest<T>) => acrossProviders((c, deadlineAt) => c.generateJson({ ...req, deadlineAt }), () => true),
  generateWithTools: (req: ToolTurnRequest) => acrossProviders((c, deadlineAt) => c.generateWithTools!({ ...req, deadlineAt }), (c) => Boolean(c.generateWithTools)),
};

export function aiClient(): AiClient {
  if (override) return override;
  return composite;
}

/** Gemini model discovery (used by the model router when no Gemini model list is configured). */
export function geminiDiscovery(): AiClient {
  if (override) return override;
  const { apiKey } = aiConfig();
  if (!apiKey) throw new AiError("ai_not_configured");
  return new GeminiClient(apiKey);
}
