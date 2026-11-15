// Lists Gemini models your key can use, and checks the configured ids exist.
// Usage: node --env-file=.env.local scripts/check-gemini.mjs
import { GoogleGenAI } from "@google/genai";
const key = process.env.GEMINI_API_KEY;
if (!key) { console.error("GEMINI_API_KEY is empty."); process.exit(1); }
const ai = new GoogleGenAI({ apiKey: key });
const names = [];
for await (const m of await ai.models.list({ config: { pageSize: 100 } })) names.push({ name: m.name?.replace("models/", ""), actions: m.supportedActions });
for (const [label, v] of [["text", process.env.GEMINI_TEXT_MODEL], ["vision", process.env.GEMINI_VISION_MODEL], ["live", process.env.GEMINI_LIVE_MODEL]]) {
  const ids = (v ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  if (!ids.length) { console.log(`${label.padEnd(7)} (empty: the app will auto-discover)`); continue; }
  for (const id of ids) {
    const hit = names.find((n) => n.name === id);
    console.log(`${label.padEnd(7)} ${id}  ->  ${hit ? "available (" + (hit.actions ?? []).join(", ") + ")" : "NOT FOUND for this key"}`);
  }
}
console.log("\nAll models:\n" + names.map((n) => " - " + n.name).join("\n"));
