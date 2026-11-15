import { route } from "@/lib/api/handler";
import { getWeeklyReport } from "@/lib/services/weekly-report";

export const GET = route<"patientId">({}, ({ user, params }) => getWeeklyReport(user, params.patientId));
