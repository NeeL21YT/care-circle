import { ForbiddenError } from "@/lib/domain/permissions";
import { InvalidTransitionError } from "@/lib/domain/dose-state";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const notFound = (what = "That item") =>
  new HttpError(404, "not_found", `${what} was not found.`);
export const unauthorized = (msg = "Please sign in to continue.") =>
  new HttpError(401, "unauthorized", msg);
export const badRequest = (msg: string, fields?: Record<string, string>) =>
  new HttpError(400, "bad_request", msg, fields);
export const conflict = (msg: string) => new HttpError(409, "conflict", msg);
export const tooMany = (retryAfterSeconds: number) =>
  new HttpError(429, "rate_limited", `Too many requests. Try again in ${retryAfterSeconds} seconds.`);

export function toErrorBody(e: unknown): { status: number; body: { error: { code: string; message: string; fields?: Record<string, string> } } } {
  if (e instanceof HttpError) {
    return { status: e.status, body: { error: { code: e.code, message: e.message, fields: e.fields } } };
  }
  if (e instanceof ForbiddenError) {
    return { status: 403, body: { error: { code: "forbidden", message: e.message } } };
  }
  if (e instanceof InvalidTransitionError) {
    return { status: 409, body: { error: { code: "invalid_transition", message: e.message } } };
  }
  // Never leak internals (or health data) in unexpected errors.
  console.error("[api] unexpected error", e instanceof Error ? e.message : "unknown");
  return { status: 500, body: { error: { code: "internal", message: "Something went wrong. Please try again." } } };
}
