import { route } from "@/lib/api/handler";
import { reconciliationDecisionSchema, type ReconciliationDecisionInput } from "@/lib/domain/schemas";
import { decide } from "@/lib/services/reconciliation";

/** A person's explicit decision about one compared medicine. */
export const POST = route<"patientId" | "extractionId" | "key", ReconciliationDecisionInput>({ body: reconciliationDecisionSchema }, ({ user, params, body }) =>
  decide(user, params.patientId, params.extractionId, params.key, body),
);
