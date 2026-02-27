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
