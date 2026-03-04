# Runtime Tag Usage Map And Deprecation Plan (2026-03-04)

## Scope
- Repository: `/home/strato-space/copilot`
- Task: `copilot-9iic` (research-only)
- Goal: map all `runtime_tag` usage and propose deprecation plan for moving to separate MongoDB databases (`prod`, `stage`, `dev`) without runtime-tagged entities.

## T0 Contract Freeze Addendum (`copilot-f75b.1`)

### Frozen Contract And Guardrail (Epic Phase)
- Target contract for epic `copilot-f75b`:
  - read-path behavior moves to `runtime_tag` ignore mode,
  - new writes must stop introducing `runtime_tag`,
  - implementation is code-path only (no datastore rewrites in this phase).
- **Explicit guardrail:** `NO MongoDB/Redis data mutations are allowed in this epic phase.`
- Disallowed during this phase:
  - running backfill/unset scripts against live data (`runtime-tag-backfill` style),
  - ad-hoc `mongo`/`mongosh` `update*`/`delete*` operations for `runtime_tag`,
  - Redis key rewrite/delete migration commands.
- Allowed during this phase:
  - code, tests, docs, and read-only inventory/audit commands.

### Runtime-Tag Touchpoint Inventory (Snapshot: 2026-03-04)
- Counting method: `rg -n "runtime_tag"` over scoped paths (excluding `dist/node_modules`).
- Totals by area:

| Area | Matches | Files | Key hotspots |
| --- | ---: | ---: | --- |
| `backend` (`src` + `scripts`) | 116 | 31 | `backend/src/api/routes/voicebot/sessions.ts` (17), `backend/src/workers/voicebot/runner.ts` (10), `backend/src/services/db.ts` (9), `backend/src/api/routes/voicebot/uploads.ts` (9), `backend/src/voicebot_tgbot/activeSessionMapping.ts` (8) |
| `app` (`app/src`) | 0 | 0 | No frontend runtime-tag touchpoints in `app/src` |
| `tests` (`backend/__tests__`, `app/__tests__`, `miniapp/__tests__`) | 113 | 19 | `backend/__tests__/voicebot/runtime/sessionsRuntimeCompatibilityRoute.sessionParity.test.ts` (22), `backend/__tests__/voicebot/runtimeScope.test.ts` (13), `backend/__tests__/voicebot/runtime/sessionUtilityRuntimeBehavior.validation.test.ts` (13), `backend/__tests__/voicebot/runtime/sessionUtilityRuntimeBehavior.codexSyncAndFilters.test.ts` (10) |
| `docs` (`docs/`) | 23 | 5 | `docs/RUNTIME_TAG_DEPRECATION_PLAN_2026-03-04.md` (15), `docs/copilot-repo-visual-recap.html` (4) |

### Agreed Smoke Checklist For Later Waves (Before/After)
- Before each implementation wave:
  1. Capture baseline inventory:
     - `rg -n "runtime_tag" backend/src backend/scripts app/src backend/__tests__ app/__tests__ miniapp/__tests__ docs`
  2. Run type-safety gates:
     - `cd backend && npm run build`
     - `cd app && npm run build`
  3. Run high-signal runtime-scope tests:
     - `cd backend && npm run test -- --runTestsByPath __tests__/services/dbRuntimeScopedCollectionProxy.test.ts __tests__/services/dbAggregateRuntimeScope.test.ts __tests__/voicebot/runtimeScope.test.ts __tests__/voicebot/runtime/sessionsRuntimeCompatibilityRoute.sessionParity.test.ts`
  4. Confirm no DB-mutation scripts are in execution plan for the wave.
- After each implementation wave:
  1. Re-run inventory and compare hit deltas by area/hotspots.
  2. Re-run `backend/app` build gates.
  3. Re-run the same high-signal runtime-scope tests (plus changed-area tests).
  4. Run voice smoke bundle:
     - `./scripts/run-test-suite.sh voice`
  5. Re-confirm guardrail: no Mongo/Redis mutation operations executed.

## T7 Docs/Env Contract Cleanup (`copilot-f75b.8`)

### Canonical Documentation Contract (post-T7)
- Runtime isolation is now documented as deployment/database separation (separate DB/instance per environment).
- `runtime_tag` is documented as transitional metadata only and is not a canonical operational isolation mechanism.
- Canonical Voice API/docs no longer require clients to depend on `runtime_mismatch` semantics.
- Queue/poller lock documentation now references env-stable naming (environment suffix), not runtime-tag suffixes.

