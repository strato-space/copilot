# Copilot

Copilot is the workspace for Finance Ops, OperOps/CRM, Voice, and Miniapp surfaces. Deprecated code is archived in `old_code/`.

## FinOps notes
- FX rates are managed in `app/src/store/fxStore.ts` and recalculate RUB values in analytics, KPIs, and plan-fact tables.
- The Employees directory supports a chat-driven form fill that prompts for missing fields.
- Plan-fact months can be pinned (up to 3), and the totals row stays visible under pinned months.
- The Expenses tab combines payroll and other costs, with category-level operations and sticky totals.
- Expense attachments are uploaded via `/api/uploads/expense-attachments` and served from `/uploads/expenses`.
- Guide directories fall back to mock data when the automation API is unavailable, and the Guide header includes a global Log sidebar.

## OperOps/CRM notes
- CRM components migrated from `automation/appkanban` live in `app/src/components/crm/`.
- CRM pages: CRMPage, PerformersPage, FinancesPerformersPage, ProjectsTree, TaskPage in `app/src/pages/operops/`.
- CRM stores: `kanbanStore.ts` (tickets, epics, performers), `crmStore.ts` (UI state), `projectsStore.ts` (project tree), `requestStore.ts` (API).
- Socket.IO events: TICKET_CREATED, TICKET_UPDATED, TICKET_DELETED, EPIC_UPDATED, COMMENT_ADDED, WORK_HOURS_UPDATED.
- Routes accessible at `/operops/*` with OperOpsNav horizontal navigation.

## Voice notes
- Voice UI is native in `app/` under `/voice/*` (no iframe embed).
- Voice API source of truth is local: `/api/voicebot/*` (flat contract + legacy aliases during migration).
- Runtime isolation is enforced via `runtime_tag` for operational collections; legacy records without `runtime_tag` are treated as `prod`.
- WebRTC FAB script should be loaded from same-origin static path (`/webrtc/webrtc-voicebot-lib.js`) via `VITE_WEBRTC_VOICEBOT_SCRIPT_URL`.
- Upload route (`/api/voicebot/upload_audio`) immediately emits socket events `new_message` + `session_update` into `voicebot:session:<session_id>` so new chunks appear without waiting for polling.
- `Done` in WebRTC now runs bounded auto-upload draining and marks remaining failed chunk uploads for explicit retry instead of indefinite automatic loops.
- Full-track recording segments are represented as `full_track` in chunk metadata and UI, with duration and timestamp information persisted in upload metadata.
- Session toolbar and FAB keep unified control order `New / Rec / Cut / Pause / Done`; `Rec` activates page session before routing to FAB control, while status badge follows runtime states (`recording`, `paused`, `finalizing`, `error`, `closed`, `ready`).
- Voice task creation in Copilot runtime no longer requires `task_type_id`; missing type is no longer a hard blocker in ticket/task generation.
- `copilot-voicebot-tgbot-prod` runs TypeScript runtime from `backend/dist/voicebot_tgbot/runtime.js` with merged env sources: `backend/.env.production` + `voicebot_runtime/.env.prod-cutover` (TG/runtime overrides).


### Voice runtime: key configuration map
- OpenAI key is a shared variable: `OPENAI_API_KEY`.
  - Copilot backend: `backend/src/api/routes/voicebot/llmgate.ts`.
  - Voice runtime services: `voicebot_runtime/` jobs and processors (transcribe/categorization/task creation/title flows).
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
  - Transcription errors persist diagnostics (`openai_key_mask`, `openai_key_source`, `openai_api_key_env_file`, `server_name`) for quota/file-path incident analysis.
- Storage and services:
  - `OPENAI_*` keys are loaded per service source: backend API uses `backend/.env.production`; TG runtime uses merged env (`backend/.env.production` + `voicebot_runtime/.env.prod-cutover`).
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
- Agents MCP (fast-agent): http://copilot-dev.stratospace.fun:8722 (plain HTTP; MCP endpoint is `/mcp`)
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
