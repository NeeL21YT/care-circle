import { ClipboardCheck, ArrowRightLeft, MessageCircle, ScanLine, Bell, BellRing, UserRound, CalendarDays, FileText, History, Home, Pill, Settings, Users } from "lucide-react";
import { requirePagePatient } from "@/lib/auth/page";
import { can } from "@/lib/domain/permissions";
import { PatientNav, type NavItem } from "@/components/app/patient-nav";
import { PinGate } from "@/components/app/pin-gate";

/**
 * Every page under /patients/[patientId] is authorized here first (membership
 * check -> 404 for strangers), then again by each page for its own action.
 */
export default async function PatientLayout({ children, params }: { children: React.ReactNode; params: Promise<{ patientId: string }> }) {
  const { patientId } = await params;
  const { patient, membership } = await requirePagePatient(patientId, "patient:read");
  const base = `/patients/${patientId}`;
  const mine = membership.role === "patient";
  const items: NavItem[] = [
    { href: base, label: mine ? "My day" : "Overview", icon: <Home /> },
    can(membership, "medications:read") && { href: `${base}/medications`, label: mine ? "My medicines" : "Medications", icon: <Pill /> },
    { href: `${base}/assistant`, label: "Care assistant", icon: <MessageCircle /> },
    can(membership, "medications:write") && { href: `${base}/scanner`, label: "Prescription scanner", icon: <ScanLine /> },
    can(membership, "tasks:read") && { href: `${base}/tasks`, label: mine ? "My tasks" : "Care tasks", icon: <ClipboardCheck /> },
    can(membership, "handovers:read") && { href: `${base}/handover`, label: "Care handover", icon: <ArrowRightLeft /> },
    can(membership, "appointments:read") && { href: `${base}/appointments`, label: mine ? "My appointments" : "Appointments", icon: <CalendarDays /> },
    can(membership, "documents:read") && { href: `${base}/documents`, label: mine ? "My documents" : "Documents", icon: <FileText /> },
    can(membership, "members:read") && { href: `${base}/care-circle`, label: mine ? "My care team" : "Care circle", icon: <Users /> },
    can(membership, "audit:read") && { href: `${base}/activity`, label: "Activity history", icon: <History /> },
    { href: `${base}/notifications`, label: "Notifications", icon: <Bell /> },
    { href: `${base}/notification-settings`, label: "Notification settings", icon: <BellRing /> },
    can(membership, "patient:update")
      ? { href: `${base}/settings`, label: "Profile & reminder rules", icon: <Settings /> }
      : mine && { href: `${base}/settings`, label: "My profile", icon: <UserRound /> },
  ].filter(Boolean) as NavItem[];

  return (
    <div className="mx-auto grid max-w-7xl gap-8 px-4 py-8 lg:grid-cols-[16rem_minmax(0,1fr)]">
      <aside><PatientNav items={items} patientName={patient.fullName} /></aside>
      <main id="main-content" className="min-w-0">{mine ? <PinGate>{children}</PinGate> : children}</main>
    </div>
  );
}
