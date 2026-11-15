import { route } from "@/lib/api/handler";
import { markNotificationRead } from "@/lib/services/notifications";

export const PATCH = route<"notificationId">({}, ({ user, params }) => markNotificationRead(user, params.notificationId));
