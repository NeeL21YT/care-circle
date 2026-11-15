/**
 * Demo mode. A public, clearly labelled way to explore the REAL app with
 * made-up family data, without registering.
 *
 * It is not a mock: the demo uses real Firebase accounts, real Firestore data
 * and every normal code path. What differs: the three accounts can only be
 * entered through POST /api/demo/start (they have no password), the data is
 * synthetic, and actions that would contact real people (invitations) are off.
 * Enabled only when DEMO_MODE=true.
 */
export const DEMO_UIDS = { caregiver: "demo_meera", patient: "demo_asha", family: "demo_rahul" } as const;
export type DemoRole = keyof typeof DEMO_UIDS;
export const DEMO_ROLES = Object.keys(DEMO_UIDS) as DemoRole[];

export const DEMO_PEOPLE: Record<DemoRole, { name: string; email: string; label: string; short: string }> = {
  // ".invalid" is reserved (RFC 2606) and can never receive mail.
  caregiver: { name: "Meera Verma", email: "demo.meera@carecircle.invalid", label: "Caregiver (daughter)", short: "Caregiver" },
  patient: { name: "Asha Verma", email: "demo.asha@carecircle.invalid", label: "Patient (simple view)", short: "Patient" },
  family: { name: "Rahul Verma", email: "demo.rahul@carecircle.invalid", label: "Family member (son)", short: "Family" },
};

export const isDemoUid = (uid: string) => uid.startsWith("demo_");
export const demoRoleOf = (uid: string): DemoRole | null => (DEMO_ROLES.find((r) => DEMO_UIDS[r] === uid) ?? null);
export const demoEnabled = () => process.env.DEMO_MODE === "true";
