"use client";
import { useRouter } from "next/navigation";
import { signOut } from "firebase/auth";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/client/api";
import { clientAuth } from "@/lib/firebase/client";

export function SignOutButton() {
  const router = useRouter();
  async function go() {
    await api("/api/auth/logout", { method: "POST" }).catch(() => {});
    await signOut(clientAuth()).catch(() => {});
    router.replace("/login");
    router.refresh();
  }
  return (
    <Button variant="ghost" onClick={go}>
      <LogOut aria-hidden="true" /> Sign out
    </Button>
  );
}
