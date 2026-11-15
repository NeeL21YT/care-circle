"use client";
import { useEffect, useState } from "react";
import { Volume2, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FAILURE_MESSAGE, speak, speechSupported, stopSpeaking } from "@/lib/client/speech";
import { useDisplaySettings } from "./display-settings";
import { useAnnounce } from "./announcer";

/**
 * Optional "read aloud" using the browser's speech synthesis (see lib/client/speech.ts for the Firefox
 * workarounds). Complements (does not replace) screen readers. Hidden when the browser has no speech
 * support; when it has support but cannot speak (no voice installed), it says so instead of staying silent.
 */
export function ReadAloud({ text, label = "Read this aloud" }: { text: string; label?: string }) {
  const [supported, setSupported] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const { settings } = useDisplaySettings();
  const announce = useAnnounce();

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reads browser-only APIs after mount; doing it during render would cause a hydration mismatch
    setSupported(speechSupported());
    return () => stopSpeaking();
  }, []);
  if (!supported) return null;

  function start() {
    setProblem(null);
    setSpeaking(true);
    void speak(text, {
      rate: settings.speechRate,
      lang: document.documentElement.lang || "en",
      onEnd: () => setSpeaking(false),
      onError: (why, detail) => {
        setSpeaking(false);
        setProblem(`${FAILURE_MESSAGE[why]}${detail ? ` (Details: ${detail}.)` : ""}`);
        announce(FAILURE_MESSAGE[why], "assertive");
      },
    });
  }
  function stop() {
    stopSpeaking();
    setSpeaking(false);
    announce("Stopped reading.");
  }

  return (
    <span className="inline-flex max-w-full flex-col items-start gap-2">
      {speaking ? (
        <Button variant="outline" size="lg" onClick={stop}>
          <Square aria-hidden="true" /> Stop reading
        </Button>
      ) : (
        <Button variant="outline" size="lg" onClick={start}>
          <Volume2 aria-hidden="true" /> {label}
        </Button>
      )}
      {problem && <span role="status" className="block max-w-prose text-base text-destructive">{problem}</span>}
    </span>
  );
}
