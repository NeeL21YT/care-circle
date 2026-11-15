// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chunkText, FAILURE_MESSAGE, getVoicesAsync, heldUtterances, pickVoice, speak, stopSpeaking } from "@/lib/client/speech";

type Handler = ((e?: unknown) => void) | null;
class FakeUtterance { text: string; rate = 1; lang = ""; voice: unknown = null; onstart: Handler = null; onend: Handler = null; onerror: Handler = null; constructor(t: string) { this.text = t; } }

const voice = (lang: string, extra: Record<string, unknown> = {}) => ({ lang, name: `v-${lang}`, default: false, localService: true, ...extra }) as unknown as SpeechSynthesisVoice;

let calls: string[] = [];
let spoken: FakeUtterance[] = [];
let voices: SpeechSynthesisVoice[] = [];
let listeners: Record<string, (() => void)[]> = {};

beforeEach(() => {
  vi.useFakeTimers();
  calls = []; spoken = []; listeners = {}; voices = [voice("en-US", { default: true })];
  const synth = {
    getVoices: () => voices,
    cancel: () => calls.push("cancel"),
    resume: () => calls.push("resume"),
    speak: (u: FakeUtterance) => { calls.push("speak"); spoken.push(u); },
    addEventListener: (n: string, f: () => void) => { (listeners[n] ??= []).push(f); },
    removeEventListener: (n: string, f: () => void) => { listeners[n] = (listeners[n] ?? []).filter((x) => x !== f); },
  };
  Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true });
  Object.defineProperty(window, "SpeechSynthesisUtterance", { value: FakeUtterance, configurable: true });
});
afterEach(() => { stopSpeaking(); vi.useRealTimers(); });

const run = async (text: string, o: Partial<Parameters<typeof speak>[1]> = {}) => {
  const p = speak(text, { rate: 1, lang: "en", ...o });
  await vi.advanceTimersByTimeAsync(200);
  await p;
};

describe("voice choice", () => {
  it("prefers the page language, then any same language, then the device default", () => {
    const en = voice("en-GB"), hi = voice("hi-IN"), us = voice("en-US", { default: true });
    expect(pickVoice([hi, en, us], "en-US")).toBe(us);
    expect(pickVoice([hi, en], "en")).toBe(en);
    expect(pickVoice([hi], "en")).toBe(hi); // nothing better: use what exists rather than staying silent
    expect(pickVoice([], "en")).toBeNull();
    expect(pickVoice([voice("en_US")], "en-us")?.lang).toBe("en_US"); // Android style underscore
  });
  it("waits for voices that load late (Firefox)", async () => {
    voices = [];
    const p = getVoicesAsync(3000);
    voices = [voice("en-US")];
    listeners.voiceschanged.forEach((f) => f());
    expect(await p).toHaveLength(1);
    voices = [];
    const none = getVoicesAsync(3000);
    await vi.advanceTimersByTimeAsync(3100);
    expect(await none).toHaveLength(0);
  });
});

