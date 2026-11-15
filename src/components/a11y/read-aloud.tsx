"use client";
import { useEffect, useRef, useState } from "react";
import { Volume2, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDisplaySettings } from "./display-settings";
import { useAnnounce } from "./announcer";

/**
 * Optional "read aloud" using the browser's speech synthesis. Complements (does
 * not replace) screen readers: it helps low-vision users and anyone who
 * prefers listening. Hidden when the browser has no speech support.
 */
export function ReadAloud({ text, label = "Read this aloud" }: { text: string; label?: string }) {
  const [supported, setSupported] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const { settings } = useDisplaySettings();
  const announce = useAnnounce();
  const utter = useRef<SpeechSynthesisUtterance | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reads browser-only storage/APIs after mount; doing it during render would cause a hydration mismatch
    setSupported(typeof window !== "undefined" && "speechSynthesis" in window);
    return () => { if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel(); };
  }, []);
  if (!supported) return null;

  function start() {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = settings.speechRate;
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);
    utter.current = u;
    setSpeaking(true);
    window.speechSynthesis.speak(u);
  }
  function stop() {
    window.speechSynthesis.cancel();
    setSpeaking(false);
    announce("Stopped reading.");
  }

  return speaking ? (
    <Button variant="outline" size="lg" onClick={stop}>
      <Square aria-hidden="true" /> Stop reading
    </Button>
  ) : (
    <Button variant="outline" size="lg" onClick={start}>
      <Volume2 aria-hidden="true" /> {label}
    </Button>
  );
}
