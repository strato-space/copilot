# Session Management Spec (VoiceBot + WebRTC)

## Status
This document is the current source of truth for session lifecycle and routing.

## Core model
- `active-session` is a per-user attribute (keyed by `telegram_user_id`).
- `pageSessionId` is the session opened on `/session/:id` in web UI.
- `active-session` and `pageSessionId` are independent.

## Telegram commands (`@strato_voice_bot`)

### `/start`
- Always creates a new session.
- Sets this new session as `active-session`.
- Does not close previous sessions.

### `/session`
- Without args:
  - returns current `active-session` if it exists;
  - returns `Активная сессия не найдена...` if none.
- With arg:
  - accepts `session_id` or `https://voice.stratospace.fun/session/<id>`;
  - accepts the same values when command is used as reply to a message;
  - validates access rights;
  - sets selected session as `active-session`.

### `/done`
- Closes only current `active-session`.
- If no `active-session`, returns `Активная сессия не найдена...`.
- Clears `active-session` after successful close.

### `/login`
- Not related to current `active-session`.
- Returns a one-time login URL to web interface:
  - `https://voice.stratospace.fun/tg_auth?token=<one_time_token>`
- URL can be used to authenticate web UI regardless of active session state.

## Incoming Telegram materials routing
- For `voice`, `text`, `photo`, `document`:
  - if `active-session` exists and is open: attach to it;
  - if no active open session: create a new session, set active, attach material.
- No automatic fallback to "today open sessions" by default.
- Fallback search is allowed only with explicit `allowFallback=true` in internal calls.

## Web UI behavior

### `/session` (without `:id`)
- Opens current active session if exists (`/session/<active_id>`).
- If none exists, shows empty state ("Активная сессия не найдена").

### `/session/:id`
- Opens page session (`pageSessionId`) only.
- Does not change `active-session` automatically.

### Session page actions
- Buttons order is fixed and matches FAB: `New / Rec / Cut / Pause / Done`.
- `New`:
  - starts new session creation flow via FAB (`new`) and records into it.
- `Rec`:
  - sets `pageSessionId` as user `active-session` (access validation included);
  - then starts recording via FAB (`rec`) into this activated session.
- `Cut`:
  - requests immediate chunk cut via FAB (`cut`) for current recording.
- `Pause`:
  - requests pause via FAB (`pause`) for current recording.
- `Done`:
  - applies to `pageSessionId` only;
  - closes that exact session by explicit `session_id` (repeated done is allowed).
- Session status pictogram (left of page action buttons) is state-driven:
  - `recording` -> blinking red dot,
  - `cutting` -> scissors,
  - `paused` -> pause bars,
  - `final_uploading` -> green check,
  - `closed` -> blue square,
  - `ready` -> gray ring,
  - `error` -> red exclamation.

## WebRTC FAB behavior
- `New`:
  - always creates a new session;
  - sets it as active (backend + local runtime);
  - starts recording into this new session.
- `Rec`:
  - records into active session;
  - on `/session/:id` first activates page session and then records into it.
- `Done`:
  - closes current active session (not `pageSessionId`).

## Backend API

### `POST /voicebot/active_session`
- Returns active session for current authenticated user:
  - `{ active_session: null }` or
  - `{ active_session: { session_id, session_name, is_active, url } }`.

### `POST /voicebot/activate_session`
- Input: `{ session_id }`.
- Validates access rights.
- Sets `active-session` for authenticated user.
- Returns `{ success, session_id, session_name, is_active, url }`.

### `POST /voicebot/create_session`
- Creates session.
- Also sets created session as `active-session`.

## Socket contract (`/socket.io`)

### Auth source
- Socket user identity is resolved only from JWT (`socket.user`).
- Client-provided `telegram_user_id` is ignored for authorization and routing decisions.

### `session_done`
- Client payload: `{ session_id }` only.
- Backend checks:
  - authenticated performer exists;
  - performer has session read access (`READ_ALL` or `READ_OWN` rules);
  - performer has `VOICEBOT_SESSIONS.UPDATE`.
- On success queues `DONE_MULTIPROMPT` with performer-derived `telegram_user_id` (for active-session cleanup).

### Other mutating socket events
- `post_process_session` and `create_tasks_from_chunks` use the same access check:
  - valid session id;
  - authenticated performer;
  - session access by owner/project/restricted rules;
  - required `UPDATE` permission.
- `subscribe_on_session` requires valid read access to requested session.

### Ack format
- Events may return ack object:
  - success: `{ ok: true, ... }`
  - error: `{ ok: false, error: "<code>" }`
- Typical error codes:
  - `invalid_session_id`
  - `unauthorized`
  - `session_not_found`
  - `forbidden`
  - `internal_error`

## Done processing contract
- Closing is deterministic by explicit `session_id` or current `active-session`.
- `done_count` increments on each close action.
- Repeated close is allowed.

## Link normalization
- Canonical public link format:
  - `https://voice.stratospace.fun/session/<id>`
- Legacy host links should be normalized to canonical host in bot-visible outputs.

## Invariants
- No implicit attach to arbitrary open sessions when `active-session` is missing.
- `active-session` can be switched only through explicit actions:
  - `/start`
  - `/session <id|url>`
  - web `Активировать`
  - web session creation flow.
