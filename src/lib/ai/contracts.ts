/** Provider-neutral AI contracts. No runtime code, so providers and services can import freely. */
import type { z } from "zod";

export type AiTask = "vision" | "text" | "live";

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export type Part = { inlineData: { mimeType: string; data: string } } | { text: string };

export interface GenerateJsonRequest<T> {
  /** Which kind of model to use. Each provider resolves its own fallback list for the task. */
  task: AiTask;
  /** Trusted instructions only. Untrusted document text never goes here. */
  system: string;
  /** Untrusted content: the document bytes and a short task line. */
  parts: Part[];
  schema: z.ZodType<T>;
  /** Absolute time (ms) by which the whole request, across providers, must finish. */
  deadlineAt?: number;
}

/**
 * A turn in a tool-calling conversation. Parts use neutral shapes that every
 * provider understands: { text }, { functionCall: { name, args } } (model) and
 * { functionResponse: { name, response } } (user). Providers may add extra
 * fields (e.g. thought signatures) which must round-trip untouched.
 */
export interface ChatContent {
  role: "user" | "model";
  parts: unknown[];
}
export interface ToolDeclaration {
  name: string;
  description: string;
  /** JSON Schema for the arguments. */
  parameters: unknown;
}
export interface ToolTurnRequest {
  task: AiTask;
  system: string;
  contents: ChatContent[];
  tools: ToolDeclaration[];
  deadlineAt?: number;
}
export interface ToolTurnResult {
  /** The model's turn, to append to `contents` before sending tool results. */
  content: ChatContent;
  text: string;
  calls: { name: string; args: Record<string, unknown> }[];
  usage: TokenUsage;
  model: string;
}

/** Narrow seam over provider SDKs so services (and tests) never depend on them directly. */
export interface AiClient {
  generateJson<T>(req: GenerateJsonRequest<T>): Promise<{ data: T; usage: TokenUsage; model: string }>;
  /**
   * One model turn with function calling. The model only REQUESTS calls; the
   * caller decides whether to run them. Nothing here executes application code.
   */
  generateWithTools?(req: ToolTurnRequest): Promise<ToolTurnResult>;
  /** Models the key can use (for discovery). */
  listModels?(): Promise<{ name: string; actions: string[] }[]>;
}
