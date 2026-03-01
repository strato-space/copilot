# Copilot Constitution

This repository hosts the Finance Ops console. Deprecated modules are archived in `old_code/`.

## Hard Product Decisions (Do Not Reinterpret)

These decisions are part of the current platform contract and must be preserved unless a new approved spec replaces them.

- Voice source of truth is Copilot:
  - UI: `https://copilot.stratospace.fun/voice/*`
  - API: local `/api/voicebot/*`
  - Legacy `voice.stratospace.fun` is not the implementation target for new changes.
- Session close is REST-first:
  - frontend/WebRTC closes via `POST /api/voicebot/session_done` (alias `/api/voicebot/close_session`),
  - browser must not be the source of `session_done` socket emits.
- Voice controls contract is fixed to `New / Rec / Cut / Pause / Done` with unified behavior between page toolbar and FAB.
- Full-track archive chunks are visible in monitor/runtime metadata but must not auto-upload until diarization rollout is enabled.
- Runtime isolation is mandatory for operational data:
  - use `runtime_tag`,
  - legacy rows without `runtime_tag` are treated as `prod`,
  - prod runtime accepts `prod` + `prod-*` family tags.
- Realtime UX is mandatory for voice:
  - upload must emit `new_message` + `session_update`,
  - processing must emit `message_update` for transcription/categorization progress.
- Session list behavior is contract-bound:
  - quick filters: `Все`, `Без проекта`, `Активные`, `Мои`,
  - deleted mode toggle (`Показывать удаленные`) is part of persisted filter state,
  - filter state is restored after navigation/reload.
- Voice/OperOps integration remains canonical:
  - `CREATE_TASKS` payload shape is `id/name/description/priority/...`,
  - `task_type_id` is optional in Possible Tasks UI.

## Critical Interfaces To Preserve

- Voice close: `POST /api/voicebot/session_done` (and alias `POST /api/voicebot/close_session`)
- Voice upload: `POST /api/voicebot/upload_audio`
- Voice attachment upload: `POST /api/voicebot/upload_attachment` (alias `/api/voicebot/attachment`)
- Voice realtime namespace: Socket.IO `/voicebot` + `subscribe_on_session`
- Canonical voice session URL pattern: `https://copilot.stratospace.fun/voice/session/:session_id`

## Minimal Agent Context (From 2026-02-26 and 2026-02-27)

Use these as non-negotiable implementation constraints derived from `origin/main` + `CHANGELOG.md`:

- Voice close path:
  - close requests are REST-only (`/api/voicebot/session_done`);
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
  - `processingLoop` and done-flow rely on shared orchestration and common queue kick.
- Ontology tooling path contract:
  - canonical scripts are under `ontology/typedb/scripts/*`;
  - do not add new backend-local duplicates under `backend/scripts` for TypeDB flow.

## Core Principles

### I. Type Safety & Modern TypeScript
All frontend and backend code MUST be written in TypeScript with strict type checking enabled.

**Rules:**
- Functions SHOULD have explicit type signatures for parameters and return values.
- Avoid `any` unless there is a clear, documented reason.
- ES modules are the default in backend (`type: module`).

### II. State Management Discipline
Shared UI state MUST live in Zustand stores.

**Rules:**
- Shared or persistent UI state belongs in `app/src/store/*`.
- Components should stay focused on presentation and orchestration.

### III. API-First & Auth
Frontend and backend MUST communicate via documented REST endpoints.

**Rules:**
- API responses follow a `{ data, error }` envelope from middleware.
- Authentication uses http-only cookies set by the Copilot backend.
- Auth is validated locally against `automation_performers` with `password_hash` and JWT.

### IV. Component Modularity & UI System
React components MUST be functional and organized by domain.

**Rules:**
- Page components live in `app/src/pages/`.
- Reusable UI components live in `app/src/components/`.
- Ant Design provides the base UI system; Tailwind CSS handles custom layout/styling.

### V. Real-time Communication Standards
Socket.IO is the real-time layer for updates.

**Rules:**
- Event names are defined in `backend/src/constants.ts`.
- Clients should explicitly subscribe/unsubscribe to channels.

### VI. Coding Principles (TypeScript)
Preferred engineering principles for this repo:
- Favor KISS: keep solutions straightforward, remove dead fallbacks.
- Apply SOLID: explicit interfaces, dependency injection over global mutable state.
- Keep functions small and cohesive; extract utilities instead of growing branch-heavy handlers.
- Avoid hidden fallback paths that obscure control flow.
- Make failures explicit with structured errors; no silent recovery.
- Never suppress exceptions silently (`catch {}` without logging is forbidden in backend paths).
- Log I/O and external integration errors even when execution continues.

### VII. API Type Discipline
- Validate public API payloads with Zod at route boundaries.
- Derive TypeScript callback/input types from schemas (`z.input<typeof schema>`).
- Do not rely on untyped `any` payloads for voice/finops/crm route contracts.

### VIII. Versioning & Dependency Policy
- Follow SemVer (`MAJOR.MINOR.PATCH`) for externally visible changes.
- `MAJOR`: breaking API/contract changes; `MINOR`: backward-compatible features; `PATCH`: fixes/refactors.
- Keep dependencies aligned with current stable releases; avoid opportunistic downgrades unless explicitly required.
- For runtime-scoped data paths, treat missing `runtime_tag` as `prod` only.

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
  - `prod`: builds `app` + `miniapp` with `build`, builds backend, starts `copilot-backend-prod` and `copilot-miniapp-backend-prod`, then starts agents when available.
