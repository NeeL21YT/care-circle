import { route } from "@/lib/api/handler";
import { refreshDraft } from "@/lib/services/handovers";

export const maxDuration = 60;

export const POST = route<"patientId" | "handoverId">({ rateLimit: { name: "ai:handover", limit: 6, windowSeconds: 300 } }, ({ user, params }) =>
  refreshDraft(user, params.patientId, params.handoverId),
);
