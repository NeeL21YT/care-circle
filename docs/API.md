# API reference

All endpoints are JSON under `/api`, authenticated with the httpOnly `__session` cookie (or `Authorization: Bearer <Firebase ID token>`). Responses are `{ "data": ... }` or `{ "error": { "code", "message", "fields?" } }`, always with `Cache-Control: no-store`.

**Every endpoint** verifies: (1) a valid, non-revoked session, (2) email verified (except auth endpoints), (3) same-origin for mutations, (4) a per-user rate limit, (5) Zod-validated input, and, for `/patients/:patientId/*`, (6) an **active membership on that patient** and (7) a role/permission for the specific action. Non-members receive `404` (patient ids cannot be enumerated); members lacking permission receive `403`.

Status codes: `400` validation (with `fields`), `401` not signed in, `403` forbidden / bad origin, `404` not found, `409` conflict / invalid state, `429` rate limited (`Retry-After` seconds in message), `500` generic.

## Auth

| Method & path | Notes |
| --- | --- |
| `POST /api/auth/session` | `{ idToken, accountType? }` → sets session cookie; creates the profile doc on first call. Rate limited 10/5 min. |
| `POST /api/auth/logout` | Clears the cookie and revokes refresh tokens. |

## Patients

| Method & path | Permission | Notes |
| --- | --- | --- |
| `GET /api/patients` | signed in | Patients you belong to (fields filtered by role). |
| `POST /api/patients` | caregiver account | Creates a profile; caller becomes primary caregiver. |
| `GET /api/patients/:id` | `patient:read` | `{ patient, role }`. Family sees name/photo/language/timezone only. |
| `PATCH /api/patients/:id` | caregiver: all fields; patient: phone, email, language only | |
| `PUT /api/patients/:id/escalation-policy` | `policy:update` | `{ upcomingLeadMinutes, followUpAfterMinutes, escalateAfterMinutes }` |
| `POST /api/patients/:id/photo` | `patient:update` | multipart `file`, JPG/PNG ≤ 1 MB (magic bytes checked). |
| `GET /api/patients/:id/audit` | `audit:read` (caregiver) | Who did what; no health details. |

## Care circle

| Method & path | Permission | Notes |
| --- | --- | --- |
| `POST /api/patients/:id/invitations` | `members:invite` | `{ email, role, permissions? }`. Emails a single-use link; 7-day expiry. Rate limited 10/min. In non-production without email configured the response includes `devAcceptUrl`. |
| `GET /api/patients/:id/invitations` | `members:invite` | Pending, unexpired. |
| `DELETE /api/patients/:id/invitations/:inviteId` | `members:invite` | Cancel. |
| `POST /api/invitations/accept` | signed in + verified | `{ token }`. Succeeds only if the account's verified email equals the invited email. |
| `GET /api/patients/:id/memberships` | `members:read` | Emails/permissions visible to caregivers only. |
| `PATCH /api/patients/:id/memberships/:uid` | `members:revoke` | `{ permissions }` (family only). |
| `DELETE /api/patients/:id/memberships/:uid` | `members:revoke` | Immediate. Last primary caregiver cannot be removed (409). |

## Medications

| Method & path | Permission | Notes |
| --- | --- | --- |
| `GET /api/patients/:id/medications` | `medications:read` | |
| `POST /api/patients/:id/medications` | `medications:write` | Validates schedule; materializes 14 days of dose occurrences. |
| `GET /api/patients/:id/medications/:mid` | `medications:read` | |
| `PATCH /api/patients/:id/medications/:mid` | `medications:write` | Version bump + snapshot; future occurrences reconciled (changed ones cancelled, answered ones kept). Status transitions are enforced. |
| `DELETE /api/patients/:id/medications/:mid` | `medications:write` | **Discontinues** (never deletes): history is kept, future doses cancelled. |

## Doses

| Method & path | Permission | Notes |
| --- | --- | --- |
| `GET /api/patients/:id/doses?from&to&limit` | `doses:read` | ISO datetimes. Members without `adherence` see future doses only. |
| `POST /api/patients/:id/doses/:occ/events` | `doses:respond` | `{ eventType: acknowledged|reported_taken|reported_skipped|snoozed|reported_unsure, note?, clientEventId?, snoozeMinutes?, occurredAt? }`. Appends an event and updates status in one transaction. `clientEventId` makes retries idempotent (`200` + `duplicate:true`). |
| `GET /api/patients/:id/doses/:occ/events` | `doses:viewHistory` | Full event history. |
| `POST /api/patients/:id/doses/:occ/snooze` | `doses:respond` | `{ minutes: 10|15|30|60, clientEventId? }` |

