import "server-only";

/**
 * Gemini configuration. Model ids are NEVER hardcoded at call sites: they come
 * from the environment so a retired model is a config change, not a deploy.
 * None of these values is exposed to browser code (no NEXT_PUBLIC_ prefix).
 *
 * No model id appears in code. Each GEMINI_*_MODEL variable is an ORDERED,
 * comma-separated fallback list ("a,b,c"). When unset, the router discovers
 * suitable models from `models.list` for the configured key (model-router.ts).
 */
export const PROMPT_VERSIONS = {
  prescription: "rx-2026-11-1",
  documentSummary: "doc-2026-11-1",
  handover: "handover-2026-11-1",
  assistant: "assistant-2026-11-1",
} as const;

export interface AiConfig {
  apiKey: string | null;
  openrouterKey: string | null;
  /** Providers to try, in order. Only those with a key are used. */
  providerOrder: string[];
  /** OpenRouter has no sensible automatic default (prices and quality vary a lot), so these must be set. */
  openrouterTextModels: string[];
  openrouterVisionModels: string[];
  opencodeKey: string | null;
  opencodeBaseUrl: string;
  opencodeTextModels: string[];
  opencodeVisionModels: string[];
  /** Ordered fallback lists; empty means "discover". */
  textModels: string[];
  visionModels: string[];
  liveModels: string[];
  /** Total budget for one AI request across all fallback attempts. */
  timeoutMs: number;
  attemptTimeoutMs: number;
  /** Start the next fallback model if the current one has not answered after this long. */
  hedgeMs: number;
  /** Per user, per patient, per UTC day. */
  dailyQuota: { prescription: number; assistant: number; document: number; voice: number; handover: number };
}

export function aiConfig(): AiConfig {
  const list = (v: string | undefined) => (v ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  const textModels = list(process.env.GEMINI_TEXT_MODEL);
  return {
    apiKey: process.env.GEMINI_API_KEY || null,
    openrouterKey: process.env.OPENROUTER_API_KEY || null,
    providerOrder: list(process.env.AI_PROVIDER).length ? list(process.env.AI_PROVIDER).map((x) => x.toLowerCase()) : ["gemini", "openrouter", "opencode"],
    openrouterTextModels: list(process.env.OPENROUTER_TEXT_MODEL),
    openrouterVisionModels: list(process.env.OPENROUTER_VISION_MODEL).length ? list(process.env.OPENROUTER_VISION_MODEL) : list(process.env.OPENROUTER_TEXT_MODEL),
    opencodeKey: process.env.OPENCODE_API_KEY || null,
    opencodeBaseUrl: process.env.OPENCODE_BASE_URL || "https://opencode.ai/zen/v1",
    opencodeTextModels: list(process.env.OPENCODE_TEXT_MODEL),
    opencodeVisionModels: list(process.env.OPENCODE_VISION_MODEL).length ? list(process.env.OPENCODE_VISION_MODEL) : list(process.env.OPENCODE_TEXT_MODEL),
    textModels,
    visionModels: list(process.env.GEMINI_VISION_MODEL).length ? list(process.env.GEMINI_VISION_MODEL) : textModels,
    liveModels: list(process.env.GEMINI_LIVE_MODEL),
    timeoutMs: Number(process.env.GEMINI_TIMEOUT_MS) || 55_000,
    attemptTimeoutMs: Number(process.env.GEMINI_ATTEMPT_TIMEOUT_MS) || 25_000,
    hedgeMs: Number(process.env.GEMINI_HEDGE_MS) || 12_000,
    dailyQuota: {
      prescription: Number(process.env.AI_DAILY_PRESCRIPTION_SCANS) || 20,
      assistant: Number(process.env.AI_DAILY_ASSISTANT_MESSAGES) || 200,
      document: Number(process.env.AI_DAILY_DOCUMENT_REQUESTS) || 40,
      voice: Number(process.env.AI_DAILY_VOICE_SESSIONS) || 20,
      handover: Number(process.env.AI_DAILY_HANDOVER_SUMMARIES) || 30,
    },
  };
}

export function isAiConfigured(): boolean {
  const c = aiConfig();
  return c.providerOrder.some((p) => (p === "gemini" && c.apiKey) || (p === "openrouter" && c.openrouterKey && c.openrouterTextModels.length) || (p === "opencode" && c.opencodeKey && c.opencodeTextModels.length));
}
