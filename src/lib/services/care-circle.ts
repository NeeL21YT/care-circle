import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { col, db, fromSnap, toData, fromData } from "@/lib/db";
import { badRequest, conflict, notFound } from "@/lib/api/errors";
import { effectivePermissions, invitableRoles, ForbiddenError, NO_SHARE } from "@/lib/domain/permissions";
import type { Membership, Patient, Role, SharePermissions } from "@/lib/domain/types";
import { requirePatientAccess } from "@/lib/auth/access";
import type { CurrentUser } from "@/lib/auth/session";
import { audit } from "./audit";
import { sendInvitationEmail } from "@/lib/email/send";
import { serverEnv } from "@/lib/env";
import { isDemoUid } from "@/lib/demo";

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface Invitation {
  id: string; // sha256(token)
  patientId: string;
  patientName: string;
  email: string;
  role: Role;
  permissions: SharePermissions;
  invitedByUid: string;
  invitedByName: string;
  status: "pending" | "accepted" | "revoked";
  expiresAt: Date;
  createdAt: Date;
  acceptedByUid?: string | null;
}

const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

export function isExpired(inv: Pick<Invitation, "expiresAt">, now = new Date()) {
  return inv.expiresAt.getTime() <= now.getTime();
}

/** Strips the hashed id and token-derived data from what's returned to clients. */
export function publicInvitation(i: Invitation) {
  const { id: _id, ...rest } = i;
  void _id;
  return { ...rest, inviteId: i.id.slice(0, 12), expired: isExpired(i) };
}

export async function createInvitation(
  user: CurrentUser,
  patientId: string,
  input: { email: string; role: Role; permissions?: Partial<SharePermissions> },
) {
  const { patient, membership } = await requirePatientAccess(user.uid, patientId, "members:invite");
  // The demo is public: inviting would send real emails to arbitrary addresses.
  if (isDemoUid(user.uid)) throw new ForbiddenError("Inviting people is switched off in the demo, because it would send real emails.");
  if (!invitableRoles(membership.role).includes(input.role)) {
    throw new ForbiddenError("You cannot invite someone with that role.");
  }
  const email = input.email.toLowerCase();
  if (email === user.email.toLowerCase()) throw badRequest("You are already in this care circle.");

  // Reject if that email already has an active membership on this patient.
  const existing = await col.sub(patientId, "memberships").where("email", "==", email).where("status", "==", "active").get();
  if (!existing.empty) throw conflict("That person is already in the care circle.");
  // One pending invitation per (patient, email); replace rather than stack.
  const pending = await col.invitations().where("patientId", "==", patientId).where("email", "==", email).where("status", "==", "pending").get();
  for (const d of pending.docs) await d.ref.update({ status: "revoked" });

  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  const invitation: Invitation = {
    id: hashToken(token),
    patientId,
    patientName: patient.fullName,
    email,
    role: input.role,
    permissions: effectivePermissions(input.role, input.permissions),
    invitedByUid: user.uid,
    invitedByName: user.displayName,
    status: "pending",
    expiresAt: new Date(now.getTime() + INVITE_TTL_MS),
    createdAt: now,
  };
  await col.invitations().doc(invitation.id).create(toData(invitation));
  await audit(patientId, user.uid, "member.invite", { type: "invitation", id: invitation.id.slice(0, 12) }, { role: input.role });
  const emailResult = await sendInvitationEmail({ invitation, token });
  // Local development without an email provider: surface the link so the flow
  // can still be tested. Never returned in production.
  const devAcceptUrl =
    !emailResult.sent && process.env.NODE_ENV !== "production" ? `${serverEnv().APP_URL}/invite/${token}` : undefined;
  return { invitation: publicInvitation(invitation), emailSent: emailResult.sent, devAcceptUrl };
}

export async function listInvitations(user: CurrentUser, patientId: string) {
  await requirePatientAccess(user.uid, patientId, "members:invite");
  const snap = await col.invitations().where("patientId", "==", patientId).where("status", "==", "pending").get();
  return snap.docs
    .map((d) => fromSnap<Invitation>(d)!)
    .filter((i) => !isExpired(i))
    .map(publicInvitation);
}

export async function revokeInvitation(user: CurrentUser, patientId: string, inviteIdPrefix: string) {
  await requirePatientAccess(user.uid, patientId, "members:invite");
  const snap = await col.invitations().where("patientId", "==", patientId).where("status", "==", "pending").get();
  const match = snap.docs.find((d) => d.id.startsWith(inviteIdPrefix));
  if (!match) throw notFound("That invitation");
  await match.ref.update({ status: "revoked" });
  await audit(patientId, user.uid, "member.invite_revoke", { type: "invitation", id: inviteIdPrefix });
}

