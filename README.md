# Copilot

Copilot is the workspace for Finance Ops, OperOps/CRM, Voice, and Miniapp surfaces. Deprecated code is archived in `old_code/`.

## FinOps notes
- FX rates are managed in `app/src/store/fxStore.ts` and recalculate RUB values in analytics, KPIs, and plan-fact tables.
- The Employees directory supports a chat-driven form fill that prompts for missing fields.
- Plan-fact months can be pinned (up to 3), and the totals row stays visible under pinned months.
- Plan-fact frontend uses API-only data (local `mockPlanFact` fallback and CRM snapshot badges were removed from pages/stores).
- Plan-fact project edits are persisted through `PUT /api/plan-fact/project`; backend propagates `contract_type` updates into facts/forecasts records for the same `project_id`.
- The Expenses tab combines payroll and other costs, with category-level operations and sticky totals.
- Expense attachments are uploaded via `/api/uploads/expense-attachments` and served from `/uploads/expenses`.
- Guide directories fall back to mock data when the automation API is unavailable, and the Guide header includes a global Log sidebar.

## OperOps/CRM notes
- CRM components migrated from `automation/appkanban` live in `app/src/components/crm/`.
- CRM pages: CRMPage, PerformersPage, FinancesPerformersPage, ProjectsTree, TaskPage in `app/src/pages/operops/`.
- CRM stores: `kanbanStore.ts` (tickets, epics, performers), `crmStore.ts` (UI state), `projectsStore.ts` (project tree), `requestStore.ts` (API).
- Socket.IO events: TICKET_CREATED, TICKET_UPDATED, TICKET_DELETED, EPIC_UPDATED, COMMENT_ADDED, WORK_HOURS_UPDATED.
- Routes accessible at `/operops/*` with OperOpsNav horizontal navigation.
- CRM Kanban task details link must resolve by `id || _id` to prevent `/operops/task/undefined` navigation for records without public `id`.
- CRM project display/filtering should resolve project name from `project_data`/`project_id`/`project`; performer filter must handle mixed `_id` and legacy `id` values.

## Voice notes
- Voice UI is native in `app/` under `/voice/*` (no iframe embed).
- Voice API source of truth is local: `/api/voicebot/*` (flat contract + legacy aliases during migration).
- Runtime isolation is enforced via `runtime_tag` for operational collections; legacy records without `runtime_tag` are treated as `prod`.
- WebRTC FAB script should be loaded from same-origin static path (`/webrtc/webrtc-voicebot-lib.js`) via `VITE_WEBRTC_VOICEBOT_SCRIPT_URL`.
- Upload route (`/api/voicebot/upload_audio`) immediately emits socket events `new_message` + `session_update` into `voicebot:session:<session_id>` so new chunks appear without waiting for polling.
- Upload route returns structured oversize diagnostics (`413 file_too_large` with max-size metadata), and WebRTC upload client normalizes these payloads into concise UI-safe error messages.
- Upload route propagates `request_id` in success/error payloads and logs (`X-Request-ID` passthrough or generated fallback), and WebRTC surfaces this id in upload diagnostics.
- Upload route now has explicit upstream-failure shaping: Nginx intercepts `502/503/504` for `/api/voicebot/upload_audio` and returns structured JSON `503 backend_unavailable`, while WebRTC client keeps chunk in failed/manual-retry state and shows actionable retry guidance.
- Session upload flow consumes pending image anchors (`pending_image_anchor_message_id` / `pending_image_anchor_oid`): first uploaded chunk is linked with `image_anchor_message_id`, then pending anchor markers are cleared.
- Categorization updates are now delivered via websocket `message_update` events (no page refresh required): processor workers push `SEND_TO_SOCKET` jobs, backend consumes them and broadcasts to `voicebot:session:<session_id>`.
- Transcribe worker now emits realtime `message_update` events for both success and failure branches, so pending/error rows appear in Transcription tab without manual refresh.
- Voice socket reconnect now performs session rehydrate and ordered upsert (`new_message`/`message_update`) to prevent live-state drift after transient disconnects.
- Voice websocket must use the `/voicebot` namespace (`getVoicebotSocket`), not the root namespace (`/`), otherwise session subscriptions (`subscribe_on_session`) are ignored.
- `Done` in WebRTC now runs bounded auto-upload draining and marks remaining failed chunk uploads for explicit retry instead of indefinite automatic loops.
- WebRTC unload persistence now stores any non-recording state as `paused` to avoid stale auto-resume after refresh/unload races.
- Full-track recording segments are represented as `full_track` in Monitor/UI with duration and timestamp metadata, but upload to backend is intentionally disabled until diarization workflow is enabled.
- Voice workers schedule periodic `PROCESSING` scans in TS runtime; pending-session filtering uses `is_waiting: { $ne: true }` to include legacy rows without explicit flag.
- TS `processingLoop` now also prioritizes sessions inferred from pending message backlog (including rows with `is_messages_processed=true`) and requeues categorization after quota cooldown via processors queue.
- TS transcribe handler deduplicates repeated uploads by file hash (`file_hash` / `file_unique_id` / `hash_sha256`) and reuses existing session transcription before new OpenAI requests.
- Historical WebRTC duplicates can be collapsed by filename per session via backend script:
  - dry run: `cd backend && DOTENV_CONFIG_PATH=.env.production npm run voice:dedupe:webm:dry`
  - apply: `cd backend && DOTENV_CONFIG_PATH=.env.production npm run voice:dedupe:webm:apply`
  - rules: only non-Telegram `*.webm` messages, grouped by `(session_id, file_name)`, keep one most relevant message and mark the rest `is_deleted=true`.
