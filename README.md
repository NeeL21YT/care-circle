# Care Circle

**An AI-assisted, accessibility-first care coordination platform for older adults and the family who look after them.**

One family, one shared care plan: everyone can see what needs attention, who is responsible, and what the patient has reported. Care Circle never gives medical advice, never diagnoses and never changes a medicine on its own. People decide; software keeps them informed.

- **Live demo:** _add the Vercel URL here after deploying_
- **Stack:** Next.js 16 (App Router, strict TypeScript), Tailwind CSS 4, Base UI primitives, Zod, Firebase Auth + Firestore (Admin SDK on the server), Supabase Storage (private bucket), Brevo email, Gemini / OpenRouter / OpenCode for AI, Luxon, Vitest.
- **More docs:** [API](docs/API.md) · [Firestore schema](docs/FIRESTORE_SCHEMA.md) · [AI design and safety](docs/AI.md) · [Accessibility and manual test script](docs/ACCESSIBILITY.md)

---

## 1. Problem statement and how this answers it

**Challenge:** *Elderly Care & Medication Management Platform* — a shared ecosystem where elderly people, caretakers and family manage medications, appointments and routines, with proactive email reminders, going beyond a basic reminder app and keeping the elderly person at the centre of their own healthcare decisions.

| Requirement in the brief | What is built |
| --- | --- |
| Elderly person, caretaker and family share one healthcare profile | Per-patient **care circle** with three roles (patient, primary caregiver, family) and per-category sharing |
| "Secure, passcode-based access" | Access is by personal sign-in plus **single-use invitation codes** (hashed, 7-day expiry, bound to the invited, email-verified person) and an optional **on-device PIN lock** for shared tablets/phones. We deliberately did not use one shared family passcode: it cannot be audited or revoked per person, whereas each person's access here can be revoked and is logged |
| Authorized members view, add, edit and manage medication schedules | Medicines with daily / weekly / every-N-days schedules, version history, statuses; family sharing is explicit and read-only |
| Track adherence | Patient-reported taken / skipped / snoozed / not sure, with a documented adherence formula, weekly chart and text/table alternatives. Always a **self-report**, never verified |
| Monitor upcoming doctor appointments | Appointments with a calendar view, reminders and a handover list |
| Proactive **email** reminders: missed medications, upcoming doses, appointments | Idempotent scheduler: upcoming-dose, due, follow-up and **caregiver escalation for missed doses**, plus appointment reminders; quiet hours, preferences, retries, delivery status recorded |
| Go beyond a basic reminder app | AI prescription scanner with human approval, prescription **reconciliation**, a grounded care assistant, shared care tasks, and shift-style **care handover** |
| More accessible and reliable | Large type, high contrast, read-aloud, keyboard and screen-reader support; idempotent jobs with retries; works with no AI key |
| Elderly person at the centre | Simple patient screen; the patient answers their own reminders; the patient sees only documents shared with them; the assistant asks for their confirmation before recording anything; every AI suggestion needs a human's approval |

### Why it matters

In many households an older person's care is shared between several people: one handles morning medicines, another checks in at night, another books doctors. Information gets lost between them. Nobody is sure whether a reminder was ignored, a dose was reported, a prescription changed, or who was supposed to call the clinic.

Care Circle makes that shared picture explicit and safe:

| Problem | How Care Circle answers it |
| --- | --- |
| Medicine reminders get ignored | Reminders escalate on rules the family sets (patient first, then caregivers), with quiet hours and no duplicate sends |
| "Did Mum take it?" | Patients report taken / skipped / not sure. It is always labelled a **self-report**, never verified |
| Paper prescriptions are hard to digitise and easy to mis-enter | Photo or PDF goes to AI, which only produces a **draft** that a caregiver checks field by field |
| New prescription vs what is already on the list | **Reconciliation** shows possible differences side by side and a person decides each one |
| Responsibilities live in people's heads | **Care tasks** with owner, due date, hand-over and a visible activity history |
| Shift changes lose context | **Care handover**: a summary built from real records, reviewed, shared and acknowledged |
| Older users struggle with complex apps | Large type, high contrast, simple screens, keyboard and screen-reader support, read-aloud |

