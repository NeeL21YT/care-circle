import "server-only";
import { aiConfig } from "./config";
import { geminiDiscovery } from "./client";
import type { AiTask } from "./contracts";
import { AiError } from "./errors";

export type { AiTask };

/** Not a model list: only name patterns for things that are NOT chat models. */
const EXCLUDE = /embed|imagen|veo|tts|image|robotics|aqa|learnlm|gemma|computer-use|deep-research|nano-banana|omni|antigravity/i;
const isPreview = (n: string) => /preview|exp|latest|-\d{2}-\d{4}$/i.test(n);
/**
 * Stable before preview, then by task:
 *  - text (chat, tool calls): latency matters, so Lite first, then Flash, then Pro.
 *  - vision (documents): accuracy matters, so Flash first, then Lite, then Pro.
 * Within a tier, newer versions first. Slow or quota-limited models are handled at
 * call time by hedged fallback (client.ts), not guessed here.
 */
function rankFor(task: AiTask) {
  const tier = (n: string) => {
    const lite = /lite/i.test(n);
    const flash = /flash/i.test(n) && !lite;
    const pro = /pro/i.test(n);
    if (task === "text") return lite ? 0 : flash ? 1 : pro ? 2 : 3;
    return flash ? 0 : lite ? 1 : pro ? 2 : 3;
  };
  const ver = (n: string) => Number(n.match(/gemini-(\d+(?:\.\d+)?)/)?.[1] ?? 0);
  return (a: string, b: string) => Number(isPreview(a)) - Number(isPreview(b)) || tier(a) - tier(b) || ver(b) - ver(a) || a.localeCompare(b);
}

let cache: { at: number; models: { name: string; actions: string[] }[] } | null = null;
export function __resetModelCache() {
  cache = null;
}

async function discovered() {
  if (cache && Date.now() - cache.at < 60 * 60_000) return cache.models;
  const client = geminiDiscovery();
  if (!client.listModels) throw new AiError("ai_model_missing");
  const models = await client.listModels();
  cache = { at: Date.now(), models };
  return models;
}

/**
 * Ordered fallback list for a task. Uses the configured list (env) if present,
 * else discovers from `models.list`: stable Flash first, then Pro, then previews.
 */
export async function modelsFor(task: AiTask): Promise<string[]> {
  const c = aiConfig();
  const configured = task === "vision" ? c.visionModels : task === "live" ? c.liveModels : c.textModels;
  if (configured.length) return configured;
  const action = task === "live" ? "bidiGenerateContent" : "generateContent";
  const names = (await discovered())
    .filter((m) => m.name.startsWith("gemini-") && m.actions.includes(action))
    .map((m) => m.name)
    .filter((n) => (task === "live" ? /live|native-audio/i.test(n) : !EXCLUDE.test(n) && !/live|native-audio/i.test(n)))
    .sort(rankFor(task));
  if (!names.length) throw new AiError("ai_model_missing");
  return names.slice(0, 4);
}