- Idle active sessions can be auto-closed via backend script:
  - dry run: `cd backend && DOTENV_CONFIG_PATH=.env.production npm run voice:close-idle:dry -- --inactive-hours=4`
  - dry run (LLM/automation JSON): `cd backend && DOTENV_CONFIG_PATH=.env.production npm run voice:close-idle:dry -- --inactive-hours=4 --json`
  - dry run (streaming JSONL): `cd backend && DOTENV_CONFIG_PATH=.env.production npm run voice:close-idle:dry -- --inactive-hours=4 --jsonl`
  - apply: `cd backend && DOTENV_CONFIG_PATH=.env.production npm run voice:close-idle:apply -- --inactive-hours=4`
  - activity window uses latest session update/message/session-log timestamps; sessions with no movement above the threshold are closed through `DONE_MULTIPROMPT` flow.
- Empty stale sessions can be cleaned in worker runtime by scheduled `CLEANUP_EMPTY_SESSIONS` jobs (no-message sessions older than configured threshold are marked `is_deleted=true`):
  - env knobs: `VOICEBOT_EMPTY_SESSION_CLEANUP_INTERVAL_MS`, `VOICEBOT_EMPTY_SESSION_CLEANUP_AGE_HOURS`, `VOICEBOT_EMPTY_SESSION_CLEANUP_BATCH_LIMIT`.
