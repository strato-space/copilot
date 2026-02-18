# Changelog

## 2026-02-17
### PROBLEM SOLVED
- **16:20** Active-session behavior was still ambiguous between Telegram, WebRTC FAB, and session pages; users could implicitly fall back to unrelated open sessions instead of deterministic explicit active-session routing.
- **16:20** Socket session-closing flow trusted client payload context for user mapping and did not uniformly enforce session/project access checks across mutating socket events.
- **16:20** Shared Mongo/Redis between prod and beta runtimes allowed cross-runtime workers to pick foreign sessions/messages, causing stuck processing and environment leakage.
- **16:20** Deleting transcript segments could leave stale overlapping categorization rows in message projections, causing UI inconsistency between Transcription and Categorization tabs.
- **17:33** Telegram responses were inconsistent (`prefix + field headers`) across `/start`, `/session`, `/done`, and postprocessing events, which complicated quick parsing and copy/reuse in chat operations.
- **17:33** `/login` behavior still depended on active-session context, while operators needed a deterministic auth-entry link regardless of current session mapping.
- **17:33** Session page controls/status did not match the new FAB `New/Rec` contract, so operators could not trigger explicit `Rec` from a session row with a predictable active-session sync.
- **17:52** Session status pictogram near session-page action buttons was not fully tied to runtime `State` values (`cutting`, `final_uploading`, `error`, etc.), so operators lost quick visual feedback for real recorder state.
- **18:25** Opening `/session/:id` for a session inaccessible in the current runtime showed endless spinner instead of an explicit "session not found / runtime mismatch" state.

### FEATURE IMPLEMENTED
- **16:20** Implemented strict active-session semantics across TG/Web/WebRTC:
  - `/session` without args returns only explicit active session (no auto-pick fallback),
  - `/session <id|url>` activates session by explicit selection with access validation,
  - `/done` closes active session and clears active mapping,
  - incoming TG voice/text/attachments create a new session only when no active open session exists.
- **16:20** Added Web API + UI active-session controls:
  - `POST /voicebot/active_session`,
  - `POST /voicebot/activate_session`,
  - `/session` (without id) resolver page,
  - `Активировать` action on session page.
- **16:20** Added runtime isolation contract:
  - sessions/messages are tagged with `runtime_tag`,
  - active-session map is scoped by `telegram_user_id + runtime_tag`,
  - prod keeps legacy compatibility for records without `runtime_tag`,
  - API/worker paths ignore foreign runtime data.
- **16:20** Hardened socket contracts:
  - client `session_done` payload now uses `session_id` only,
  - backend resolves authenticated performer from JWT and validates permissions/access for `session_done`, `subscribe_on_session`, `post_process_session`, and `create_tasks_from_chunks`,
  - standardized socket ack error codes.
- **17:33** Unified Telegram session-event output to a strict 4-line message contract:
  - line 1: user-friendly event name,
  - line 2: canonical session URL,
  - line 3: session name,
  - line 4: project name.
- **17:33** Reworked `/login` to issue one-time `tg_auth` links (token in `automation_one_use_tokens`), fully independent of active-session state.
- **17:33** Updated session page UI actions to `Rec / Activate / Done` with FAB state sync and visual status markers (`rec/pause/closed`).
- **17:52** Finalized session-page controls to `New / Rec / Cut / Pause / Done` (same order as FAB) and switched left-side pictogram to full state-driven mapping.
- **18:25** Improved session-page resilience on 404 response from `/voicebot/session` by introducing explicit runtime-mismatch UI and retry-safe error rendering when a session is outside the active runtime.

### CHANGES
- **16:20** Backend session flow updates:
  - strict resolver default in `voicebot/bot_utils.js` (`allowFallback=false` unless explicitly enabled),
  - deterministic close behavior + `done_count` increment in `voicebot/common_jobs/done_multiprompt.js`,
  - active-session mapping set on `create_session` and on explicit activation in `crm/controllers/voicebot.js`.
- **16:20** Runtime isolation implementation:
  - added `RUNTIME_TAG` / `IS_PROD_RUNTIME` in `constants.js` and runtime helpers in `services/runtimeScope.js`;
  - persisted `runtime_tag` at write points (`get_new_session`, voice/text/attachment handlers, web upload path);
  - applied runtime filters/guards in `processing_loop`, `transcribe`, `categorize`, `finalization`, socket close flow, and CRM session/message queries;
  - split `automation_tg_voice_sessions` mapping by runtime and added safe prod fallback for legacy rows without `runtime_tag`;
  - upload/session API now reject cross-runtime operations (`404` for inaccessible sessions, `409 runtime_mismatch` for uploads).
- **16:20** API/routes and frontend integration:
  - added `active_session` / `activate_session` routes in `crm/routes/voicebot.js`,
  - added `SessionResolverPage` route wiring (`app/src/App.jsx`, `app/src/pages/SessionResolverPage.jsx`),
  - added `fetchActiveSession`/`activateSession` store actions and session-page activation button (`app/src/store/voiceBot.js`, `app/src/components/voicebot/MeetingCard.jsx`).
