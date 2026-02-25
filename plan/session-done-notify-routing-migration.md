# Session Done Notify + Routing Source Migration (Deferred Spec)

## Context
Current `Done` flow in Voice sends notifications through the notify pipeline, while routing metadata is still sourced from `/home/strato-space/settings/routing-prod.json`.

Target requirement:
1. Immediately send a "session closed" message to target chat right after `Done` (before transcription/categorization).
2. Migrate routing ownership from `routing-prod.json` to Copilot data model (client/customer card + project mapping).

## Scope
- Applies to `copilot.stratospace.fun/voice` and `@strato_voice_bot` (Copilot runtime).
- Does not change existing postprocessing notifications (`SESSION_TRANSCRIPTION_DONE`, `SESSION_CATEGORIZATION_DONE`, etc.) in this phase.

## Current implementation points
- Done flow core: `backend/src/services/voicebotSessionDoneFlow.ts`.
- Done worker: `backend/src/workers/voicebot/handlers/doneMultiprompt.ts`.
- Notify worker: `backend/src/workers/voicebot/handlers/notify.ts`.
- Voice routing consumers: `backend/src/services/voicebotDoneNotify.ts`.
- CRM entities for future routing source:
  - `backend/src/api/routes/crm/customers.ts`
  - `backend/src/api/routes/crm/project-groups.ts`
  - `backend/src/api/routes/crm/projects.ts`
  - `app/src/pages/directories/ClientsProjectsRatesPage.tsx`
  - `app/src/pages/operops/ProjectsTree.tsx`

## Proposed architecture
### A. Immediate `Done` notification (phase-1)
- Add dedicated notify event `SESSION_DONE_IMMEDIATE` emitted directly from `completeSessionDoneFlow` after successful close/update and before queueing heavy processing.
- Message format stays unified (`event / url / session-name / project-name`).
- Delivery is best-effort but logged in `automation_voice_bot_session_log` with explicit phase marker `done_immediate`.

### B. Routing source migration (phase-2)
- Introduce routing entity in Copilot DB (runtime-scoped):
  - `customer_notify_targets` / `project_notify_targets` (chat_id, thread_id, policy, active flag).
- Resolution priority:
  1. explicit project target,
  2. project-group target,
  3. customer target,
  4. legacy fallback (`routing-prod.json`) during transition window.
- After migration completion, remove runtime dependency on `routing-prod.json` for voice notifications.

## Rollout plan
1. Add schema + read path with fallback to legacy JSON.
2. Add admin UI/editor for customer/project notify target in Copilot.
3. Run backfill script from `routing-prod.json` into DB targets.
4. Enable `SESSION_DONE_IMMEDIATE` on prod.
5. Observe delivery/duplicates for 1 week.
6. Disable legacy JSON fallback and freeze migration.

## Safety requirements
- Idempotency key: `session_id + notify_event + phase`.
- No duplicate sends on repeated `Done` presses.
- Runtime isolation preserved (`runtime_tag` filtering in target lookup + log writes).

## Acceptance criteria
1. On `Done`, user receives immediate close message before first transcription completion event.
2. Routing can be served from Copilot DB without reading `/home/strato-space/settings/routing-prod.json`.
3. All notify writes are traceable in session log with phase markers.
4. No cross-runtime notification leakage.

## Tracking
- Deferred BD issue: `copilot-1y3o`.

## Diagnostic update (2026-02-25)
- Verified on today's sessions (`automation_voice_bot_session_log`) that `notify_requested` for `session_ready_to_summarize` can be created.
- Route parity fix completed in `copilot-di7n`: enqueue notify jobs from `/update_project`, `/trigger_session_ready_to_summarize`, and `/resend_notify_event` in addition to log writes.
- Done-flow parity fix completed in `copilot-q57h`: `DONE_MULTIPROMPT` auto-enqueues `session_ready_to_summarize` when `project_id` is present.
- Transport outage fixed in `copilot-ufc8`: `actions@call` restored; `https://call-actions.stratospace.fun/notify` returns HTTP `200`.
- Local hooks parity completed in `copilot-8gee`: TS notify worker now supports `VOICE_BOT_NOTIFY_HOOKS_CONFIG` (YAML/JSON), detached hook spawn, and worker session-log events (`notify_hook_started`, `notify_http_sent`, `notify_http_failed`).
- Root diagnostic issue `copilot-4eg9` is closed.