- Validate environment files before startup: `./scripts/check-envs.sh`.
- Frontend build (manual): `cd app && npm install && npm run build` (outputs to `app/dist`).
- Miniapp build (manual): `cd miniapp && npm install && npm run build` (outputs to `miniapp/dist`).
- Backend build (manual): `cd backend && npm install && npm run build` then `npm run start` to serve on port 3002.

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

### Code Organization
- Frontend code lives in `app/src/`.
- Miniapp code lives in `miniapp/src/`.
- Backend code lives in `backend/src/`.
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

## Product Notes (FinOps)
- FX rates live in `app/src/store/fxStore.ts` and drive RUB conversions across analytics, KPIs, and plan-fact tables.
- The plan-fact grid keeps at least one pinned month; users can pin up to 3 and can unpin the active month if another month remains pinned.
- Plan-fact pages now use API-only data (no local mock/snapshot fallback in frontend store or analytics page).
- Plan-fact project edits are persisted via `PUT /api/plan-fact/project` (fields: `project_name`, `subproject_name`, `contract_type`, `rate_rub_per_hour`) and contract type updates are propagated to facts/forecasts.
- Expense attachments are served from `/uploads/expenses`.
- Guide directories use mock fallback data when automation APIs fail and expose a global Log sidebar from the Guide header.

## Product Notes (OperOps/CRM)
- CRM components migrated from `automation/appkanban` live in `app/src/components/crm/`.
- CRM pages live in `app/src/pages/operops/` (CRMPage, PerformersPage, FinancesPerformersPage, ProjectsTree, TaskPage).
- CRM stores: `kanbanStore.ts` (tickets, epics, performers), `crmStore.ts` (UI state), `projectsStore.ts` (project tree), `requestStore.ts` (API).
- Socket.IO events for CRM: TICKET_CREATED, TICKET_UPDATED, TICKET_DELETED, EPIC_UPDATED, COMMENT_ADDED, WORK_HOURS_UPDATED.
- CRM routes accessible at `/operops/*` with OperOpsNav horizontal navigation.
- CRM Kanban task-detail links must use `id || _id`; records created without public `id` should still open `/operops/task/:taskId` correctly.
- CRM performer filtering must be identifier-compatible (`_id` and legacy `id`), and project labels must resolve via `project_data`/`project_id`/`project` fallback chain.
- Ticket create/update diagnostics should log normalized `project/project_id/performer` payload values to speed up CRM incident triage.
- CRM work-hours joins are canonical on `ticket_db_id` (`automation_tasks._id`) across CRM routes, miniapp routes, and reporting services; `ticket_id` remains migration-only input and must be normalized before writes.

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
- Categorization pipeline must emit `message_update` over websocket (through `SEND_TO_SOCKET` events queue) so Categorization tab updates without manual refresh.
- TS transcribe worker now emits `message_update` for both success and failure branches (including quota/missing-file retries) so Transcription UI updates live without refresh.
- Frontend voice socket must connect to `/voicebot` namespace (not `/`) and subscribe via `subscribe_on_session`; otherwise live session updates will be dropped.
- Frontend voice socket reconnect flow must rehydrate current session and keep deterministic message ordering for `new_message`/`message_update` upserts.
- Backend API process owns socket event delivery for `voicebot--events-*` queue via dedicated runtime (`startVoicebotSocketEventsWorker`); standalone workers should not consume `EVENTS` queue.
- Runtime-scoped aggregate queries now auto-scope nested `$lookup` stages for runtime-tagged collections (`prod` family vs exact non-prod), so cross-runtime joins do not leak records.
- Socket `session_done` authorization is test-covered through `resolveAuthorizedSessionForSocket` export; keep socket handlers bound to backend performer/session auth checks only.
- `Done` path enforces one-shot auto-upload retry per pending chunk/session and surfaces manual retry for remaining failures.
- WebRTC REST close warnings must include `session_id` in client logs so 404/403/5xx close incidents can be matched with backend access logs quickly.
- Inactive open sessions can be auto-closed by cron via `backend/scripts/voicebot-close-inactive-sessions.ts` (uses latest session/message/session-log activity timestamps and runs `DONE_MULTIPROMPT` flow for sessions idle above threshold).
- Summarize MCP dependency watchdog script (`backend/scripts/summarize-mcp-watchdog.ts`) is canonical for `session_ready_to_summarize` prerequisites: it probes required endpoint/service pairs (`fs`, `tg-ro`, `call`, `seq`, `tm`, `tgbot`) and in apply mode auto-heals only failed units (`start` inactive, `restart` active with endpoint `502`/unreachable diagnostics).
- Full-track archive chunks are tracked as `trackKind='full_track'` with metadata (`sessionId`, `mic`, `duration/start/end`) in voicebot runtime, but upload is intentionally disabled until diarization flow is introduced.
- Web upload route now returns structured oversize diagnostics (`413 file_too_large` with `max_size_bytes`/`max_size_mb`), and WebRTC upload errors normalize backend payloads into concise UI-safe messages.
- Upload flow consumes `pending_image_anchor_message_id`/`pending_image_anchor_oid`: first uploaded audio chunk is linked via `image_anchor_message_id`, and pending marker fields are cleared from the session.
- Voice message grouping keeps image-anchor rows attached to the next transcription message block and suppresses duplicate standalone anchor-only rows.
- Transcription table rows now render inline image previews for image attachments (segmented and fallback row modes).
- Web pasted images are uploaded to backend storage through `POST /api/voicebot/upload_attachment` (alias `/api/voicebot/attachment`) and persisted under `backend/uploads/voicebot/attachments/<session_id>/<file_unique_id>.<ext>`.
- Screenshort cards must keep canonical `https://...` URLs fully visible, while `data:image/...;base64,...` values are rendered in truncated preview form (`data:image/...;base64,...`) with Copy action preserving the full raw URL.
- Session page should render `Возможные задачи` only when `processors_data.CREATE_TASKS.data` exists and user has `PROJECTS.UPDATE`; keep compact task-table contract (no standalone status/project/AI columns, keep `description`).
- `task_type_id` is optional in the Possible Tasks table; required-field validation now blocks only `name`, `description`, `performer_id`, and `priority`.
- `CREATE_TASKS` persistence in API/worker paths is canonicalized to `id/name/description/priority/...` shape; legacy keys (`Task ID`, `Task Title`, `Description`, `Priority`) are normalized on write and accepted for delete matching.
- TS voice workers run deterministic pending-session scans via scheduled `PROCESSING` jobs; `processingLoop` must keep `is_waiting: { $ne: true }` semantics to avoid skipping unset rows.
- `processingLoop` now prioritizes sessions discovered from pending messages (even when `is_messages_processed=true`), requeues categorization after quota cooldown, and falls back to global runtime queues when handler-local queues are absent.
- Finalization backlog scan should prioritize newest sessions (`updated_at`/`_id` descending) with an expanded scan window so stale rows do not starve fresh closed sessions.
- TS transcribe worker deduplicates repeated chunk uploads by file hash (`file_hash`/`file_unique_id`/`hash_sha256`) and reuses existing transcription payload before calling OpenAI.
- Voice workers schedule `CLEANUP_EMPTY_SESSIONS` on `VOICEBOT_QUEUES.COMMON`; cleanup marks stale empty sessions (`message_count=0`) as `is_deleted=true` with configurable cadence/age/batch limits via env.
- Voice sessions list supports `include_deleted` server filter and frontend `Показывать удаленные`; creator/participant filters drop numeric identity placeholders so only human labels are shown.
- Voice sessions list must force a refetch when `include_deleted` intent changes during an in-flight list load; loading guard should not block `force=true` mode sync.
- Voice sessions list supports bulk delete for selected non-deleted rows (`Удалить выбранные` with confirmation) while preserving row-click navigation behavior.
- Notify worker (`backend/src/workers/voicebot/handlers/notify.ts`) now supports both HTTP notify transport and local hooks parity:
  - HTTP path uses `VOICE_BOT_NOTIFIES_URL` + `VOICE_BOT_NOTIFIES_BEARER_TOKEN`,
  - local hooks use `VOICE_BOT_NOTIFY_HOOKS_CONFIG` (YAML/JSON; default `./notifies.hooks.yaml`; empty value disables),
  - per-hook stdout/stderr logs are persisted to `VOICE_BOT_NOTIFY_HOOKS_LOG_DIR` (default `./logs/voicebot-notify-hooks`),
  - writes `notify_hook_started`, `notify_hook_failed`, `notify_http_sent`, `notify_http_failed` into `automation_voice_bot_session_log`,
  - `notify_hook_started.metadata.log_path` stores exact hook-run log file path for diagnostics.