- Voice sessions list supports deleted-session mode (`include_deleted` / `Показывать удаленные`); creator/participant filters suppress numeric identity placeholders and keep only human-readable labels.
- Voice sessions list forces a mode-sync refetch when `showDeletedSessions` intent changes during an in-flight load (`force=true` bypasses loading short-circuit for this case).
- Voice sessions list supports bulk delete for selected active rows (`Удалить выбранные`) with confirmation and safe exclusion of already deleted sessions.
- Session read path normalizes stale categorization rows linked to deleted transcript segments (including punctuation/spacing variants) and saves cleaned `processed_data`.
- Voice message grouping links image-anchor rows to the next transcription block and suppresses duplicate standalone anchor groups; transcription rows now show inline image previews when image attachments are present.
- Web pasted images are persisted via backend upload endpoint (`POST /api/voicebot/upload_attachment`, alias `/api/voicebot/attachment`) into `backend/uploads/voicebot/attachments/<session_id>/<file_unique_id>.<ext>`.
- Session page shows `Возможные задачи` tab when `processors_data.CREATE_TASKS.data` is present and user has `PROJECTS.UPDATE`; the table uses compact design (no standalone status/project/AI columns), keeps `description`, and validates required fields inline.
- Possible Tasks validation no longer requires `task_type_id`; blocking required fields are `name`, `description`, `performer_id`, and `priority`.
- CREATE_TASKS payloads are normalized to canonical `id/name/description/priority/...` shape in both worker (`createTasksFromChunks`) and API utility (`save_create_tasks`) write paths.
- Task deletion from session now matches canonical and legacy identifiers (`id`, `task_id_from_ai`, `Task ID`) to handle mixed historical payloads.
- TS categorization/create-tasks chain treats non-text placeholders (`image`, `[Image]`, `[Screenshot]`) as non-blocking: rows are marked processed with empty categorization, and `CREATE_TASKS` can finalize without waiting on uncategorizable chunks.
- Session toolbar and FAB keep unified control order `New / Rec / Cut / Pause / Done`; `Rec` activates page session before routing to FAB control, while status badge follows runtime states (`recording`, `paused`, `finalizing`, `error`, `closed`, `ready`).
- Transcription/Categorization tables support client-side chronological direction switching (up/down) with preference persisted in local storage.
- Screenshot attachments now display canonical absolute URLs with `public_attachment` priority (`direct_uri`), and expose hover-only copy-link action in card footer.
- Screenshort cards keep `https://...` links fully visible, while `data:image/...;base64,...` values are displayed in truncated preview form (`data:image/...;base64,...`) and copied in full through the hover Copy action.
- Voice task creation in Copilot runtime no longer requires `task_type_id`; missing type is no longer a hard blocker in ticket/task generation.
- `copilot-voicebot-tgbot-prod` runs TypeScript runtime from `backend/dist/voicebot_tgbot/runtime.js` with `backend/.env.production` as the single env source.
- TS tgbot runtime protects against duplicate pollers using Redis distributed lock `voicebot:tgbot:poller_lock:<runtime_tag>`; lock loss triggers controlled shutdown to prevent split Telegram update consumption.
- `copilot-voicebot-workers-prod` runs TypeScript worker runtime from `backend/dist/workers/voicebot/runtime.js` (`npm run start:voicebot-workers`) via `scripts/pm2-voicebot-cutover.ecosystem.config.js`; queue workers consume all `VOICEBOT_QUEUES` and dispatch through `VOICEBOT_WORKER_MANIFEST` with `backend/.env.production`.
- Backend API process runs dedicated socket-events consumer (`startVoicebotSocketEventsWorker`) for `voicebot--events-*` queue and uses Socket.IO Redis adapter for cross-process room delivery.
- TS transcribe handler never silently skips missing transport now: Telegram messages with `file_id` but without local `file_path` are marked `transcription_error=missing_transport` with diagnostics; text-only chunks without file path are transcribed via `transcription_method=text_fallback` and continue categorization pipeline.

### Voice TypeScript migration status (from closed BD issues)
- Runtime entrypoints migrated to TS:
  - `backend/src/voicebot_tgbot/runtime.ts` (`copilot-b2t`, `copilot-f1g`, `copilot-h84`)
  - `backend/src/workers/voicebot/runtime.ts` + manifest/runner (`copilot-ovg`)
- Core worker handlers migrated to TS (`copilot-6jm`, `copilot-lnu`, `copilot-lcf`):
  - `backend/src/workers/voicebot/handlers/{transcribe,categorize,finalization,processingLoop,summarize,questions,customPrompt,createTasksFromChunks,doneMultiprompt,...}.ts`
- Legacy runtime subtree was removed from this repo under `copilot-vsen`; historical implementation references live in external repo `/home/strato-space/voicebot`.
- JS cleanup completed for confirmed dead artifact: removed `sandbox-assets/ui-miniapp/app.js` (no runtime references in copilot).

