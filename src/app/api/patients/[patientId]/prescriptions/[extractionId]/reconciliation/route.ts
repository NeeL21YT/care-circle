import { route } from "@/lib/api/handler";
import { getReconciliation } from "@/lib/services/reconciliation";

/** Possible differences between this scan and the current medicine list. Read-only. */
export const GET = route<"patientId" | "extractionId">({}, ({ user, params }) => getReconciliation(user, params.patientId, params.extractionId));
