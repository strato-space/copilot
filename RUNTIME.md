# Copilot Runtime Specification

This file contains current implementation state, runtime constraints, and operational reference for the copilot repository. It is a descriptive specification — it records what the system currently does and how to operate it. For binding governance rules, see [AGENTS.md](AGENTS.md).

This file uses the same modality tags as AGENTS.md (`[RULE]`, `[FACT]`, `[INDEX]`, `[LEGACY-COMPAT]`). Most content here is `[FACT]` — current runtime state. The term `canonical` appears frequently in historical bullets; interpret it as `authoritative` or `current` depending on context (see AGENTS.md term normalization).

## Implementation Constraints (Minimal Agent Context)

These constraints are derived from origin/main + CHANGELOG.md. They describe current implementation behavior, not governance policy.

- Voice close path:
  - close requests are REST-only (`/api/voicebot/session_done`);
  - clients fail fast and do not fall back to `/api/voicebot/close_session`;
  - browser-side `session_done` socket emit is not a valid source of truth.
- FAB/toolbar done semantics:
  - `Done` must work from both `recording` and `paused` session states;
  - failed close must keep session active (no fake closed reset).
- Realtime guarantees:
  - upload pipeline and workers must emit room updates (`new_message`, `session_update`, `message_update`) so session UI updates without refresh.
- Sessions list contract:
  - quick filters: `Все | Без проекта | Активные | Мои`;
  - `Показывать удаленные` is part of persisted filter state;
  - include-deleted mode changes must force-sync even under loading.
- Sessions list visual status:
  - use state pictogram model (`recording/cutting/paused/final_uploading/closed/ready/error`);
  - do not reintroduce legacy noisy red-dot semantics.
- Voice processing robustness:
  - TS transcribe supports Telegram transport recovery (`getFile` + download + persisted `file_path`);
  - media-bearing video inputs are staged to extracted audio before ASR, not transcribed from the raw video container;
  - ASR runs in single-file-first mode, attempts low-bitrate re-encode before segmented fallback when chunk fan-out would exceed the hard cap, and fails safely instead of truncating tails when split output still exceeds `8` chunks;
  - transcribe persistence now records `source_media_type`, `audio_extracted`, `asr_chunk_count`, `chunk_policy`, and `chunk_cap_applied` on both success and deterministic oversize failure paths;
  - `processingLoop` and done-flow rely on shared orchestration and common queue kick.
- Ontology tooling path contract:
  - canonical scripts are under `ontology/typedb/scripts/*`;
  - do not add new backend-local duplicates under `backend/scripts` for TypeDB flow.
  - canonical generated ontology output is `ontology/typedb/schema/str-ontology.tql`;
  - editable source fragments are under `ontology/typedb/schema/fragments/*/*.tql`;
  - generated inventory and sampling artifacts live under `ontology/typedb/inventory_latest/*`,
  - operator workflow now includes `ontology:typedb:{build,contract-check,domain-inventory,entity-sampling,ingest:*,sync:core:*,sync:enrich:*,sync:*,full:from-scratch:apply,rollout:start,rollout:stop,rollout:clear-logs,rollout:status}`,
  - rollout terms are ontology-distinct:
    - `cleanup_apply` = core hygiene pass for canonical AS-IS entities/required relations;
    - `historical_backfill` = enrichment pass for derived projections/support objects.
  - do not collapse cleanup and backfill into one benchmark class; compare like with like.
  - `copilot-8wn1` cleanup apply currently runs with `--skip-session-derived-projections` by design; the skipped projections belong to backfill, not to the hygiene objective.
  - architecture / roadmap source is `ontology/plan/ontology-and-operations.md`.
  - for conceptual-model / ontology disputes, defer to `ontology/plan/voice-dual-stream-ontology.md`, `ontology/plan/ontology-and-operations.md`, `ontology/typedb/docs/*_contract_v1.md`, and `ontology/typedb/schema/fragments/*/*.tql`; repo-root `AGENTS.md` summarizes runtime/product constraints and must yield to the ontology authority when they conflict.
  - performance notes for the 2026-03-15 rollout tuning live in `ontology/typedb/docs/ingest_performance_profile_2026-03-15.md`.
  - `copilot` ontology is the common kernel; project-local ontologies must extend it rather than fork it.
  - `SemanticCards` are a required companion surface for key ontology objects: kernel cards live under `ontology/semantic/*`, project-local overlay cards live under project-local AFS `ontology/semantic/*`, and `ontology/typedb/docs/semantic-glossary.md` is the platform glossary/index rather than a replacement for cards.
- Semantic-card persistence runtime is now active on backend boot:
  - startup must load the checked TQL card registry plus the Mongo->card persistence bridge before serving requests,
  - `ontology/typedb/schema/fragments/*/*.tql` remains the editable authority for card-backed runtime coverage,
  - strict Mongo adapters are allowed only for collections with card-backed coverage; `schema-only-unchecked` collections must not be marketed as fully card-backed.
- direct DB-side TypeDB constraints are now part of the contract for `task.status` and `task.priority`; do not bypass owner-level `@values(...)` with ad hoc raw-label writes.
- Mongo task labels must normalize directly into canonical lifecycle keys and `P1..P7` priority before writing to TypeDB.
  - executor-layer ontology vocabulary is now reserved and active: `coding_agent`, `task_family`, `executor_role`, `executor_routing`, `task_execution_run`.
  - do not collapse `processing_run` into task execution: `processing_run` is a voice extraction/processing occurrence, while `task_execution_run` is an executor-layer occurrence for a task.
  - dual-stream execution semantics are fixed in `ontology/plan/voice-dual-stream-ontology.md`: draft tasks remain `task[DRAFT_10]`, `context_enrichment` is required before launch, `human approval` is launch authorization (not final acceptance), and execution must materialize through `executor_routing` -> `task_execution_run` -> `outcome_record` (currently usually `artifact_record`) -> `acceptance_evaluation`.

## Technology Stack Constraints

**Backend:**
- Node.js + Express
- TypeScript (ES modules)
- Socket.IO
- MongoDB driver
- dotenv, cookie-parser, multer

**Frontend:**
- React (functional components)
- Vite
- TypeScript
- Zustand
- Ant Design
- Tailwind CSS (PostCSS via `@tailwindcss/postcss`)
- Axios
- React Router
- dayjs

**Testing:**
- Jest (frontend + backend)

## Development Workflow