describe("speaking", () => {
  it("never calls speak() in the same tick as cancel() (Firefox drops it), and resumes first", async () => {
    const p = speak("Hello there.", { rate: 1, lang: "en" });
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toEqual(["cancel"]); // cancelled, but not speaking yet
    await vi.advanceTimersByTimeAsync(200);
    await p;
    expect(calls).toEqual(["cancel", "resume", "speak"]);
  });

  it("sets the voice, language and rate, and holds the utterance so it is not garbage-collected", async () => {
    voices = [voice("hi-IN"), voice("en-GB")];
    await run("Hello there.", { rate: 0.8, lang: "en-GB" });
    expect(spoken[0]).toMatchObject({ rate: 0.8, lang: "en-GB" });
    expect((spoken[0].voice as { lang: string }).lang).toBe("en-GB");
    expect(heldUtterances()).toBe(1);
  });

  it("speaks long text as sentence-sized chunks in order, and reports start and end once", async () => {
    const onStart = vi.fn(), onEnd = vi.fn();
    const text = Array.from({ length: 12 }, (_, i) => `This is sentence number ${i} with a few extra words in it.`).join(" ");
    await run(text, { onStart, onEnd });
    expect(spoken.length).toBeGreaterThan(1);
    expect(spoken.every((u) => u.text.length <= 220)).toBe(true);
    expect(spoken.map((u) => u.text).join(" ")).toBe(text);
    spoken[0].onstart?.(); spoken[1].onstart?.();
    expect(onStart).toHaveBeenCalledTimes(1);
    spoken.slice(0, -1).forEach((u) => u.onend?.());
    expect(onEnd).not.toHaveBeenCalled();
    spoken.at(-1)!.onend?.();
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("still tries when the voice list is empty (some Firefox builds report voices late), then says so if nothing starts", async () => {
    voices = [];
    const onError = vi.fn(), onStart = vi.fn();
    const p = speak("Hello.", { rate: 1, lang: "en", onError, onStart });
    await vi.advanceTimersByTimeAsync(3200); // waited for voices, then spoke anyway
    await p;
    expect(spoken).toHaveLength(1); // it did try, letting the engine choose a voice
    expect(spoken[0].voice).toBeNull();
    expect(spoken[0].lang).toBe("en");
    await vi.advanceTimersByTimeAsync(5200);
    expect(onError).toHaveBeenCalledWith("no_voice", expect.stringMatching(/voices found: 0/));
    expect(onStart).not.toHaveBeenCalled();
    expect(FAILURE_MESSAGE.no_voice).toMatch(/Add voices/);
  });

  it("works when an empty list was only a timing problem: it speaks as soon as the engine starts", async () => {
    voices = [];
    const onStart = vi.fn(), onError = vi.fn();
    const p = speak("Hello.", { rate: 1, lang: "en", onStart, onError });
    await vi.advanceTimersByTimeAsync(3200);
    await p;
    spoken[0].onstart?.();
    await vi.advanceTimersByTimeAsync(6000);
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled(); // the watchdog is cleared once speech starts
  });

  it("reports errors, but ignores the 'interrupted' error caused by its own cancel()", async () => {
    const onError = vi.fn();
    await run("Hello.", { onError });
    spoken[0].onerror?.({ error: "interrupted" });
    expect(onError).not.toHaveBeenCalled();
    spoken[0].onerror?.({ error: "not-allowed" });
    expect(onError).toHaveBeenCalledWith("blocked", expect.stringMatching(/engine error: not-allowed/));
  });

  it("does not stay silent forever if nothing starts", async () => {
    const onError = vi.fn();
    await run("Hello.", { onError });
    await vi.advanceTimersByTimeAsync(5200);
    expect(onError).toHaveBeenCalledWith("failed", expect.stringMatching(/voices found: 1/));
  });

  it("a newer request replaces an older one, and stop cancels", async () => {
    voices = [];
    const first = speak("one", { rate: 1, lang: "en", onError: vi.fn() });
    voices = [voice("en-US")];
    const second = speak("two", { rate: 1, lang: "en" });
    listeners.voiceschanged?.forEach((f) => f());
    await vi.advanceTimersByTimeAsync(300);
    await Promise.all([first, second]);
    expect(spoken.map((u) => u.text)).toEqual(["two"]);
    stopSpeaking();
    expect(calls.at(-1)).toBe("cancel");
    expect(heldUtterances()).toBe(0);
  });
});

describe("chunking", () => {
  it("keeps short text whole and splits an endless sentence", () => {
    expect(chunkText("Take it with food. Then rest.")).toEqual(["Take it with food. Then rest."]);
    const long = "word ".repeat(200).trim();
    const parts = chunkText(long, 100);
    expect(parts.every((p) => p.length <= 100)).toBe(true);
    expect(parts.join("").replace(/\s/g, "")).toBe(long.replace(/\s/g, ""));
    expect(chunkText("   ")).toEqual([]);
  });
});
