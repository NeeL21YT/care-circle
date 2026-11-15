import { NextResponse } from "next/server";
import { z } from "zod";
import { route } from "@/lib/api/handler";
import { notFound } from "@/lib/api/errors";
import { DEMO_ROLES, demoEnabled } from "@/lib/demo";
import { startDemoSession } from "@/lib/demo/session";

export const maxDuration = 60;

const body = z.object({ role: z.enum(DEMO_ROLES as [string, ...string[]]) });

/** Public demo entry. Does nothing unless DEMO_MODE=true. */
export const POST = route<never, z.infer<typeof body>>({ auth: "none", body, rateLimit: { name: "demo", limit: 20, windowSeconds: 300 } }, async ({ body }) => {
  if (!demoEnabled()) throw notFound("This page");
  const { cookie, patientId } = await startDemoSession(body.role as (typeof DEMO_ROLES)[number]);
  const res = NextResponse.json({ data: { patientId } }, { headers: { "Cache-Control": "no-store" } });
  res.cookies.set(cookie.name, cookie.value, cookie.options);
  return res;
});