### Build & Run
- Preferred (PM2): `./scripts/pm2-backend.sh <dev|prod|local>` from repo root.
  - `dev`: builds `app` + `miniapp` with `build-dev`, builds backend, starts `copilot-backend-dev` and `copilot-miniapp-backend-dev`, then starts agents via `agents/pm2-agents.sh` when available.
  - `local`: builds `app` with `build-local`, `miniapp` with `build-dev`, builds backend, starts `copilot-backend-local` and `copilot-miniapp-backend-local`, then starts agents when available.
  - `prod`: builds `app` + `miniapp` with `build`, builds backend, starts `copilot-backend-prod` and `copilot-miniapp-backend-prod`, then starts agents when available; the same script must also recreate or restart `copilot-voicebot-workers-prod` / `copilot-voicebot-tgbot-prod` so VoiceBot runtimes do not stay missing after deploy, and must run `scripts/pm2-runtime-readiness.sh prod` as a fail-fast readiness gate.
  - post-deploy/reboot notify integration smoke command is canonical: `./scripts/voice-notify-healthcheck.sh --env-file backend/.env.production` (non-zero on non-2xx or transport failure).
- Validate environment files before startup: `./scripts/check-envs.sh`.
- Frontend build (manual): `cd app && npm install && npm run build` (outputs to `app/dist`).
- Miniapp build (manual): `cd miniapp && npm install && npm run build` (outputs to `miniapp/dist`).
- Backend build (manual): `cd backend && npm install && npm run build` then `npm run start` to serve on port 3002.
- Figma module build (manual): `cd figma && npm install && npm run build`.

### Service Execution Rules
- All long-running services (backend, miniapp backend, agents) MUST be started via PM2, NEVER using Vite dev server directly.
- Before starting a service, rebuild it with the appropriate mode for the target environment:
  - **production**: `npm run build` (default)
  - **development**: `npm run build-dev`
  - **localhost**: `npm run build-local` with local env overrides
- PM2 commands: `pm2 start <script> --name <service-name>`, `pm2 stop <name>`, `pm2 restart <name>`, `pm2 logs <name>`.
- When working from sandboxed Codex sessions, run shell scripts and PM2 commands through SSH on the target server (for example, `ssh p2 'cd /home/strato-space/copilot && ./scripts/pm2-backend.sh dev'`) to avoid local sandbox restrictions.

### Dev version (p2)
- Check env layout: `./scripts/check-envs.sh`.
- Start backend + miniapp backend + build assets: `./scripts/pm2-backend.sh dev`.
- Build frontend after each change: `cd app && npm install && npm run build-dev` (outputs to `app/dist`).
- Build miniapp after each change: `cd miniapp && npm install && npm run build-dev` (outputs to `miniapp/dist`).
- View in browser: `https://copilot-dev.stratospace.fun` (nginx serves `app/dist`).
- `VITE_AGENTS_API_URL` must use plain HTTP for `:8722` (fast-agent runs without TLS); using `https://` can fail with `ERR_SSL_PACKET_LENGTH_TOO_LONG`.
- Preferred target is loopback `http://127.0.0.1:8722` (bind `copilot-agent-services` to localhost only; do not expose `:8722` publicly).
- Agents PM2 runtime is canonical via the repo-local bootstrap `uv run --directory /home/strato-space/copilot/agents python run_fast_agent.py serve ...`; model selection remains config-driven through `agents/fastagent.config.yaml`, `create_tasks` card must not hardcode model override, and the bootstrap is where repo-local runtime model registrations/profiling hooks live.
- PM2 agents runtime may pin a repo-local Codex OAuth file via `CODEX_AUTH_JSON_PATH`; local/prod runtime can use `agents/.codex/auth.json` instead of depending on the host-global Codex auth file.
- Backend quota self-heal for `create_tasks` is canonical: on quota-class MCP failure the backend compares `/root/.codex/auth.json` with `agents/.codex/auth.json`, copies only when contents differ, restarts `copilot-agent-services` once via `agents/pm2-agents.sh`, then retries the MCP call once.
- Backend quota self-heal retry must wait for local agents MCP readiness (`http://127.0.0.1:8722/mcp`) after `copilot-agent-services` restart; immediate retries before readiness are a known `ECONNREFUSED` race.
- Invalid-key / `401 unauthorized` failures in agent-backed `create_tasks` are treated as the same recoverable auth/runtime drift class as quota-style failures.
- Auth sync and model sync are canonical:
  - source auth account lives in `/root/.codex/auth.json`
  - runtime auth copy lives in `agents/.codex/auth.json`
  - runtime `default_model` is pinned to `gpt-5.4-mini`
  - auth recovery may restart agents and restore the same `gpt-5.4-mini` default after sync
- Runtime key drift baseline for OpenAI-backed production services is documented in `docs/COPILOT_OPENAI_API_KEY_RUNTIME_STATE_2026-03-17.md` (PM2 runtime mask vs `backend/.env.production` value vs agents Codex OAuth mode).

### Code Organization
- Frontend code lives in `app/src/`.
- Miniapp code lives in `miniapp/src/`.
- Backend code lives in `backend/src/`.
- Figma indexing code lives in `figma/src/`.
- Agents code lives in `agents/`.
- Do not store build artifacts outside module directories.
- For `app/`, keep only TypeScript/TSX sources and avoid JS duplicates.
- Use `.env` files for environment-specific configuration; do not commit secrets.

## PM2 Services (prod/dev)
- PM2 runs the backend API and miniapp backend; frontend builds are served statically via Nginx.
- PM2 startup uses [scripts/pm2-backend.ecosystem.config.js](scripts/pm2-backend.ecosystem.config.js) with per-mode `env_file`.

### PM2 services (prod) -> repo paths
- `copilot-backend-prod` — Finance Ops backend API (`npm run start` with `backend/.env.production`).
- `copilot-miniapp-backend-prod` — Miniapp backend API (`npm run start:miniapp` with `backend/.env.production`).
- `copilot-voicebot-tgbot-prod` — TG bot runtime from `backend/dist/voicebot_tgbot/runtime.js` (`npm run start:voicebot-tgbot`) via `scripts/pm2-voicebot-cutover.ecosystem.config.js`; env source is `backend/.env.production`.
- `copilot-voicebot-workers-prod` — VoiceBot worker runtime from `backend/dist/workers/voicebot/runtime.js` (`npm run start:voicebot-workers`) via `scripts/pm2-voicebot-cutover.ecosystem.config.js`; env source is `backend/.env.production`.

### PM2 services (dev) -> repo paths
- `copilot-backend-dev` / `copilot-backend-local` — backend API (`npm run dev` with `backend/.env.development`).
- `copilot-miniapp-backend-dev` / `copilot-miniapp-backend-local` — miniapp backend API (`npm run dev:miniapp` with `backend/.env.development`).
- Ensure dev frontend builds exist before serving via Nginx: `cd app && npm run build-dev` and `cd miniapp && npm run build-dev`.

### PM2 services (figma standalone) -> repo paths
- `copilot-figma-indexer-dev` / `copilot-figma-indexer-prod` — Figma BullMQ/Mongo indexing runtime from `figma/dist/cli/index.js` (`serve:indexer`) via `figma/scripts/pm2-figma.ecosystem.config.cjs`.
- `copilot-figma-webhook-receiver-dev` / `copilot-figma-webhook-receiver-prod` — Figma webhook HTTP runtime from `figma/dist/cli/index.js` (`serve:webhooks`) via `figma/scripts/pm2-figma.ecosystem.config.cjs`.