## 2. How it works (approach and logic)

### Principles that drive the design

1. **Software only, no hardware.** Nothing infers that a medicine was swallowed. "Reported taken" is a self-report everywhere it appears.
2. **Deterministic code decides, AI only explains.** Doses due, who gets notified and when, what is overdue, what is unresolved and who may see what are all plain, tested code. AI is used for reading documents, answering questions and rewording summaries, and each use is fenced in.
3. **Humans approve every consequential change.** AI output is a draft. A scanned medicine becomes active only after a caregiver edits and approves it. The assistant can only *propose* an action; a person presses Confirm.
4. **One authorization choke point.** Every patient-scoped read or write goes through `requirePatientAccess(uid, patientId, action)`. A non-member gets 404 (so ids cannot be enumerated), a member without permission gets 403. The patient id always comes from the verified URL and the caller's own membership, never from request bodies or from an AI model.
5. **Least information.** Roles (patient, primary caregiver, family) plus per-category family sharing (medicines, adherence, appointments, documents, tasks, "can manage care"). Family never edits medicines.

### Architecture

```
Browser (React, server components)
   │  httpOnly session cookie (Firebase session cookie, verified on every request)
   ▼
Next.js route handlers  ──►  route() wrapper: origin check, auth, rate limit, Zod validation, uniform errors
   ▼
Services (src/lib/services)  ──►  requirePatientAccess()  ──►  Firestore (Admin SDK only; rules deny all client access)
   │                                   │
   │                                   └─ pure domain logic (src/lib/domain): scheduling, dose state machine,
   │                                      adherence, escalation, permissions, handover, reconciliation
   ├─ AI layer (src/lib/ai): provider chain with fallback, structured output, tool registry, usage quotas
   ├─ Storage (Supabase, private bucket, 5-minute signed URLs)
   └─ Email (Brevo) + scheduled job (POST /api/jobs/tick, idempotent)
```

### Medication reminders and escalation
- Doses are materialised as occurrences (DST-correct, 14-day rolling window) with a status state machine: scheduled, notified, acknowledged, reported taken / skipped, snoozed, missed by policy, unknown, cancelled.
- A scheduled tick evaluates each unresolved dose against the patient's escalation policy and creates notifications with **deterministic ids**, so running the tick twice sends nothing twice. Email delivery uses lease-based claiming and retries, and respects quiet hours and each person's preferences.
- Adherence = reported taken / due non-cancelled doses, and is null when nothing was due. The definition is shown in the UI.

### AI prescription scanner and reconciliation
1. A caregiver uploads a photo or PDF (type checked by magic bytes, 4 MB limit, private storage).
2. Gemini (or a fallback provider) returns **structured JSON** validated by Zod. Fields it cannot read stay `null`; confidence is shown but treated as a model estimate. Text in the document is untrusted: instructions inside it are ignored and flagged.
3. The review screen shows the original beside editable fields, with low-confidence and missing values highlighted.
4. **Reconciliation** compares each medicine with the current list (brand vs generic, strength units, times per day) and shows *possible* differences. Each item needs an explicit decision: update existing, keep as is, separate new medicine, ask the doctor (optionally creates a task), or reject. A look-alike duplicate cannot be added until it is confirmed as separate. Applied changes go through the normal medication service, with version history tagged with the prescription they came from.
5. A medicine missing from the new prescription is shown as "could mean unchanged, left off or stopped. Only the doctor can say". It is never stopped automatically.

### Care assistant
A chat helper that answers from the signed-in user's own records through backend-run tools (medicine list, schedule, dose history, appointments, documents, preferences). The model can only *request* a tool; the server validates and runs it with the user's identity, so role and sharing rules apply automatically. It never receives the patient's name or id. Urgent wording ("chest pain") gets a fixed emergency message without calling a model. Dose changes and clinical questions are refused in favour of "ask your doctor or pharmacist". See [docs/AI.md](docs/AI.md).