### Voice migration planning docs
- Primary frontend migration decision log: `docs/MERGING_FRONTENDS_VOICEBOT.PLAN.md`
- Program-level migration source: `docs/MERGING_PROJECTS_VOICEBOT_PLAN.md`
- Playwright parity source: `docs/PLAYWRIGHT_MIGRATION_MATRIX.md`
- All three docs are synced from closed `bd list --all` items and use status legend `[v] / [x] / [~]`.
- This plan is maintained against closed `bd` issues and includes an explicit contradiction section between old assumptions and implemented behavior.
- Current open migration backlog is tracked only in `bd`; as of the latest refresh there are no open P1 frontend migration tasks.
- Legacy implementation history remains in external repo: `/home/strato-space/voicebot`
- Synced legacy planning references copied for context now live in `plan/session-managment.md` and `plan/gpt-4o-transcribe-diarize-plan.md`.


### Voice runtime: key configuration map
- OpenAI key is a shared variable: `OPENAI_API_KEY`.
  - Copilot backend: `backend/src/api/routes/voicebot/llmgate.ts`.
  - TS workers/tgbot runtime: `backend/src/workers/voicebot/*` and `backend/src/voicebot_tgbot/*`.
- Runtime/instance settings:
  - `VOICE_RUNTIME_ENV` (`prod|dev`) — runtime family.
  - `VOICE_RUNTIME_SERVER_NAME` — host identity (`p2`, etc.).
  - `VOICE_RUNTIME_TAG` — explicit full tag override.
  - Runtime family matching in prod accepts `prod` and `prod-*` tags; non-prod remains strict by exact tag.
  - `DOTENV_CONFIG_PATH`, `DOTENV_CONFIG_OVERRIDE` — explicit env file source for cutover startup.
- Telegram identity:
  - `TG_VOICE_BOT_TOKEN` (prod family)
  - `TG_VOICE_BOT_BETA_TOKEN` (non-prod runtime)
- OpenAI/LLM knobs:
  - `OPENAI_BASE_URL` (default `https://api.openai.com/v1`)
  - `VOICEBOT_CATEGORIZATION_MODEL` (default `gpt-4.1`)
  - `VOICEBOT_TASK_CREATION_MODEL` (default `gpt-4.1`)
- Transcription errors persist diagnostics (`openai_key_mask`, `openai_key_source`, `openai_api_key_env_file`, `server_name`) for quota/file-path incident analysis; key mask format is normalized to `sk-...LAST4`.
- Storage and services:
  - `OPENAI_*` keys are loaded from `backend/.env.production` for backend API, TS workers, and TS tgbot runtime.
  - `MONGO_*`, `REDIS_*`, `MAX_FILE_SIZE`, `UPLOADS_DIR` remain service-specific.

### Voice agents integration (frontend -> agents)
- Agent cards live in `agents/agent-cards/*` and are served by Fast-Agent on `http://127.0.0.1:8722/mcp` (`/home/strato-space/copilot/agents/pm2-agents.sh`).
- Frontend trigger points:
  - AI title button in `/voice/session/:id` calls MCP tool `generate_session_title`.
  - CRM "restart create_tasks" flow calls MCP tool `create_tasks`.
- Frontend MCP endpoint resolution order:
  1. `window.agents_api_url` (if set at runtime),
  2. `VITE_AGENTS_API_URL`,
  3. fallback `http://127.0.0.1:8722` (prod safety fallback).
- MCP transport path:
  - browser opens Socket.IO to backend (`/socket.io`),
  - frontend emits `mcp_call`,
  - backend MCP proxy (`backend/src/services/mcp/*`) calls Fast-Agent MCP endpoint.
- Required tool names in agent cards:
  - `generate_session_title` (`agents/agent-cards/generate_session_title.md`)
  - `create_tasks` (`agents/agent-cards/create_tasks.md`)

## Miniapp notes
- Miniapp frontend sources live in `miniapp/src/` and build to `miniapp/dist`.
- Miniapp backend is served by the Copilot backend runtime (`npm run dev:miniapp` / `npm run start:miniapp`).
- PM2 mode scripts start both backend APIs (`copilot-backend-*` and `copilot-miniapp-backend-*`) together.

