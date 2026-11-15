# 🤝 Care Circle

> **One family. One shared care plan. Everyone knows what needs attention.**

Care Circle is an AI-assisted, accessibility-first care coordination platform for older adults and the family who look after them. It was built for the **PromptWars × Catalyst hackathon** (MnM) for the challenge **Elderly Care & Medication Management Platform**.

🌐 **Live demo:** https://care-circle-tan.vercel.app — press **Try the demo** on the home page. No sign-up needed.
💻 **Source:** https://github.com/NeeL21YT/care-circle

> Care Circle never gives medical advice, never diagnoses and never changes a medicine on its own. People decide; the software keeps everyone informed.

## 📖 About

In many households an older person's care is shared: one family member handles the morning medicines, another checks in at night, another books the doctor. Information gets lost between them. Nobody is sure whether a reminder was ignored, a dose was reported, a prescription changed, or who was supposed to call the clinic.

Care Circle puts the elderly person, their caretakers and their family on one shared, secure care plan. It sends proactive email reminders, makes responsibilities visible, and uses AI only where it helps, always with a person approving the result.

---

# ✨ Features

Care Circle goes beyond a reminder app. It is a **care coordination system**: deterministic code decides *when* and *who*, AI helps people *read and understand*, and humans approve every consequential change.

## 💊 Medicines & Adherence
- Daily, weekly and every-N-days schedules, correct across daylight-saving changes
- Patient reports **taken / skipped / remind me later / not sure**. Always labelled a *self-report*, never verified
- Weekly adherence chart with a text summary and data table
- Full version history of every medicine

## 📧 Smart Email Reminders
- Upcoming-dose, due, follow-up and **missed-dose caregiver escalation** emails, plus appointment reminders
- Quiet hours, per-person preferences, retries and delivery status
- **Idempotent**: the scheduler can run twice and nothing is sent twice

## 👪 Shared Care Circle
- Three roles: **patient**, **primary caregiver**, **family member**
- Family sees only what they are granted (medicines, adherence, appointments, documents, tasks)
- Single-use invitation codes bound to the invited, email-verified person; access can be revoked at any time

## 📅 Appointments & 📄 Documents
- Calendar view with reminders
- Private documents in a locked bucket, opened only through 5-minute signed links

## 🧾 AI Prescription Scanner
- Photo or PDF in, **structured draft** out (Gemini, with OpenRouter and OpenCode as fallbacks)
- Original beside editable fields; low-confidence and missing values are highlighted
- **Nothing becomes active until a caregiver approves it**

## 🔁 Prescription Reconciliation
- Compares a new prescription with the current list: brand vs generic, strength, dose, how often, dates
- Shows *possible* differences side by side. A person decides each one: update, keep, new medicine, ask the doctor, or reject
- Every change is saved in the medicine's history with its source

## 🤖 Care Assistant
- Chat that answers from the signed-in person's own records using backend-run tools
- Cannot change anything by itself: it can only *propose*, and a person presses **Confirm**
- Refuses dose and clinical questions; urgent wording gets a fixed "contact emergency services" reply

## ✅ Care Tasks & 🔄 Care Handover
- Assign, accept, hand over and complete tasks, with a visible activity history
- **Handover**: a summary of what happened, built from real records, reviewed by its author, shared with one person and acknowledged. Unresolved items stay unresolved

## ♿ Accessibility
- Large type, high contrast, text-size settings, read-aloud, keyboard and screen-reader support
- A simple "My day" screen for the patient; responsive from 320 px phones to desktop

## 🎮 Demo Mode
- One-click demo as a caregiver, patient or family member, with made-up family data
- Uses the real app, not a mock. Invitations and email are switched off in the demo

## 🚧 Not built yet
Voice assistant, AI document summaries, AI-written notification wording, push notifications, caregiver weekly report and check-in, doctor-visit brief with PDF export, translated interface (English only for now).

---

# 🎯 How It Answers the Challenge

| Requirement | What is built |
| --- | --- |
| Shared ecosystem for elderly person, caretakers and family | Per-patient **care circle** with roles and per-category sharing |
| **Secure, passcode-based access** | Personal sign-in plus **single-use invitation codes** (hashed, 7-day expiry, bound to one verified email) and an optional on-device **PIN lock**. A shared family passcode was rejected on purpose: it cannot be audited or revoked per person |
| View, add, edit, manage medication schedules | Medicines with flexible schedules and history; family access is read-only |
| Track adherence | Self-reported taken / skipped / snoozed, weekly chart, documented formula |
| Monitor upcoming appointments | Calendar, reminders, handover list |
| **Proactive email reminders** for missed medications, upcoming doses, appointments | Idempotent scheduler with escalation, quiet hours and retries |
| Go beyond a basic reminder app | AI scanner, reconciliation, assistant, tasks and handover |
| Elderly person at the centre | Simple patient screen; the patient answers their own reminders; nothing is recorded without their confirmation |