- Session payload normalization now removes stale categorization rows that reference already deleted transcript segments (including punctuation/spacing variants), and persists cleanup on read.
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
- `session_done` - Mark session as complete
- `post_process_session` - Trigger post-processing
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
- Close-session outcomes for voice migration work must always be reflected in `AGENTS.md`, `README.md`, and `CHANGELOG.md` with matching BD evidence.
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

<!-- BEGIN BEADS INTEGRATION -->
## Issue Tracking with bd (beads)

**IMPORTANT**: This project uses **bd (beads)** for ALL issue tracking. Do NOT use markdown TODOs, task lists, or comment-based checklists.

### Why bd?

- Dependency-aware: Track blockers and relationships between issues
- Git-friendly: Auto-syncs to JSONL for version control
- Agent-optimized: JSON output, ready work detection, discovered-from links
- Prevents duplicate tracking systems and confusion

### Quick Start

Issue IDs in this repo look like `copilot-<hash>`.

**Check for ready work:**

```bash
bd ready --json
```

**Create new issues:**

```bash
bd create "Issue title" --description="Detailed context" --type task --priority 2 --json
bd create "Issue title" --description="Follow-up found while working" --type bug --priority 1 --deps discovered-from:<issue-id> --json
```

**Claim and update:**

```bash
bd update <issue-id> --claim --json
bd update <issue-id> --priority 1 --json
```

**Complete work:**

```bash
bd close <issue-id> --reason "Completed" --json
```

### Issue Types

- `bug` - Something broken
- `feature` - New functionality
- `task` - Work item (tests, docs, refactoring)
- `epic` - Large feature with subtasks
- `chore` - Maintenance (dependencies, tooling)

### Priorities

- `0` - Critical (security, data loss, broken builds)
- `1` - High (major features, important bugs)
- `2` - Medium (default, nice-to-have)
- `3` - Low (polish, optimization)
- `4` - Backlog (future ideas)

### Workflow for AI Agents

1. **Check ready work**: `bd ready` shows unblocked issues
2. **Claim your task**: `bd update <id> --claim`
3. **Work on it**: Implement, test, document
4. **Discover new work?** Create linked issue:
   - `bd create "Found bug" --description="Details about what was found" --priority 1 --deps discovered-from:<parent-id>`