- **16:20** Reliability and compatibility coverage:
  - expanded/updated tests for active-session resolver and controller flows,
  - added transcript-delete coverage to verify categorization cleanup consistency,
  - added socket access helper tests in `__tests__/services/session-socket-auth.test.js`.
- **17:33** Added shared formatter module `voicebot/session_telegram_message.js` and switched message producers (`voicebot-tgbot.js`, `voicebot/common_jobs/done_multiprompt.js`, `voicebot/postprocessing/all_custom_prompts.js`) to unified event output.
- **17:33** Updated Telegram `/login` path in `voicebot-tgbot.js`: token generation (`crypto.randomBytes`), persistence in one-use tokens collection, and command/help text updates.
- **17:33** Updated `app/src/components/voicebot/MeetingCard.jsx` with `Rec / Activate / Done`, active-session localStorage/event sync to FAB, and rec/pause/closed status icon rendering.
- **17:52** Updated `app/src/components/voicebot/MeetingCard.jsx` status icon mapping to runtime states:
  - `recording` blinking red dot,
  - `cutting` scissors,
  - `paused` pause bars,
  - `final_uploading` green check,
  - `closed` blue square,
  - `ready` gray ring,
  - `error` red exclamation.
- **17:52** Updated `plan/session-managment.md` and `README.md` to align documentation with the new button order and state-driven pictogram contract.
- **17:33** Updated session management spec in `plan/session-managment.md` to document `/login` one-time auth-link semantics.
- **17:33** Adjusted `__tests__/common_jobs/done_multiprompt.test.js` assertions to validate the new 4-line Telegram message contract.
- **18:25** Updated session fetch UX in `app/src/store/voiceBot.js` + `app/src/pages/SessionPage.jsx` and enriched request diagnostics in `app/src/store/request.js` to distinguish 404 runtime-mismatch states from other load errors.

## 2026-02-16
### PROBLEM SOLVED
- **07:19** Telegram screenshot/document attachments were not consistently accessible to external processors (LLM/MCP) because the only supported path required session auth and depended on message ids; we now provide a stable, direct attachment contract without exposing Telegram bot tokens.
- **07:19** External attachment links needed to be explicit about compatibility between legacy UI consumption and stable public access; mixed behavior could break automation consumers and direct download tooling.

### FEATURE IMPLEMENTED
- **07:19** Added a stable public attachment endpoint: `GET /voicebot/public_attachment/:session_id/:file_unique_id` for Telegram-only attachments (no session auth, lookup by session + file_unique_id).
- **07:19** Extended `session_attachments` payload to include both legacy protected `uri` and optional `direct_uri` so existing UI flow stays intact while external consumers get stable references.
- **07:19** Added direct rendering path in `Screenshort` for `direct_uri` with protected fallback to `/voicebot/message_attachment/...`.

### CHANGES
- **07:19** Backend: added public attachment resolver and stream proxy in `crm/controllers/voicebot.js`, and registered public route in `crm/routes/voicebot.js`.
- **07:19** Backend auth gate updated in `voicebot-backend.js` to allow unauthenticated `/voicebot/public_attachment/*` requests for public retrieval.
- **07:19** Frontend: updated `Screenshort.jsx` and attachment normalization in `app/src/store/voiceBot.js` to consume `direct_uri` safely.
- **07:19** Tests/docs: added/extended API+smoke coverage and docs for public attachment delivery in:
  - `__tests__/controllers/voicebot-integration.test.js`
  - `__tests__/smoke/session_management_smoke.test.js`
  - `docs/VOICEBOT_API.md`
  - `docs/VOICEBOT_API_CODE_EXAMPLES.md`
  - `docs/VOICEBOT_API_TESTS.md`

## 2026-02-15
### PROBLEM SOLVED
- **15:00** Telegram voice bot session behavior was not aligned for deterministic handoff, with unclear active-session ownership semantics across `/start`, `/done`, and incoming content messages.
- **15:00** Session selection behavior for forwarded content and user-owned active sessions was undefined, creating inconsistency in how new voice/text messages should be attached.
- **09:43** Telegram bot command discoverability and login entrypoint were still not codified for operators, increasing support overhead during command onboarding.
- **17:30** Telegram screenshots/documents did not have a token-safe way to render in Web UI; direct Telegram file URLs would leak bot tokens and attachments were not exposed as a stable UI read model.
- **16:01** OpenAI quota failures could stall transcription or categorization indefinitely, requiring manual restarts even after the balance was restored.
- **19:53** `/session` and `/login` responses could still surface internal session URLs and did not consistently expose session metadata, forcing manual mapping when users revisited existing sessions.
- **21:12** Redis queue overload (maxmemory + noeviction) could stall sequential processors: BullMQ enqueue failed while `is_processing` flags were already set, causing categorization/transcription to loop in a stale-reset state without making progress.
- **21:31** Redis cleanup automation was too conservative for high-throughput queues and included an unsafe emergency path that could delete waiting jobs; cleanup is now bounded and safe (history-only) with stream trimming.
- **22:10** OpenAI spend could spike because categorization ran on trivial short text messages and used a long instruction prompt; categorization now skips trivial short texts/commands and defaults to a cheaper model (configurable).

