import type { Metadata } from "next";
import Link from "next/link";
import { requirePageUser } from "@/lib/auth/page";
import { PageHeader } from "@/components/ui/page-header";
import { DisplaySettingsPanel } from "@/components/app/display-settings-panel";

export const metadata: Metadata = { title: "Display settings" };

export default async function SettingsPage() {
  const user = await requirePageUser();
  return (
    <main id="main-content" className="mx-auto max-w-3xl px-4 py-8">
      <PageHeader title="Display settings" description="Make the app comfortable to see, hear and use. These are saved on this device." />
      <DisplaySettingsPanel showPin={user.accountType === "patient"} />
      <p className="mt-8 text-base">Need help? Read our <Link href="/accessibility" className="font-semibold text-primary underline">accessibility statement</Link>.</p>
    </main>
  );
}
