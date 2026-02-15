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