5. **Complete**: `bd close <id> --reason "Done"`

### Auto-Sync

bd keeps `.beads/issues.jsonl` in sync with your local DB:

- Exports to `.beads/issues.jsonl` after changes (5s debounce)
- Imports from JSONL when newer (e.g., after `git pull`)

Notes:
- `bd sync` updates JSONL but does **not** commit/push.
- With hooks installed (`bd hooks install`), `pre-commit` exports and stages `.beads/*.jsonl` automatically.
- `bd doctor --fix` may set `skip-worktree` flags for `.beads/*.jsonl`, so they might not appear in `git status` until staged by the hook; that's expected.
- Git hooks won't push for you; you still need `git push`.

### Important Rules

- ✅ Use bd for ALL task tracking
- ✅ Always use `--json` flag for programmatic use
- ✅ Link discovered work with `discovered-from` dependencies
- ✅ Check `bd ready` before asking "what should I work on?"
- ❌ Do NOT create markdown TODO lists
- ❌ Do NOT use external issue trackers
- ❌ Do NOT duplicate tracking systems

For more details, see `.beads/README.md`, run `bd quickstart`, or use `bd --help`.

<!-- END BEADS INTEGRATION -->

## Landing the Plane (Session Completion)

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   bd sync
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds

## Session closeout update
- Close-session refresh (2026-03-01 22:02):
  - Captured outstanding local docs commit `e577500` (`docs: fix Mermaid line breaks in visual recap diagram`) into close-session artifacts and prepared final release handoff.
  - Added `CHANGELOG.md` date block `2026-03-01` with explicit problem/feature/change entries for `docs/copilot-repo-visual-recap.html`.
  - Synced `AGENTS.md` and `README.md` session-closeout sections to keep closeout evidence aligned before final push and Telegram broadcast.
- Close-session refresh (2026-02-28 19:10):
  - `copilot-sxq1.14.8` scoped subjective batch execution is currently blocked by Codex runner quota/usage-limit response; issue kept `in_progress` with blocker evidence in notes.
  - Decomposed `copilot-sxq1.14.8` into six independent scope tasks to avoid monolithic run dependency:
    - `copilot-sxq1.14.8.1` (`app/src/store/**`)
    - `copilot-sxq1.14.8.2` (`app/src/hooks/**`)
    - `copilot-sxq1.14.8.3` (`app/src/services/**`)
    - `copilot-sxq1.14.8.4` (`app/src/utils/**`)
    - `copilot-sxq1.14.8.5` (`app/src/types/**`)
    - `copilot-sxq1.14.8.6` (`app/src/constants/**`)
  - Revalidated test contract on reorganized stage runner:
    - reran flaky shard `cd app && npm run test:e2e:voice:shard:1of2` -> pass (`13/13`);
    - canonical gate `./scripts/run-test-suite.sh full --fail-fast` -> `10/10 PASS`.
  - Refreshed `desloppify next` triage anchor: `review::.::holistic::abstraction_fitness::overuse_unknown_in_core_contracts::5ff2ecc1` (Tier 1).
- Closed testing modernization epic `copilot-2gs1` (stages 1-8): unified test runner now executes by parallel stages with fail-fast abort, backend tests are split into explicit parallel-safe and serialized groups, and app/voice Playwright suites run via shard jobs declared in `platforms.json`.
- Final full-suite benchmark for this wave: `163.97s -> 80.01s` (`+51.20%` wall-clock improvement).
- Closed `copilot-sxq1.8` and synced contract coverage with extracted helper modules in voice/frontend (`voicebotHttp`, `voicebotRuntimeConfig`, `codexTaskTimeline`) plus TaskPage sanitize rendering contracts.
- Updated backend contract/runtime tests for current route shapes and ESM execution:
  - imported `jest` from `@jest/globals` in `backend/__tests__/voicebot/runtime/sessionUtilityRuntimeBehavior.validation.test.ts`,
  - switched entrypoint path resolution to `import.meta.url` in `backend/__tests__/entrypoints/orphanedEntrypointsContract.test.ts`,
  - refreshed route-contract expectations in `backend/__tests__/api/crmCodexRouteContract.test.ts` and `backend/__tests__/voicebot/rowMaterialTargetRouteContract.test.ts`.
- Close-session validation summary:
  - `make test` target is not defined in this repository,
  - canonical suite passed: `./scripts/run-test-suite.sh full` (`10/10 PASS`),
  - type-safety builds passed: `cd app && npm run build`, `cd backend && npm run build`.
- Current `desloppify next` top unresolved item is Tier-2 exact duplicate `renderSanitizedHtml` between `app/src/pages/operops/TaskPage.tsx` and `miniapp/src/components/OneTicket.tsx`.
- Closed `copilot-4o2c` (Voice/OperOps Codex details parity): Voice inline `Подробности Codex задачи` now reuses the same `CodexIssueDetailsCard` as OperOps, preserving Description/Notes paragraph breaks and widening the drawer to `min(1180px, calc(100vw - 48px))`; updated contracts in `app/__tests__/voice/codexTasksInlineDetailsContract.test.ts` and `app/__tests__/operops/codexTaskPageContract.test.ts`.
- Closed `copilot-y9qy` (Wave 1 `desloppify` debug-logs + exact duplicates) with full swarm execution:
  - completed/closed all child tasks `copilot-y9qy.1`..`.19`,
  - removed Tier-1 tagged logs and unified duplicate helper clusters across app/backend/voice workers,
  - final full test gate passed (`app` `61/61` suites, `backend` `78/78` suites; total `543/543` tests).
