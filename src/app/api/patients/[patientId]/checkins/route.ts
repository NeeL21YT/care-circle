import { route } from "@/lib/api/handler";
import { checkinSchema, type CheckinInput } from "@/lib/domain/weekly-report";
import { listMyCheckins, saveCheckin } from "@/lib/services/weekly-report";

export const GET = route<"patientId">({}, ({ user, params }) => listMyCheckins(user, params.patientId));

export const POST = route<"patientId", CheckinInput>({ body: checkinSchema }, ({ user, params, body }) => saveCheckin(user, params.patientId, body));
