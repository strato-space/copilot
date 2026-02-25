# Copilot VoiceBot API

Date: 2026-02-19  
Scope: `/api/voicebot/*` endpoints used by `/voice`, WebRTC FAB, and migration parity checks.

## Auth
- All endpoints require authenticated copilot session (`authMiddleware` + `requireAdmin`).
- Runtime isolation is enforced via `runtime_tag`.

## Core session endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/voicebot/active_session` | `POST` | Return active session mapping for current performer. |
| `/api/voicebot/activate_session` | `POST` | Set active session by `session_id`. |
| `/api/voicebot/create_session` | `POST` | Create new session and make it active. |
| `/api/voicebot/session` | `POST` | Session details for one session (`session_id` / `session_oid`). |
| `/api/voicebot/sessions` | `POST` | Session list with filters/pagination. |
| `/api/voicebot/session_log` | `POST` | Session event log from `automation_voice_bot_session_log`. |
| `/api/voicebot/trigger_session_ready_to_summarize` | `POST` | Ensure project (PMO fallback), write `notify_requested` log event with `session_ready_to_summarize`. |

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

## Runtime mismatch contract
- Read/update for foreign runtime returns `404`.
- Upload/attach into foreign runtime returns `409` with `error=runtime_mismatch`.

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

### Multi-process delivery
- Socket.IO Redis adapter is enabled in backend bootstrap (`backend/src/index.ts`), so events are delivered correctly across PM2 processes.

## Legacy compatibility aliases
- `/api/voicebot/sessions/*` and `/api/voicebot/uploads/*` are temporarily preserved as thin aliases during migration.
