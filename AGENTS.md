# Copilot Workspace Guidelines

This repository hosts the Finance Ops console. Deprecated modules are archived in `old_code/`.

## Shared rules
- Document changes in the module itself; shared notes can live in this repo root.
- Do not store build artifacts outside the module directories.
- For `app/`, keep only TypeScript/TSX sources and avoid JS duplicates.

## FinOps notes
- FX rates live in `app/src/store/fxStore.ts` and drive RUB conversions across analytics, KPIs, and plan-fact tables.
- The plan-fact grid keeps at least one pinned month; users can pin up to 3 and can unpin the active month if another month remains pinned.
- Expense attachments are served from `/uploads/expenses`.

## Deployment endpoints
- `copilot.stratospace.fun` → FinOps shell served from `app/dist` (host Nginx config in `deploy/nginx-host.conf`).
- `finops.stratospace.fun` → FinOps frontend (`app/dist`)

## Portal auth
- The Copilot portal uses `/api/try_login`, which proxies Voicebot `/try_login`; configure `VOICEBOT_API_URL` or `VOICEBOT_TRY_LOGIN_URL` for the backend.