## Product Notes (FinOps)
- FX rates live in `app/src/store/fxStore.ts` and drive RUB conversions across analytics, KPIs, and plan-fact tables.
- The plan-fact grid keeps at least one pinned month; users can pin up to 3 and can unpin the active month if another month remains pinned.
- Compact plan-fact `Value`, `Forecast`, and `Fact` RUB cells must stay single-line so monthly grid rows do not grow unpredictably from wrapped currency text.
- Plan-fact pages now use API-only data (no local mock/snapshot fallback in frontend store or analytics page).
- Plan-fact project edits are persisted via `PUT /api/plan-fact/project` (fields: `project_name`, `subproject_name`, `contract_type`, `rate_rub_per_hour`) and contract type updates are propagated to facts/forecasts.
- Forecast edits now require a non-empty comment, and monthly revision history is exposed through `GET /api/plan-fact/forecast-history` backed by `forecasts_project_month_history`.
- Expense attachments are served from `/uploads/expenses`.
- Guide directories use mock fallback data when automation APIs fail and expose a global Log sidebar from the Guide header.
- FinOps spec-source inventory and open scope questions are tracked in `docs/FINOPS_SPEC_DISCOVERY.md` until product scope is approved.

## Product Notes (OperOps/CRM)
- CRM components migrated from `automation/appkanban` live in `app/src/components/crm/`.
- CRM pages live in `app/src/pages/operops/` (CRMPage, PerformersPage, FinancesPerformersPage, ProjectsTree, TaskPage).
- CRM stores: `kanbanStore.ts` (tickets, epics, performers), `crmStore.ts` (UI state), `projectsStore.ts` (project tree), `requestStore.ts` (API).
- Socket.IO events for CRM: TICKET_CREATED, TICKET_UPDATED, TICKET_DELETED, EPIC_UPDATED, COMMENT_ADDED, WORK_HOURS_UPDATED.
- CRM routes accessible at `/operops/*` with OperOpsNav horizontal navigation.
- CRM Kanban task-detail links must use `id || _id`; records created without public `id` should still open `/operops/task/:taskId` correctly.
- OperOps project create/edit flow is canonical on dedicated routes `/operops/projects-tree/new` and `/operops/projects-tree/:projectId`; `ProjectsTree` should route project rows there instead of reopening inline create/edit modals.
- CRM performer filtering must be identifier-compatible (`_id` and legacy `id`), and project labels must resolve via `project_data`/`project_id`/`project` fallback chain.
- Ticket create/update diagnostics should log normalized `project/project_id/performer` payload values to speed up CRM incident triage.
- CRM work-hours joins are canonical on `ticket_db_id` (`automation_tasks._id`) across CRM routes, miniapp routes, and reporting services; `ticket_id` remains migration-only input and must be normalized before writes.
- CRM task comments are canonical through `automation_comments`: ticket reads aggregate `comments_list`, and `POST /api/crm/tickets/add-comment` must resolve canonical task ids plus optional session-aware metadata (`comment_kind`, `source_session_id`, `discussion_session_id`, `dialogue_reference`).
- Task attachments are canonical across CRM and Miniapp tickets:
  - CRM routes: `POST /api/crm/tickets/upload-attachment`, `GET /api/crm/tickets/attachment/:ticket_id/:attachment_id`, `POST /api/crm/tickets/delete-attachment`,
  - Miniapp routes: `POST /tickets/upload-attachment`, `GET /tickets/attachment/:ticket_id/:attachment_id`,
  - storage is normalized through `backend/src/services/taskAttachments.ts` under `uploads/task-attachments` (override `TASK_ATTACHMENTS_DIR`),
  - allowed extensions are `pdf/docx/xlsx/png/jpg/jpeg/txt/zip`, max file size is `100MB`,
  - multipart uploads with mojibake UTF-8 filenames must be normalized back to readable UTF-8 before persistence/response payloads.
- Miniapp `/tickets` route in debug mode (`IS_MINIAPP_DEBUG_MODE=true`) reads through raw DB to preserve test-ticket visibility when debug runtime boundaries diverge from default API filters.
- Miniapp backend can optionally launch a dedicated Telegram bot when `TG_MINIAPP_BOT_TOKEN` is configured: `/start` and `/miniapp` return an inline WebApp button, `/get_info` returns chat diagnostics, and runtime shutdown stops the bot explicitly.
- OperOps Codex details card now uses a shared issue-id token renderer (`link + copy`) for `Issue ID` and `Relationships`, and relationship rows include status pictograms (`open/in_progress/blocked/deferred/closed/fallback`).
- OperOps Codex relationship groups are normalized as `Parent`, `Children`, `Depends On (blocks/waits-for)`, and `Blocks (dependents)` for deterministic dependency semantics.
- Shared Codex table status tabs now use strict segmentation `Open | In Progress | Deferred | Blocked | Closed | All` with per-tab counters; deferred/open are no longer merged heuristically.
- Single-issue OperOps Codex loads must tolerate `bd` out-of-sync recovery failures the same way list loads do: if `bd show` reports stale JSONL and `bd sync --import-only` fails with `bufio.Scanner: token too long`, the backend should fall back to direct `.beads/issues.jsonl` parsing instead of returning `502`.
- Voice Codex inline details must fetch the canonical single-issue payload (`POST /api/crm/codex/issue`) on drawer open; list-row payloads are not sufficient for comments/details parity with the standalone OperOps page.
- Voice-linked task payloads may include `discussion_sessions[]` / `discussion_count`; OperOps `TaskPage` should expose those links as a `Discussed in Sessions` timeline instead of hiding multi-session discussion context.
- OperOps `TaskPage` must keep hook order stable across loading/not-found/loaded renders; discussion-session memoization cannot live below early returns or the page may crash with React hook-order errors.
- OperOps main task navigation is status-first:
  - top-level tabs are `Draft`, `Ready`, `In Progress`, `Review`, `Done`, `Archive`, and `Codex`,
  - lifecycle counts should be shown inline in those tab labels instead of duplicated summary widgets,
  - duplicate top summary widgets with the same lifecycle labels/counts are a bug, not an accepted transition state,
  - the `Draft` tab is a normal status-first CRM surface; legacy voice backlog grouping is historical reference only,
  - accepted Voice tasks are treated as `Ready` work instead of a separate `Backlog` semantic bucket.