- Closed `copilot-6obm` security wave after triage of 20 scanner findings:
  - fixed code paths for XSS sanitization, sensitive logging redaction, crypto-safe randomness, and guarded JSON parsing,
  - documented accepted-risk scanner set (`Desloppify — Accepted risk / false-positive: 6`) in `README.md`,
  - recorded triage notes and validation evidence in `copilot-6obm.1` before closing epic/task.
- Completed swarm wave execution for `top_open_in_progress_ids_by_priority`:
  - closed `copilot-g0bd` (backend Codex routing hardening) and `copilot-603` (placeholder/no-op),
  - executed verification-only audit notes for remaining `copilot-ztlv*` and `copilot-ib30` items without unapproved feature code changes.
- Hardened `POST /voicebot/create_tickets` Codex routing (`backend/src/api/routes/voicebot/sessions.ts`):
  - Codex classification now occurs before strict ObjectId performer validation,
  - alias performer IDs like `codex-system` route to bd sync without Mongo `insertMany`,
  - Codex identity detection extended to text fields (`name`, `real_name`, `full_name`, `username`, `email`, `corporate_email`),
  - `codex_task=true` is treated as Codex-safe path in task document checks.
- Extended backend regression coverage in `backend/__tests__/voicebot/sessionUtilityRuntimeBehavior.test.ts` for alias/name-based Codex routing and malformed non-Codex performer rejection.
- Verified blocker for `copilot-ib30`: browser flow still fails at `POST /api/voicebot/activate_session` (`ERR_EMPTY_RESPONSE`), so issue remains `in_progress` with captured runtime evidence.
- Added production resilience for Codex `bd` API calls: `backend/src/api/routes/crm/codex.ts` now detects `Database out of sync with JSONL`, runs `bd sync --import-only`, and retries `bd show/list` once to prevent transient `502` on valid issue IDs.
- Fixed OperOps Codex task page load compatibility (`copilot-f7w7`): `app/src/pages/operops/CodexTaskPage.tsx` now handles mixed `/api/crm/codex/issue` response envelopes (`issue`, `data`, array, plain object) and sends both `id`/`issue_id` for API contract parity; added `app/__tests__/operops/codexTaskPageContract.test.ts`.
- Fixed Voice Codex row UI artifact (`copilot-oh19`): removed inline visible `Открыть задачу в OperOps` text spill from session row content and preserved navigation via compact action/tooltip rendering; updated `app/__tests__/voice/sessionCodexTasksFilterOrderContract.test.ts`.
- Completed Wave 1 voice-operops-codex implementation batch and closed `copilot-b1k5`, `copilot-s33e`, `copilot-u976`, `copilot-xuec`; coordinating epic `copilot-bq81` remains `in_progress` for follow-up waves.
- Canonicalized performer lifecycle selection around `is_deleted` with legacy compatibility (`is_active`/`active`) and `include_ids` passthrough so historical assignees remain selectable/renderable in edit flows.
- Added project `git_repo` contract surface (API projection, CRUD normalization, frontend types/forms) and enforced Codex assignment guard in `POST /voicebot/create_tickets` (`400` when Codex performer is selected for a project without `git_repo`).
- Extended Telegram `@task` ingress so normalized payload is written to session (`processors_data.CODEX_TASKS.data`) and used to create Codex task in the same flow; added regression coverage in `tgIngressHandlers` tests.
- Increased Voice possible-task performer selector popup height with responsive desktop/mobile values and locked the UI contract in `possibleTasksDesignContract` test.
- Recovered local `bd` claim workflow by normalizing `dependencies.metadata` empty strings to `NULL` in `.beads/beads.db` (fixes SQLite `malformed JSON` during blocked-cache rebuild on `bd update --claim`).
- Removed `Src` and `Quick Summary` columns from Voice Categorization table (`copilot-eejo`) and added regression contract `app/__tests__/voice/categorizationColumnsContract.test.ts`.
- Switched voice session close initiation to REST-only client path: frontend store and WebRTC runtime now call `POST /api/voicebot/session_done` (`/close_session` alias supported), and browser-side `session_done` socket emits are removed.
- Added canonical backend close route in `backend/src/api/routes/voicebot/sessions.ts` with Zod request validation, permission/access checks, shared `completeSessionDoneFlow` orchestration, and realtime `session_status`/`session_update` broadcast.
- Added backend regression suite `backend/__tests__/voicebot/sessionDoneRoute.test.ts` to lock REST close contract, alias parity, and validation behavior.
- Updated Voice Sessions list ordering in `app/src/pages/voice/SessionsListPage.tsx`: active rows first, then latest voice activity timestamp, then creation time with mixed-format timestamp normalization.
- Fixed WebRTC FAB `Done` close reliability on `/voice/session/:id`: `session_done` now retries across socket namespace base candidates (origin + `/api` stripped variants), and close failure no longer silently clears session state.
- Added close-failure UX guard in WebRTC runtime: when `session_done` is not acknowledged, FAB returns to `paused` with explicit retry toast (`Failed to close session. Retry Done.`) instead of fake `idle/ready`.
- Updated regression contract `app/__tests__/voice/webrtcSessionDoneSocketContract.test.ts` to lock fallback namespace attempts and non-silent failed-close behavior.
- Added sessions-list persistence contract: quick tabs (`all/without_project/active/mine`) and filter state are restored from local storage between page opens.
- Added dedicated session-state pictogram column in Voice sessions list and removed legacy active-dot semantics from date-cell rendering contracts.
- Added merge-session API/store scaffolding (`voicebot/sessions/merge`, `mergeSessions(...)`) with explicit confirmation phrase and merge-log collection constant (`automation_voice_bot_session_merge_log`).
- Added TS transcribe Telegram transport recovery flow (`getFile` -> download -> persist `file_path` -> transcribe) and matching regression coverage in `workerTranscribeHandler` tests.
- Added planning draft `plan/voice-operops-codex-taskflow-spec.md` with confirmed defaults for Codex performer, `@task` auto-session creation, deferred review worker strategy, and session-tab filtering contracts.
- Fixed sessions-list deleted-mode synchronization (`copilot-nhwu`): `SessionsListPage` now forces `fetchVoiceBotSessionsList` when `showDeletedSessions` diverges from `sessionsListIncludeDeleted`, and store loading guard allows `force=true` refresh while a previous list request is still active.
- Added regression contract test `app/__tests__/voice/sessionsListIncludeDeletedSyncContract.test.ts` to lock forced include-deleted sync behavior.
- Added Voice Sessions list URL-state workflow (`tab`, filters, pagination) with inline project reassignment and active-project-only selector options in `app/src/pages/voice/SessionsListPage.tsx`.
- Added MeetingCard dialogue-tag editor with local remembered tags (`localStorage`) and persisted updates through `updateSessionDialogueTag`.
- Updated Voice frontend done-state behavior: `voiceBotStore.finishSession` now handles `session_done` ack and applies immediate optimistic close projection; realtime `session_status=done_queued` now updates session/list state without refresh.
- Updated socket done path to emit immediate `session_update` payload (`is_active=false`, `to_finalize=true`) and extended done flow with a deduplicated common-queue `PROCESSING` kick (`<session>-PROCESSING-KICK`).
- Hardened CREATE_TASKS postprocessing to enqueue missing `CATEGORIZE` jobs before delayed retry when categorization is incomplete.
- Added performer normalization for CRM tickets (`id`/`_id`/ObjectId lookup) and expanded Miniapp tasks performer matching (`performer.id`, raw `performer`, `performer._id`) for mixed payload compatibility.
- Canonicalized public Voice/TG session links to `https://copilot.stratospace.fun/voice/session` (legacy host fallback guarded) and added `VOICE_WEB_INTERFACE_URL` default sample in `backend/.env.example`.
- Added `splitAudioFileByDuration(...)` ffmpeg utility in `backend/src/utils/audioUtils.ts` for reusable chunk segmentation.
- Added deferred design spec `plan/session-done-notify-routing-migration.md` for immediate done notification and routing-source migration to Copilot DB (tracking issue: `copilot-1y3o`).
- Added versioned ontology assets under `ontology/typedb/` to the main repo tree (schema, mapping, validation queries, rollout notes) so TypeDB scaffold is tracked together with backend ingestion scripts.
- Updated Voice transcription download contract to use `/api/voicebot/transcription/download/:session_id` end-to-end (store path fix, runtime-safe backend route, and Jest coverage for markdown export).
- Added TypeDB ontology tooling scaffold with canonical scripts in `ontology/typedb/scripts/` (requirements, ingest/validate scripts, npm script aliases, and env examples) to support STR OpsPortal ERD ingestion workflows.
- Updated OperOps Projects Tree UX: editing now opens in a dedicated modal flow instead of the split side panel, with explicit close/save handlers.
- Synchronized local bd workspace metadata after SQLite rollback (`.beads` config/metadata and import backup artifacts) and normalized claim examples to `bd update <id> --claim`.
- Added `plan/deep-research-oss-platforms-operops-finops.report.draft.md` as a draft architecture research document covering OSS platform options and rollout planning for OperOps/FinOps/Guide/Voice.
- Added `ontology/fpf-erd-extraction-protocol-str-opsportal.md` and `ontology/str-opsportal-erd-draft-v0.md` to formalize ERD extraction workflow and provide the first consolidated STR OpsPortal domain draft.
- Added shared Voice session-finalization helper `backend/src/services/voicebotSessionDoneFlow.ts` and switched socket `session_done` handling to use it for consistent queue/fallback behavior.
- Added inactivity-driven close automation script `backend/scripts/voicebot-close-inactive-sessions.ts` plus npm aliases `voice:close-idle:dry|apply` for dry-run/apply operational workflows.
- Added diagnostics helper `backend/scripts/tmp-explain-69981f2e.ts` for one-session transcription/chunk state inspection during incident triage.
- Updated TS notify hooks runner to persist per-run stdout/stderr logs under `VOICE_BOT_NOTIFY_HOOKS_LOG_DIR` and include `log_path` in session-log metadata; hook spawn errors are now persisted as `notify_hook_failed` events.
- Completed Wave 2 (`copilot-yqst`, `copilot-m2uw`, `copilot-8yuq`, `copilot-dkj6`, `copilot-aonw`, `copilot-su2v`, `copilot-grg4`, `copilot-upqs`) and merged all commits to `main`.
- Added startup seed `projectGitRepoSeed` for project `Copilot` (`git_repo=strato-space/copilot`) and integrated it in DB boot flow with dedicated tests.
- Extended Telegram/voice Codex trigger flows: `@task` auto-creates Codex session when needed, attachment refs normalize to canonical `public_attachment` URLs, and transcribe first-word trigger (`Codex`/`Кодекс`) creates deferred Codex tasks.
- Added deferred-review lifecycle end-to-end:
  - `VOICEBOT_JOBS.common.CODEX_DEFERRED_REVIEW` worker + prompt card (`agents/agent-cards/codex_deferred_review.md`),
  - issue-note persistence + Telegram approval card send,
  - callback actions `cdr:start:*` / `cdr:cancel:*` for Start/Cancel decisions.
