import { z } from "zod";

/**
 * Environment access. Server vars are read lazily so `next build` and unit
 * tests work without credentials; a clear error is thrown only when a feature
 * that needs a variable is actually used.
 */
const serverSchema = z.object({
  FIREBASE_PROJECT_ID: z.string().min(1),
  FIREBASE_CLIENT_EMAIL: z.string().min(1),
  FIREBASE_PRIVATE_KEY: z.string().min(1),
  BREVO_API_KEY: z.string().optional(),
  EMAIL_FROM_NAME: z.string().default("Care Circle"),
  /** Must be a sender/domain verified in Brevo. */
  EMAIL_FROM_ADDRESS: z.string().email().default("no-reply@example.com"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  CRON_SECRET: z.string().min(16).optional(),
  REQUIRE_EMAIL_VERIFICATION: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
});
export type ServerEnv = z.infer<typeof serverSchema>;

let cached: ServerEnv | null = null;
export function serverEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = serverSchema.safeParse(process.env);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(
      `Missing or invalid server environment variables: ${missing}. See .env.example.`,
    );
  }
  cached = parsed.data;
  return cached;
}

/** For tests. */
export function resetEnvCache() {
  cached = null;
}

export const SESSION_COOKIE = "__session";
export const SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 14; // 14 days