### FEATURE IMPLEMENTED
- **15:00** Added an explicit planning document that defines Telegram voicebot session lifecycle and routing behavior (`plan/session-managment.md`): active session model, command semantics, and session-link normalization/representation.
- **09:43** Extended the Telegram session plan with a dedicated `/login` command and explicit `@strato_voice_bot` command set for operator operations (`/start`, `/done`, `/session`, `/login`).
- **17:30** Added session attachments support end-to-end:
  - `POST /voicebot/session` now returns `session_attachments` (derived read model for the `Screenshort` tab).
  - `GET /voicebot/message_attachment/:message_id/:attachment_index` streams Telegram attachments via a backend proxy (no bot token leaks).
  - `POST /voicebot/add_attachment` adds attachment-only messages; `POST /voicebot/add_text` accepts optional `attachments` for caption+file flows.
- **17:30** UI: added `Screenshort` tab to render screenshots/documents (preview + caption + timestamp).
- **17:30** LLM context: screenshots/documents are included in categorization/create_tasks input via structured blocks without triggering transcription loops.
- **17:30** Added Jest smoke tests for the Telegram attachment flow and the attachment proxy endpoint.
- **16:01** Processing loop now auto-recovers quota-stopped work: once account balance is restored, transcription and categorization jobs requeue automatically without manual intervention, and quota markers are safely reset once successful.
- **19:53** Telegram command responses were normalized to public host links and enriched with structured metadata:
  - `/session` and `/login` now return `session-url`, `session-name`, and `session-project-name`.
  - selected/inferred session can be a mapped closed session when `/session` and `/login` are queried, so users can reopen explicitly selected sessions.
- **19:53** Added exponential retry limits and backoff metadata for transcription/categorization recovery (`transcription_attempts`, `categorization_attempts`, `*_next_attempt_at`) with hard fail markers to prevent endless retries.
- **21:12** Hardened BullMQ queue behavior to prevent Redis OOM stalls:
  - Set bounded `defaultJobOptions` retention for backend queues and removed per-job overrides that kept completed jobs forever.
  - Made processor enqueue paths `await` the `queue.add(...)` call and roll back `is_processing` flags on enqueue failure (with retry markers for categorization).
- **21:31** Improved Redis protection rails:
  - `voicebot/redis_monitor.js` now cleans more history per pass, trims BullMQ event streams, and never touches `wait/active/delayed` jobs.
  - Redis diagnostics scripts and the Bull board tool now support `REDIS_USERNAME`.
- **22:10** Added LLM cost controls:
  - Categorization uses `VOICEBOT_CATEGORIZATION_MODEL` (default `gpt-4.1`) and skips trivial short text/command messages.
  - Task creation uses `VOICEBOT_TASK_CREATION_MODEL` (with model-not-found fallback) and a shorter prompt to reduce input tokens.

### CHANGES
- **15:00** Added `plan/session-managment.md` with a complete requirements and execution-ready design for:
  - session state ownership (`active-session`) in Telegram context,
  - `/start` creating and setting a new active session without force-closing existing ones,
  - `/done` closing only the active session and clearing active mapping,
  - `/session` assignment/lookup by raw id or `/session/<id>` link filtered to user ownership,
  - voice/text attachment rules with fallback selection for today-active sessions.
- **09:43** Updated the same session-management specification to include:
  - the `/login` command that returns `https://voice.stratospace.fun/login`;
  - command-level contract text ready for Telegram command registration in BotFather;
  - concise operational wording for link-based session responses and help text.
- **17:30** Backend: added `GET /voicebot/message_attachment/:message_id/:attachment_index`, extended message persistence with `message_type` + `attachments[]`, introduced `HANDLE_ATTACHMENT` job + idempotency for Telegram retries, and exposed `session_attachments` via `POST /voicebot/session`.
- **17:30** Frontend: added `Screenshort` tab/component and wired session attachment URIs for Telegram/web sources.
- **17:30** Docs/tests: updated `docs/VOICEBOT_API*.md`, added smoke tests under `__tests__/smoke/`, and linked implementation tasks in `plan/session-managment.md`.
- **16:01** Backend: updated auto-retry loop (`voicebot/common_jobs/processing_loop.js`) and processors (`voicebot/voice_jobs/transcribe.js`, `voicebot/voice_jobs/categorize.js`) to treat `insufficient_quota` as retryable without terminal corruption and reset quota-lock state after successful retry.
- **19:53** Telegram bot formatting and session state resolution updates:
  - `voicebot-tgbot.js` now normalizes `/session`/`/login`/`/start` links to public domain and adds `session-name` + `session-project-name` in responses.
  - `voicebot/bot_utils.js` now supports `resolveActiveSessionByUser(..., includeClosed)` for explicit re-opening of mapped closed sessions.
  - `common_jobs/start_multiprompt.js`, `handle_voice.js`, `handle_text.js`, `handle_attachment.js`, and `done_multiprompt.js` updated to reuse normalized public base URL for outgoing links.
  - New processing guard diagnostics command added: `cli/diagnostics/check_processing_staleness.js` with threshold, session mode, JSON output, and metrics.
