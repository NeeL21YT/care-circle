import { HttpError } from "@/lib/api/errors";

export type AiFailureCode =
  | "ai_not_configured"
  | "ai_timeout"
  | "ai_unavailable"
  | "ai_model_missing"
  | "ai_bad_output"
  | "ai_blocked"
  | "ai_quota_exceeded";

const MESSAGES: Record<AiFailureCode, [number, string]> = {
  ai_not_configured: [503, "The AI features are not set up yet. The rest of the app still works."],
  ai_timeout: [504, "The AI took too long to respond. Please try again."],
  ai_unavailable: [502, "The AI service is not available right now. Please try again in a moment."],
  ai_model_missing: [502, "No working AI model is configured. An administrator needs to check the model settings."],
  ai_bad_output: [502, "The AI returned something we could not use. Please try again, or enter the details yourself."],
  ai_blocked: [422, "The AI could not process that document."],
  ai_quota_exceeded: [429, "You have reached today's limit for this AI feature. Please try again tomorrow."],
};

/** A model failure. Messages are safe for users; the cause is never included (it may echo content). */
export class AiError extends HttpError {
  constructor(readonly failure: AiFailureCode) {
    super(MESSAGES[failure][0], failure, MESSAGES[failure][1]);
    this.name = "AiError";
  }
}
