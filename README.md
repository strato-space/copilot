# Copilot

Copilot is the workspace for the Finance Ops console. Deprecated code is archived in `old_code/`.

## FinOps notes
- FX rates are managed in `app/src/store/fxStore.ts` and recalculate RUB values in analytics, KPIs, and plan-fact tables.
- The Employees directory supports a chat-driven form fill that prompts for missing fields.
- Plan-fact months can be pinned (up to 3), and the totals row stays visible under pinned months.
- The Expenses tab combines payroll and other costs, with category-level operations and sticky totals.
- Expense attachments are uploaded via `/api/uploads/expense-attachments` and served from `/uploads/expenses`.

## What is included
- `app/` React + Vite frontend for Finance Ops.
- `backend/` Node/Express API for Finance Ops.
- `docs/`, `specs/`, `projects/` for product documentation and specs.
- `deploy/` Host-level Nginx config and notes.

## Development (p2)
For shared dev on p2, serve a static build to avoid Vite port conflicts.

```bash
cd backend && npm install && npm run dev
cd app && npm install && npm run build-dev
```

- Dev URL: https://copilot-dev.stratospace.fun
- Backend health: http://127.0.0.1:3002/api/health

## Authentication
- Backend proxies Voicebot auth via `/api/try_login` and `/api/auth/me`; set `VOICEBOT_API_URL` in the backend environment.
- Frontend auth checks call `https://voice.stratospace.fun/auth/me` by default; override with `VITE_VOICEBOT_BASE_URL` if needed.
- Login relies on the shared `auth_token` http-only cookie for `.stratospace.fun`.

## Nginx
The Finance Ops SPA is served by Nginx, and `/api` is proxied to the backend. For the public domain, see `deploy/nginx-host.conf` and `deploy/README.md`.