Event `source` is `patient_ui`, `caregiver_ui` (caregiver recording on the patient's behalf, labelled everywhere) or `system`. System events (`notified`, `missed_by_policy`, `cancelled`, `reinstated`) cannot be submitted by people and can never overwrite a patient's answer.

## Appointments

`GET /api/patients/:id/appointments?scope=upcoming|past|all&from&to` (`appointments:read`), `POST` (`appointments:write`, `{ doctorName, facility?, date, time, location?, appointmentType, notes?, reminderOffsetsMinutes? }` in the patient's timezone), `PATCH /:aid` (incl. `status`), `DELETE /:aid` (cancels, keeps the record).

## Documents

| Method & path | Permission | Notes |
| --- | --- | --- |
| `GET /api/patients/:id/documents` | `documents:read` | Never returns storage paths. Patients see only documents shared with them. |
| `POST /api/patients/:id/documents` | `documents:write` | multipart: `file`, `title`, `category`, `description?`, `sharedWithPatient?`. ≤ 4 MB, PDF/JPG/PNG by magic bytes. 10 per 5 min. Sets `processingStatus: "not_requested"`. |
| `GET /api/patients/:id/documents/:did/url` | `documents:read` | 5-minute signed URL; access is audited. |
| `DELETE /api/patients/:id/documents/:did` | `documents:delete` | |

## Notifications

`GET /api/patients/:id/notifications` (your own only), `PATCH /api/notifications/:nid/read`, `GET|PATCH /api/notification-preferences` (`?patientId=` / body `{ patientId, email{...}, quietHours{...} }`).

## Jobs

`GET|POST /api/jobs/tick` with `Authorization: Bearer $CRON_SECRET`. Returns counts of extended medications, created notifications, state changes and delivery results. Idempotent.

## Roles and permissions

| Action | Patient | Primary caregiver | Family |
| --- | --- | --- | --- |
| Read patient basics | ✔ | ✔ | ✔ |
| Edit profile | contact + language only | ✔ | ✘ |
| Medications read / write | read / ✘ | ✔ / ✔ | grant `medications` / ✘ |
| Doses read / respond | ✔ / ✔ | ✔ / ✔ (on behalf) | `medications` or `adherence` / ✘ |
| Dose history | ✔ | ✔ | grant `adherence` |
| Appointments read / write | read / ✘ | ✔ / ✔ | grant `appointments` / ✘ |
| Documents read / write / delete | shared only / ✘ / ✘ | ✔ | grant `documents` / ✘ / ✘ |
| Invite, revoke, policy, audit | ✘ | ✔ | ✘ |

## AI, reconciliation, tasks and handovers (all under `/api/patients/{patientId}`)

All require a session and patient access; permissions are enforced per action as in the rest of the API.

| Method and path | Purpose | Who |
| --- | --- | --- |
| `GET/POST /prescriptions` | list scans / scan an uploaded document (idempotent, `retry` starts a new one) | caregivers who manage medicines |
| `GET/PATCH /prescriptions/{id}` | read / save edits to the draft | same |
| `POST /prescriptions/{id}/approve` | approve one medicine as new (blocked for look-alike duplicates until confirmed) | same |
| `POST /prescriptions/{id}/reject` | reject the whole scan (refused once something was adopted) | same |
| `GET /prescriptions/{id}/reconciliation` | possible differences vs the current list | same |
| `POST /prescriptions/{id}/reconciliation/{key}` | decide one item: `confirmed_change`, `confirmed_new`, `unchanged`, `needs_clarification`, `rejected` | same |
| `POST /assistant/chat` | send a message (rate limited, daily quota) | any member |
| `GET /assistant/conversations`, `GET/DELETE /assistant/conversations/{id}` | your own conversations | owner only |
| `POST /assistant/conversations/{id}/actions/{actionId}` | `confirm` or `cancel` a proposed action | owner only |
| `GET/POST /tasks`, `GET/PATCH /tasks/{id}` | list and filter / create (idempotent with `clientRequestId`) / read / edit | read: `tasks`; write: manage care |
| `POST /tasks/{id}/assign` | assign, hand over or take over | manager, assignee, or any member claiming an unassigned task |
| `POST /tasks/{id}/status`, `POST /tasks/{id}/notes` | move status / add a note | assignee or manager |
| `GET /activity-feed` | coordination activity | members with task access |
| `GET/POST /handovers`, `GET/PATCH/DELETE /handovers/{id}` | list / prepare a draft / read / edit note / delete draft | prepare: manage care |
| `POST /handovers/{id}/refresh`, `/share`, `/acknowledge` | rebuild from latest records / share with one authorized member / acknowledge | author / author / recipient |

## Weekly report, check-in, doctor brief (under `/api/patients/{patientId}`)

| Method and path | Purpose | Who |
| --- | --- | --- |
| `GET /weekly-report` | the last 7 days in plain words, from real records (no AI); sections you cannot see are listed as omitted | caregivers who manage care (`tasks:write`) |
| `GET/POST /checkins` | your own weekly wellbeing check-ins (one per ISO week; saving again updates it). Private: nobody else can read them | same |
| `GET /appointments/{appointmentId}/brief` | the doctor brief for one appointment, with sections gated by what you may see | anyone who can see appointments |
| `POST /appointments/{appointmentId}/brief` | add/toggle/remove a question, add/remove an observation (`action` field) | manage care; an observation can be removed by its author or a primary caregiver |

`POST /assistant/chat` also accepts an optional `page` (one of a fixed list of page keys) so the assistant knows which screen the person is on. Replies may include `links` (buttons built by the server).
