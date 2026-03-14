# Copilot VoiceBot API

Date: 2026-02-19  
Scope: `/api/voicebot/*` endpoints used by `/voice`, WebRTC FAB, and migration parity checks.

## Auth
- All endpoints require authenticated copilot session (`authMiddleware` + `requireAdmin`).
- Runtime isolation is deployment-scoped (separate DB/instance per environment); API contracts must not depend on `runtime_tag` filtering semantics.

## Core session endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/voicebot/active_session` | `POST` | Return active session mapping for current performer. |
| `/api/voicebot/activate_session` | `POST` | Set active session by `session_id`. |
| `/api/voicebot/create_session` | `POST` | Create new session and make it active. |
| `/api/voicebot/session` | `POST` | Session details for one session (`session_id` / `session_oid`). |
| `/api/voicebot/sessions` | `POST` | Session list with filters/pagination. |
| `/api/voicebot/session_log` | `POST` | Session event log from `automation_voice_bot_session_log`. |
| `/api/voicebot/trigger_session_ready_to_summarize` | `POST` | Enqueue `session_ready_to_summarize`, write `notify_requested` log event, and only assign PMO when a default PMO project exists; missing PMO must not hard-fail the route. |

## Content attach/upload endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/voicebot/add_text` | `POST` | Add text/attachments to session. |
| `/api/voicebot/add_attachment` | `POST` | Add file metadata attachment into session. |
| `/api/voicebot/upload_audio` | `POST` multipart | Upload audio chunk(s) into session. |
| `/api/voicebot/message_attachment/:message_oid/:idx` | `GET` | Resolve attachment stream by message and index. |
| `/api/voicebot/public_attachment/:session_id/:file_unique_id` | `GET` | Public attachment proxy by session+file id. |

## Access and utility endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/voicebot/auth/list-users` | `POST` | List performers for restricted access controls. |
| `/api/voicebot/projects` | `POST` | List projects available for the performer. |
| `/api/voicebot/update_*` | `POST` | Session metadata updates (name/project/access/users/dialogue tag). |

## Possible Tasks / taskflow endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/voicebot/possible_tasks` | `POST` | Canonical read path for current session Possible Tasks. Prefers `automation_tasks` master rows in status `DRAFT_10`, falls back to compatibility projection only when master rows are absent. |
| `/api/voicebot/save_possible_tasks` | `POST` | Persist current-session Possible Tasks into `automation_tasks`, rewrite mutable `DRAFT_10` rows in place, sync compatibility projection, and return canonical saved `items`. |
| `/api/voicebot/process_possible_tasks` | `POST` | Materialize selected Possible Tasks into accepted tasks with `BACKLOG_10`, stamp acceptance metadata, and remove them from draft views without soft-deleting the task document. |
| `/api/voicebot/delete_task_from_session` | `POST` | Remove a Possible Task from the current session snapshot; shared rows are unlinked from this session first and soft-deleted only when no linked sessions remain. |
| `/api/voicebot/codex_tasks` | `POST` | Return Codex/BD tasks linked to the current voice session. |
| `/api/voicebot/session_tab_counts` | `POST` | Return lightweight `Задачи` + `Codex` counts for voice session tab badges; draft rows with `source_kind=voice_possible_task` are excluded from accepted-task counts. |

## Session resolution contract
- Canonical session APIs use fail-fast lookup semantics and return `404` when a session cannot be resolved in current operational scope.
- `runtime_mismatch` is a stable taskflow/runtime contract where explicitly documented (for example session taskflow and voice-session utility routes) and is returned as `409 { "error": "runtime_mismatch" }`.

## Notify delivery + hooks (2026-02-25)
- `session_ready_to_summarize` and `session_project_assigned` are enqueued from routes (`/update_project`, `/trigger_session_ready_to_summarize`, `/resend_notify_event`) and from done flow (`DONE_MULTIPROMPT` for closed sessions with `project_id`).
- Notifies worker executes two independent paths per event:
  - HTTP delivery to `VOICE_BOT_NOTIFIES_URL` with bearer auth (`VOICE_BOT_NOTIFIES_BEARER_TOKEN`).
  - Local hooks runner from `VOICE_BOT_NOTIFY_HOOKS_CONFIG` (YAML/JSON; default `backend/notifies.hooks.yaml`; empty value disables hooks).
