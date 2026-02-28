# STR OpsPortal Ontology (TypeDB)

This folder contains a first executable scaffold of the STR OpsPortal ontology in TypeDB/TypeQL, derived from:
- `/home/strato-space/copilot/ontology/str-opsportal-erd-draft-v0.md`

## Source Of Truth And Boundaries

- Ontology scope and coordination rules are documented in:
  - `/home/strato-space/copilot/ontology/README.md`
  - `/home/strato-space/copilot/ontology/AGENTS.md`
  - `/home/strato-space/copilot/ontology/typedb/AGENTS.md`
- This `typedb/` directory is for ontology assets and tooling only.
- Runtime API behavior for Copilot Voice/OperOps/FinOps stays in repo root docs (`AGENTS.md`, `README.md`) and backend/app code contracts.
- Do not introduce alternative ontology entrypoints in `backend/scripts`; canonical tooling paths are `ontology/typedb/scripts/*`.

## Minimal Context From 2026-02-27 Migration

- TypeDB tooling paths were hard-switched from backend-local scripts to `ontology/typedb/scripts/*`.
- `backend/package.json` `ontology:typedb:*` commands are the stable operator interface and now resolve into `ontology/typedb`.
- For ingestion defaults, keep schema/deadletter locations script-relative to avoid cwd-dependent behavior.
- Future ontology updates must not restore old backend-local script copies (`backend/scripts/typedb-*`, `backend/requirements-typedb.txt`).

## Runtime Contract Alignment (2026-02-28, copilot-aonw)

- Voice ontology now models current runtime diagnostics and lifecycle fields explicitly:
  - `voice_session`: pending image-anchor pointer fields, merge markers, close-flow counters, and transcription/error diagnostics.
  - `voice_message`: hash/dedup metadata, anchor linkage metadata, transcription/categorization error fields, and file metadata envelope fields.
  - `history_step`: event payload fields (`event_name`, `event_group`, `actor`, `target`, `diff`, `metadata`, correlation IDs, replay flag, runtime tag).
- Added `voice_session_merge_log` entity plus `voice_session_has_merge_log` relation to ingest and query merge audit records from `automation_voice_bot_session_merge_log`.
- Validation checks now include:
  - orphan session-log and merge-log checks,
  - image-anchor consistency checks,
  - runtime-tag completeness counters for runtime-scoped voice collections,
  - close-contract check (`is_active=false` + `to_finalize=true` implies `done_at` exists).

## Runtime Contract Alignment (2026-02-28, copilot-gym6)

- Added cross-artifact gap baseline: `docs/runtime_contract_gap_matrix_v1.md` (runtime contract -> ontology coverage -> required change).
- Extended `schema/str_opsportal_v1.tql` for OperOps/Codex task lifecycle:
  - `project` now owns `git_repo`,
  - `oper_task` includes source lineage (`source_ref`, `external_ref`, `source_kind`, `source_data`), Codex review lifecycle fields, and `runtime_tag`,
  - new relation `voice_session_sources_oper_task` links session-origin tasks.
- Updated `mappings/mongodb_to_typedb_v1.yaml`:
  - mapped `automation_projects.git_repo`,
  - expanded `automation_tasks` mapping with Codex/runtime fields and session-link relation.
- Updated validation artifacts:
  - `queries/validation_v1.tql` now includes OperTask/Codex gates (lineage, deferred review due-at, project git_repo, task runtime-tag counters),
  - `scripts/typedb-ontology-validate.py` includes equivalent aggregate checks and TypeDB-3-safe image-anchor diagnostics.
- Ingest script alignment:
  - `scripts/typedb-ontology-ingest.py` now routes `automation_tasks` through the mapping-driven path to minimize schema/mapping/script drift.

## Contents

- `scripts/typedb-ontology-ingest.py` - MongoDB -> TypeDB ingestion tool
- `scripts/typedb-ontology-validate.py` - ontology validation checks
- `scripts/run-typedb-python.sh` - helper launcher for ontology Python venv
- `scripts/requirements-typedb.txt` - Python dependencies for ontology tooling
- `schema/str_opsportal_v1.tql` - ontology schema (entities, attributes, relations)
- `mappings/mongodb_to_typedb_v1.yaml` - MongoDB to TypeDB mapping contract
- `queries/validation_v1.tql` - validation and smoke-check queries
- `docs/rollout_plan_v1.md` - phased implementation plan

