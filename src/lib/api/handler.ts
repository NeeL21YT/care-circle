import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import type { ZodType } from "zod";
import { requireUser, type CurrentUser } from "@/lib/auth/session";
import { badRequest, tooMany, toErrorBody, HttpError } from "@/lib/api/errors";
import { checkRateLimit, LIMITS, type RateLimitOptions } from "@/lib/api/rate-limit";

export type RouteParams<P extends string = string> = { params: Promise<Record<P, string>> };

export interface HandlerContext<P extends string, B> {
  req: NextRequest;
  user: CurrentUser;
  params: Record<P, string>;
  body: B;
}

interface Options<B> {
  /** Zod schema for the JSON body (mutating requests). */
  body?: ZodType<B>;
  rateLimit?: RateLimitOptions;
  /** Public endpoints (auth) skip the session requirement. */
  auth?: "user" | "unverified" | "none";
}

/** Same-origin check for state-changing requests (defence in depth with SameSite=Lax). */
function sameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true; // non-browser clients (tests, server-to-server)
  try {
    return new URL(origin).host === req.headers.get("host");
  } catch {
    return false;
  }
}

/**
 * Wraps a route handler with: origin check, authentication, rate limiting,
 * body validation and uniform error responses. Handlers still perform their
 * own patient-level authorization via `requirePatientAccess`.
 */
export function route<P extends string = never, B = undefined>(
  options: Options<B>,
  handler: (ctx: HandlerContext<P, B>) => Promise<unknown | Response>,
) {
  return async (req: NextRequest, ctx: RouteParams<P>) => {
    try {
      const mutating = !["GET", "HEAD", "OPTIONS"].includes(req.method);
      if (mutating && !sameOrigin(req)) {
        throw new HttpError(403, "bad_origin", "Cross-site requests are not allowed.");
      }
      const user =
        options.auth === "none"
          ? (null as unknown as CurrentUser)
          : await requireUser({ allowUnverified: options.auth === "unverified" });

      const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
      const limit = options.rateLimit ?? (mutating ? LIMITS.write : LIMITS.read);
      const wait = checkRateLimit(limit, user?.uid ?? ip);
      if (wait !== null) throw tooMany(wait);

      let body: B = undefined as B;
      if (options.body) {
        let raw: unknown;
        try {
          raw = await req.json();
        } catch {
          throw badRequest("The request body must be valid JSON.");
        }
        const parsed = options.body.safeParse(raw);
        if (!parsed.success) {
          const fields: Record<string, string> = {};
          for (const issue of parsed.error.issues) {
            const key = issue.path.join(".") || "_";
            fields[key] ??= issue.message;
          }
          throw badRequest("Please check the highlighted fields.", fields);
        }
        body = parsed.data;
      }

      const params = (await ctx.params) as Record<P, string>;
      const result = await handler({ req, user, params, body });
      if (result instanceof Response) return result;
      return NextResponse.json({ data: result }, { headers: { "Cache-Control": "no-store" } });
    } catch (e) {
      const { status, body } = toErrorBody(e);
      return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
    }
  };
}
