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

### PM2 services (dev) -> repo paths
- `copilot-backend-dev` / `copilot-backend-local` — backend API (`npm run dev` with `backend/.env.development`).
- `copilot-miniapp-backend-dev` / `copilot-miniapp-backend-local` — miniapp backend API (`npm run dev:miniapp` with `backend/.env.development`).
- Ensure dev frontend builds exist before serving via Nginx: `cd app && npm run build-dev` and `cd miniapp && npm run build-dev`.

## Product Notes (FinOps)
- FX rates live in `app/src/store/fxStore.ts` and drive RUB conversions across analytics, KPIs, and plan-fact tables.
- The plan-fact grid keeps at least one pinned month; users can pin up to 3 and can unpin the active month if another month remains pinned.
- Expense attachments are served from `/uploads/expenses`.
- Guide directories use mock fallback data when automation APIs fail and expose a global Log sidebar from the Guide header.

## Product Notes (OperOps/CRM)
- CRM components migrated from `automation/appkanban` live in `app/src/components/crm/`.
- CRM pages live in `app/src/pages/operops/` (CRMPage, PerformersPage, FinancesPerformersPage, ProjectsTree, TaskPage).
- CRM stores: `kanbanStore.ts` (tickets, epics, performers), `crmStore.ts` (UI state), `projectsStore.ts` (project tree), `requestStore.ts` (API).
- Socket.IO events for CRM: TICKET_CREATED, TICKET_UPDATED, TICKET_DELETED, EPIC_UPDATED, COMMENT_ADDED, WORK_HOURS_UPDATED.
- CRM routes accessible at `/operops/*` with OperOpsNav horizontal navigation.

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
- MCP proxy stubs: `backend/src/services/mcp/` (requires `@modelcontextprotocol/sdk`).
- Workers are NOT included - run as separate service (see `backend/src/workers/README.md`).
- Agents are NOT included - run as separate Python service (see `backend/src/agents/README.md`).
- Voice UI is native in the Copilot app under `/voice/*` (no iframe embed).

### VoiceBot Environment Variables
```
# Optional for JWT socket auth
APP_ENCRYPTION_KEY=your-secret-key

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

## Beads (bd) Integration

- `bd` is already initialized in this repository and configured to use the `beads-sync` branch.
- Required setup for future repos (if cloning elsewhere):
  1. Install `bd` and Go once in environment.
  2. Run `bd init` in repo root.
  3. Run `bd config set beads.role maintainer`.
  4. Set `sync-branch: "beads-sync"` in `.beads/config.yaml`.
  5. Run `bd sync` and `bd doctor --fix --yes`.
  6. Commit `.beads/*` files and `.gitattributes` (and `AGENTS.md` updates when present).

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