- OperOps Draft/Archive visibility is operator-controlled with explicit depth presets `1d / 7d / 14d / 30d / ∞`; the default fast list/count surface is `1d`, while `∞` means an unbounded read.
- Temporal coverage/date-depth planning wave is closed: `plan/closed/2026-26-03-voice-date-depth-and-range-fix-spec.md` is `Status ✅Closed`, and epic `copilot-xmcm` with child line `copilot-xmcm.*` is fully closed in `bd`.
- Media-bearing attachment transcription planning now has an explicit BD DAG decomposition in `plan/2026-03-27-voice-media-attachment-transcription-spec.md` (`copilot-qtcp` + `.1..7`) and should be executed as bounded swarm waves.
- OperOps CRM list performance is split by payload mode: `/api/crm/tickets` list views use `response_mode=summary`, while heavy ticket fields (`work_data`, `comments_list`, `attachments`, discussion/source payloads) are hydrated lazily through detail reads when drawers or editors open; Draft/Archive summary and status-count reads may prefilter recency through lightweight source/timestamp projections before trimming transient linkage fields from the response payload.

## Product Notes (VoiceBot)
- VoiceBot backend routes live in `backend/src/api/routes/voicebot/`.
- All voicebot routes are guarded by `authMiddleware` + `requireAdmin` (SUPER_ADMIN/ADMIN only).
- Route modules:
  - `sessions.ts` - Session CRUD, CRM integration, permissions
  - `transcription.ts` - Get/update transcriptions
  - `persons.ts` - Persons CRUD with permission guards
  - `permissions.ts` - User roles and permissions management
  - `llmgate.ts` - OpenAI prompt execution (stub - requires `openai` package)
  - `uploads.ts` - Audio file upload with multer
- Permission system: `backend/src/permissions/permission-manager.ts` (ported from voicebot).
- Socket.IO namespace: `/voicebot` for real-time session updates.
- Voice upload path must broadcast `new_message` and `session_update` into room `voicebot:session:<session_id>` immediately after successful upload.
- Voice upload API now propagates `request_id` in both success and error payloads (`X-Request-ID` passthrough or generated), and backend logs each upload stage with the same correlation id.
- Voice upload must accept audio-only recorder blobs mislabeled as `video/webm` and normalize persisted/session-response MIME to `audio/webm`.
- Voice admin/person/project payloads may be enriched with Telegram chat/user data and project-performer memberships through `backend/src/services/telegramKnowledge.ts`; seed those records via `backend/scripts/seed-telegram-knowledge.ts` (`npm run telegram:knowledge:seed:{dry,apply}`).
- Incident-grade voice forensics is canonical through `backend/scripts/voicebot-session-forensics.ts` (prefer `npm run voice:session:forensics -- --session <id> --bundle-dir <dir>`): use it before ad hoc Mongo/PM2 spelunking for cross-runtime/session-state incidents, treat `processors_data.CREATE_TASKS` as auxiliary only, and use session-linked `automation_tasks` as canonical task state; detailed operator flow is in `docs/VOICE_SESSION_FORENSICS_PLAYBOOK.md`.
- Incident-grade session forensic bundles should include `index.json`, `index.md`, per-session JSON+Markdown reports, queue snapshot, PM2 log hits, and a `bd` verdict comment; incomplete bundles are not considered finished investigations.
- Telegram knowledge seeding now reuses shared routing-project extraction (`backend/src/utils/routingConfig.ts`) so routing topics, project names, and project aliases resolve consistently when one routing item carries multiple project sources.
- `POST /api/voicebot/project_performers` returns a permission-checked project payload plus linked performers sourced from `automation_project_performer_links` and `automation_telegram_*`.
- `POST /api/voicebot/project_performers` must tolerate projects whose linked performer ids resolve to zero active performer rows after lifecycle filtering; Telegram/performer enrichment must short-circuit empty selector inputs instead of issuing Mongo queries with empty logical arrays.
- Seed rollout and rollback steps for the Telegram knowledge slice are documented in `ontology/plan/telegram-knowledge-seed-rollout.md`.
- Categorization pipeline must emit `message_update` over websocket (through `SEND_TO_SOCKET` events queue) so Categorization tab updates without manual refresh.
- `CREATE_TASKS` realtime contract is session-room first: workers must emit `tickets_prepared` with canonical `session_id`; `socket_id` is optional and only narrows delivery to one socket when present.
- Socket events runtime must pass through non-object payloads for `tickets_prepared` (array-of-task contract) without object coercion.
- TS transcribe worker now emits `message_update` for both success and failure branches (including quota/missing-file retries) so Transcription UI updates live without refresh.
- OpenAI recovery-retry semantics are unified for transcription/categorization and processing loop repair: both `insufficient_quota` and `invalid_api_key` are recoverable retry codes with canonical retry metadata and operator-facing messages.
- `POST /api/voicebot/transcription/retry` is message-driven: it re-arms non-transcribed session messages (`to_transcribe=true`, attempts reset, retry delay cleared), clears session-level transcription error markers, and relies on canonical processing-loop queue kick.
- Post-transcribe garbage detection is now part of the worker contract (`backend/src/services/voicebot/transcriptionGarbageDetector.ts`, default model `gpt-5.4-nano`): garbage chunks are marked with `garbage_detection` metadata, skip categorization/`CREATE_TASKS` enqueue, and emit `transcription_garbage_detected` session log events.
- Transcription fallback rows with `transcription_error` must render metadata signature footer (`mm:ss - mm:ss, file.webm, HH:mm:ss`) when transcript text is absent, and this placeholder must be replaceable in place via realtime `message_update`.
- Frontend voice socket must connect to `/voicebot` namespace (not `/`) and subscribe via `subscribe_on_session`; otherwise live session updates will be dropped.
- `subscribe_on_session` must replay a `session_update.taskflow_refresh.possible_tasks` hint so reconnecting session pages refetch canonical possible-task state even if an earlier realtime hint was missed.
- Frontend voice socket reconnect flow must rehydrate current session and keep deterministic message ordering for `new_message`/`message_update` upserts.
- Backend API process owns socket event delivery for `voicebot--events-*` queue via dedicated runtime (`startVoicebotSocketEventsWorker`); standalone workers should not consume `EVENTS` queue.
- Runtime-tag aggregate scoping has been removed from operational read paths; nested `$lookup` joins are runtime-tag-agnostic until full environment-level DB cutover is complete.
- Socket `session_done` authorization is test-covered through `resolveAuthorizedSessionForSocket` export; keep socket handlers bound to backend performer/session auth checks only.
- `Done` path enforces one-shot auto-upload retry per pending chunk/session and surfaces manual retry for remaining failures.
- WebRTC page `Done` must stay enabled from `paused` in embedded Settings/Monitor contexts whenever active/session state exists, not only when the page URL carries `pageSession`.
- WebRTC FAB must surface a red `Mic 1 OFF` critical state during `recording` / `paused` / `cutting`, and missing saved Mic 1 devices must downgrade deterministically `LifeCam -> Microphone -> OFF`.
- WebRTC REST close warnings must include `session_id` in client logs so 404/403/5xx close incidents can be matched with backend access logs quickly.
- Inactive open sessions can be auto-closed by cron via `backend/scripts/voicebot-close-inactive-sessions.ts` (minutes-first operator surface, default `10`-minute inactivity threshold, latest session/message/session-log activity timestamps, canonical `DONE_MULTIPROMPT` flow, and missing-title generation through composite `create_tasks.session_name` before completion).
- Voice worker runtime owns scheduled `CLOSE_INACTIVE_SESSIONS` jobs; tune with `VOICEBOT_CLOSE_INACTIVE_SESSIONS_{ENABLED,INTERVAL_MS,TIMEOUT_MINUTES,BATCH_LIMIT}` rather than ad hoc cron copies.
- Summarize MCP dependency watchdog script (`backend/scripts/summarize-mcp-watchdog.ts`) is canonical for `session_ready_to_summarize` prerequisites: it probes required endpoint/service pairs (`fs`, `tg-ro`, `call`, `seq`, `tm`, `tgbot`) and in apply mode auto-heals only failed units (`start` inactive, `restart` active with endpoint `502`/unreachable diagnostics).
- Full-track archive chunks are tracked as `trackKind='full_track'` with metadata (`sessionId`, `mic`, `duration/start/end`) in voicebot runtime, but upload is intentionally disabled until diarization flow is introduced.
- Web upload route now returns structured oversize diagnostics (`413 file_too_large` with `max_size_bytes`/`max_size_mb`), and WebRTC upload errors normalize backend payloads into concise UI-safe messages.
- Upload flow consumes `pending_image_anchor_message_id`/`pending_image_anchor_oid`: first uploaded audio chunk is linked via `image_anchor_message_id`, and pending marker fields are cleared from the session.
- Voice message grouping keeps image-anchor rows attached to the next transcription message block and suppresses duplicate standalone anchor-only rows.
- Transcription table rows now render inline image previews for image attachments (segmented and fallback row modes).
- Web pasted images are uploaded to backend storage through `POST /api/voicebot/upload_attachment` (alias `/api/voicebot/attachment`) and persisted under `backend/uploads/voicebot/attachments/<session_id>/<file_unique_id>.<ext>`.
- Screenshort cards must keep canonical `https://...` URLs fully visible, while `data:image/...;base64,...` values are rendered in truncated preview form (`data:image/...;base64,...`) with Copy action preserving the full raw URL.
- Session page should not expose a separate `Возможные задачи` top tab; draft rows belong to the unified `Задачи` surface under the `DRAFT_10` / `Draft` lifecycle subtab, with the current compact implementation preserved but the canonical ontology target remaining a review-workspace / master-detail surface rather than a separate top tab.
- The lifecycle subtab axis inside `Задачи` is fixed (`Draft / Ready / In Progress / Review / Done / Archive`) and remains visible even when every bucket count is zero.
- The parent `Задачи` count must include all lifecycle buckets, including `Draft`, and it must be computed from the canonical exact-key lifecycle buckets only.
- Voice tab green activity indicators (`Транскрипция`, `Категоризация`, `Задачи`) are runtime-only signals: inactive/closed/finalized sessions must suppress stale dots even when historical payloads are incomplete.
- `task_type_id` is optional in the Possible Tasks table; required-field validation now blocks only `name`, `description`, `performer_id`, and `priority`.
- Voice Possible Tasks session table no longer exposes editable `task_type_id` and `dialogue_tag` columns; required create contract remains `name/description/performer_id/priority` with optional project link.
- Draft read semantics are canonical on session-linked `DRAFT_10` task docs: session APIs must dedupe by row lineage, surface `discussion_sessions[]` / `discussion_count`, and treat `source_kind` plus stale refresh markers as compatibility metadata only.
- Draft visibility horizon is an operational read/workqueue policy, not a second lifecycle:
  - `DRAFT_10` storage truth remains canonical and full-history by default,
  - callers may pass `draft_horizon_days` to bound voice-derived Draft reads/workqueues by recency of the linked voice-discussion window,
  - the default recency anchor is linked session discussion timestamps; `task.updated_at` is not the default anchor and may be used only under an explicitly chosen recall-first policy,
  - for session-scoped Draft reads, the window is evaluated in both directions around the current session against the task's linked discussion range (`first_linked_session_at .. last_linked_session_at`),
  - if `draft_horizon_days` is omitted, Draft reads remain unbounded,
  - `READY_10+` remains full-history regardless of any Draft horizon policy.