## What is included
- `app/` React + Vite frontend for Finance Ops and OperOps/CRM.
- `miniapp/` React + Vite miniapp frontend.
- `backend/` Node/Express API for FinOps, CRM, VoiceBot, and miniapp backend routes.
- `agents/` Python-based agents service and PM2 helper scripts.
- `scripts/` deployment helpers (`pm2-backend.sh`, `check-envs.sh`).
- `docs/`, `specs/`, `projects/` for product documentation and specs.
- `deploy/` Host-level Nginx config and notes.

## Planning Artifacts
- Synced voice migration planning docs are stored under `docs/voicebot-plan-sync/`.
- Keep `docs/voicebot-plan-sync/implementation-draft-v1.md` and session-level transcript versioning specs (`edit-event-log-plan.md`, `gpt-4o-transcribe-diarize-plan.md`) current with migration decisions.
- Session close/finalization outcomes for voice migration should be documented in `CHANGELOG.md` and mirrored in `AGENTS.md` + `README.md`.

## Versioning And Dependencies
- SemVer policy: `MAJOR.MINOR.PATCH`.
- `MAJOR`: breaking API or behavior contract changes.
- `MINOR`: backward-compatible features/endpoints.
- `PATCH`: bugfixes/refactors without intentional behavior change.
- Dependency policy:
  - Prefer current stable TypeScript/Node LTS and keep strict typecheck green.
  - Prefer current stable `zod` 4.x for API schema/runtime validation.
  - Review lockfile changes in PRs; avoid silent transitive upgrades during hotfixes.

## Typed Contracts
- Backend voice handlers must validate request payloads with Zod at route boundaries.
- Keep callback/input types derived from schemas (`z.input<typeof schema>`) for compile-time safety.
- Do not bypass schema validation with ad-hoc parsing for public API endpoints.

## Development (p2)
For shared dev on p2, use PM2 scripts and serve static builds to avoid Vite port conflicts.

```bash
./scripts/check-envs.sh
./scripts/pm2-backend.sh dev
```

- Dev URL: https://copilot-dev.stratospace.fun
- Backend health: http://127.0.0.1:3002/api/health
- Agents MCP (fast-agent): http://127.0.0.1:8722 (plain HTTP; MCP endpoint is `/mcp`, loopback-only bind)
- Manual frontend builds:
  - `cd app && npm install && npm run build-dev`
  - `cd miniapp && npm install && npm run build-dev`

## Repository Sync (bd)
This repo uses `bd` (Beads) and the `beads-sync` branch to keep repository metadata consistent.

```bash
bd sync
```

See `AGENTS.md` for the full workflow (including `bd doctor` guidance).

## Authentication
- Backend proxies Voicebot auth via `/api/try_login` and `/api/auth/me`; set `VOICEBOT_API_URL` in the backend environment.
- Frontend auth checks call `https://voice.stratospace.fun/auth/me` by default; override with `VITE_VOICEBOT_BASE_URL` if needed.
- Login relies on the shared `auth_token` http-only cookie for `.stratospace.fun`.

## Nginx
The Finance Ops SPA is served by Nginx, and `/api` is proxied to the backend. For the public domain, see `deploy/nginx-host.conf` and `deploy/README.md`.

## Testing
- Unit tests: `npm run test` (Jest) in `app/` and `backend/`.
- E2E tests: `npm run test:e2e` (Playwright) in `app/` — runs against local dev server.
- E2E tests require a running dev server or use `PLAYWRIGHT_BASE_URL` env var.
- Run E2E with UI: `npm run test:e2e:ui`
- Run E2E headed: `npm run test:e2e:headed`

### E2E Auth Setup
To run authenticated tests:
1. Copy `app/.env.test.example` to `app/.env.test`
2. Fill in `TEST_USER_EMAIL` and `TEST_USER_PASSWORD`
3. Run tests: `npm run test:e2e`

Projects:
- `chromium-unauth`: Tests without authentication (login page, redirects)
- `chromium`: Authenticated tests (require valid credentials in `.env.test`)

