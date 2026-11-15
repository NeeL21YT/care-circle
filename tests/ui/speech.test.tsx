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
    const p = getVoicesAsync(1500);
    voices = [voice("en-US")];
    listeners.voiceschanged.forEach((f) => f());
    expect(await p).toHaveLength(1);
    voices = [];
    const none = getVoicesAsync(1500);
    await vi.advanceTimersByTimeAsync(1600);
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

  it("says so when the device has no voice installed", async () => {
    voices = [];
    const onError = vi.fn();
    const p = speak("Hello.", { rate: 1, lang: "en", onError });
    await vi.advanceTimersByTimeAsync(1700);
    await p;
    expect(onError).toHaveBeenCalledWith("no_voice");
    expect(spoken).toHaveLength(0);
    expect(FAILURE_MESSAGE.no_voice).toMatch(/no voice installed/);
  });

  it("reports errors, but ignores the 'interrupted' error caused by its own cancel()", async () => {
    const onError = vi.fn();
    await run("Hello.", { onError });
    spoken[0].onerror?.({ error: "interrupted" });
    expect(onError).not.toHaveBeenCalled();
    spoken[0].onerror?.({ error: "not-allowed" });
    expect(onError).toHaveBeenCalledWith("blocked");
  });

  it("does not stay silent forever if nothing starts", async () => {
    const onError = vi.fn();
    await run("Hello.", { onError });
    await vi.advanceTimersByTimeAsync(5200);
    expect(onError).toHaveBeenCalledWith("failed");
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
