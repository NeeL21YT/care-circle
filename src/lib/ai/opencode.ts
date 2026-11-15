import "server-only";
import { aiConfig } from "./config";
import { OpenAiCompatClient } from "./openai-compat";

/**
 * OpenCode Zen: an OpenAI-compatible gateway. Only models served through the
 * chat-completions endpoint work here, so models must be chosen explicitly
 * (see scripts/check-providers.mjs). A model that cannot do tools or JSON
 * output fails fast and the next configured model is tried.
 */
export class OpenCodeClient extends OpenAiCompatClient {
  constructor(key: string) {
    super({
      name: "opencode",
      baseUrl: aiConfig().opencodeBaseUrl,
      key,
      models: (t) => (t === "vision" ? aiConfig().opencodeVisionModels : aiConfig().opencodeTextModels),
    });
  }
}