- Draft enrichment surface is description-first Markdown with canonical sections `## description`, `## object_locators`, `## expected_results`, `## acceptance_criteria`, `## evidence_links`, `## executor_routing_hints`, `## open_questions`.
- `Ready+` enrichment is comment-first: accepted task `name` / `description` remain the launch snapshot, and follow-up clarification should append comments instead of auto-rewriting the execution brief.
- Accepted session-task reads are canonical on `POST /api/voicebot/session_tasks` with `{ session_id, bucket: 'Ready+' }`: the bucket is accepted-only, may return only non-draft lifecycle rows, and `DRAFT_10` leakage there is a contract violation (`copilot-f6z4`), not compatibility behavior.
- Session-scoped taskflow parity is now canonical across backend + MCP + Actions:
  - list: `POST /api/voicebot/session_tasks` with `{ session_id, bucket: 'Draft' }` as strict canonical `DRAFT_10` draft baseline; accepted bucket is `Ready+`, codex bucket is `Codex`, and lowercase aliases are not part of the live contract; optional `draft_horizon_days` tunes visibility policy without changing storage truth
  - create regular: `create_session_tasks`
  - create codex: `create_session_codex_tasks`
  - delete row: `delete_session_possible_task`
- Assistant/taskflow runbook is fixed to `discuss -> preview -> apply -> verify`:
  - preview is local-only and must not mutate backend state
  - if all rows reject locally, apply must fail locally without POSTing
  - only `created_task_ids` are considered committed
- Taskflow mutation result contract is fixed:
  - `operation_status`: `success | partial | failed`
  - `rejected_rows`: machine-readable row errors
  - `removed_row_ids`: only rows actually removed from `CREATE_TASKS`
  - `codex_issue_sync_errors`: present only when Codex/BD sync fails after create
- Canonical taskflow row locator priority is `row_id -> id -> task_id_from_ai`; `task_id_from_ai` is legacy fallback metadata, not the primary mutation identity.
- Realtime refresh contract is fixed:
  - backend emits `session_update.taskflow_refresh` with per-list flags `possible_tasks/tasks/codex/summary`
  - `save_possible_tasks` may include optional `refresh_correlation_id` and `refresh_clicked_at_ms`, and backend refresh hints must pass these fields through unchanged for end-to-end diagnostics
  - frontend consumes the hint without full-page reload
  - refresh tokens must increment additively so repeated hints remain concurrency-safe