- **19:53** Retry controls and hard-stop behavior:
  - `voicebot/voice_jobs/transcribe.js` and `voicebot/voice_jobs/categorize.js` now track attempt counters, schedule exponential next attempts, and stop after max attempts unless quota-retry path is active.
  - `voicebot/processors/categorization.js` and `voicebot/common_jobs/processing_loop.js` mirror retry gating by skipping stale entries until `next_attempt_at` and resetting stale lock assumptions.
- **21:12** Queue retention + enqueue safety:
  - `voicebot-backend.js` and `voicebot-tgbot.js` now apply bounded BullMQ job retention defaults.
  - `voicebot/bot_utils.js`, processors, and key controllers no longer override `removeOnComplete/removeOnFail` to `false`.
  - `voicebot/processors/{categorization,questioning,summarization,custom_processor}.js` now await enqueue and roll back lock flags on enqueue failure.
- **21:31** `voicebot/redis_monitor.js` emergency cleanup no longer risks dropping queued work (`wait`), and additionally trims `bull:<queue>:events` streams.
- **22:10** Reduced LLM token usage by shortening categorization/task prompts and adding short-text skip guards in the categorization processor.
- **22:36** Docs: documented LLM cost control env knobs and updated the auto-reprocessing notes in `README.md`/`AGENTS.md`.

## 2026-02-14
### PROBLEM SOLVED
- **06:55** Large web audio uploads could appear stuck at 0% because the UI progress only advanced after the request completed; the uploader now tracks byte-level progress during upload.
- **06:57** Uploads between 500MB and 600MB could fail at the edge due to a lower request body limit; the edge Nginx limit was raised to align with the product's 600MB cap.

### FEATURE IMPLEMENTED
- **06:55** Added real-time upload feedback for large audio files (file name + uploaded MB / total MB) while a web upload is in progress.

### CHANGES
- **06:55** Frontend: added axios upload progress tracking and improved error hints for common failures (413, network, timeouts).
- **06:55** Frontend: stopped forcing the multipart Content-Type header so the browser/axios can set the correct boundary automatically.
- **06:55** Docs: documented where source WebM/audio files live on disk and how duration backfill is computed (including an ffprobe fallback) in `AGENTS.md`.
- **06:57** Ops (edge): increased Nginx request body size limit to `700m` and upload body timeout to `600s` for `voice.stratospace.fun`.

## 2026-02-13
### PROBLEM SOLVED
- **09:45** Transcription chunk actions overlapped content and were inconsistent across segments; the UI now renders Copy/Edit/Delete in the free space above the chunk text (hover-only) and reserves safe right padding to prevent overlap.
- **09:45** Session/message durations were frequently zero or derived from unstable indexes, breaking timeline rendering and downstream analytics; duration is now resolved from message/chunk metadata and `ffprobe` as needed, and canonical segments are rebuilt with monotonic start/end times.
- **09:45** Closing a multiprompt session could unexpectedly spawn a new session automatically; the done handler now only closes the current session and emits update/notify events.

### FEATURE IMPLEMENTED
- **09:45** Added Copy action for transcription segments (hover-only) and an inline timeline label under the segment text (`HH:mm, mm:ss - mm:ss`) derived from canonical transcription or legacy chunks.
- **09:45** Added `services/transcriptionTimeline.js` to normalize legacy `transcription_chunks[]` into a stable timeline and to resolve duration consistently across sources.
- **09:45** Added diagnostics CLI `node cli/diagnostics/recalc_session_duration.js <sessionId> [--apply]` to recompute and optionally backfill message/session durations.
- **09:45** Added unit tests for timeline normalization and session-close behavior.

### CHANGES
- **09:45** Backend: improved audio duration probing via `ffprobe` JSON (`utils/audio_utils.js`), persisted upload duration in `crm/controllers/audio_upload.js`, and used timeline normalization in `crm/controllers/voicebot.js` and `voicebot/voice_jobs/transcribe.js`.
- **09:45** Frontend: simplified the Transcription table header (removed the standalone time column) and polished segment rendering/actions in `TranscriptionTableRow.jsx`.
- **09:45** Planning: added WBS + Mermaid artifacts for spec tracking (`plan/spec-task-breakdown-v1.md`, `plan/spec-wbs-status.png`).

