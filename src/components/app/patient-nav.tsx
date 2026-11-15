"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface NavItem { href: string; label: string; icon: React.ReactNode }

/**
 * Section navigation for one patient. On wide screens it is a sidebar; on
 * phones it collapses behind a labelled disclosure button (aria-expanded +
 * aria-controls). The current page is marked with aria-current="page" and a
 * visible bar, not by colour alone.
 */
export function PatientNav({ items, patientName }: { items: NavItem[]; patientName: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  return (
    <div className="lg:sticky lg:top-4">
      <div className="lg:hidden">
        <Button variant="outline" className="w-full justify-between" aria-expanded={open} aria-controls="patient-sections" onClick={() => setOpen((o) => !o)}>
          <span>Menu: {patientName}</span>
          {open ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
        </Button>
      </div>
      <nav id="patient-sections" aria-label={`${patientName} sections`} className={cn("mt-3 space-y-1 lg:mt-0 lg:block", open ? "block" : "hidden")}>
        <ul className="space-y-1">
          {items.map((it) => {
            const active = it.href === pathname || (it.href.split("/").length > 3 && pathname.startsWith(it.href));
            return (
              <li key={it.href}>
                <Link
                  href={it.href}
                  aria-current={active ? "page" : undefined}
                  onClick={() => setOpen(false)}
                  className={cn("flex min-h-12 items-center gap-3 rounded-xl border-l-4 px-4 py-2 text-base font-semibold", active ? "border-primary bg-secondary text-secondary-foreground" : "border-transparent hover:bg-accent")}
                >
                  <span aria-hidden="true" className="[&_svg]:size-5">{it.icon}</span>
                  {it.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