### Updated Canonical Docs
- `AGENTS.md`
- `README.md`
- `docs/VOICEBOT_API.md`

### Note On Historical Sections In This Document
- The remaining sections below preserve the original 2026-03-04 baseline inventory and risk analysis snapshot.
- Treat those sections as migration context/history, not as current operational contract.

## Executive Summary
- `runtime_tag` is currently a **core isolation primitive** in backend runtime logic, data access proxying, queue naming, and API compatibility behavior.
- In source code (`backend/src`) there are **200 direct runtime-scope hits** (`runtime_tag`, `RUNTIME_TAG`, `mergeWithRuntimeFilter`, `buildRuntimeFilter`).
- Runtime scoping is centralized in:
  - `backend/src/services/runtimeScope.ts`
  - `backend/src/services/db.ts`
- `RUNTIME_SCOPED_COLLECTIONS` currently contains **41 collections**.
- Current env layout still points both dev and prod to the same DB name (`DB_NAME=stratodb` in both `.env.development` and `.env.production`), and there is no stage-mode PM2/env profile yet.

## Current Runtime Isolation Model

### 1) Runtime identity derivation
- File: `backend/src/services/runtimeScope.ts`
- Runtime is derived from env:
  - `VOICE_RUNTIME_ENV` -> family (`prod|dev`)
  - `VOICE_RUNTIME_SERVER_NAME` -> host part
  - `VOICE_RUNTIME_TAG` (explicit override) or fallback `${family}-${server}`.
- `IS_PROD_RUNTIME` enables special compatibility behavior:
  - family match `^prod(?:-|$)`,
  - include legacy rows with missing/empty `runtime_tag`.

### 2) DB proxy and automatic scope enforcement
- File: `backend/src/services/db.ts`
- `getDb()` returns runtime-scoped proxy:
  - injects runtime filter into read ops,
  - injects `runtime_tag` on inserts/upserts,
  - patches `$lookup` pipelines for runtime-scoped collections.
- `getRawDb()` bypasses proxy and is used in selected paths.

### 3) Collection-level scope registry
- File: `backend/src/services/runtimeScope.ts`
- `RUNTIME_SCOPED_COLLECTIONS` contains 41 collections across:
  - VoiceBot sessions/messages/topics,
  - CRM tasks/comments/work-hours,
  - FinOps entities,
  - reports/integration caches.

### 4) Queue/runtime naming dependency
- File: `backend/src/constants.ts`
- Voice queues are suffixed with `RUNTIME_TAG`:
  - e.g. `voicebot--common-${RUNTIME_TAG}`.
- Additional runtime-scoped keys also include `RUNTIME_TAG`:
  - worker scheduler IDs (`backend/src/workers/voicebot/runner.ts`),
  - TG poller lock key (`backend/src/voicebot_tgbot/runtime.ts`).

## Usage Map (By Area)

### A) Highest concentration by module (from `backend/src`)
- `api/routes/voicebot/*`: 58 hits
- `workers/voicebot/*`: 39 hits
- `voicebot_tgbot/*`: 33 hits
- `services/db.ts`: 16 hits
- `services/runtimeScope.ts`: 14 hits

### B) API/session access and compatibility contracts
- `backend/src/api/routes/voicebot/sessions.ts`:
  - extensive runtime filtering,
  - explicit `409 runtime_mismatch` behavior when record exists outside active runtime.
- `backend/src/api/routes/voicebot/uploads.ts`:
  - uses scoped read + raw fallback to return `runtime_mismatch` vs `404`.
- `backend/src/api/routes/voicebot/transcription.ts`:
  - download route reads via `getRawDb()` after permission check.

### C) Raw DB bypass points (intentional exceptions)
- `backend/src/api/routes/voicebot/sessions.ts`:
  - `sessionAccessUtils.resolve` (raw read + mismatch detection),
  - list/get/merge flows using manual runtime-aware filters.
- `backend/src/api/routes/voicebot/uploads.ts`:
  - raw read for mismatch detection.
- `backend/src/api/routes/voicebot/transcription.ts`:
  - download path via raw collections.
- `backend/src/miniapp/routes/index.ts`:
  - debug-mode raw read for tickets (`IS_MINIAPP_DEBUG_MODE=true`).
