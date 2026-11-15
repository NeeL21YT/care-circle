import "server-only";
import { aiConfig } from "./config";
import { OpenAiCompatClient } from "./openai-compat";

export { toOpenAiMessages, toOpenAiUserContent } from "./openai-compat";

/** OpenRouter: OpenAI-compatible, plus routing that insists on providers supporting the features we use. */
export class OpenRouterClient extends OpenAiCompatClient {
  constructor(key: string) {
    super({
      name: "openrouter",
      baseUrl: "https://openrouter.ai/api/v1",
      key,
      models: (t) => (t === "vision" ? aiConfig().openrouterVisionModels : aiConfig().openrouterTextModels),
      headers: { "X-Title": "Care Circle" },
      extraBody: { provider: { require_parameters: true } },
    });
  }
}