- Added canonical Codex task reference contract (`external_ref=https://copilot.stratospace.fun/voice/session/<id>`) for voice-created Codex tasks.
- Completed Wave 4 (`copilot-l3j6`, `copilot-c1xj`, `copilot-zwjl`) and merged all commits to `main`.
- Added Voice session tabs contract:
  - `Задачи` tab (CRMKanban, `source_ref` scoped to current session, Work/Review subtabs),
  - `Codex` tab with backend `POST /api/voicebot/codex_tasks` route, newest-first canonical filtering by `external_ref`, and shared status tabs (`Open`/`Closed`/`All`) matching OperOps `Codex`.
- Added OperOps `Codex` tab (`copilot-ex9q`) backed by `POST /api/crm/codex/issues` (`bd --no-daemon list --all --json --limit 500`) and inline refresh workflow.
- Added inline Voice Codex issue detail drawer (`copilot-gb72`) with bd-show-like payload fields (`labels`, `dependencies`, `notes`, ownership metadata).
- Added shared canonical source matcher (`app/src/utils/voiceSessionTaskSource.ts`) for Voice `Задачи`/`Codex` tabs and OperOps `CRMKanban` filtering, covering `source_ref`, `external_ref`, `source_data.session_id`, and `source_data.session_db_id`.
- Fixed Voice `Задачи` tab missing-task regression (`copilot-ztlv.27`): Source-link jump from OperOps task card now resolves the same task in Voice session view through canonical source/session matching.
- Hardened Telegram `@task` attachment contract (`copilot-ztlv.13`): created Codex tasks now persist normalized public attachment links and reverse message-attachment links in both description and `source_data.attachments`.
- Finalized OperOps task-card parity wave (`copilot-ztlv.3/.4/.5/.6`): deterministic `_id`-first eye-link routing with duplicate-id guard, stronger `Created by`/`Source`/`Project` fallback chain, and updated short-link runbook/tests.
- Completed categorization-material chain (`copilot-hfvd`, `copilot-c4bd`, `copilot-a3k0`, `copilot-p31k`, `copilot-250m`) and merged all commits to `main`.
- Categorization UI/data contract now includes:
  - `Materials` column (screenshots rendered outside main text),
  - hidden `Unknown` speaker label,
  - pale metadata signature line (timeline + speaker),
  - explicit image/text row-group cross-links (`material_*` fields),
  - explicit row-level material targeting with `image_anchor_linked_message_id` validation/persistence and realtime propagation.
