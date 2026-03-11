# Copilot Figma Indexing Services

**Created**: 2026-03-11  
**Status**: Draft  
**Implementation Location**: `copilot/figma/`

## Scope

In scope for this iteration:

- `figma-indexer`
- `figma-webhook-receiver`

Out of scope for this iteration:

- `figma-index-mcp`
- UI for browsing the index
- Deep inventory below the `page -> section` level
- OAuth migration (PAT is the current auth mode)

## Purpose

`figma/` is a standalone module inside `copilot` that:

- builds and maintains an up-to-date Figma structure index,
- stores inventory at `team -> project -> file -> page -> section` level,
- detects changes through both polling and webhooks,
- provides a durable base for a future `figma-index-mcp`.

The current v1 data source is the Figma REST API authenticated by PAT:

- team/project listing through the REST API,
- `team_id` bootstrap from configuration,
- file tree reads through the REST API with `depth=2`.

Current assumptions already validated manually:

- `GET /v1/me` works with PAT,
- `GET /v1/teams/:team_id/projects` works,
- `GET /v1/projects/:project_id/files` works.

That means v1 can ship without depending on the official Figma MCP. The official MCP and `figma-console` remain separate read surfaces for targeted workflows.

## Goals

### Functional goals

- Sync the configured set of Figma teams.
- Sync projects for each team.
- Sync files for each project.
- Persist the top-level file tree:
  - file metadata,
  - pages (`CANVAS`),
  - top-level sections (`SECTION`).
- Detect changes through polling and webhooks.
- Store sync history, errors, and webhook events.
- Give a future MCP fast indexed reads instead of live API-only reads.

### Non-functional goals

- Avoid storing full file content when it is not needed.
- Avoid rescanning every file on every pass.
- Reuse the repo-standard MongoDB + Redis/BullMQ stack.
- Stay PM2-friendly for both dev and prod operations.

## Runtime Model

### `figma-indexer`

Background runtime responsible for:

- bootstrap sync for all configured `team_id` values,
- periodic polling,
- BullMQ enqueue/worker execution,
- Figma REST API reads,
- Mongo updates for teams/projects/files/snapshots,
- retry and backoff handling for rate limits and transient failures.

### `figma-webhook-receiver`

HTTP runtime responsible for:

- receiving Figma webhooks,
- verifying webhook authenticity,
- enforcing idempotency by event id,
- persisting raw events,
- turning events into BullMQ jobs,
- triggering targeted invalidation and reindex work.

### Responsibility split

- `figma-indexer` maintains truth and reconciliation.
- `figma-webhook-receiver` is only a fast change signal.
- Webhooks are not the only source of truth.
- Polling remains mandatory as a safety net.

## Why This Is A Separate Module

The Figma indexer lives under `copilot/figma/` instead of `backend/src/api/routes` because:

- it is an integration subsystem, not a CRM or Voice route,
- it needs its own queues, runtime loops, and collections,
- a future MCP server will depend on the same indexed data,
- the code stays cleaner when Figma indexing is isolated from backend API routes.

## Directory Layout

```text
copilot/figma/
  README.md
  OPERATIONS.md
  package.json
  tsconfig.json
  src/
    config/
      env.ts
    constants/
      collections.ts
      queues.ts
      sync.ts
    db/
      indexes.ts
      mongo.ts
    redis/
      connection.ts
    figma-api/
      auth.ts
      client.ts
      endpoints.ts
      mappers.ts
      rateLimit.ts
    domain/
      files.ts
      projects.ts
      snapshots.ts
      syncRuns.ts
      teams.ts
      webhookEvents.ts
      webhookSubscriptions.ts
    http/
      app.ts
      routes/
        admin.ts
        health.ts
        webhook.ts
    jobs/
      enqueue.ts
      handlers/
        processWebhookEvent.ts
        reconcileStaleFiles.ts
        syncFileTree.ts
        syncProjectFiles.ts
        syncProjects.ts
        syncTeam.ts
    services/
      indexerRuntime.ts
      treeExtractor.ts
      webhookRuntime.ts
    cli/
      index.ts
    types/
      api.ts
      figma.ts
      jobs.ts
  scripts/
    pm2-figma.ecosystem.config.cjs
    pm2-figma.sh
```

## Technology Stack

This module follows the same core stack used elsewhere in Copilot:

- Node.js
- TypeScript
- ES modules
- MongoDB driver
- Redis
- BullMQ
- Express
- Zod for env and request validation

It may reuse patterns from the backend runtime, but it should remain operationally independent from VoiceBot runtime code.

## External Dependencies

### Figma API

v1 uses a personal access token from environment variables.

Required access:

- `projects:read`
- `file_content:read`
- `file_metadata:read`

Future direction:

- move to a private OAuth app,
- keep PAT only as a dev fallback.

### Seed Data

Known `team_id` values must be provided explicitly through configuration.

### MongoDB / Redis

The module currently reuses the same MongoDB and Redis infrastructure as the main Copilot repo, but with dedicated queue names and dedicated Figma collections.

## Commands

```bash
cd /home/strato-space/copilot/figma
npm install
npm run build
npm test
npm run sync:bootstrap
npm run sync:team -- --team=<team_id>
npm run sync:project -- --team=<team_id> --project=<project_id>
npm run sync:file -- --team=<team_id> --project=<project_id> --file=<file_key>
./scripts/pm2-figma.sh dev start
```

## Tests

Current test coverage is centered on:

- env parsing,
- queue constants,
- tree extraction,
- webhook route verification and idempotency.

See `OPERATIONS.md` for PM2 usage, runtime env requirements, and the smoke-check workflow.