## 2026-02-12
### PROBLEM SOLVED
- **05:22** Planning requirements for a large event-log/edit/rollback initiative were scattered across discussions; this session captures the source planning input in-repo for traceability and coordinated implementation.
- **08:35** Planning specs drifted on transcript identity and storage layers, mixing canonical transcription facts with UI-facing chunk lists; specs now converge on an immutable `transcription_raw -> transcription` chain and treat list views as derived/legacy.
- **09:12** Closed the remaining blocker on transcript version storage by locking versions at the session level, with session API responses returning only the effective final transcript after edits.
- **09:14** Closed the remaining blocker on speaker display defaults by locking technical-label rendering to `Спикер 1/2/...` while preserving raw labels in immutable transcription facts.
- **18:31** Transcript segment edits lacked a durable audit trail and safe rollback semantics; introduced an append-only session log with replayable events for edit/delete/rollback actions.
- **19:06** Operators could not edit or delete transcript segments directly in the Transcription tab; added UI controls wired to the new edit/delete endpoints.
- **19:25** Segment editing was modal-heavy and required a mandatory reason for destructive actions; moved to inline editing, hover-only actions, immediate delete, and optional reason.

### FEATURE IMPLEMENTED
- **05:22** Added raw stakeholder planning artifact `plan/edit-event-log-req.md` as the baseline input for the upcoming event-log specification work.
- **08:35** Added an event-log/edit/rollback spec draft (`plan/edit-event-log-plan.md`) aligned to immutable facts, append-only events, and replayable projections.
- **08:35** Refined the diarization migration plan to make `transcription_raw -> transcription` the canonical immutable storage contract and documented the model-agnostic `transcription` schema.
- **09:18** Added a consolidated launch draft `plan/implementation-draft-v1.md` with decision-locked staged execution (`event-log -> diarization`).
- **18:31** Added session log storage and CRM endpoints for transcript segment edit/delete/rollback, aligned to lowercase snake_case event taxonomy and replay-friendly actor/target metadata.
- **19:06** Added Transcription tab segment actions (edit/delete) plus a Log tab to surface session events.
- **19:25** Updated the UI to show segment actions on hover only, make `reason` optional across action endpoints, and move the Log tab to the end of the tab bar.

### CHANGES
- **05:22** Updated `AGENTS.md`, `README.md`, and `CHANGELOG.md` to document planning-artifact placement and close-session outcomes.
- **08:35** Planning specs: updated `plan/gpt-4o-transcribe-diarize-plan.md` to clarify the minimal immutable transcription contract and added `plan/edit-event-log-plan.md` for segment edits/rollback.
- **08:35** No runtime, API, database, or production behavior changes were introduced by these planning/spec updates.
- **09:22** Synchronized locked clarification outcomes across `plan/edit-event-log-plan.md`, `plan/gpt-4o-transcribe-diarize-plan.md`, and `plan/edit-event-log-req.md`.
- **09:24** Updated planning references in `AGENTS.md` and `README.md` to include `plan/implementation-draft-v1.md` and session-level transcript-versioning semantics.
- **18:31** Backend: introduced `automation_voice_bot_session_log` storage and API routes for segment actions (`crm/controllers/voicebot.js`) to support replayable history and rollback.
- **19:06** Frontend: added Transcription and Log tab UI for segment operations and event visibility (segment-level edit/delete wiring).
- **19:25** Frontend/backend: removed required `reason` validation for action endpoints and streamlined the editing workflow to be inline (no modal).

## 2026-02-07
### PROBLEM SOLVED
- **07:10** Sessions could not be summarized on-demand when a project was missing or the automatic conditions hadn't fired; the UI can now manually enqueue `session_ready_to_summarize` with a PMO fallback project, without affecting the standard automatic trigger.
- **08:32** Circle action buttons in the session header were visually misaligned (icons shifted up), making actions appear on different levels; icons are now centered so the buttons align consistently.

### FEATURE IMPLEMENTED
- **07:10** Added a `Summarize (∑)` action next to the AI title generator to trigger summarization and disable itself for 3 minutes.
- **07:10** Added `POST /voicebot/trigger_session_ready_to_summarize` to (1) assign PMO when `project_id` is missing and (2) enqueue the `session_ready_to_summarize` notify event (hooks from `notifies.hooks.yaml` will run via the notifies worker).
- **07:10** Added Jest unit + integration tests and API docs for `/voicebot/create_session`, `/voicebot/add_text`, and `/voicebot/trigger_session_ready_to_summarize`.

### CHANGES
- **07:10** Frontend: `MeetingCard.jsx` and `voiceBot.js` add manual summarize trigger + 3-minute cooldown.
- **07:10** Backend: `crm/controllers/voicebot.js`, `crm/routes/voicebot.js` add manual summarize endpoint (PMO assign + notify enqueue).
- **07:10** Tests/docs: `__tests__/controllers/*`, `__tests__/setup.js`, plus `docs/VOICEBOT_API*.md`.
- **08:32** Frontend: centered icon rendering for circle action buttons in `MeetingCard.jsx` to avoid baseline drift.

## 2026-02-06
### PROBLEM SOLVED
- **13:35** Session project assignment notifies were emitted on rename and lacked change context; notifies now fire only when `project_id` actually changes and include old/new project ids.
- **22:00** Local notify hooks could fail silently (detached spawn with ignored stdio), making production debugging difficult; hook runner now logs starts and spawn failures with `event`, `cmd`, `session_id`, and payload context.

