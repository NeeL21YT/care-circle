import { describe, expect, it } from "vitest";
import { ACTIONS, can, effectivePermissions, invitableRoles, type Actor } from "@/lib/domain/permissions";

const actor = (role: Actor["role"], perms = {}): Actor => ({
  role,
  status: "active",
  permissions: effectivePermissions(role, perms),
});

describe("permissions", () => {
  it("revoked or missing members can do nothing", () => {
    for (const a of ACTIONS) {
      expect(can({ ...actor("primary_caregiver"), status: "revoked" }, a)).toBe(false);
      expect(can(null, a)).toBe(false);
    }
  });
  it("primary caregiver can do everything", () => {
    for (const a of ACTIONS) expect(can(actor("primary_caregiver"), a)).toBe(true);
  });
  it("patient can respond to doses but cannot edit medications or invite", () => {
    const p = actor("patient");
    expect(can(p, "doses:respond")).toBe(true);
    expect(can(p, "medications:read")).toBe(true);
    expect(can(p, "medications:write")).toBe(false);
    expect(can(p, "members:invite")).toBe(false);
    expect(can(p, "members:revoke")).toBe(false);
    expect(can(p, "appointments:write")).toBe(false);
  });
  it("family has no write access of any kind, whatever is granted", () => {
    const f = actor("family", { medications: true, adherence: true, appointments: true, documents: true });
    for (const a of ACTIONS.filter((x) => /write|delete|invite|revoke|update$|respond|policy|audit/.test(x) && x !== "patient:updatePreferences")) {
      expect(can(f, a)).toBe(false);
    }
  });
  it("family sees nothing sensitive by default", () => {
    const f = actor("family");
    expect(can(f, "patient:read")).toBe(true);
    expect(can(f, "medications:read")).toBe(false);
    expect(can(f, "doses:viewHistory")).toBe(false);
    expect(can(f, "appointments:read")).toBe(false);
    expect(can(f, "documents:read")).toBe(false);
  });
  it("family grants are independent per category", () => {
    const f = actor("family", { appointments: true });
    expect(can(f, "appointments:read")).toBe(true);
    expect(can(f, "medications:read")).toBe(false);
    expect(can(actor("family", { adherence: true }), "doses:viewHistory")).toBe(true);
    expect(can(actor("family", { adherence: true }), "medications:read")).toBe(false);
  });
  it("only caregivers can hand out roles", () => {
    expect(invitableRoles("primary_caregiver")).toContain("family");
    expect(invitableRoles("patient")).toEqual([]);
    expect(invitableRoles("family")).toEqual([]);
  });
});
