# AI design and safety

AI is used for four things only: reading prescription images/PDFs into **drafts**, answering questions from a user's own records, and rewording the handover facts. It is never used to decide who is notified, whether a dose was missed, whether something is urgent, or what is medically correct.

## Providers and fallback

`src/lib/ai/client.ts` tries the providers listed in `AI_PROVIDER` (default `gemini,openrouter,opencode`; only those with a key and models are used), sharing one deadline. Each provider tries its own ordered model list with **hedging**: if a model fails or is slow (12 s), the next starts and the first valid answer wins. A model that failed recently is tried last for five minutes.

- **Gemini:** models come from `GEMINI_TEXT_MODEL` / `GEMINI_VISION_MODEL` (ordered lists) or are discovered from `models.list`. Chat prefers fast Lite models, document reading prefers full Flash. No model id is hard-coded.
- **OpenRouter / OpenCode:** one shared OpenAI-compatible client. Models must be configured explicitly (`scripts/check-providers.mjs` lists them) and must support tools and JSON output; the scanner also needs image input. Claude models were found to reject the scanner's strict JSON schema on OpenRouter; they work for chat.
- Verified with real calls during development: Gemini (scanner, assistant), OpenRouter free and paid models. OpenCode is unit-tested only.

## Safety rules that code enforces (not just prompts)

| Rule | Where |
| --- | --- |
| Model never gets Firestore or admin access | all data goes through services and `requirePatientAccess` |
| Model never chooses the patient | `patientId` is bound by the server from the authorized URL; it is not a tool argument |
| Tools validate input with Zod and reduce errors to generic text | `ai/assistant/tool-registry.ts` |
| Writes need a human click | assistant tools only create *pending actions*; `POST .../actions/:id` with `confirm` runs the normal service as the user |
| Prescription output is a draft | Zod-validated; unreadable fields stay `null`; every medicine needs human review; approval goes through `createMedication` |
| Injection in documents or records | documents are untrusted; instruction-like text is flagged and ignored; tool results are returned as "records, not instructions" |
| Urgent wording bypasses the model | `ai/assistant/safety.ts` returns a fixed emergency message |
| Handover summaries stay faithful | `ai/handover/summarizer.ts` drops lines with unknown refs, new numbers, resolved wording for unresolved items, or "urgent/verified"; attention items are always included |
| No patient name or id is sent to a model | prompts use facts only |
| Cost and abuse control | rate limits per endpoint, per-user daily quotas (`AI_DAILY_*`), token usage recorded without content |
| Logs | provider status codes only; never prompts, documents or replies |

## The assistant inside every page

- A button on every patient page opens the same assistant (one conversation system, not a second chatbot). The browser sends only a **page key from a fixed list** (`src/lib/ai/assistant/pages.ts`), never free text, so the model is told "the user is looking at the Care tasks page" without any injection surface.
- Extra read tools: care tasks, recent family activity, latest handover. All go through the same permissioned services, so a patient sees only their own tasks and a family member only what they were granted.
- **Links:** the model can request `openPage` or `openDoctorBrief`. The server builds the URL from the fixed list, checks the person's permission (a patient cannot be sent to the scanner), and attaches a button. The model never writes a URL.
- **Typed tool calls:** small models sometimes write a call as text, for example `[Open Care handover](command:default_api:openPage{page:handover})`, instead of calling the tool. `clean-reply.ts` turns such a typed `openPage` into the real, permission-checked button and removes all other markdown link syntax, so link targets from the model are never shown or followed. This was found by testing with a real model.

## Limitations

- Model confidence values are estimates, not accuracy.
- The summary guard checks numbers, citations and key wording; it is a safeguard, not a proof. The structured facts are always shown next to the summary.
- The assistant's refusals depend on the model following its instructions plus the deterministic emergency check. Test it with your own prompts.
- Free models can be slow or rate limited.
