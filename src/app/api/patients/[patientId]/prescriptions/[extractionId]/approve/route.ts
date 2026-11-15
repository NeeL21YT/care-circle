import { z } from "zod";
import { route } from "@/lib/api/handler";
import { approveMedication } from "@/lib/services/prescriptions";

const body = z.object({ index: z.number().int().min(0), medication: z.unknown() });

/** Explicit approval of ONE reviewed medicine; it becomes an active medication via the Phase 1 service. */
export const POST = route<"patientId" | "extractionId", z.infer<typeof body>>({ body }, ({ user, params, body }) =>
  approveMedication(user, params.patientId, params.extractionId, body.index, body.medication),
);
