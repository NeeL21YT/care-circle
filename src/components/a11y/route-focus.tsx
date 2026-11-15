"use client";
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useAnnounce } from "./announcer";

/**
 * Client-side navigation does not move focus or tell screen readers the page
 * changed. After each navigation we move focus to the page's <h1>
 * (tabindex=-1) and announce the new page title.
 */
export function RouteFocus() {
  const pathname = usePathname();
  const first = useRef(true);
  const announce = useAnnounce();

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const raf = requestAnimationFrame(() => {
      const h1 = document.querySelector<HTMLElement>("main h1");
      if (h1) {
        h1.setAttribute("tabindex", "-1");
        h1.focus({ preventScroll: false });
        announce(`${h1.textContent ?? "Page"} page loaded`);
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [pathname, announce]);

  return null;
}
