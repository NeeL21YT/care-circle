# Firestore schema

All patient data lives under `patients/{patientId}`, so every query is naturally scoped to one patient. Timestamps are Firestore `Timestamp`s (UTC); the patient's IANA timezone is stored on the patient and copied onto each dose occurrence. Dates the user thinks of as calendar dates (birth date, medication start/end) are `"YYYY-MM-DD"` strings interpreted in the patient's timezone.

```
users/{uid}                                   email, displayName, accountType, createdAt
invitations/{sha256(token)}                   patientId, email, role, permissions, status, expiresAt, invitedBy*
patients/{patientId}                          profile + escalationPolicy
  memberships/{uid}                           role, permissions{medications,adherence,appointments,documents}, status
  medications/{id}                            + versions/{n} (immutable snapshots)
  doseOccurrences/{id}                        id = `${medicationId}_${yyyyMMdd'T'HHmm'Z'}` (deterministic)
  doseEvents/{id}                             append-only history
  appointments/{id}
  documents/{id}                              metadata only; file in the private Supabase bucket
  notificationPreferences/{uid}
  notifications/{id}                          id = idempotency key
  auditEvents/{id}                            append-only, ids and field names only
```

## Key documents

**patients** `fullName, photoPath, dateOfBirth, gender, phone, email, preferredLanguage, timezone, emergencyContactName/Phone, medicalNotes, escalationPolicy{upcomingLeadMinutes, followUpAfterMinutes, escalateAfterMinutes}, createdByUid, createdAt, updatedAt`

**memberships** `uid, patientId, role (patient|primary_caregiver|family), permissions, status (active|revoked), displayName, email, invitedByUid, createdAt, updatedAt, revokedAt`. Revocation sets `status` and clears permissions; the document is kept for history.

**medications** `name, activeIngredient, strength, doseAmount, doseUnit, form, route, schedule{frequency: daily|weekly|every_n_days, times[], daysOfWeek[], intervalDays}, startDate, endDate, prescriber, instructions, status (draft|active|on_hold|completed|discontinued), createdByUid, createdAt, updatedAt, version, horizonExtendedAt` plus the **Phase 2 hooks** `sourceDocumentId (null)`, `verificationStatus (unverified|pending_review|verified)`, `verifiedByUid`, `verifiedAt`. Manual entry by a caregiver is stored as `verified` (a human entered it).

**doseOccurrences** `medicationId, medicationName, doseText, instructions` (denormalized snapshot so patient screens need no join), `scheduledAt, timezone, status (scheduled|notified|acknowledged|reported_taken|reported_skipped|snoozed|missed_by_policy|unknown|cancelled), gracePeriodMinutes, notifiedAt, respondedAt, snoozedUntil, createdAt, updatedAt`

**doseEvents** `doseOccurrenceId, eventType, userId (null for system), source (patient_ui|caregiver_ui|system), note, occurredAt, recordedAt, clientEventId, snoozeMinutes, previousStatus, resultingStatus`. Event ids: `${occurrenceId}_${clientEventId}` for client events (idempotent), `${occurrenceId}_sys_${type}` for once-only system events.

**notifications** `recipientUid, type, title, body, resourceId, stage, scheduledFor, readAt, deliveries{in_app, email, push}, payload, createdAt, notificationId`. `deliveries.email` = `{status: pending|sending|sent|failed|skipped, attempts, providerMessageId, lastError, deliverAfter (quiet hours), leaseUntil, skipReason, sentAt}`. **Delivery is tracked here; patient acknowledgement is tracked only on the dose.**

**documents** `title, category, description, fileName, contentType, sizeBytes, storagePath (server-only), uploadedByUid/Name, sharedWithPatient, processingStatus (not_requested|queued|processing|completed|failed)`.

## Adherence definition

`percentage = reported_taken ÷ non-cancelled doses whose scheduled time has passed`. Skipped, "not sure" and unanswered doses stay in the denominator and never count as taken; future doses are excluded. With nothing due the percentage is `null` (shown as "no figure yet", never 0 or 100). It is displayed with the sentence "based on self-reports, not verified".

## Indexes

Declared in `firestore.indexes.json`: composite indexes for `(medicationId, scheduledAt)`, `(recipientUid, createdAt desc)`, `(doseOccurrenceId, recordedAt)`, plus collection-group field overrides used by the scheduler and "my patients" lookups (`memberships.uid/status`, `doseOccurrences.scheduledAt`, `appointments.startsAt`, `medications.status`, `notifications.recipientUid/notificationId/deliveries.email.status`).

## Security rules summary

Clients may **read** only: their own user doc; patient documents/subcollections they are an *active member* of and permitted to see (mirrors `permissions.ts`); their own notifications/preferences. Clients may **never write**, and file storage is private and server-mediated; all writes and file access go through server endpoints. Rules are defence in depth and are not covered by automated tests yet.

## Added collections (all server-only; the rules deny client access)

Under `patients/{patientId}/`:

- `prescriptionExtractions/{id}`: scan record (status history, the AI's original `extractedData`, the human-edited `reviewedMedications`, `approvals` map, model and prompt version, failure code).
- `prescriptionReconciliations/{extractionId}`: one doc with a `decisions` map keyed `m0`, `m1`, `absent_<medicationId>`: status, who and when, note, affected medication id, snapshot of what was compared.
- `medications/{id}/versions/{n}`: now also stores `changeSource` (e.g. which prescription and who confirmed it).
- `careTasks/{id}`, `careActivity/{id}` (append-only, ordered by `seq`), `careHandovers/{id}` (items with source ids, summary, status, recipient, acknowledgement).
- `aiConversations/{id}` with `messages` and `pendingActions` subcollections (private to the author); `aiUsage/{uid_day}` (counts and token totals only).