### FEATURE IMPLEMENTED
- **13:35** Introduced `session_ready_to_summarize` notify event when both conditions are met: session is closed and `project_id` is assigned (emitted on close or on project assignment for already closed sessions).
- **13:35** Added an optional local notify hooks runner (YAML/JSON config) so events can trigger background commands (for example StratoProject summarization) without blocking the queue worker.

### CHANGES
- **13:35** Added `VOICE_BOT_NOTIFY_HOOKS_CONFIG` to `.env.example` and added `notifies.hooks.yaml` sample config.
- **22:00** Updated the sample hooks config to use an absolute `uv` path to avoid PATH differences under PM2/systemd.
- **13:35** Ignored fast-agent local artifacts (`agents/.venv/`, `agents/logs/`) in `.gitignore`.
- **13:35** Bumped frontend package version to `0.0.39` (`app/package.json`).

## 2026-02-05
### PROBLEM SOLVED
- Closed sessions could not accept web audio uploads, blocking late chunks from entering the processing pipeline.

### FEATURE IMPLEMENTED
- None.

### CHANGES
- Allow `/voicebot/upload_audio` to accept inactive sessions unless `is_deleted=true` (`crm/controllers/audio_upload.js`).
- Keep the upload UI available for closed sessions and disable only when the session is deleted (`app/src/components/voicebot/SessionStatusWidget.jsx`).
- Bumped frontend package version to `0.0.38` (`app/package.json`).

## 2026-02-04
### PROBLEM SOLVED
- **09:30** Voice MCP `/voicebot/projects` output missed key project attributes used by DBI flows; added them to the projects list payload.

### FEATURE IMPLEMENTED
- **09:30** Included `board_id`, `drive_folder_id`, and `design_files` in the `/voicebot/projects` response for both "read all" and "read assigned" permissions.

### CHANGES
- **09:30** Expanded project projections in `crm/controllers/voicebot.js` and `permissions/permission-manager.js`.
- **09:30** Bumped frontend package version to `0.0.37` (`app/package.json`).
- **22:01** Normalized spacing in `plan/session-697b75eabebd2e48576bc6ed.pretty.json` to keep the snapshot readable.

## 2026-02-03
### PROBLEM SOLVED
- The diarization migration notes mixed chunk vs. segment semantics and did not capture message-level transcription fields; the plan now spells out segment-level chunk storage and top-level transcription attributes for compatibility.

### FEATURE IMPLEMENTED
- None.

### CHANGES
- Clarify `transcription_chunks[]` to store one diarized segment per entry and document message-level transcription fields in `plan/gpt-4o-transcribe-diarize-plan.md`.
- Bump the frontend package version to `0.0.36` (`app/package.json`).

## 2026-02-02
### PROBLEM SOLVED
- Sessions list rows no longer jump in height when hovering the tag column; the tag edit control now matches the row height.

### FEATURE IMPLEMENTED
- Added CRM task extraction via the `create_tasks` agent, triggered by the "send to CRM" action and persisted in `agent_results.create_tasks`, with a restart endpoint for retries.

### CHANGES
- Added the `create_tasks` AgentCard and MCP-backed execution in `crm/controllers/voicebot.js`.
- Added CRM routes for `send_to_crm`, `sessions_in_crm`, and `restart_create_tasks`.
- Wired the sessions list "send to CRM" action with loading state and disabled state, and stabilized tag selector sizing.

## 2026-01-30
### PROBLEM SOLVED
- The "Delete session" dropdown action navigated into the session row instead of performing the delete action; row click propagation is now stopped for menu actions.
- Diarization migration notes were inconsistent about chunk vs. segment semantics; the plan now aligns the target shape with the OpenAI diarized JSON object and clarifies compatibility fields.
- **14:45** Fast-agent MCP services restarted under PM2 cluster mode and could collide with the legacy Python wrapper on port 8721; the service now runs as a single forked fast-agent instance with AgentCards.

### FEATURE IMPLEMENTED
- Added a concrete prod session snapshot to anchor the diarization data-model discussion and future migrations.
- **14:45** Introduced AgentCards-based session title generation for the MCP agent service.

### CHANGES
- Stop row-click navigation for session menu actions in `app/src/pages/SessionsListPage.jsx`.
- Expand `plan/gpt-4o-transcribe-diarize-plan.md` with the diarized JSON structure, legacy L1 fields, and UI/categorization guidance.
- Added `plan/session-697b75eabebd2e48576bc6ed.pretty.json` for schema reference.
- Document the new plan artifacts in `AGENTS.md` and `README.md`.
- Bumped frontend package version to `0.0.32` (`app/package.json`).
- **14:45** Move the session title prompt into `agents/agent-cards/generate_session_title.md` and remove the legacy `VoicebotAgentServices.py` wrapper and prompt file.
- **14:45** Run the MCP agent service via `fast-agent serve` in fork mode and add AgentCard validation in `agents/pm2-agents.sh`.
- **14:45** Redirect `/authorized` to `/login` in `app/src/App.jsx` for both embedded and full routes.
- **14:45** Bump the frontend package version to `0.0.35` (`app/package.json`).


