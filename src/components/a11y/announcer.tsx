"use client";
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

/**
 * Global live regions. Two permanently-mounted regions (polite + assertive)
 * so screen readers reliably announce changes made by any component:
 * "Marked Metformin as taken", "Medication saved", errors, etc.
 * Toast-style popups are deliberately NOT used: they time out before many
 * screen-reader users can read them.
 */
type Announce = (message: string, priority?: "polite" | "assertive") => void;
const Ctx = createContext<Announce>(() => {});
export const useAnnounce = () => useContext(Ctx);

export function AnnouncerProvider({ children }: { children: React.ReactNode }) {
  const [polite, setPolite] = useState("");
  const [assertive, setAssertive] = useState("");
  const flip = useRef(false);

  const announce = useCallback<Announce>((message, priority = "polite") => {
    // A trailing non-breaking space forces re-announcement of identical text.
    flip.current = !flip.current;
    const text = message + (flip.current ? "" : " ");
    (priority === "assertive" ? setAssertive : setPolite)("");
    setTimeout(() => (priority === "assertive" ? setAssertive : setPolite)(text), 50);
  }, []);
  const value = useMemo(() => announce, [announce]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <div aria-live="polite" aria-atomic="true" role="status" className="sr-only" data-testid="live-polite">{polite}</div>
      <div aria-live="assertive" aria-atomic="true" role="alert" className="sr-only" data-testid="live-assertive">{assertive}</div>
    </Ctx.Provider>
  );
}
