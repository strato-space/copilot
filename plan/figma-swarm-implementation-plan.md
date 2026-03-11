# Plan: Figma Indexer + Webhook Receiver v1

**Generated**: 2026-03-11

## Overview

Implement two separate runtime components inside `figma/`:

- `figma-indexer` for PAT-based inventory sync and tree snapshots.
- `figma-webhook-receiver` for webhook intake, idempotent persistence, and targeted invalidation jobs.

The plan is optimized for swarm execution: first establish the shared module/contracts, then run parallel tracks for `indexer` and `receiver`, then merge, test, and package for PM2.

## Prerequisites

- Official Figma REST and webhook docs verified against the current public docs.
- Existing repo conventions reused for Mongo, Redis, BullMQ, logging, Jest, and PM2.
- A separate `figma/` package with its own build, test, and runtime scripts.

## Dependency Graph

```text
T1 ──┬── T2 ──┬── T4 ──┬── T6 ──┐
     │        │        │        ├── T8 ── T10
     │        │        └── T7 ──┘
     │        └── T5 ───────────┘
     └── T3 ────────────────────┘
```

## Tasks

### T1: Module Skeleton

- **depends_on**: []
- **location**: `figma/package.json`, `figma/tsconfig.json`, `figma/jest.config.cjs`
- **description**: Create an independent TypeScript/Jest package for `figma/` with CLI and runtime scripts.
- **validation**: `npm test` and `npm run build` are available inside `figma/`.
- **status**: Not Completed
- **log**:
- **files edited/created**:

### T2: Shared Runtime Contracts

- **depends_on**: [T1]
- **location**: `figma/src/config`, `figma/src/constants`, `figma/src/types`, `figma/src/db`, `figma/src/redis`
- **description**: Implement env parsing, queue/job names, Mongo collections/indexes, Redis connection helpers, sync-run collection contracts, and shared TypeScript types.
- **validation**: Shared imports compile without cycles and env parsing is covered by unit tests.
- **status**: Not Completed
- **log**:
- **files edited/created**:

### T3: PM2 Packaging

- **depends_on**: [T1]
- **location**: `figma/scripts/pm2-figma.ecosystem.config.cjs`
- **description**: Prepare a separate PM2 ecosystem for `figma-indexer` and `figma-webhook-receiver`.
- **validation**: The PM2 config contains dev/prod services and correct `cwd` / env / script entries.
- **status**: Not Completed
- **log**:
- **files edited/created**:

### T4: Indexer Core

- **depends_on**: [T2]
- **location**: `figma/src/figma-api`, `figma/src/domain`, `figma/src/services/treeExtractor.ts`
- **description**: Implement the Figma PAT client, response mappers, top-level tree extraction, and persistence helpers for teams, projects, files, and snapshots.
- **validation**: Unit tests cover tree extraction, mapping, and idempotent snapshot logic.
- **status**: Not Completed
- **log**:
- **files edited/created**:

### T5: Receiver Core

- **depends_on**: [T2]
- **location**: `figma/src/http`, `figma/src/services/webhookRuntime.ts`, `figma/src/domain/webhookEvents.ts`
- **description**: Implement the Express app, health/readiness/admin routes, raw-body capture, webhook verification/parsing, and raw event persistence.
- **validation**: Integration tests cover `/healthz`, `/readyz`, `/webhooks/figma`, admin auth, and the verification/raw-body contract.
- **status**: Not Completed
- **log**:
- **files edited/created**:

### T6: Queue Contracts And Indexer Jobs

- **depends_on**: [T4]
- **location**: `figma/src/jobs`, `figma/src/services/indexerRuntime.ts`
- **description**: Implement BullMQ queues, deterministic job ids, sync/reconcile handlers, the runtime loop, shared enqueue helpers, and canonical sync-run logging during processing.
- **validation**: Tests cover deterministic job ids, enqueue routing, and retry/backoff policy.
- **status**: Not Completed
- **log**:
- **files edited/created**:

### T7: Webhook Queue Bridge

- **depends_on**: [T5, T6]
- **location**: `figma/src/jobs/handlers/processWebhookEvent.ts`, `figma/src/jobs/enqueue.ts`
- **description**: Implement the `PROCESS_WEBHOOK_EVENT` consumer and targeted invalidation routing from team/project/file scope to queue jobs.
- **validation**: Tests confirm routing and idempotent repeated event processing.
- **status**: Not Completed
- **log**:
- **files edited/created**:

### T8: CLI Surface

- **depends_on**: [T4, T5, T6, T7]
- **location**: `figma/src/cli/index.ts`
- **description**: Expose operator commands such as `sync:*`, `serve:webhooks`, and `stats` on top of the shared domain logic.
- **validation**: CLI commands compile and invoke the corresponding runtime/domain paths.
- **status**: Not Completed
- **log**:
- **files edited/created**:

### T9: Observability And Ops

- **depends_on**: [T5, T6, T7]
- **location**: `figma/src/http/routes/admin.ts`, `figma/src/services/*Runtime.ts`
- **description**: Add structured logs, queue stats, receiver/indexer operational surfaces, webhook subscription state, and snapshot retention/GC policy.
- **validation**: `/admin/stats` returns queue/db stats and logs include scope/job fields.
- **status**: Not Completed
- **log**:
- **files edited/created**:

### T10: Validation

- **depends_on**: [T3, T8, T9]
- **location**: `figma/__tests__`, `figma/package.json`
- **description**: Add unit/integration tests, run build and test suite, verify PM2-ready layout, and lock the live smoke/runbook steps for team/project/file/webhook flows.
- **validation**: `npm test` and `npm run build` succeed inside `figma/`; a manual smoke checklist is documented.
- **status**: Not Completed
- **log**:
- **files edited/created**:

## Parallel Execution Groups

| Wave | Tasks | Can Start When |
|------|-------|----------------|
| 1 | T1 | Immediately |
| 2 | T2, T3 | T1 complete |
| 3 | T4, T5 | T2 complete |
| 4 | T6, T7 | T4 or T5 complete as required |
| 5 | T8, T9 | T4/T5/T6/T7 complete |
| 6 | T10 | T3/T8/T9 complete |

## Testing Strategy

- Unit: env parsing, job ids, tree extraction, webhook normalization, retry policy.
- Integration: webhook receiver persistence/idempotency, enqueue routing, Mongo upserts, snapshot replacement.
- Build/runtime: package build, CLI entrypoints, and PM2 ecosystem sanity.

## Risks & Mitigations

- Webhook contract drift: verify against official Figma docs and keep verification logic isolated.
- Queue/job storms: enforce deterministic job ids and bounded concurrency from env.
- Dirty workspace conflicts: keep implementation isolated to `figma/` plus the minimal shared PM2/script touchpoints.