- `CREATE_TASKS` persistence in API/worker paths is strict canonical `id/name/description/priority/...`; runtime fallback for legacy human-title keys is disabled.
- Manual `POST /api/voicebot/generate_possible_tasks` and background `CREATE_TASKS` worker refresh must share the same composite side effects: session `summary_md_text` / `review_md_text` / generated `session_name` / `project_id`, Ready+ comment enrichment, Codex note enrichment, processor success markers, and `session_update.taskflow_refresh.summary` when summary text is produced.
- `incremental_refresh` preserves unmatched draft candidates as `source_data.refresh_state='stale'` compatibility rows instead of hard-deleting them; `full_recompute` remains the explicit destructive refresh mode.
- `create_tasks` prompt is compact-session-first: it must tolerate sparse project cards, current Mongo possible-task rows (`VOICE_BOT` / `voice_possible_task` / empty `project_id` or `performer_id`), and split sequential deliverables instead of collapsing them into one task.
- Backend `runCreateTasksAgent(...)` must derive a bounded `project_crm_window` from session/message bounds using `VOICEBOT_PROJECT_CRM_LOOKBACK_DAYS` (default `14`, backend clamp `1..30`) and keep project-wide CRM enrichment bounded; unbounded project CRM is not part of the active contract.
- Historical CREATE_TASKS payload migration (legacy human-title keys -> canonical schema) is executed via `backend/scripts/voicebot-migrate-create-tasks-schema.ts` and archived in `docs/archive/VOICEBOT_CREATE_TASKS_MIGRATION.legacy.md`.
- Composite `create_tasks` output is the canonical runtime contract for session naming; legacy standalone title-agent cards are no longer part of the active execution path.
- The offline title-generation utility `backend/scripts/voicebot-generate-session-titles.ts` now uses the same quota-recovery rule and compare-before-copy guard as backend `create_tasks`.
- Session summary persistence is canonical:
  - backend `POST /api/voicebot/save_summary` validates `{session_id, md_text}` and writes `summary_md_text` + `summary_saved_at`,
  - `summary_correlation_id` / `correlation_id` may be supplied or reused from the session and must reconcile a pending `summary_save` audit row to `done` instead of inserting a duplicate event,
  - route emits realtime `session_update.taskflow_refresh.summary`,
  - frontend binds `summary_md_text` to the top-level `Саммари` tab instead of rendering a second summary panel under `Категоризация`.
- Session-title generation is fail-fast and traceable:
  - frontend title generation uses stage-level timeouts and `finally` cleanup so `Генерирую заголовок` cannot spin forever,
  - backend composite analyzer path logs `session_name` generation correlations with `requestId` + `session_id` for incident triage.
- Live meeting possible-task generation is canonical:
  - session header exposes `Tasks` before `Summarize`,
  - session-page `Tasks` button calls backend `POST /api/voicebot/generate_possible_tasks`,
  - backend delegates generation to `runCreateTasksAgent(...)`, so server-side quota recovery and auth/model sync rules apply to this UI path,
  - the agent may enrich context through MCP `voice` and `gsh`,
  - manual refresh carries `refresh_correlation_id` / `refresh_clicked_at_ms` from UI click to backend completion log and realtime hint for end-to-end latency diagnostics,
  - backend persists possible tasks into `automation_tasks` through `generate_possible_tasks` / `save_possible_tasks` / `process_possible_tasks`,
  - in the current wave, `save_possible_tasks` and `session_tasks(bucket='Draft')` are the first real ontology-backed runtime slice for `automation_tasks`: write-time persistence uses the strict Draft-master scalar subset through the card-backed collection adapter with card-derived value/type/domain checks, while read-time validation keeps legacy compatibility for historical `source_kind='voice_session'` rows and candidate-pool scans may drop invalid/unrelated Draft rows instead of aborting the current session persist; structured compatibility payloads (`source_data`, `dependencies`, `dependencies_from_ai`, `status_history`, `task_status_history`, `comments_list`) and overlays (`relations`, `parent`, `children`, `discussion_sessions`) remain manual until their ontology contract is promoted,
  - `process_possible_tasks` now promotes selected rows into `READY_10` while keeping draft rows in `DRAFT_10`,
  - selected rows leave draft views without being soft-deleted,
  - the resulting UI semantics are unified under `Задачи` rather than a separate `Возможные задачи` tab,
  - session payload fallback is not a valid Draft read path,
  - backend-side quota recovery now avoids no-op agent restarts by comparing auth files before copying/restarting,
  - the agent must not route execution through `StratoProject`.
- Manual `Summarize` must not hard-fail just because a session has no `project_id` and no default `PMO` project exists; backend should continue with `project_id=null`, and the frontend should surface the backend error text instead of a raw `AxiosError`.
- Voice session header top action row owns both `Скачать Транскрипцию` and `Загрузить аудио`; `SessionStatusWidget` is status-only and must not keep a second upload control.
- `Tasks` and `Summarize` are session/header actions and belong in the right header action cluster before `Запустить произвольный промпт`; they are not recording controls and should not live inside the left `New / Rec / Cut / Pause / Done` strip.
- Voice and OperOps task displays should render target labels (`Draft`, `Ready`, `In Progress`, `Review`, `Done`, `Archive`) through the shared display-layer mapping rather than exposing raw stored labels such as `Progress 10` or `Review / Ready`.
- Historical Voice/CRM legacy status values from the task-surface spec have already been cleaned out of the live `task_status` field in Mongo; the checked-in migration helpers were removed after the cleanup wave completed.
- If a session-scoped non-codex task row somehow lands outside the target task-status axis again, backend must expose it through a temporary `Unknown` bucket instead of dropping it from `Задачи`.
- The `Unknown` subtab is visible only when `count > 0`; otherwise the fixed lifecycle axis remains `Draft / Ready / In Progress / Review / Done / Archive`.
- The top-level `Задачи` badge must not render a placeholder `0` before `session_tab_counts` resolves.
- Voice/OperOps lineage and task-reference semantics are fixed:
  - accepted-task filtering must match `source_data.voice_sessions[].session_id` in addition to authoritative session refs stored in `source_ref` / `external_ref`; otherwise repaired or migrated rows can disappear from session-scoped task views,
  - Mongo `_id` is the only durable internal row identity,
  - `external_ref` is the authoritative source reference; when the source system exposes a durable source id, `external_ref` must be unique per bd issue and no two bd issues may share the same `external_ref`,
  - `source_ref` is the authoritative OperOps self URL (`/operops/task/<mongo_id>`) for materialized task rows,
  - if a materialized OperOps task keeps its self-link in `source_ref`, voice-session linkage must use `external_ref` for session matching and must not treat `/operops/task/...` self-links as voice-session refs,
  - `bd_external_ref` is a separate bd sync key and must not replace the `external_ref` / `source_ref` contract.
