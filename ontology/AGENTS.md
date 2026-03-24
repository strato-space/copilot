# Ontology Agent Notes

Scope: `/home/strato-space/copilot/ontology`

## What belongs here

- ERD drafts and extraction protocols.
- TypeDB schema/mapping/query assets.
- TypeDB ingestion/validation helper scripts and their local dependency file.

## What does not belong here

- Runtime API handlers (keep in `backend/src`).
- Frontend UI logic (keep in `app/src`).
- Ad-hoc duplicates of TypeDB tooling under `backend/scripts`.

## Required Reading Order (for ontology tasks)

1. `ontology/README.md`
2. `ontology/typedb/README.md`
3. `ontology/typedb/AGENTS.md`
4. Repo root `AGENTS.md` (for runtime/product constraints if task touches APIs/UI)

## Change Discipline

- Keep schema and mapping changes atomic and documented.
- Treat `ontology/typedb/schema/fragments/*.tql` as editable source of truth and `ontology/typedb/schema/str-ontology.tql` as the generated artifact.
- Treat `copilot` ontology as kernel/common layer for all project-local ontology overlays.
- Keep the ontology planning family role-separated:
  - `ontology/plan/voice-dual-stream-ontology.md` defines the voice/task domain ontology;
  - `ontology/plan/ontology-persistence-system-needs.*` define generic persistence requirements;
  - `ontology/plan/ontology-persistence-db-spec.md` defines the generic persistence architecture;
  - `ontology/plan/voice-ontology-persistence-alignment-spec.md` binds the voice/task ontology to that generic persistence kernel.
- Keep project-local SemanticCards aligned with ontology changes whenever object semantics change.
- Keep DB-side owner-level `@values(...)` constraints intact for task/task-view status and priority; do not reintroduce unconstrained raw-label writes.
- Treat executor-layer objects (`task_family`, `executor_role`, `executor_routing`, `task_execution_run`) as active kernel vocabulary, not speculative prose-only terms.
- If schema/mapping changes affect runtime assumptions, update:
  - `/home/strato-space/copilot/AGENTS.md`
  - `/home/strato-space/copilot/README.md`
  - `/home/strato-space/copilot/CHANGELOG.md`
- Prefer additive evolution of ontology artifacts; avoid destructive renames without migration notes.

## Commands

Run ontology tooling via backend npm aliases (stable operator contract):

- `cd /home/strato-space/copilot/backend && npm run ontology:typedb:py:setup`
- `cd /home/strato-space/copilot/backend && npm run ontology:typedb:build`
- `cd /home/strato-space/copilot/backend && npm run ontology:typedb:ingest:dry`
- `cd /home/strato-space/copilot/backend && npm run ontology:typedb:ingest:apply -- --init-schema`
- `cd /home/strato-space/copilot/backend && npm run ontology:typedb:validate`

## Recent Updates

- 2026-03-25: Rehomed the dual-stream voice ontology into `ontology/plan/voice-dual-stream-ontology.md`, added the generic ontology-persistence spec family plus the voice-domain bridge spec, and aligned plan documents to reference the ontology-local canonical source instead of the old repo-root `plan/` path.

- 2026-02-28: `copilot-gym6.1`..`copilot-gym6.5` completed ontology runtime-parity wave:
  - gap matrix baseline added: `ontology/typedb/docs/runtime_contract_gap_matrix_v1.md`,
  - schema + mapping extended for Codex/task lineage, deferred review lifecycle, `project.git_repo`, and task runtime tagging,
  - `voice_session_sources_task` relation added and mapped from `automation_tasks.source_ref`.
- 2026-02-28: Validation pack/tooling refreshed for TypeDB 3 compatibility:
  - `ontology/typedb/queries/validation_v1.tql` now covers task/codex quality gates,
  - `ontology/typedb/scripts/typedb-ontology-validate.py` anchor checks were rewritten to avoid incompatible attribute-type joins (`pending_image_anchor_message_id` vs `voice_message_id`).
- 2026-02-28: Ingestion tooling alignment:
  - `ontology/typedb/scripts/typedb-ontology-ingest.py` runs `automation_tasks` via mapping-driven ingestion path to reduce YAML/script drift.
- 2026-02-28: Operational runbook note for dev env:
  - when `.env.development` lacks `MONGODB_CONNECTION_STRING`, construct it from `MONGO_USER/MONGO_PASSWORD/MONGODB_HOST/MONGODB_PORT/DB_NAME` and include `directConnection=true` to avoid replica-set internal-hostname DNS failures.
- 2026-02-28: `copilot-aonw` completed deep runtime-contract ontology refresh for Voice domain (schema/mapping/validation/docs), including merge-log representation and anchor/dedup/error diagnostics fields.
- 2026-02-28: Expanded `typedb/schema/str_opsportal_v1.tql` and `typedb/mappings/mongodb_to_typedb_v1.yaml` to cover additional MongoDB collections and attributes.
- 2026-02-28: Upgraded `typedb/scripts/typedb-ontology-ingest.py` with mapping-driven generic ingestion, relation idempotency checks, and datetime normalization for TypeDB compatibility.
- 2026-02-28: Completed full apply+validate cycle against production MongoDB source and local TypeDB target (`str_opsportal_v1`) with successful validation.
- 2026-02-28: Investigated orphan voice messages, exported forensic payloads to `ontology/orphan/`, created one PMO stub session for recovery, and removed low-value orphan messages with no reliable session linkage.
- 2026-02-28: Registered runtime-diagnostics bug `copilot-k8v3` for incorrect UI rendering of `404 not found` as `runtime mismatch`.
