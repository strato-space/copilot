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

## Development
Start the frontend and backend together:

```bash
./scripts/dev.sh
```

- Frontend: http://localhost:5173
- Backend: http://localhost:3002/api/health

## Nginx
The Finance Ops SPA is served by Nginx, and `/api` is proxied to the backend. For the public domain, see `deploy/nginx-host.conf` and `deploy/README.md`.