---

# 🧠 Approach & Logic

1. **No hardware, no guessing.** Nothing infers that a medicine was swallowed.
2. **Deterministic code decides, AI only explains.** Doses due, who is notified and when, what is overdue and who may see what are plain, tested code.
3. **Humans approve every consequential change.** AI output is always a draft.
4. **One authorization choke point.** Every patient-scoped read or write goes through `requirePatientAccess(uid, patientId, action)`. Non-members get 404 so ids cannot be enumerated. The patient id comes from the verified URL, never from a request body or an AI model.
5. **Least information.** AI prompts carry no patient name or id, and documents are treated as untrusted data.

```
Browser ── session cookie ──► Next.js route handlers (origin check, auth, rate limit, Zod validation)
                                   │
                                   ▼
                  Services ──► requirePatientAccess() ──► Firestore (server only; rules deny all client access)
                     │
                     ├─ Domain logic: scheduling, dose state machine, escalation, permissions, handover, reconciliation
                     ├─ AI layer: provider chain with fallback, structured output, tools, per-user quotas
                     ├─ Storage: Supabase (private bucket, signed URLs)
                     └─ Email: Brevo + scheduled job (POST /api/jobs/tick)
```

Details: [AI design and safety](docs/AI.md) · [API](docs/API.md) · [Firestore schema](docs/FIRESTORE_SCHEMA.md) · [Accessibility and manual test script](docs/ACCESSIBILITY.md)

---

# 🎨 Design Language

**Calm Clarity × Large & Legible**

### Color Palette

| Color | Hex | Use |
|--------|------|------|
| Care Teal | `#0B6B63` | Primary actions, brand |
| Mist | `#F5F8F7` | Page background |
| Deep Ink | `#14282A` | Text |
| Sage | `#E3EFEC` | Cards, highlights |
| Amber | `#FFF1D6` | Warnings, demo banner |
| Info Blue | `#0B4F8A` | Information |
| Alert Red | `#B3261E` | Destructive actions |

Colors are chosen for WCAG 2.2 AA contrast and checked with automated axe tests (not a full manual audit). Status is never shown by color alone: every status has an icon and text.

---

# 🛠 Tech Stack

### Frontend
- Next.js 16 (App Router, Server Components)
- React 19
- TypeScript (strict)
- Tailwind CSS 4, Base UI primitives
- React Hook Form + Zod, Recharts

### Backend
- Firebase Authentication (httpOnly session cookie)
- Cloud Firestore via the Admin SDK (rules deny all client access)
- Supabase Storage (private bucket, signed URLs)
- Next.js Route Handlers

### AI & APIs
- Google Gemini via `@google/genai` (model discovery and fallback chain, structured output, function calling)
- OpenRouter and OpenCode (OpenAI-compatible fallbacks)
- Brevo transactional email

### Quality
- Vitest + Testing Library + axe: **294 tests in 31 files**
- ESLint (with jsx-a11y), strict TypeScript

### Deployment
- Vercel (functions in `iad1`, next to the database)
- GitHub Actions timer for reminders

---

# 📌 Assumptions & Limitations

- Each person has their own account; families agree who the primary caregiver is.
- Times follow the patient's timezone. Demo data is **synthetic**.
- Email is used for reminders and contains the medicine name, so treat it as a demo channel.
- Patients cannot add or edit their own medicines (caregiver-managed by design).
- Rate limiting is in memory per server instance. Uploads are limited to 4 MB.
- Reminder timing is as fine as the scheduler (5 minutes on the free GitHub Actions timer).
- Screen-reader behavior was checked with axe and keyboard tests, not with real NVDA, JAWS or VoiceOver sessions. A manual script is in [docs/ACCESSIBILITY.md](docs/ACCESSIBILITY.md).
- DPDP, ABDM and FHIR compliance are **not** implemented or claimed.

---

# 🚀 Getting Started

```bash
npm install
cp .env.example .env.local      # fill it in (see below)
npm run dev                     # http://localhost:3000
npm test                        # 294 tests; needs no Firebase or AI key
npm run typecheck && npm run lint && npm run build
```

<details>
<summary><b>Set up the services</b></summary>

