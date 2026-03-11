# Figma Operations

## Runtime Shape

- `figma-indexer` is the BullMQ + Mongo polling runtime.
- `figma-webhook-receiver` is the HTTP receiver for Figma webhooks.
- Both runtimes are packaged as standalone PM2 services via `figma/scripts/pm2-figma.ecosystem.config.cjs`.

## Required Environment

Shared infrastructure:

- `MONGODB_CONNECTION_STRING`
- `DB_NAME`
- `REDIS_CONNECTION_HOST`
- `REDIS_CONNECTION_PORT`
- `REDIS_CONNECTION_PASSWORD` if required
- `REDIS_DB_INDEX`
- `APP_ENV`

Indexer-specific:

- `FIGMA_PERSONAL_ACCESS_TOKEN`
- `FIGMA_TEAM_IDS`

Receiver-specific:

- `FIGMA_WEBHOOK_PORT`
- `FIGMA_WEBHOOK_PUBLIC_BASE_URL`
- `FIGMA_WEBHOOK_VERIFY_SECRET`
- `FIGMA_ADMIN_API_KEY`

## PM2

Build and start:

```bash
cd /home/strato-space/copilot/figma
./scripts/pm2-figma.sh dev start
./scripts/pm2-figma.sh prod restart
```

Services:

- `copilot-figma-indexer-dev`
- `copilot-figma-webhook-receiver-dev`
- `copilot-figma-indexer-prod`
- `copilot-figma-webhook-receiver-prod`

## Webhook Registration Runbook

Figma webhook verification is passcode-based.

- Use the same passcode value as `FIGMA_WEBHOOK_VERIFY_SECRET`.
- Figma sends an initial `PING` on webhook creation unless the webhook is created paused.
- The receiver must answer `200 OK` quickly.
- An invalid passcode must return `400`.

Store webhook metadata outside Figma because the passcode is redacted on reads:

- webhook name,
- `webhook_id`,
- `context`,
- `context_id`,
- receiver URL,
- local passcode version / rotation date.

The receiver supports a manual metadata registry through `POST /admin/webhooks/register`.

Recommended webhook targets:

- file-scoped hooks for high-value files,
- project/team hooks only as coarse invalidation signals.

Polling remains mandatory because `FILE_UPDATE` can be delayed and team hooks do not cover every invite-only project edge case.

## Live Smoke Checklist

1. Run `npm run build`.
2. Run `npm test`.
3. Run `tsx src/cli/index.ts sync:team --team=<known_team_id>`.
4. Run `tsx src/cli/index.ts sync:project --team=<team_id> --project=<project_id>`.
5. Run `tsx src/cli/index.ts sync:file --team=<team_id> --project=<project_id> --file=<file_key>`.
6. Compare stored page/section counts with one real Figma file in the Figma UI.
7. Send a real or replayed webhook payload with the correct passcode.
8. Verify:
   - `copilot_figma_webhook_events` inserted exactly one row,
   - `PROCESS_WEBHOOK_EVENT` routed to the expected file/project/team queue,
   - `copilot_figma_sync_runs` reflects both receiver and sync activity.

## Admin API

- `GET /healthz`
- `GET /readyz`
- `POST /webhooks/figma`
- `POST /admin/sync/team`
- `POST /admin/sync/project`
- `POST /admin/sync/file`
- `POST /admin/reconcile`
- `POST /admin/webhooks/register`
- `GET /admin/stats`
