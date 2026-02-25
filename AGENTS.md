# Copilot Constitution

This repository hosts the Finance Ops console. Deprecated modules are archived in `old_code/`.

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
- Categorization pipeline must emit `message_update` over websocket (through `SEND_TO_SOCKET` events queue) so Categorization tab updates without manual refresh.
- Frontend voice socket must connect to `/voicebot` namespace (not `/`) and subscribe via `subscribe_on_session`; otherwise live session updates will be dropped.
- Frontend voice socket reconnect flow must rehydrate current session and keep deterministic message ordering for `new_message`/`message_update` upserts.
- Backend API process owns socket event delivery for `voicebot--events-*` queue via dedicated runtime (`startVoicebotSocketEventsWorker`); standalone workers should not consume `EVENTS` queue.
- Runtime-scoped aggregate queries now auto-scope nested `$lookup` stages for runtime-tagged collections (`prod` family vs exact non-prod), so cross-runtime joins do not leak records.
- Socket `session_done` authorization is test-covered through `resolveAuthorizedSessionForSocket` export; keep socket handlers bound to backend performer/session auth checks only.
- `Done` path enforces one-shot auto-upload retry per pending chunk/session and surfaces manual retry for remaining failures.
- Inactive open sessions can be auto-closed by cron via `backend/scripts/voicebot-close-inactive-sessions.ts` (uses latest session/message/session-log activity timestamps and runs `DONE_MULTIPROMPT` flow for sessions idle above threshold).
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
- Notify worker (`backend/src/workers/voicebot/handlers/notify.ts`) now supports both HTTP notify transport and local hooks parity:
  - HTTP path uses `VOICE_BOT_NOTIFIES_URL` + `VOICE_BOT_NOTIFIES_BEARER_TOKEN`,
  - local hooks use `VOICE_BOT_NOTIFY_HOOKS_CONFIG` (YAML/JSON; default `./notifies.hooks.yaml`; empty value disables),
  - writes `notify_hook_started`, `notify_http_sent`, `notify_http_failed` into `automation_voice_bot_session_log`.
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
- Unit tests: `npm run test` (Jest) in `app/` and `backend/`.
- E2E tests: `npm run test:e2e` (Playwright) in `app/` — runs against local dev server.
- E2E tests require running dev server or use `PLAYWRIGHT_BASE_URL` env var.

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
- Added TypeDB ontology tooling scaffold in backend (`requirements-typedb.txt`, ingest/validate scripts, npm script aliases, and env examples) to support STR OpsPortal ERD ingestion workflows.
- Updated OperOps Projects Tree UX: editing now opens in a dedicated modal flow instead of the split side panel, with explicit close/save handlers.
- Synchronized local bd workspace metadata after SQLite rollback (`.beads` config/metadata and import backup artifacts) and normalized claim examples to `bd update <id> --claim`.
- Added `plan/deep-research-oss-platforms-operops-finops.report.draft.md` as a draft architecture research document covering OSS platform options and rollout planning for OperOps/FinOps/Guide/Voice.
- Added `plan/fpf-erd-extraction-protocol-str-opsportal.md` and `plan/str-opsportal-erd-draft-v0.md` to formalize ERD extraction workflow and provide the first consolidated STR OpsPortal domain draft.
- Added shared Voice session-finalization helper `backend/src/services/voicebotSessionDoneFlow.ts` and switched socket `session_done` handling to use it for consistent queue/fallback behavior.
- Added inactivity-driven close automation script `backend/scripts/voicebot-close-inactive-sessions.ts` plus npm aliases `voice:close-idle:dry|apply` for dry-run/apply operational workflows.
- Added diagnostics helper `backend/scripts/tmp-explain-69981f2e.ts` for one-session transcription/chunk state inspection during incident triage.
