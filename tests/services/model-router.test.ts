import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { __resetModelCache, modelsFor } from "@/lib/ai/model-router";
import { __setAiClientForTests } from "@/lib/ai/client";

const ALL = [
  "gemini-3-pro-preview", "gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-3-flash-preview",
  "gemini-2.5-flash-image", "gemini-embedding-001", "gemini-2.5-flash-native-audio-preview-12-2025", "gemma-3-27b",
].map((name) => ({ name, actions: name.includes("native-audio") ? ["bidiGenerateContent"] : name.includes("embedding") ? ["embedContent"] : ["generateContent"] }));

beforeEach(() => {
  __resetModelCache();
  for (const k of ["GEMINI_TEXT_MODEL", "GEMINI_VISION_MODEL", "GEMINI_LIVE_MODEL"]) delete process.env[k];
  process.env.GEMINI_API_KEY = "k";
  __setAiClientForTests({ generateJson: async () => { throw new Error("unused"); }, listModels: async () => ALL });
});
afterEach(() => { __setAiClientForTests(null); delete process.env.GEMINI_API_KEY; });

describe("modelsFor", () => {
  it("prefers stable flash, then pro, then previews, and skips non-chat models", async () => {
    const m = await modelsFor("vision");
    expect(m[0]).toBe("gemini-2.5-flash");
    expect(m).not.toContain("gemini-embedding-001");
    expect(m).not.toContain("gemini-2.5-flash-image");
    expect(m).not.toContain("gemma-3-27b");
    expect(m).not.toContain("gemini-2.5-flash-native-audio-preview-12-2025");
  });
  it("prefers lite models for chat (latency) but full flash for documents (accuracy)", async () => {
    expect((await modelsFor("text"))[0]).toBe("gemini-2.5-flash-lite");
    __resetModelCache();
    expect((await modelsFor("vision"))[0]).toBe("gemini-2.5-flash");
  });
  it("uses live-capable models for voice", async () => {
    expect(await modelsFor("live")).toEqual(["gemini-2.5-flash-native-audio-preview-12-2025"]);
  });
  it("honors an ordered env fallback list without calling models.list", async () => {
    process.env.GEMINI_VISION_MODEL = "a-model, b-model";
    expect(await modelsFor("vision")).toEqual(["a-model", "b-model"]);
  });
  it("vision falls back to the text list when only text is set", async () => {
    process.env.GEMINI_TEXT_MODEL = "t1";
    expect(await modelsFor("vision")).toEqual(["t1"]);
  });
});