## 2026-01-28
### PROBLEM SOLVED
- Embedded Voicebot screens could fall back to the full layout and side navigation when navigating deeper routes → added iframe-aware routing and embed layout handling.
- CORS checks failed for allowed subdomains with explicit ports → expanded origin validation to accept `*.stratospace.fun` plus localhost variants.

### FEATURE IMPLEMENTED
- Added `/embed/*` routing mode with postMessage bridge for route/height sync in iframe containers.

### CHANGES
- Introduced embed-specific hooks and layout components in the UI.
- Added embed parent origin configuration to frontend env files.

## 2026-01-29
### PROBLEM SOLVED
- Session list navigation could redirect to login without a visible loading state and ignore existing cookies; the UI now validates auth state before redirecting and shows a loading placeholder.
- Session tags were hard to reuse and discover; the UI now persists tag suggestions locally and shows compact tag summaries until hover.

### FEATURE IMPLEMENTED
- Added a diarization migration plan for `gpt-4o-transcribe-diarize` and documented prompt-based speaker handling in the Voicebot pipeline.

### CHANGES
- Redesigned the sessions list table layout (compact columns, avatars, icon headers, sticky header, right-aligned stats).
- Added hover-to-edit tag selector with localStorage-backed tag history in `SessionsListPage.jsx`.
- Added auth state probing in `RequireAuth.jsx` and `AuthUser` store to avoid premature redirects.
- Tightened sessions table padding in `app/src/index.css`.
- Expanded the diarization plan with current Mongo data model references, transcription chunk shape, and diarization impact notes.
- Bumped frontend package version to `0.0.13` (`app/package.json`).

## 2026-01-26
### PROBLEM SOLVED
- Session diagnostics for stuck postprocessing lacked a consistent reference and repeatable checks; added Mongo/Redis troubleshooting guidance and CLI diagnostics scripts.
- Segment discovery during transcription could miss files due to mismatched filename patterns; the segment matcher now aligns with the actual FFmpeg naming scheme.

### FEATURE IMPLEMENTED
- Added CLI diagnostics utilities to inspect sessions, queue health, postprocessor jobs, and Redis keys.

### CHANGES
- Document Mongo/Redis credentials, collections, queues, and stuck-session indicators in `AGENTS.md`.
- Add CLI diagnostics scripts under `cli/diagnostics/` and document them in `AGENTS.md` and `README.md`.
- Update segment filename matching in `voicebot/voice_jobs/transcribe.js`.
- Bump frontend package version to `0.0.2` (`app/package.json`).

## 2026-01-25
### PROBLEM SOLVED
- Sessions list loads could be slow and sometimes abort due to an expensive per-session message count lookup and duplicate UI fetches; added a MongoDB index on `automation_voice_bot_messages.session_id` and de-duplicated the sessions list fetch in the UI.
- MCP session title generation could fail without a clear error and fall back to a client-side timeout; the UI now surfaces `mcp_error` events and the MCP HTTP client sends compatible `Accept` headers for Streamable HTTP endpoints.
- Firefox dev consoles showed noisy warnings from Bluebird ("unreachable code after return statement") and empty optimized-deps sourcemaps; the Vite dev server now strips the unreachable Bluebird line and disables optimized-deps sourcemaps to keep logs clean.
- Session live updates could fail on HTTPS deployments due to hardcoded `ws://<host>:<port>` Socket.IO URLs; the UI now connects via same-origin so WSS works behind reverse proxies.
- Web UI sessions created from the embedded WebRTC FAB could be rejected or fail to appear in the sessions list because `chat_id` was required and list permissions only matched `chat_id`; `chat_id` is now optional for web sessions, list filtering also matches `user_id`, and the UI refreshes the sessions list on WebRTC session creation.

### FEATURE IMPLEMENTED
- None.

### CHANGES
- De-duplicate sessions list fetching to reduce request aborts and noise (`app/src/pages/SessionsListPage.jsx`).
- Handle MCP error events coming over Socket.IO (`app/src/hooks/useMCPWebSocket.js`).
- Use same-origin Socket.IO URL for session updates (`app/src/store/voiceBot.js`).
- Refresh the sessions list when the WebRTC FAB signals a new session (`app/src/components/WebrtcFabLoader.jsx`).
- Set Streamable HTTP MCP client `Accept` headers (`services/mcpProxyClient.js`).
- Replace the default Vite favicon, strip Bluebird unreachable eval, and disable optimized-deps sourcemaps to reduce Firefox console noise (`app/index.html`, `app/vite.config.js`).
- Refresh Browserslist DB (`caniuse-lite`) to avoid build warnings (`app/package-lock.json`).
- Fix the agent services PM2 `env_file` path (`agents/ecosystem.config.cjs`).
- Pin frontend build-time endpoints for direct-IP access and override to same-origin when served from `*.stratospace.fun` (`app/index.html`, `app/.env.production`).
- Document stuck categorization reset, the sessions list index requirement, HTTPS/WSS Socket.IO notes, and the production deploy frontend rebuild step (including `app/.env.production.local` overrides) (`AGENTS.md`, `README.md`).
- Allow web UI sessions without `chat_id` by resolving it from the authenticated performer when available (`crm/controllers/voicebot.js`).
- Include authenticated `user_id` in the base session list permissions filter for web-created sessions (`permissions/permission-manager.js`).
- Move Chrome remote debugging doc to the WebRTC repo and update the Voicebot references (`AGENTS.md`, `README.md`).