1. **Firebase** (Authentication + Firestore): create a project, enable Email/Password (and Google if wanted), create Firestore, add a Web app (`NEXT_PUBLIC_FIREBASE_*`) and a service account (`FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`, keeping the `\n` escapes). Deploy rules and indexes with `firebase deploy --only firestore:rules,firestore:indexes`. Add your domain under Authentication > Authorized domains.
2. **Supabase Storage**: set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (server only). The private bucket is created on first upload.
3. **Brevo**: `BREVO_API_KEY` and a verified sender in `EMAIL_FROM_ADDRESS`. Without it the app still works and records deliveries as skipped.
4. **AI (optional)**: `GEMINI_API_KEY`. Leave the `GEMINI_*_MODEL` variables empty to auto-pick models, or give an ordered list `model-a,model-b`. Optionally `OPENROUTER_*` and `OPENCODE_*` (run `node --env-file=.env.local scripts/check-providers.mjs` to list models). `AI_PROVIDER` sets the order. Without any key the rest of the app still works.
5. **`CRON_SECRET`**: a random string of 16+ characters that authorizes the scheduler.
6. **`DEMO_MODE=true`** enables the demo buttons.

Every variable is documented in `.env.example`. Never commit `.env.local`.

</details>

<details>
<summary><b>Deploy to Vercel</b></summary>

1. Import the repository in Vercel and add every variable from `.env.example`. Set `APP_URL` to the production URL.
2. Add the Vercel domain to Firebase Authentication > Authorized domains.
3. **Scheduler:** add the repository secrets `APP_URL` and `CRON_SECRET` in GitHub. The workflow in `.github/workflows/tick.yml` then calls `POST /api/jobs/tick` every 5 minutes. (Vercel's free plan only allows daily crons.)
4. **Deployment notes:** `vercel.json` runs functions in `iad1`, next to the Firestore database (`nam5`), which makes pages several times faster than a distant region. `package.json` pins `jwks-rsa` 3 through npm `overrides`, because Vercel's runtime does not allow `require()` of ES modules and `firebase-admin` 14 otherwise crashes every request with `ERR_REQUIRE_ESM`. Do not remove it unless `firebase-admin` stops needing it.
5. Open the live site once yourself before sharing it: the first ever visit seeds the demo data.

</details>

<details>
<summary><b>The demo, in detail</b></summary>

The demo accounts are real Firebase accounts with **no password**, reachable only through the demo button. The data is synthetic: a fictional patient with three medicines and several days of reported history (including a skipped dose and an open reminder), an upcoming appointment, three care tasks (one overdue and unassigned) and a handover already shared from the caregiver to the family member. Inviting people is switched off, so the demo can never send email. Visitors share one set of data. Set `DEMO_MODE=false` for real use. A sample prescription to scan can be downloaded from the demo banner: one medicine matches the list, one has a different strength and one is new.

</details>

---

# 🧪 Testing

`npm test` covers:
- **Domain logic:** scheduling including daylight saving, the dose state machine, adherence maths, escalation and quiet hours, permissions, the handover builder, reconciliation
- **Services** (against an in-memory Firestore double): cross-patient isolation, roles and sharing, invitations, medicine and dose lifecycle, notification idempotency and retries, the scanner, the assistant (tools, confirmation, prompt injection, quotas), tasks, handovers, reconciliation, AI provider fallback, the demo
- **API and UI:** authentication, origin check, validation, rate limits, accessibility (axe, keyboard, accessible names, live regions, focus)

AI behavior is tested with scripted fake models, and the scanner and assistant were also run against **real Gemini** and OpenRouter with synthetic data. OpenCode is implemented and unit-tested but its free quota ran out during testing. The Firestore double is not Firestore itself, so security rules and indexes are verified by deploying them.

---

# 🔐 Security

Server-side authorization on every endpoint · Firestore rules deny all client access · Zod validation on every input · same-origin check on mutations · rate limits and per-user daily AI quotas · audit log of sensitive actions · private documents through short-lived signed links · magic-byte file checks · security headers · errors never include patient data · AI keys never reach the browser · AI sees no patient name or id.

---

# 👥 Team

**Participant:** Nilutpal (solo)

| Member | GitHub |
|--------|--------|
| Nilutpal | https://github.com/NeeL21YT |

---

# 🏆 Hackathon

**Event:** PromptWars × Catalyst, organized by MnM (Makers Need More)

**Date:** 15 November 2026

**Challenge:** Elderly Care & Medication Management Platform

---

# 📄 License

Developed by **Nilutpal** for the **PromptWars × Catalyst Hackathon 2026**.