- Closed remaining dependency chain issues (`copilot-eejo`, `copilot-a3k0`, `copilot-c4bd`, `copilot-hfvd`, `copilot-p31k`, `copilot-250m`) and closed coordinating epic `copilot-bq81`; `bd ready` is now empty.
- Fixed `/session_done` permission compatibility in `backend/src/api/routes/voicebot/sessions.ts`: replaced route-level `PermissionManager.requirePermission(...)` call with inline `getUserPermissions(...)` check for `VOICEBOT_SESSIONS.UPDATE`.
- Re-ran full Jest suites after the fix: `app` (`50` suites, `113` tests) and `backend` (`76` suites, `365` tests) passed with zero failures.

<!-- desloppify-begin -->
<!-- desloppify-skill-version: 2 -->
---
name: desloppify
description: >
  Codebase health scanner and technical debt tracker. Use when the user asks
  about code quality, technical debt, dead code, large files, god classes,
  duplicate functions, code smells, naming issues, import cycles, or coupling
  problems. Also use when asked for a health score, what to fix next, or to
  create a cleanup plan. Supports 28 languages.
allowed-tools: Bash(desloppify *)
---

# Desloppify

## 1. Your Job

Improve code quality by maximising the **strict score** honestly.

**The main thing you do is run `desloppify next`** — it tells you exactly what to fix and how. Fix it, resolve it, run `next` again. Keep going.

Follow the scan output's **INSTRUCTIONS FOR AGENTS** — don't substitute your own analysis.

## 2. The Workflow

Two loops. The **outer loop** rescans periodically to measure progress.
The **inner loop** is where you spend most of your time: fixing issues one by one.

### Outer loop — scan and check

```bash
desloppify scan --path .       # analyse the codebase
desloppify status              # check scores — are we at target?
```
If not at target, work the inner loop. Rescan periodically — especially after clearing a cluster or batch of related fixes. Issues cascade-resolve and new ones may surface.

### Inner loop — fix issues

Repeat until the queue is clear:

```
1. desloppify next              ← tells you exactly what to fix next
2. Fix the issue in code
3. Resolve it (next shows you the exact command including required attestation)
```

Score may temporarily drop after fixes — cascade effects are normal, keep going.
If `next` suggests an auto-fixer, run `desloppify fix <fixer> --dry-run` to preview, then apply.

