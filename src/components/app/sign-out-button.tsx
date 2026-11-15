"use client";
import { signOut } from "firebase/auth";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/client/api";
import { fullPageLoad } from "@/lib/client/navigate";
import { clientAuth } from "@/lib/firebase/client";

export function SignOutButton() {
  async function go() {
    await api("/api/auth/logout", { method: "POST" }).catch(() => {});
    await signOut(clientAuth()).catch(() => {});
    // Back to the homepage, as a full page load so nothing from the signed-in session is left on screen.
    fullPageLoad("/");
  }
  return (
    <Button variant="ghost" onClick={go}>
      <LogOut aria-hidden="true" /> Sign out
    </Button>
  );
}