### Care tasks and handover
- **Tasks:** assign, accept, start, flag, complete, hand over, take over unassigned work, add notes. Who may do what is enforced server-side, and every change is written to an activity feed with the actor's name (including "completed on behalf of the assignee").
- **Handover:** the code collects what the author is allowed to see: unresolved, snoozed and skipped doses, doses *reported* taken, overdue tasks, upcoming appointments, prescriptions awaiting review, new documents, care-plan changes. Each statement carries the permission needed to read it. AI may reword these facts, but a line is dropped if it cites an unknown item, invents a number, resolves something unresolved, loses the "reported" wording, or says "urgent" or "verified". Anything needing attention is always kept in its original wording. If AI is unavailable, the plain factual list is used. The author reviews the draft, shares it with one person who is allowed to see all of it, and that person acknowledges it. Access is re-checked on every read.

## 3. Assumptions

- Patients and caregivers each have their own accounts (email/password or Google). Families agree who is the primary caregiver.
- Times are shown and scheduled in the patient's timezone (default India Standard Time in the demo data).
- Email is acceptable for reminders in this version. Emails contain the medicine name, so treat it as a demo channel.
- The AI provider keys are the operator's. Free-tier models may be slow or rate limited, so the app falls back across models and providers.
- Demo data is **synthetic**. This is not a certified medical device and makes no compliance claims.
- A person with no caregiver cannot self-manage their medicines (they are caregiver-managed by design).

## 4. What is built and what is not

**Built and tested:** authentication and roles; care circle with invitations and sharing; medications and DST-correct dose scheduling; self-reported adherence; appointments; private documents; escalating, idempotent email and in-app notifications; patient, caregiver and family dashboards; AI prescription scanner; reconciliation; care assistant with confirm-to-act; care tasks and activity feed; care handover; accessibility features.

**Not built yet (do not rely on these):** real-time voice assistant, AI document summaries and classification, AI-written notification wording, push notifications (FCM), caregiver weekly summaries and check-in, doctor-visit brief with PDF export, translated UI (English only; preferred language is stored), offline mode.

## 5. Quick start

```bash
npm install
cp .env.example .env.local      # fill it in (sections 6 and 7)
npm run dev                     # http://localhost:3000
npm test                        # 278 tests; no Firebase or AI key needed
npm run typecheck && npm run lint && npm run build
```

## 6. Services to set up

1. **Firebase** (Authentication + Firestore): create a project, enable Email/Password (and Google if wanted), create Firestore, add a Web app (`NEXT_PUBLIC_FIREBASE_*`) and a service account (`FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`, keeping the `\n` escapes). Deploy rules and indexes: `firebase deploy --only firestore:rules,firestore:indexes`. Add your domain under Authentication > Authorized domains.
2. **Supabase Storage** (files): set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (server only). The private bucket is created on first upload.
3. **Brevo** (email): `BREVO_API_KEY`, a verified sender in `EMAIL_FROM_ADDRESS`. Without it the app still works and records deliveries as skipped.
4. **AI (optional, one or more):**
   - `GEMINI_API_KEY`. Leave the `GEMINI_*_MODEL` variables empty to auto-pick from the models your key can use, or give an ordered list `model-a,model-b`.
   - `OPENROUTER_API_KEY` plus `OPENROUTER_TEXT_MODEL` and `OPENROUTER_VISION_MODEL`, and/or `OPENCODE_API_KEY` plus `OPENCODE_TEXT_MODEL`. Run `node --env-file=.env.local scripts/check-providers.mjs` to list available models.
   - `AI_PROVIDER` sets the order (default `gemini,openrouter,opencode`). Without any AI key the whole app still works; only the AI features say they are not set up.
5. `CRON_SECRET`: a random string of at least 16 characters, used to authorize the scheduler.

All variables are documented in `.env.example`. Never commit `.env.local`.

## 7. Deploy