## Scope of v1 scaffold

This is a practical v1 base for implementation:
- Covers core Guide, OperOps, Voice pipeline, and FinOps concepts.
- Prioritizes entities and relations that already have MongoDB representation.
- Keeps polymorphic links (`EvidenceLink`, `EntityAttachment`) as explicit bridge entities for now.

## Assumptions

- IDs are ingested as strings in TypeDB, even when source MongoDB fields are ObjectId/int.
- Time fields are mapped to `datetime` where stable; otherwise stored as string and normalized later.
- Legacy schema drift (`status` vs `task_status`, mixed id types) is handled in ingestion mapping.

## Next execution steps

1. Import schema into an isolated TypeDB database (`str_opsportal_v1`).
2. Implement batch ingestion from collections listed in mapping.
3. Run `queries/validation_v1.tql` after each ingestion phase.
4. Add missing spec-only entities as source collections appear (`facts_project_month`, `fx_monthly`, etc.).

## Runtime versions (validated)

- TypeDB server: `typedb/typedb:3.x` (validated on `3.8.0`)
- Python gRPC driver: `typedb-driver==3.8.0`

## Migration policy

- Migration target is **TypeDB 3.x only**.
- Backward compatibility with TypeDB 2.x is intentionally dropped.
- Ontology ingestion/validation scripts run via **Python gRPC driver**.
- Runtime contract: `TYPEDB_ADDRESSES`, `TYPEDB_USERNAME`, `TYPEDB_PASSWORD`, `TYPEDB_TLS_ENABLED`.

## Backend commands

From `copilot/backend`:

- `npm run ontology:typedb:py:setup`
- `npm run ontology:typedb:ingest:dry`
- `npm run ontology:typedb:ingest:apply -- --init-schema`
- `npm run ontology:typedb:validate`

### Operator Runbook (Dev, Verified 2026-02-28)

1. Prepare Python env:
   - `cd /home/strato-space/copilot/backend && npm run ontology:typedb:py:setup`
2. Load backend env and construct Mongo URI if needed:
   - `set -a && source .env.development && set +a`
   - `export MONGODB_CONNECTION_STRING="mongodb://${MONGO_USER}:${MONGO_PASSWORD}@${MONGODB_HOST}:${MONGODB_PORT}/${DB_NAME}?authSource=admin&directConnection=true"`
3. Run dry ingestion:
   - `npm run ontology:typedb:ingest:dry`
4. Sync schema/apply sample (optional but useful when local TypeDB schema drifts):
   - `npm run ontology:typedb:ingest:apply -- --init-schema --limit 5 --collections automation_projects,automation_tasks,automation_voice_bot_sessions,automation_voice_bot_messages,automation_voice_bot_session_log,automation_voice_bot_session_merge_log`
5. Run validation:
   - `npm run ontology:typedb:validate`

Note: `directConnection=true` avoids replica-set internal-hostname resolution issues observed in dev when only external host/IP is reachable.

## Operational Contract

- `backend/package.json` npm aliases `ontology:typedb:*` are the stable operator interface; keep names backward-compatible.
- Script defaults are script-relative and must continue to work from `copilot/backend` commands.
- Any schema/mapping breaking change must be reflected in:
  - `ontology/typedb/docs/rollout_plan_v1.md`
  - `CHANGELOG.md` (repo root)
  - `AGENTS.md` (repo root) if operational workflow changes.

Optional runtime args/env:

- `--typedb-addresses` / `TYPEDB_ADDRESSES` (comma-separated, default `127.0.0.1:1729`; Python driver uses first)
- `--typedb-username` / `TYPEDB_USERNAME` (default `admin`)
- `--typedb-password` / `TYPEDB_PASSWORD` (default `password`)
- `--typedb-tls-enabled` / `TYPEDB_TLS_ENABLED` (default `false`)
