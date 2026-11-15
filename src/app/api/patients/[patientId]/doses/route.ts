import { route } from "@/lib/api/handler";
import { dosesQuerySchema } from "@/lib/domain/schemas";
import { badRequest } from "@/lib/api/errors";
import { listDoses } from "@/lib/services/doses";

export const GET = route<"patientId">({}, ({ req, user, params }) => {
  const parsed = dosesQuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) throw badRequest("Invalid date range.");
  const { from, to, limit } = parsed.data;
  return listDoses(user, params.patientId, { from: from ? new Date(from) : undefined, to: to ? new Date(to) : undefined, limit });
});
