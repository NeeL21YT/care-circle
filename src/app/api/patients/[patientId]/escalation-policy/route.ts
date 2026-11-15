import { route } from "@/lib/api/handler";
import { escalationPolicySchema } from "@/lib/domain/schemas";
import { updateEscalationPolicy } from "@/lib/services/patients";
import type { z } from "zod";

export const PUT = route<"patientId", z.infer<typeof escalationPolicySchema>>(
  { body: escalationPolicySchema },
  async ({ user, params, body }) => (await updateEscalationPolicy(user, params.patientId, body)).escalationPolicy,
);
