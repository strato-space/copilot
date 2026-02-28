# Copilot Ontology Workspace

This directory is the canonical home for ERD and ontology artifacts used by Copilot.

## Purpose

- Keep conceptual data model documents (ERD/protocol) close to executable ontology assets.
- Provide one place where agents can understand domain structure before touching backend/frontend contracts.
- Avoid drift between planning documents and TypeDB schema/mapping implementation.

## Canonical Files

- `str-opsportal-erd-draft-v0.md` — consolidated ERD draft for STR OpsPortal domains.
- `fpf-erd-extraction-protocol-str-opsportal.md` — extraction protocol used to derive ERD from source systems.
- `typedb/schema/str_opsportal_v1.tql` — TypeQL schema.
- `typedb/mappings/mongodb_to_typedb_v1.yaml` — mapping contract from Mongo collections to TypeDB entities/relations.
- `typedb/queries/validation_v1.tql` — validation/smoke queries.
- `typedb/docs/rollout_plan_v1.md` — rollout and migration notes.

## Key Rules

- Treat `AGENTS.md` and `README.md` at repo root as source of truth for runtime interface contracts.
- Treat `ontology/*` as source of truth for conceptual model and TypeDB scaffolding.
- Do not place new ontology scripts back under `backend/scripts`; use `ontology/typedb/scripts/*`.
- Keep schema/mapping updates synchronized with docs and changelog.

## Entry Points

- Human/operator context: `ontology/AGENTS.md`
- TypeDB tooling usage: `ontology/typedb/README.md`
- TypeDB editing/ops constraints: `ontology/typedb/AGENTS.md`

## Session Outcome (2026-02-28)

- Deep runtime-contract alignment (`copilot-aonw`) added Voice merge-log ontology coverage plus expanded session/message/session-log fields for anchors, dedup hashes, runtime diagnostics, and merge traceability.
- Validation suite was expanded with runtime-quality gates (orphan session/merge logs, image-anchor integrity, runtime-tag completeness, and close-flow `done_at` consistency checks).
- TypeDB ontology assets were reconciled with production MongoDB structure:
  - schema: `typedb/schema/str_opsportal_v1.tql`
  - mappings: `typedb/mappings/mongodb_to_typedb_v1.yaml`
  - ingestion tooling: `typedb/scripts/typedb-ontology-ingest.py`
- Ingestion pipeline now supports broader mapping-driven coverage and safer idempotent relation writes.
- Full ontology apply+validate run completed successfully for target DB `str_opsportal_v1`.
- Orphan voice-message investigation artifacts are stored in `ontology/orphan/`.
- Data cleanup was partially applied after review:
  - one recoverable orphan session was restored as a PMO stub session,
  - remaining low-value orphan messages without reliable linkage were removed from MongoDB.
