import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { runTick } from "@/lib/services/jobs";

export const maxDuration = 60;

function authorized(req: NextRequest): boolean {
  // Read directly (not via serverEnv) so an unauthenticated caller gets 401, never a config error.
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) return false; // fail closed: no secret configured => endpoint disabled
  const given = req.headers.get("authorization")?.replace(/^Bearer /i, "") ?? "";
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Called by Cloud Scheduler (via functions/), Vercel Cron, or any scheduler,
 * with `Authorization: Bearer $CRON_SECRET`. Idempotent: safe to call often.
 */
async function handle(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: { code: "unauthorized", message: "Unauthorized" } }, { status: 401 });
  const result = await runTick(new Date());
  return NextResponse.json({ data: result }, { headers: { "Cache-Control": "no-store" } });
}
export const GET = handle; // Vercel Cron issues GET
export const POST = handle;