- `backend/src/api/routes/crm/projects.ts`:
  - raw DB used to access Mongo client/session for transaction setup.

### D) Data/index schema coupling
- `backend/src/constants.ts` startup indexes include `runtime_tag`:
  - `automation_tasks`: `(is_deleted, task_status, runtime_tag)`
  - `automation_work_hours`: `(ticket_db_id, runtime_tag)`.
- `backend/scripts/runtime-tag-backfill.ts` assumes shared DB and fills missing tags.

### E) Test and doc surface area
- Tests reference runtime-scope contracts heavily (`~135 hits` across test dirs), including:
  - `runtime_mismatch` response semantics,
  - prod-family compatibility (`prod` + `prod-*` + legacy empty tags),
  - runtime-tag writes on insert/upsert.

## Gaps Relative To Target Architecture (`prod/stage/dev` DB split)

1. **Environment split is incomplete**
- PM2/env pipeline currently defines `dev/prod/local`, no `stage`.
- Dev/prod env files both point to same DB name (`stratodb`).

2. **`runtime_mismatch` depends on shared-DB visibility**
- Current 409 contract depends on being able to detect “exists in another runtime” from the same DB.
- After strict DB split, this signal disappears unless cross-DB lookup is introduced.

3. **Core infra assumes `runtime_tag` in entities**
- DB proxy, indexes, and many tests depend on field existence and matching.

4. **Redis/queues are namespaced by runtime tag**
- Strategy must define whether queue isolation remains tag-based or moves to per-env Redis plus simplified naming.

## Deprecation Strategy (No Code Changes In This Task)

### Phase 0: Preconditions and decision record
- Approve target topology:
  - DB per environment: `copilot_prod`, `copilot_stage`, `copilot_dev` (names illustrative),
  - decide Redis isolation strategy (shared-with-prefix vs per-env Redis).
- Decide future of `runtime_mismatch` contract:
  - keep via cross-DB check, or
  - deprecate to plain `404` after split.

### Phase 1: Environment/database separation (keep `runtime_tag` temporarily)
- Add explicit stage runtime profile:
  - `backend/.env.stage`, PM2 stage apps, deploy docs.
- Point each environment to dedicated `MONGODB_CONNECTION_STRING` + `DB_NAME`.
- Keep existing runtime filters/tag writes enabled as temporary safety net.
- Add startup health check asserting DB target identity (env -> expected DB).

### Phase 2: Compatibility hardening before field removal
- Eliminate remaining `getRawDb()` usages where not strictly required.
- For required raw paths, isolate reason and add explicit comments/tests.
- Stop relying on prod-family + legacy-empty compatibility for new writes.
- Backfill and lock historical rows for deterministic migration.

### Phase 3: Remove runtime-tag from data model
- Remove runtime-tag injection from DB proxy (`withRuntimeTag`, `patchRuntimeTagIntoSetOnInsert`).
- Remove runtime filter auto-merge from runtime-scoped operations.
- Drop `runtime_tag` from startup indexes and recreate replacement indexes.
- Remove `runtime-tag-backfill` script and related migration-only contracts.

### Phase 4: API/worker/test contract cleanup
- Update API behavior for cross-runtime scenarios (if 409 contract changes).
- Update tests:
  - remove assertions tied to `runtime_tag`,
  - replace with env-isolated DB integration checks.
- Update docs (`AGENTS.md`, `README.md`, Voice API docs) to new isolation model.

## Recommended Rollout Order
1. Split DB endpoints first (safe infra boundary).
2. Keep `runtime_tag` logic for one stabilization window.
3. Measure: no cross-env leakage with DB split alone.
4. Remove field-level runtime logic in controlled PR series.
5. Remove legacy compatibility branches and migrate tests/docs.

## Risk Register
- High: silent behavior drift in `runtime_mismatch` API contract.
- High: index regressions when removing `runtime_tag` compound keys.
- Medium: hidden reliance on `getRawDb()` in merge/download/debug paths.
- Medium: queue/lock collisions if Redis namespace strategy is changed without migration.

## Suggested Implementation Epic Breakdown
- T1 Infra: add stage env/profile + split DB names for prod/dev/stage.
- T2 Contract: decide and codify `runtime_mismatch` post-split semantics.
- T3 Data layer: make runtime scope optional via feature flag.
- T4 Migrations: remove `runtime_tag` writes/filters/indexes in phased PRs.
- T5 QA: replace runtime-tag tests with environment-isolation tests.
