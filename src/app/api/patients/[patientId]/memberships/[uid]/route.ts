import { route } from "@/lib/api/handler";
import { membershipUpdateSchema } from "@/lib/domain/schemas";
import { revokeMember, updateMemberPermissions } from "@/lib/services/care-circle";
import { LIMITS } from "@/lib/api/rate-limit";
import type { z } from "zod";

export const PATCH = route<"patientId" | "uid", z.infer<typeof membershipUpdateSchema>>(
  { body: membershipUpdateSchema, rateLimit: LIMITS.sensitive },
  async ({ user, params, body }) => {
    await updateMemberPermissions(user, params.patientId, params.uid, body.permissions);
    return { updated: true };
  },
);

export const DELETE = route<"patientId" | "uid">({ rateLimit: LIMITS.sensitive }, async ({ user, params }) => {
  await revokeMember(user, params.patientId, params.uid);
  return { revoked: true };
});