/** Look up an invitation by the raw token from the emailed link. */
export async function getInvitationByToken(token: string): Promise<Invitation | null> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
  return fromSnap<Invitation>(await col.invitations().doc(hashToken(token)).get());
}

/**
 * Accepts an invitation. Access is granted ONLY when: the caller is signed in,
 * their email is VERIFIED, and it matches the invited email. Knowing a
 * patient's email address, or holding a leaked link under another account,
 * is not enough.
 */
export async function acceptInvitation(user: CurrentUser, token: string) {
  if (!user.emailVerified) throw new ForbiddenError("Verify your email address before accepting an invitation.");
  const ref = col.invitations().doc(hashToken(token));
  const now = new Date();
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const inv = fromSnap<Invitation>(snap);
    if (!inv) throw notFound("That invitation");
    if (inv.status !== "pending") throw conflict("This invitation is no longer valid.");
    if (isExpired(inv, now)) throw conflict("This invitation has expired. Ask the caregiver to send a new one.");
    if (inv.email.toLowerCase() !== user.email.toLowerCase()) {
      throw new ForbiddenError("This invitation was sent to a different email address. Sign in with the invited account.");
    }
    const mRef = col.sub(inv.patientId, "memberships").doc(user.uid);
    const mSnap = await tx.get(mRef);
    const prior = fromSnap<Membership>(mSnap);
    const membership: Membership = {
      uid: user.uid,
      patientId: inv.patientId,
      role: inv.role,
      permissions: inv.permissions,
      status: "active",
      displayName: user.displayName,
      email: user.email,
      invitedByUid: inv.invitedByUid,
      createdAt: prior?.createdAt ?? now,
      updatedAt: now,
      revokedAt: null,
    };
    tx.set(mRef, toData({ ...membership, id: user.uid }));
    tx.update(ref, { status: "accepted", acceptedByUid: user.uid, acceptedAt: now });
    return inv;
  }).then(async (inv) => {
    await audit(inv.patientId, user.uid, "member.accept", { type: "membership", id: user.uid }, { role: inv.role });
    return { patientId: inv.patientId, role: inv.role };
  });
}

export async function listMembers(user: CurrentUser, patientId: string) {
  const { membership } = await requirePatientAccess(user.uid, patientId, "members:read");
  const snap = await col.sub(patientId, "memberships").where("status", "==", "active").get();
  return snap.docs.map((d) => {
    const m = fromData<Membership>(d.data());
    // Only caregivers see email addresses and exact family permissions.
    const base = { uid: d.id, displayName: m.displayName, role: m.role, joinedAt: m.createdAt };
    return membership.role === "primary_caregiver" ? { ...base, email: m.email, permissions: m.permissions } : base;
  });
}

export async function updateMemberPermissions(user: CurrentUser, patientId: string, uid: string, permissions: SharePermissions) {
  await requirePatientAccess(user.uid, patientId, "members:revoke");
  const ref = col.sub(patientId, "memberships").doc(uid);
  const m = fromSnap<Membership>(await ref.get());
  if (!m || m.status !== "active") throw notFound("That member");
  if (m.role !== "family") throw badRequest("Only family members have adjustable sharing.");
  await ref.update({ permissions, updatedAt: new Date() });
  await audit(patientId, user.uid, "member.permissions_update", { type: "membership", id: uid });
}

export async function revokeMember(user: CurrentUser, patientId: string, uid: string) {
  await requirePatientAccess(user.uid, patientId, "members:revoke");
  const ref = col.sub(patientId, "memberships").doc(uid);
  await db().runTransaction(async (tx) => {
    const m = fromSnap<Membership>(await tx.get(ref));
    if (!m || m.status !== "active") throw notFound("That member");
    if (m.role === "primary_caregiver") {
      const caregivers = await tx.get(
        col.sub(patientId, "memberships").where("role", "==", "primary_caregiver").where("status", "==", "active"),
      );
      if (caregivers.size <= 1) {
        throw conflict("A patient must always have at least one primary caregiver.");
      }
    }
    tx.update(ref, { status: "revoked", revokedAt: new Date(), permissions: NO_SHARE, updatedAt: new Date() });
  });
  await audit(patientId, user.uid, "member.revoke", { type: "membership", id: uid });
}

export type { Patient };
