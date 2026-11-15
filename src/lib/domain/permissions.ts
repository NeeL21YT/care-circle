import type { Membership, Role, SharePermissions } from "./types";

/**
 * Every server operation is expressed as an Action and authorized through
 * `can()`. The UI may use `can()` to hide controls, but it is NEVER the
 * enforcement point: route handlers/services call `assertCan()`.
 */
export const ACTIONS = [
  "patient:read",
  "patient:update",
  "patient:updatePreferences",
  "members:read",
  "members:invite",
  "members:revoke",
  "medications:read",
  "medications:write",
  "doses:read",
  "doses:respond",
  "doses:viewHistory",
  "appointments:read",
  "appointments:write",
  "documents:read",
  "documents:write",
  "documents:delete",
  "notifications:read",
  "audit:read",
  "policy:update",
  "tasks:read",
  "tasks:write",
  "tasks:respond",
  "handovers:read",
  "handovers:write",
] as const;
export type Action = (typeof ACTIONS)[number];

export const FULL_SHARE: SharePermissions = {
  medications: true,
  adherence: true,
  appointments: true,
  documents: true,
  tasks: true,
  manageCare: true,
};
export const NO_SHARE: SharePermissions = {
  medications: false,
  adherence: false,
  appointments: false,
  documents: false,
  tasks: false,
  manageCare: false,
};

const PATIENT_ACTIONS: ReadonlySet<Action> = new Set([
  "patient:read",
  "patient:updatePreferences",
  "members:read",
  "medications:read",
  "doses:read",
  "doses:respond",
  "doses:viewHistory",
  "appointments:read",
  "documents:read",
  "notifications:read",
  // Patients see and update only tasks assigned to them (enforced in the task service).
  "tasks:read",
  "tasks:respond",
]);

export type Actor = Pick<Membership, "role" | "permissions" | "status">;

export function can(actor: Actor | null | undefined, action: Action): boolean {
  if (!actor || actor.status !== "active") return false;
  switch (actor.role) {
    case "primary_caregiver":
      return true;
    case "patient":
      return PATIENT_ACTIONS.has(action);
    case "family":
      return familyCan(actor.permissions, action);
    default:
      return false;
  }
}

function familyCan(p: SharePermissions, action: Action): boolean {
  switch (action) {
    // Family always sees who the patient is and receives their own notifications.
    case "patient:read":
    case "notifications:read":
    case "patient:updatePreferences":
      return true;
    case "medications:read":
      return p.medications;
    // Dose schedule (what is due) travels with medication visibility;
    // adherence history is a separate, explicit grant.
    case "doses:read":
      return p.medications || p.adherence;
    case "doses:viewHistory":
      return p.adherence;
    case "appointments:read":
      return p.appointments;
    case "documents:read":
      return p.documents;
    // Optional flags: members saved before these existed simply do not have them.
    case "tasks:read":
    case "tasks:respond":
    case "handovers:read":
      return p.tasks === true;
    case "tasks:write":
    case "handovers:write":
      return p.tasks === true && p.manageCare === true;
    default:
      // Family never edits medicines, appointments or documents, patient edits, policy or audit.
      return false;
  }
}

export class ForbiddenError extends Error {
  readonly status = 403;
  constructor(message = "You do not have permission to do that.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export function assertCan(actor: Actor | null | undefined, action: Action): void {
  if (!can(actor, action)) throw new ForbiddenError();
}

/** Roles an inviter is allowed to hand out. */
export function invitableRoles(inviter: Role): Role[] {
  return inviter === "primary_caregiver"
    ? ["patient", "primary_caregiver", "family"]
    : [];
}

/** Effective share permissions for a role (family uses explicit grants). */
export function effectivePermissions(
  role: Role,
  granted?: Partial<SharePermissions>,
): SharePermissions {
  if (role === "family") return { ...NO_SHARE, ...granted };
  return { ...FULL_SHARE };
}
