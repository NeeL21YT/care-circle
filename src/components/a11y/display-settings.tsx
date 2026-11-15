"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export type TextSize = "normal" | "large" | "xlarge";
export type Contrast = "auto" | "normal" | "high";
export interface DisplaySettings {
  textSize: TextSize;
  contrast: Contrast;
  /** Speech rate for "Read aloud" (0.6 - 1.4). */
  speechRate: number;
}

const DEFAULTS: DisplaySettings = { textSize: "normal", contrast: "auto", speechRate: 0.9 };
const KEY = "cc.display";

/** Inline script run before paint so there is no flash of default text size/contrast. */
export const DISPLAY_BOOT_SCRIPT = `(function(){try{var s=JSON.parse(localStorage.getItem("${KEY}")||"{}");var r=document.documentElement;if(s.textSize&&s.textSize!=="normal")r.setAttribute("data-text-size",s.textSize);if(s.contrast&&s.contrast!=="auto")r.setAttribute("data-contrast",s.contrast);}catch(e){}})();`;

function read(): DisplaySettings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
  } catch {
    return DEFAULTS;
  }
}

function apply(s: DisplaySettings) {
  const r = document.documentElement;
  if (s.textSize === "normal") r.removeAttribute("data-text-size");
  else r.setAttribute("data-text-size", s.textSize);
  if (s.contrast === "auto") r.removeAttribute("data-contrast");
  else r.setAttribute("data-contrast", s.contrast);
}

const Ctx = createContext<{ settings: DisplaySettings; update: (p: Partial<DisplaySettings>) => void }>({
  settings: DEFAULTS,
  update: () => {},
});
export const useDisplaySettings = () => useContext(Ctx);

export function DisplaySettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<DisplaySettings>(DEFAULTS);
  useEffect(() => {
    const s = read();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reads browser-only storage/APIs after mount; doing it during render would cause a hydration mismatch
    setSettings(s);
    apply(s);
  }, []);
  const update = useCallback((p: Partial<DisplaySettings>) => {
    setSettings((cur) => {
      const next = { ...cur, ...p };
      try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* private mode */ }
      apply(next);
      return next;
    });
  }, []);
  const value = useMemo(() => ({ settings, update }), [settings, update]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
