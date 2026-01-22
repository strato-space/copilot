# Copilot

Copilot is the umbrella workspace for Ops tools. The web entry point is `copilot.stratospace.fun`.

## Modules
- **OperOps**: operational control hub (placeholder UI at `operops.stratospace.fun`).
- **FinOps**: plan-fact and forecasting console (source in `finance-ops/`, deployed at `finops.stratospace.fun`).
- **ChatOps**: assistant and chat automation workspace (placeholder UI at `chatops.stratospace.fun`).

## FinOps notes
- FX rates are managed in `finance-ops/admin_app` and recalculate RUB values in analytics, KPIs, and plan-fact tables.
- The Employees directory supports a chat-driven form fill that prompts for missing fields.

## What is included
- `frontend/` Static SPA (HTML, CSS, JS)
- `backend/` FastAPI app with `/api/health`, `/api/hello`, and `/api/items` CRUD
- `docker-compose.yml` to run both services
- `frontend/nginx.conf` for the container domain and reverse proxy
- `deploy/` Host-level Nginx config and notes

## Ops Planning mock endpoints
These endpoints power the Ops Planning UI (reading CRM snapshot CSV from `voicebot/downloads` when available):
- `GET /api/ops/backlog`
- `GET /api/ops/today`
- `GET /api/ops/week`
- `GET /api/ops/metrics`
- `GET /api/ops/timeline`
- `GET /api/ops/month`
- `GET /api/ops/memory`
- `GET /api/ops/performer/{id}`
- `POST /api/ops/approve`
- `POST /api/ops/apply`
- `POST /api/ops/memory`
- `POST /api/ops/performer/{id}/note`
- `POST /api/ops/performer/{id}/draft`

Local JSON storage for future writes lives in `backend/app/data/`.

## Data source (CRM snapshot)
- Default: `../voicebot/downloads/crm-tasks-active-selected-YYYY-MM-DD.csv` (latest date/mtime).
- Docker: `docker-compose.yml` mounts `../voicebot/downloads` into the backend container and sets `COPILOT_CSV_DIR`.

## Safe apply (fail-closed)
`POST /api/ops/apply` is **fail-closed** until CRM API details are provided:
- Requires env: `CRM_API_BASE_URL`, `CRM_API_TOKEN`
- Still returns `501` because CRM write endpoints/mapping are `TBD` (no silent writes).

## UI notes
- Default language is RU with a toggle to EN.
- Bottom navigation holds core Ops Hub screens; extra tabs live in the burger menu.
- Agent is a floating action button with a drawer and command chips.
- Backlog cards show priority and assignee initials.

## Smoke checks
- `curl http://localhost:8000/api/ops/backlog`
- `curl http://localhost:8000/api/ops/metrics`
- `curl http://localhost:8000/api/ops/memory`
- `curl http://localhost:8000/api/ops/performer/masha`
- `curl -X POST http://localhost:8000/api/ops/approve -H 'Content-Type: application/json' -d '{"ops":[]}'`
- `curl -X POST http://localhost:8000/api/ops/apply -H 'Content-Type: application/json' -d '{"approve_id":"approve-xxxx"}'`

## Known issue
If `docker-compose up` fails with `ContainerConfig`, remove old containers and recreate:
```bash
docker rm -f copilot-web copilot-backend
docker-compose up -d --build --force-recreate
```
If the error persists, build and run the containers manually on a shared network:
```bash
docker build -t copilot_backend ./backend
docker build -t copilot_web ./frontend
docker network create copilot-net
docker run -d --name backend --network copilot-net -p 8000:8000 copilot_backend:latest
docker run -d --name copilot-web --network copilot-net -p 8080:80 copilot_web:latest
```

## Run with Docker
```bash
docker-compose up --build
```

- Frontend: http://localhost:8080
- Backend: http://localhost:8000/api/health

## Nginx
The SPA is served by Nginx, and `/api` is proxied to the backend. The container config is in `frontend/nginx.conf`.
For the public domain, see `deploy/nginx-host.conf` and `deploy/README.md`.