1. Import the repository in **Vercel** (Next.js, default build settings) and add every variable from `.env.example`. Set `APP_URL` to the production URL.
2. Add the Vercel domain to Firebase Authentication > Authorized domains.
3. **Scheduler:** reminders need something to call `POST /api/jobs/tick` with `Authorization: Bearer $CRON_SECRET`. Vercel's free plan only allows daily crons, so this repo ships a free GitHub Actions workflow (`.github/workflows/tick.yml`) that calls it every 5 minutes. In the GitHub repository settings > Secrets and variables > Actions, add `APP_URL` (for example `https://your-app.vercel.app`) and `CRON_SECRET` (same value as in Vercel). Alternatives: the Cloud Function in `functions/` (needs the Firebase Blaze plan) or any external pinger.
4. Register two test accounts, create a patient, and walk through [docs/ACCESSIBILITY.md](docs/ACCESSIBILITY.md#manual-test-script).

## 8. Testing

`npm test` runs **278 tests in 28 files**:

- **Domain:** scheduling including DST, dose state machine, adherence maths, escalation and quiet hours, permissions, handover builder, reconciliation matching and comparison.
- **Services** (against an in-memory Firestore double): cross-patient isolation, role and sharing rules, invitations, medication and dose lifecycle, notification idempotency and retries, documents, the prescription scanner, the assistant (tools, confirmation, injection, quotas), tasks, handovers, reconciliation, AI provider fallback.
- **API wrapper and UI:** auth, origin check, validation, rate limits; accessibility (axe, keyboard, accessible names, live regions, focus).
- AI behaviour is tested with scripted fake models. In addition, the scanner and assistant were run against **real Gemini** and OpenRouter with synthetic data during development. OpenCode is implemented and unit-tested, but its free quota was exhausted during testing, so it has not been confirmed against the live service.

Honest limits: the Firestore double is not Firestore, so security rules and indexes are verified by deploying them, not by emulator tests; and screen-reader behaviour was checked with axe and keyboard tests, not with real NVDA, JAWS or VoiceOver sessions. Use the manual script in [docs/ACCESSIBILITY.md](docs/ACCESSIBILITY.md).

## 9. Security

Server-side authorization on every endpoint; Firestore rules deny all client writes and expose only what a browser might need; AI, tasks, handovers and audit data are server-only; Zod validation on every input; same-origin check on mutations; rate limits (including AI endpoints) and per-user daily AI quotas; audit log of sensitive actions; private documents served only through short-lived signed URLs; magic-byte file checks; security headers; errors never include patient data; AI keys never reach the browser; AI sees no patient name or id and treats documents as untrusted data.

## 10. Known limitations

- Rate limiting is in memory per server instance (best effort on serverless).
- Uploads go through the API route, so the limit is 4 MB.
- Reminder timing is as fine as the scheduler (5 minutes on the free GitHub Actions setup).
- Emails include medicine names; email is not a secure channel.
- Quiet hours also hold caregiver alerts; no "critical" bypass exists.
- Reconciliation understands common frequency wording and compares only against daily schedules; unusual brand names can be missed. It reports possible differences, never errors.
- DPDP, ABDM and FHIR compliance are **not** implemented or claimed.

## 11. Project layout

```
src/app/            routes: (auth) pages, (app) dashboard and patients/[patientId]/*, invite, api/*
src/components/     ui/ primitives, a11y/ (announcer, focus, display settings, read-aloud), app/ feature components
src/lib/domain/     pure logic: scheduling, dose-state, adherence, escalation, permissions, schemas, handover, reconciliation
src/lib/services/   server services (patients, care-circle, medications, doses, appointments, documents, notifications,
                    jobs, dashboards, prescriptions, reconciliation, assistant, care-tasks, handovers, audit)
src/lib/ai/         provider chain and fallback, prescription extraction, assistant tools, handover summarizer, usage quotas
src/lib/auth|api|db|firebase|email|storage|client/   infrastructure
functions/          optional Cloud Function scheduler
.github/workflows/  tick.yml (free scheduler)
tests/              domain, services, api, ui
```