**To be strategic**, use `plan` to shape what `next` gives you:
```bash
desloppify plan                        # see the full ordered queue
desloppify plan move <pat> top         # reorder — what unblocks the most?
desloppify plan cluster create <name>  # group related issues to batch-fix
desloppify plan focus <cluster>        # scope next to one cluster
desloppify plan defer <pat>            # push low-value items aside
desloppify plan skip <pat>             # hide from next
desloppify plan done <pat>             # mark complete
desloppify plan reopen <pat>           # reopen
```

### Subjective reviews

The scan will prompt you when a subjective review is needed — just follow its instructions.
If you need to trigger one manually:
```bash
desloppify review --run-batches --runner codex --parallel --scan-after-import
```

### Other useful commands

```bash
desloppify next --count 5                         # top 5 priorities
desloppify next --cluster <name>                  # drill into a cluster
desloppify show <pattern>                         # filter by file/detector/ID
desloppify show --status open                     # all open findings
desloppify plan skip --permanent "<id>" --note "reason" # accept debt (lowers strict score)
desloppify scan --path . --reset-subjective       # reset subjective baseline to 0
```

## 3. Reference

### How scoring works

Overall score = **40% mechanical** + **60% subjective**.

- **Mechanical (40%)**: auto-detected issues — duplication, dead code, smells, unused imports, security. Fixed by changing code and rescanning.
- **Subjective (60%)**: design quality review — naming, error handling, abstractions, clarity. Starts at **0%** until reviewed. The scan will prompt you when a review is needed.
- **Strict score** is the north star: wontfix items count as open. The gap between overall and strict is your wontfix debt.
- **Score types**: overall (lenient), strict (wontfix counts), objective (mechanical only), verified (confirmed fixes only).

### Subjective reviews in detail

- **Preferred**: `desloppify review --run-batches --runner codex --parallel --scan-after-import` — does everything in one command.
- **Manual path**: `desloppify review --prepare` → review per dimension → `desloppify review --import file.json`.
- Import first, fix after — import creates tracked state entries for correlation.
- Integrity: reviewers score from evidence only. Scores hitting exact targets trigger auto-reset.
- Even moderate scores (60-80) dramatically improve overall health.
- Stale dimensions auto-surface in `next` — just follow the queue.

### Key concepts

- **Tiers**: T1 auto-fix → T2 quick manual → T3 judgment call → T4 major refactor.
- **Auto-clusters**: related findings are auto-grouped in `next`. Drill in with `next --cluster <name>`.
- **Zones**: production/script (scored), test/config/generated/vendor (not scored). Fix with `zone set`.
- **Wontfix cost**: widens the lenient↔strict gap. Challenge past decisions when the gap grows.
- Score can temporarily drop after fixes (cascade effects are normal).

## 4. Escalate Tool Issues Upstream

When desloppify itself appears wrong or inconsistent:

1. Capture a minimal repro (`command`, `path`, `expected`, `actual`).
2. Open a GitHub issue in `peteromallet/desloppify`.
3. If you can fix it safely, open a PR linked to that issue.
4. If unsure whether it is tool bug vs user workflow, issue first, PR second.

## Prerequisite

`command -v desloppify >/dev/null 2>&1 && echo "desloppify: installed" || echo "NOT INSTALLED — run: pip install --upgrade git+https://github.com/peteromallet/desloppify.git"`

<!-- desloppify-end -->

## Codex Overlay

This is the canonical Codex overlay used by the README install command.

1. Prefer first-class batch runs: `desloppify review --run-batches --runner codex --parallel --scan-after-import`.
2. The command writes immutable packet snapshots under `.desloppify/review_packets/holistic_packet_*.json`; use those for reproducible retries.
3. Keep reviewer input scoped to the immutable packet and the source files named in each batch.
4. Do not use prior chat context, score history, narrative summaries, issue labels, or target-threshold anchoring while scoring.
5. Assess every dimension listed in `query.dimensions`; never drop a requested dimension. If evidence is weak/mixed, score lower and explain uncertainty in findings.
6. Return machine-readable JSON only for review imports. For Claude session submit (`--external-submit`), include `session` from the generated template:

```json
{
  "session": {
    "id": "<session_id_from_template>",
    "token": "<session_token_from_template>"
  },
  "assessments": {
    "<dimension_from_query>": 0
  },
  "findings": [
    {
      "dimension": "<dimension_from_query>",
      "identifier": "short_id",
      "summary": "one-line defect summary",
      "related_files": ["relative/path/to/file.py"],
      "evidence": ["specific code observation"],
      "suggestion": "concrete fix recommendation",
      "confidence": "high|medium|low"
    }
  ]
}
```

7. `findings` MUST match `query.system_prompt` exactly (including `related_files`, `evidence`, and `suggestion`). Use `"findings": []` when no defects are found.
8. Import is fail-closed by default: if any finding is invalid/skipped, `desloppify review --import` aborts unless `--allow-partial` is explicitly passed.
9. Assessment scores are auto-applied from trusted internal run-batches imports, or via Claude cloud session imports (`desloppify review --external-start --external-runner claude` then printed `--external-submit`). Legacy attested external import via `--attested-external` remains supported.
10. Manual override is safety-scoped: you cannot combine it with `--allow-partial`, and provisional manual scores expire on the next `scan` unless replaced by trusted internal or attested-external imports.
11. If a batch fails, retry only that slice with `desloppify review --run-batches --packet <packet.json> --only-batches <idxs>`.

<!-- desloppify-overlay: codex -->
<!-- desloppify-end -->