## 2026-01-24
### PROBLEM SOLVED
- Task generation could run before all message categorizations finished, producing incomplete task lists; CREATE_TASKS now waits for full categorization and retries later.
- Transcription logs could leak Telegram bot tokens through file links and left segment artifacts on disk; file links are now masked and per-message segment folders are cleaned up on success.

### FEATURE IMPLEMENTED
- Added `cli/restart-voicebot-sessions.js` to restart sessions by requeueing transcription for messages with empty transcription (or all messages via `--all`), with optional `--dry-run`.
- Added a Chrome remote debugging quick reference in `../webrtc/docs/CHROME_DEVTOOLS.md`.

### CHANGES
- Documented PM2 service roles and repo entrypoints for production mapping in `AGENTS.md`.
- Updated `voicebot/postprocessing/create_tasks.js` to mark processor state, delay/requeue until categorization completes, and persist empty results as processed.
- Updated `voicebot/voice_jobs/transcribe.js` to mask Telegram file links in logs, isolate FFmpeg segmentation outputs per job, and clean up segments on success.
- Removed obsolete `plan/act-33-fab-webrtc-spec.md` and refreshed documentation in `AGENTS.md` and `README.md`.
- Documented auto-reprocessing behavior, stuck-session recovery, and production ops runbook details in `AGENTS.md` and `README.md`.

## 2026-01-23
### PROBLEM SOLVED
- The FAB WebRTC spec did not reflect current progress, making QA status unclear; acceptance criteria and the work plan are now tracked with explicit checkboxes.
- Audio uploads above 500MB were rejected; the maximum allowed size is now 600MB.

### FEATURE IMPLEMENTED
- None.

### CHANGES
- Mark acceptance criteria and work plan completion status in `plan/act-33-fab-webrtc-spec.md`.
- Increased audio upload size limits and UI hints to 600MB in `constants.js` and `app/src/components/AudioUploader.jsx`.
- Documented dev vs production UI endpoints in `AGENTS.md` and `README.md`.

## 2026-01-22
### PROBLEM SOLVED
- Corrupted sessions with transcription errors could not be retried from the UI; operators can now restart processing to requeue failed messages and clear error flags.
- Fixed-width layouts overflowed on MacBook-sized screens; core VoiceBot pages now scale with max-width containers to avoid horizontal clipping.
- The UI lacked a direct entry to WebRTC call controls; a call shortcut is now available in the navigation.

### FEATURE IMPLEMENTED
- Added an end-to-end "restart corrupted session" flow (API + UI action) guarded by processing permissions.
- Added a WebRTC call shortcut in the left navigation for quick access to recording controls.

### CHANGES
- Added `voicebot/restart_corrupted_session` route and controller logic to reset error metadata and enqueue transcription retries.
- Added store and Sessions list actions for restarting corrupted sessions with status feedback.
- Updated Session/Meetings/Admin/Canvas layouts and tickets preview modal to use responsive max widths.
- Allowed Vite dev hosts for `voice-dev.stratospace.fun` and `voice.stratospace.fun`.
## 2026-01-21
### PROBLEM SOLVED
- Processor warnings flooded logs and made stalls hard to spot; pending processor logging is now aggregated, rate-limited, and escalated only for stuck processors.
- Transcription failures could leave messages in limbo; errors are now recorded on messages and sessions to stop downstream work cleanly.

### FEATURE IMPLEMENTED
- Added structured transcription error tracking on messages and sessions with error codes and timestamps.

### CHANGES
- Aggregate processor pending/stuck logging in `voicebot/common_jobs/processing_loop.js` and drop per-message warnings in finalization.
- Categorization now skips empty transcripts and stops when transcription errors are present.
- Transcription job captures segmentation failures and non-retryable errors, and notifies sessions via updates.

## 2026-01-20
### PROBLEM SOLVED
- MCP calls failed against Streamable HTTP endpoints after SSE transport was configured; updated transport settings to match server expectations.

### FEATURE IMPLEMENTED
- None.

### CHANGES
- Switch StratoSpace MCP transports to HTTP in `agents/fastagent.config.yaml`.
- Document MCP transport usage in `AGENTS.md` and `README.md`.

## 2026-01-16
### PROBLEM SOLVED
- Developers needed a quick way to flip frontend API endpoints without losing localhost context; clarified the dev endpoint while retaining localhost reference.

### FEATURE IMPLEMENTED
- None.

### CHANGES
- Update the frontend dev API endpoint and keep localhost noted for quick switching.
- Refresh `package-lock.json` after dependency metadata cleanup.