- Session log events are written by worker for observability:
  - `notify_hook_started`
  - `notify_http_sent`
  - `notify_http_failed`

## Realtime websocket contract (`/voicebot`)

- Frontend voice socket MUST connect to namespace `/voicebot` (not root `/`).
- Client joins session room via:
  - `subscribe_on_session` with `{ session_id }`
  - `unsubscribe_from_session` with `{ session_id }`
- Room format: `voicebot:session:<session_id>`.

### Realtime events
- `new_message` — new chunk/message attached to session.
- `session_update` — session-level state/metadata updates.
- `message_update` — per-message updates (including categorization/transcription progress).

### Delivery path ownership
- Categorization/transcription workers enqueue socket fan-out jobs to `VOICEBOT_QUEUES.EVENTS` (`SEND_TO_SOCKET`).
- Backend API process runs `startVoicebotSocketEventsWorker` and is the owner of websocket delivery.
- Standalone worker runtime MUST NOT consume `EVENTS` queue directly.

## Current create_tasks path

- The interactive `Tasks` button uses MCP `create_tasks` through the local fast-agent service.
- The frontend now sends a compact session envelope (`session_id`, `session_url`, `project_id`) instead of a giant transcript/categorization/material payload over Socket.IO.
- The prompt rehydrates context through MCP `voice`:
  - `voice.fetch(..., mode="transcript")`
  - `voice.project(project_id)`
  - `voice.session_possible_tasks(...)`
  - `voice.crm_tickets(session_id=...)`
  - `voice.crm_tickets(project_id=...)`
- `DRAFT_10` Possible Tasks are mutable:
  - same-scope rows are rewritten in place by canonical `row_id/id`
  - duplicate suppression applies to materialized task space, not to mutable `DRAFT_10` baseline rows
- `process_possible_tasks` is now non-destructive:
  - selected rows materialize into `READY_10`,
  - accepted rows retain `source_kind=voice_session` plus acceptance metadata,
  - cleanup removes them from draft views but must not soft-delete the materialized task document
- Automatic runtime path:
  - every successful text transcription completion enqueues `POSTPROCESSORS.CREATE_TASKS`,
  - worker delegates to fast-agent `create_tasks`,
  - refreshed possible-task rows are persisted to `automation_tasks` and synced into `processors_data.CREATE_TASKS` compatibility projection,
  - only after persistence does the worker enqueue websocket refresh via `session_update.taskflow_refresh.possible_tasks`,
  - runtime recompute is not gated by session close or categorization completion.
- Manual categorization path:
  - socket `create_tasks_from_chunks` now queues the same canonical `COMMON.CREATE_TASKS_FROM_CHUNKS` worker job,
  - it does not emit legacy `tickets_prepared`; viewers refresh through the same Mongo-first `session_update.taskflow_refresh.possible_tasks` path.

## Voice session tab badges

- Voice session tabs render compact numeric badges for:
  - `Транскрипция`
  - `Категоризация`
  - `Возможные задачи`
  - `Задачи`
  - `Codex`
  - `Screenshort`
- `Log` intentionally has no count badge.
- Session header upload is now owned by the top icon action row next to `Скачать Транскрипцию`; `SessionStatusWidget` is status-only.
- Voice and OperOps task surfaces should render the target display labels `Draft / Ready / In Progress / Review / Done / Archive` instead of raw stored labels.
- `Задачи` total + `Work / Review` counts are loaded through `/api/voicebot/session_tab_counts`.
- `Codex` badge is derived from the same `codex/issues` source + session `source_ref` filter as the `Codex` tab content.
- `Транскрипция`, `Категоризация`, and `Возможные задачи` show a subtle green pulse dot while their stage is still pending:
  - transcription pending = uploaded/new chunk not yet transcribed,
  - categorization pending = transcript exists but categorization is not complete,
  - possible tasks pending = transcript advanced beyond the last completed `CREATE_TASKS` run or `CREATE_TASKS` is currently processing.

### Multi-process delivery
- Socket.IO Redis adapter is enabled in backend bootstrap (`backend/src/index.ts`), so events are delivered correctly across PM2 processes.

## Legacy compatibility aliases
- `/api/voicebot/sessions/*` and `/api/voicebot/uploads/*` are temporarily preserved as thin aliases during migration.