## Session closeout update
- Fixed voice sessions deleted-mode sync (`copilot-nhwu`): `SessionsListPage` now forces list refetch when `sessionsListIncludeDeleted` differs from current `showDeletedSessions` intent.
- Updated store fetch guard so `fetchVoiceBotSessionsList({ force: true })` can run while list loading is active for required mode synchronization.
- Added regression test `app/__tests__/voice/sessionsListIncludeDeletedSyncContract.test.ts`.
- Restored notify transport path for voice summarize events: `actions@call` command fixed in `/home/tools/server/mcp/call.env`, `/notify` now healthy (`200`).
- Added TS local notify hooks parity in `backend/src/workers/voicebot/handlers/notify.ts`:
  - `VOICE_BOT_NOTIFY_HOOKS_CONFIG` support (YAML/JSON, default `./notifies.hooks.yaml`, empty disables),
  - detached hook spawn + structured logs,
  - session-log events `notify_hook_started`, `notify_http_sent`, `notify_http_failed`.
- Added sample hooks config `backend/notifies.hooks.yaml` and targeted regression test `backend/__tests__/voicebot/notifyWorkerHooks.test.ts`.
- Added Voice Sessions list URL-state workflow (`tab`, filters, pagination) with inline project reassignment and active-project-only selectors (`app/src/pages/voice/SessionsListPage.tsx`).
- Added MeetingCard dialogue-tag editing with remembered local tag options and persisted `dialogue_tag` updates.
- Updated done UX/state flow: frontend applies immediate ack-driven close projection, listens for `session_status=done_queued`, and backend socket emits immediate `session_update` on `session_done`.
- Added deduplicated immediate common-queue processing kick in shared done flow (`backend/src/services/voicebotSessionDoneFlow.ts`) to reduce finalize lag after session close.
- Hardened CREATE_TASKS postprocessing to enqueue pending CATEGORIZE jobs before delayed retry when categorization is incomplete.
- Added mixed-identifier performer normalization for CRM ticket create/update and Miniapp task performer matching compatibility (`id`/`_id`/ObjectId).
- Canonicalized Voice/TG public session links to `https://copilot.stratospace.fun/voice/session[/<id>]` and added `VOICE_WEB_INTERFACE_URL` sample default in `backend/.env.example`.
- Added `splitAudioFileByDuration(...)` ffmpeg helper in backend audio utilities for deterministic segment generation.
- Added deferred migration spec `plan/session-done-notify-routing-migration.md` for immediate done notifications and routing ownership move from JSON config to Copilot DB targets.
- Added tracked ontology package under `ontology/typedb/` (TypeQL schema, Mongo mapping, validation query set, rollout plan) to keep TypeDB model assets versioned in Copilot.
- Updated Voice transcription download flow to use `/api/voicebot/transcription/download/:session_id` with runtime-safe markdown export handling and Jest coverage.
- Added backend TypeDB ontology helper tooling (`requirements-typedb.txt`, ingest/validate scripts, npm aliases, and `.env` sample variables) for STR OpsPortal model ingestion.
- Switched OperOps Projects Tree editing to modal-based UX and removed split-pane edit card flow.
- Synced local bd SQLite metadata/config files and stored Dolt migration import/backup artifacts in `.beads/`.
- Added `plan/deep-research-oss-platforms-operops-finops.report.draft.md` (draft) summarizing platform research options for OperOps/FinOps/Guide/Voice and phased implementation recommendations.
- Added `plan/fpf-erd-extraction-protocol-str-opsportal.md` and `plan/str-opsportal-erd-draft-v0.md` for STR OpsPortal ERD extraction protocol definition and the initial consolidated ERD draft.
- Extracted shared Voice `completeSessionDoneFlow` service and switched socket `session_done` path to it for unified close/notify behavior.
- Added idle-active-session close automation script (`backend/scripts/voicebot-close-inactive-sessions.ts`) and npm commands `voice:close-idle:dry|apply` with JSON/JSONL outputs for operations.
- Added session-specific diagnostics helper script `backend/scripts/tmp-explain-69981f2e.ts` for transcription/chunk payload inspection.