- Accepted Voice task reuse must preserve the original `created_at`; lineage-based updates may refresh task content/state, but must not rewrite row creation time.
- Accepted-task reads and `session_tab_counts` must ignore stale compatibility rows (`source_data.refresh_state='stale'`) so live status counts and non-draft task views stay aligned with the canonical draft baseline.
- Transcript segment `edit/delete/rollback` routes must requeue `CREATE_TASKS` in incremental-refresh mode so manual transcript corrections do not leave possible-task candidates stale.
- Done-flow summarize pipeline now propagates `summary_correlation_id` and writes summary audit events (`summary_telegram_send`, `summary_save`) with idempotency keys for retry-safe diagnostics.
- Voice metadata signatures and transcription fallback footers must normalize UTF-8-as-Latin1 mojibake filenames from message/attachment metadata before rendering `file.webm` labels.
- Voice-created Codex BD issues therefore encode per-task uniqueness in `external_ref=https://copilot.stratospace.fun/voice/session/<id>#codex-task=<task-id>`, while human-readable source text stays on the plain authoritative session URL.
- `create_tickets` must not blanket-delete unrelated `codex_task` rows by session before bd sync; adjacent direct Codex task docs from the same source session must survive.
- TS voice workers run deterministic pending-session scans via scheduled `PROCESSING` jobs; `processingLoop` must keep `is_waiting: { $ne: true }` semantics to avoid skipping unset rows.
- `processingLoop` now prioritizes sessions discovered from pending messages (even when `is_messages_processed=true`), requeues categorization after quota cooldown, and falls back to global runtime queues when handler-local queues are absent.
- Finalization backlog scan should prioritize newest sessions (`updated_at`/`_id` descending) with an expanded scan window so stale rows do not starve fresh closed sessions.
- TS transcribe worker deduplicates repeated chunk uploads by file hash (`file_hash`/`file_unique_id`/`hash_sha256`) and reuses existing transcription payload before calling OpenAI.
- Attachment-origin audio/video payloads now follow the same payload-first transcription contract as voice chunks: ingress/session reads/realtime payloads must normalize `primary_payload_media_kind`, `primary_transcription_attachment_index`, `classification_resolution_state`, `transcription_eligibility`, `transcription_processing_state`, skip/basis fields, and attachment-level projection metadata.
- Pending attachment classification is explicit: `POST /api/voicebot/transcription/resolve_classification` is the operator override path, `processingLoop` / `restart_corrupted_session` must preserve `pending_classification | pending_transcription | classified_skip | transcription_error` semantics instead of blanket `to_transcribe=true`, and resolved ineligible media stays skipped until classification changes.
- TS transcribe worker now supports media-bearing attachments end-to-end: attachment transport projection can promote nested Telegram anchors to top-level transport fields, video payloads are staged to mono 16k Opus via `ffmpeg` before ASR, deterministic `transcription_job_key` guards demote stale attachment jobs atomically, and legacy `legacy_attachment` placeholders can be repaired through `repairLegacyAttachmentMediaProjection` plus `POST /api/voicebot/repair_legacy_attachment_media`.
- Voice workers schedule `CLEANUP_EMPTY_SESSIONS` on `VOICEBOT_QUEUES.COMMON`; cleanup marks stale empty sessions (`message_count=0`) as `is_deleted=true` with configurable cadence/age/batch limits via env.
- Voice sessions list supports `include_deleted` server filter and frontend `Показывать удаленные`; creator/participant filters drop numeric identity placeholders so only human labels are shown.
- Sessions-list visibility contract is canonical in runtime and tests: non-deleted sessions with `is_active=false` and `message_count=0` remain hidden; parity fixtures must mock message-count aggregates explicitly.
- Voice sessions list must force a refetch when `include_deleted` intent changes during an in-flight list load; loading guard should not block `force=true` mode sync.
- Voice sessions list fetch must stay single-shot with respect to metadata hydration: project/person hydration must not retrigger `sessions/list`, and canonical row ordering belongs in the store rather than in an extra page-level resort pass.
- Voice sessions list backend contract must avoid per-row fan-out work: `message_count` and session task counters should be resolved in bounded batch reads, and `automation_voice_bot_messages.session_id` is a required startup index for the list path.
- Voice sessions list supports bulk delete for selected non-deleted rows (`Удалить выбранные` with confirmation) while preserving row-click navigation behavior.
- Voice session task subtabs are new-contract only: backend `voicebot/session_tab_counts` must return ordered `status_counts`, and clients must not rely on legacy `tasks_work_count` / `tasks_review_count` fields or hardcoded `Work/Review` splits.
- Frontend session task tabs must map backend status labels back to canonical CRM status keys before passing filters into `CRMKanban`; do not pass human-readable labels directly as task-status filter values.
- Categorization table contract is now `Time | Audio | Text | Materials`; legacy `Обработка`/processing column rendering path was removed.
- Categorization rows use stable identity (`row_id`/`segment_oid` first, deterministic fallback key second), so row selection/actions are row-local and collision-safe.
- Categorization row actions now include Copy/Edit/Delete in the frontend and call backend routes `POST /api/voicebot/edit_categorization_chunk` and `POST /api/voicebot/delete_categorization_chunk`.
- Categorization mutation routes return deterministic validation/runtime errors (`invalid_row_oid`, `message_session_mismatch`, `ambiguous_row_locator`, `row_already_deleted`, etc.) and emit realtime `message_update` + `session_update` on success.
- Deleting the last active categorization row in a message now cascades transcript-segment delete with compensating rollback if log persistence fails, to avoid partial state.
- Categorization materials are rendered only in the dedicated Materials column; image-only blocks remain visible without image-as-text rows.
- Categorization metadata signature is rendered once per message block footer (`source_file_name + HH:mm:ss`) instead of repeating per row.
- Categorization row-local visual contract keeps blue selection highlight only (no extra material-target grid ring), and typography is increased for readability in dense sessions.
- Notify worker (`backend/src/workers/voicebot/handlers/notify.ts`) now supports both HTTP notify transport and local hooks parity:
  - HTTP path uses `VOICE_BOT_NOTIFIES_URL` + `VOICE_BOT_NOTIFIES_BEARER_TOKEN`,
  - local hooks use `VOICE_BOT_NOTIFY_HOOKS_CONFIG` (YAML/JSON; default `./notifies.hooks.yaml`; empty value disables),
  - per-hook stdout/stderr logs are persisted to `VOICE_BOT_NOTIFY_HOOKS_LOG_DIR` (default `./logs/voicebot-notify-hooks`),
  - writes `notify_hook_started`, `notify_hook_failed`, `notify_http_sent`, `notify_http_failed` into `automation_voice_bot_session_log`,
  - `notify_hook_started.metadata.log_path` stores exact hook-run log file path for diagnostics.
- Session payload normalization now removes stale categorization rows that reference already deleted transcript segments (including punctuation/spacing variants), and persists cleanup on read.
- Session payload normalization now force-clears all categorization rows when every transcript segment in a message is marked `is_deleted=true`, preventing orphan categorization tails after full transcript cleanup from UI.
- Categorization handler must treat non-text placeholders (`image`, `[Image]`, `[Screenshot]`) as non-blocking: mark message as processed with empty categorization and emit `message_update` for realtime consistency.
- WebRTC unload persistence now writes non-recording states as `paused` to prevent stale `recording` state recovery after refresh/unload races.
- Transcription/Categorization tables expose explicit chronological direction toggle (up/down) and persist user preference in `sessionsUIStore` local storage.
- Voice task creation UI accepts missing `task_type_id` in task/ticket entry points (`TasksTable`, `TicketsPreviewModal`).
- MCP proxy stubs: `backend/src/services/mcp/` (requires `@modelcontextprotocol/sdk`).
- Workers run as a separate TypeScript service (`npm run start:voicebot-workers` / `npm run dev:voicebot-workers`); see `backend/src/workers/README.md`.
- Agents are NOT included - run as separate Python service (see `backend/src/agents/README.md`).
- Voice UI is native in the Copilot app under `/voice/*` (no iframe embed).

