/**
 * Robust read-aloud on the browser's speech synthesis, including Firefox (Gecko).
 *
 * Known problems this works around:
 *  - Firefox ignores speak() when it is called in the same moment as cancel(): we wait a moment.
 *  - Firefox (and Safari) load voices late: we wait for `voiceschanged` instead of assuming they exist.
 *  - With no voice for the page language, Firefox stays silent: we pick a matching voice, else the default.
 *  - Speech engines can silently drop very long utterances and the browser may garbage-collect an
 *    utterance that is still speaking: we speak sentence-sized chunks and keep a reference.
 *  - A device with no installed voice (e.g. Firefox on Linux without speech-dispatcher) never speaks:
 *    we report it, so the page can say so instead of doing nothing.
 */
export type SpeakFailure = "no_voice" | "blocked" | "failed";

export interface SpeakOptions {
  rate: number;
  lang: string;
  onStart?: () => void;
  onEnd?: () => void;
  /** `detail` is a short technical note (engine error and voice count) that helps diagnose a browser. */
  onError?: (why: SpeakFailure, detail?: string) => void;
}

export const FAILURE_MESSAGE: Record<SpeakFailure, string> = {
  no_voice: "No voice is available for reading aloud on this device. Install one in your system settings (Windows: Settings > Time & language > Speech > Add voices. Mac: System Settings > Accessibility > Spoken Content > System voice. Linux: install speech-dispatcher), then reload this page. You can also use your screen reader.",
  blocked: "The browser blocked the sound. Press the button again.",
  failed: "Reading aloud did not start. You can try again, or use your screen reader.",
};

/** Firefox and its forks (Floorp, LibreWolf, Zen...) all report "Firefox/" in the user agent. */
export const isGecko = () => typeof navigator !== "undefined" && /Firefox\//.test(navigator.userAgent);

const GECKO_NO_VOICE =
  "Your browser is hiding this device's voices. In Firefox and Floorp that happens when fingerprinting protection is on (about:config, privacy.resistFingerprinting). Turn it off, or add an exception for this site, then reload this page. You can also use your screen reader.";

/** The message to show. Firefox-family browsers get the privacy-setting explanation, because that is the usual cause there. */
export function failureMessage(why: SpeakFailure): string {
  return why === "no_voice" && isGecko() ? GECKO_NO_VOICE : FAILURE_MESSAGE[why];
}

export function speechSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
}

/** Voices, waiting (briefly) for browsers that load them late. */
export function getVoicesAsync(timeoutMs = 3000): Promise<SpeechSynthesisVoice[]> {
  const synth = window.speechSynthesis;
  const now = synth.getVoices();
  if (now.length) return Promise.resolve(now);
  return new Promise((resolve) => {
    const timer = setTimeout(() => done(), timeoutMs);
    function done() {
      clearTimeout(timer);
      synth.removeEventListener?.("voiceschanged", done);
      resolve(synth.getVoices());
    }
    synth.addEventListener?.("voiceschanged", done);
  });
}

const norm = (l: string) => l.toLowerCase().replace("_", "-");

/** Best voice for a language: exact match, else same language, else the device default. */
export function pickVoice(voices: SpeechSynthesisVoice[], lang: string): SpeechSynthesisVoice | null {
  const want = norm(lang);
  const base = want.split("-")[0];
  const exact = voices.filter((v) => norm(v.lang) === want);
  const same = voices.filter((v) => norm(v.lang).split("-")[0] === base);
  const pool = exact.length ? exact : same;
  return pool.find((v) => v.default) ?? pool.find((v) => v.localService) ?? pool[0] ?? voices.find((v) => v.default) ?? voices[0] ?? null;
}

/** Sentence-sized chunks (at most `max` characters) so engines do not cut long text off. */
export function chunkText(text: string, max = 220): string[] {
  const sentences = text.replace(/\s+/g, " ").trim().match(/[^.!?\n]+[.!?]*\s*/g) ?? [];
  const chunks: string[] = [];
  let cur = "";
  const push = () => { if (cur.trim()) chunks.push(cur.trim()); cur = ""; };
  for (const s of sentences) {
    if (s.length > max) {
      push();
      for (let i = 0; i < s.length; i += max) chunks.push(s.slice(i, i + max).trim());
    } else if ((cur + s).length > max) { push(); cur = s; } else cur += s;
  }
  push();
  return chunks;
}

// Held at module level so the browser cannot garbage-collect an utterance that is still speaking.
let active: SpeechSynthesisUtterance[] = [];
let session = 0;
let watchdog: ReturnType<typeof setTimeout> | undefined;

/** For tests: how many utterances are currently held. */
export const heldUtterances = () => active.length;

export function stopSpeaking() {
  session++;
  clearTimeout(watchdog);
  active = [];
  if (speechSupported()) window.speechSynthesis.cancel();
}

/** Starts reading `text`. Returns after scheduling; progress and failures arrive through the callbacks. */
export async function speak(text: string, o: SpeakOptions): Promise<void> {
  if (!speechSupported()) return o.onError?.("failed");
  const synth = window.speechSynthesis;
  const mine = ++session;
  const voices = await getVoicesAsync();
  if (mine !== session) return; // stopped or replaced while waiting for voices
  // An empty list does not always mean "no speech": some Firefox builds report voices late or only after the
  // first speak(). So we still try (letting the engine choose a voice), and only give up if nothing starts.
  const voice = pickVoice(voices, o.lang);
  const voiceCount = voices.length;
  const parts = chunkText(text);
  if (!parts.length) return o.onEnd?.();

  synth.cancel();
  // Firefox drops a speak() that follows cancel() immediately, so give it a moment.
  await new Promise((r) => setTimeout(r, 80));
  if (mine !== session) return;

  let started = false;
  const utterances = parts.map((p) => {
    const u = new SpeechSynthesisUtterance(p);
    u.rate = o.rate;
    u.lang = voice?.lang ?? o.lang;
    if (voice) u.voice = voice;
    return u;
  });
  active = utterances;
  utterances.forEach((u, i) => {
    u.onstart = () => { if (mine !== session) return; if (!started) { started = true; clearTimeout(watchdog); o.onStart?.(); } };
    u.onend = () => { if (mine === session && i === utterances.length - 1) { active = []; o.onEnd?.(); } };
    u.onerror = (e) => {
      if (mine !== session) return;
      const code = (e as SpeechSynthesisErrorEvent).error;
      if (code === "interrupted" || code === "canceled") return; // our own cancel()
      stopSpeaking();
      o.onError?.(code === "not-allowed" ? "blocked" : code === "voice-unavailable" ? "no_voice" : voiceCount === 0 ? "no_voice" : "failed", `engine error: ${code ?? "unknown"}; voices found: ${voiceCount}`);
    };
  });
  synth.resume(); // a previous page may have left the engine paused
  utterances.forEach((u) => synth.speak(u));
  // If nothing starts within a few seconds, say so instead of staying silent.
  watchdog = setTimeout(() => {
    if (mine === session && !started) {
      stopSpeaking();
      o.onError?.(voiceCount === 0 ? "no_voice" : "failed", `nothing started within 5 seconds; voices found: ${voiceCount}`);
    }
  }, 5000);
}
