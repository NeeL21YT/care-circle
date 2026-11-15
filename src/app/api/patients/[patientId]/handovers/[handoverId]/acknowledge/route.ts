import { route } from "@/lib/api/handler";
import { acknowledgeHandover } from "@/lib/services/handovers";

export const POST = route<"patientId" | "handoverId">({}, ({ user, params }) => acknowledgeHandover(user, params.patientId, params.handoverId));