### VoiceB Environment Variables
```
# Optional for JWT socket auth
APP_ENCRYPTION_KEY=your-secret-key

# Voice notify transport (call-actions /notify)
VOICE_BOT_NOTIFIES_URL=
VOICE_BOT_NOTIFIES_BEARER_TOKEN=

# Optional local notify hooks config (YAML/JSON)
# unset -> ./notifies.hooks.yaml
# empty string -> disabled
VOICE_BOT_NOTIFY_HOOKS_CONFIG=./notifies.hooks.yaml
# Optional hooks execution logs directory
VOICE_BOT_NOTIFY_HOOKS_LOG_DIR=./logs/voicebot-notify-hooks

# Optional for MCP proxy
MCP_SERVER_URL=http://localhost:3001
MCP_SESSION_TIMEOUT=1800000
```

### VoiceBot Socket.IO Events
- `subscribe_on_session` - Subscribe to session updates
- `unsubscribe_from_session` - Unsubscribe from session
- `session_done` - Server-side/internal close-status surface only; browser clients must not emit it and must initiate close via `POST /api/voicebot/session_done`
- `post_process_session` - Trigger post-processing
- `new_message` - Broadcast a newly materialized session message
- `message_update` - Broadcast transcription/categorization progress for an existing message
- `session_update` - Broadcast canonical session/taskflow updates
- `session_status` - Broadcast session status changes

## Planning Artifacts Placement
- Voice migration planning artifacts synced from `voicebot/plan` live in `docs/voicebot-plan-sync/`.
- Primary migration execution plans are:
  - `docs/MERGING_PROJECTS_VOICEBOT_PLAN.md`
  - `docs/MERGING_FRONTENDS_VOICEBOT.PLAN.md`
  - `docs/PLAYWRIGHT_MIGRATION_MATRIX.md`
- These three docs are maintained from closed `bd list --all` issues and use status legend `[v] / [x] / [~]`.
- Required references include `docs/voicebot-plan-sync/implementation-draft-v1.md` and the session-level transcript versioning/event-log specs (`edit-event-log-plan.md`, `gpt-4o-transcribe-diarize-plan.md`).
- Copied planning references for local copilot workflow also live in `plan/session-managment.md` and `plan/gpt-4o-transcribe-diarize-plan.md`.
- Current discussion-linking / ontology follow-up specs also live in:
  - `ontology/plan/voice-dual-stream-ontology.md`
  - `plan/2026-03-18-voice-task-session-discussion-linking-spec.md`
  - `plan/voice-non-draft-discussion-analyzer-contract.md`
  - `plan/2026-03-21-voice-task-surface-normalization-spec-2.md`
- Local methodology/process scratchpad lives in `methodology/index.md`.
- Close-session policy deltas for voice migration work that change active repo rules should be reflected in `AGENTS.md` and `README.md`; dated outcomes and evidence belong in `CHANGELOG.md` with matching BD evidence.
- Frontend migration execution log is maintained in `docs/MERGING_FRONTENDS_VOICEBOT.PLAN.md`; keep it synchronized with current open/closed `bd` issues.

## Deployment Endpoints
- `copilot.stratospace.fun` → FinOps shell served from `app/dist` (host Nginx config in `deploy/nginx-host.conf`).
- `finops.stratospace.fun` → FinOps frontend (`app/dist`).
- Current server config mirrors `deploy/nginx-host.conf`: `/api` → `http://127.0.0.1:3002`, SPA root → `/home/strato-space/copilot/app/dist`.

## Portal Auth
- The Copilot portal uses `/api/try_login` and `/api/auth/me` on the Copilot backend.
- Frontend auth checks call the same-origin `/api/auth/me` and rely on the `auth_token` cookie.

## Testing
- Canonical test platform/test-catalog matrix is `platforms.json` at repo root.
- Unified repo-level runner:
  - `./scripts/run-test-suite.sh baseline`
  - `./scripts/run-test-suite.sh voice`
  - `./scripts/run-test-suite.sh full`
- Structured test procedure is documented in `docs/TESTING_PROCEDURE.md`.
- Module-level commands:
  - `app`: `npm run test`, `npm run test:serial`, `npm run e2e:install`, `npm run test:e2e`
  - `backend`: `npm run test`, `npm run test:parallel-safe`, `npm run test:serialized`
  - `miniapp`: `npm run test`, `npm run test:e2e`
- Default worker strategy:
  - `app`/`miniapp` unit tests use `--maxWorkers=${JEST_MAX_WORKERS:-50%}`
  - `backend` unit tests are split into parallel-safe + serialized groups (`BACKEND_JEST_MAX_WORKERS` tunes parallel-safe workers)
- `full` suite executes app e2e and voice e2e as explicit shard jobs from `platforms.json`.
- `app` E2E requires explicit `PLAYWRIGHT_BASE_URL` (default `http://127.0.0.1:3002`).
- Scope options:
  - unauthenticated smoke: `cd app && npm run test:e2e:unauth`
  - authenticated suite: `cd app && npm run test:e2e:auth` (requires `.env.test` creds)

### Type Safety Gate (Mandatory For Parent And Child Agents)
- Type-safety verification is REQUIRED for every code-changing task, including work done in child agents/subagents and temporary worktrees.
- Child agents MUST run the same TypeScript gate in their own workspace before reporting completion or handing off:
  - frontend changes (`app/*`): `cd app && npm run build` (or `npm run build-dev` / `npm run build-local` if the task is explicitly env-scoped),
  - backend changes (`backend/*`): `cd backend && npm run build`.
- If a task touches both frontend and backend, both build checks are mandatory.
- Do not close `bd` issue status as done and do not merge child-agent output until the required type-safety build checks pass.

## Session closeout history

- Historical close-session notes were removed from root `AGENTS.md` to keep this file operational rather than archival.
- Archived AGENTS-specific history now lives in `docs/AGENTS_SESSION_HISTORY.md`.
- New dated implementation history belongs in `CHANGELOG.md`; task/state tracking belongs in `bd`.

## Desloppify Reference

- Desloppify operator guidance has been moved out of root `AGENTS.md` into `docs/DESLOPPIFY_AGENT_GUIDE.md`.
- Treat that guide as the repo-local overlay for the installed Desloppify skill/manual; keep repo policy here and tool workflow there.
