import { z } from "zod";
import { route } from "@/lib/api/handler";
import { acceptInvitation } from "@/lib/services/care-circle";
import { LIMITS } from "@/lib/api/rate-limit";
import { notFound } from "@/lib/api/errors";

const schema = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{20,100}$/) });

export const POST = route<never, z.infer<typeof schema>>({ body: schema, rateLimit: LIMITS.sensitive }, async ({ user, body }) => {
  try {
    return await acceptInvitation(user, body.token);
  } catch (e) {
    // Uniform answer for malformed/unknown tokens.
    if (e instanceof Error && e.name === "HttpError" && (e as { status?: number }).status === 404) throw notFound("That invitation");
    throw e;
  }
});
