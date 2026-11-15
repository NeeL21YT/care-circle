// Lists models each configured provider offers, so you can pick what to put in the *_MODEL variables.
// Usage: node --env-file=.env.local scripts/check-providers.mjs
const targets = [
  ["openrouter", "https://openrouter.ai/api/v1", process.env.OPENROUTER_API_KEY],
  ["opencode", process.env.OPENCODE_BASE_URL || "https://opencode.ai/zen/v1", process.env.OPENCODE_API_KEY],
];
for (const [name, base, key] of targets) {
  if (!key) { console.log(`${name}: no key set, skipping`); continue; }
  const res = await fetch(`${base}/models`, { headers: { Authorization: `Bearer ${key}` } });
  if (!res.ok) { console.log(`${name}: /models returned ${res.status}`); continue; }
  const { data = [] } = await res.json();
  console.log(`\n${name}: ${data.length} models`);
  for (const m of data.slice(0, 400)) {
    const p = m.supported_parameters;
    const caps = p ? [p.includes("tools") && "tools", p.includes("structured_outputs") && "json", (m.architecture?.input_modalities ?? []).includes("image") && "image"].filter(Boolean).join(",") : "";
    console.log(` - ${m.id}${caps ? "  [" + caps + "]" : ""}`);
  }
}
