# Copilot Ontology Workspace

This directory is the canonical home for ERD and ontology artifacts used by Copilot.

## Purpose

- Keep conceptual data model documents (ERD/protocol) close to executable ontology assets.
- Treat `copilot` ontology as the reusable kernel for per-project ontology overlays.
- Treat project-local SemanticCards and AFS layouts as part of the ontology surface, not just project docs.
- Provide one place where agents can understand domain structure before touching backend/frontend contracts.
- Avoid drift between planning documents and TypeDB schema/mapping implementation.

## Canonical Files

- `str-opsportal-erd-draft-v0.md` — consolidated ERD draft for STR OpsPortal domains.
- `fpf-erd-extraction-protocol-str-opsportal.md` — extraction protocol used to derive ERD from source systems.
- `typedb/schema/str-ontology.tql` — canonical generated TypeQL schema.
- `typedb/schema/str-ontology.yaml` — canonical generated TOON aggregate.
- `typedb/schema/fragments/*/*.toon.yaml` — canonical editable TOON source fragments (`kernel`, `as_is`, `to_be`, `bridges`).
- `typedb/mappings/mongodb_to_typedb_v1.yaml` — mapping contract from Mongo collections to TypeDB entities/relations.
- `typedb/queries/validation_v1.tql` — validation/smoke queries.
- `typedb/docs/rollout_plan_v1.md` — rollout and migration notes.
- `plan/ontology-and-operations.md` — implemented architecture roadmap for the object-bound ontology model.
- `plan/toon-source-migration.md` — active migration plan for TOON source, generator, and inventory layout.
- `typedb/inventory_latest/entity_sampling_latest.md` — Mongo-backed full-doc verification samples and compact TOON examples.
- `typedb/inventory_latest/domain_inventory_latest.md` and `typedb/inventory_latest/domain_inventory_latest.json` — canonical latest domain inventory outputs for TOON-marked dictionary-like attributes.
- `typedb/docs/semantic-glossary.md` plus `ontology/typedb/docs/bounded_context_bridge_rules_v1.md`, `ontology/typedb/docs/semantic_cards_workflow_v1.md`, and `ontology/typedb/docs/object_history_and_output_contract_v1.md` — LLM-facing semantic glossary for the ontology kernel.
- `typedb/docs/status_domain_inventory_2026-03-08.md` — data-backed status-domain split for live Mongo object families.
- `typedb` AS-IS layer explicitly separates `person` and `performer_profile`; do not collapse `automation_persons` and `automation_performers` into one ontology object.
- TOON-marked kernel attributes are the source of truth for dictionary-like field inspection and generated inline domain values in `str-ontology.tql`.
- Ontology-specific implementation plans live under `ontology/plan/`.
- Current migration plan for TOON source lives at `ontology/plan/toon-source-migration.md`.

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

- Ontology sync wave `copilot-gym6.1`..`copilot-gym6.5` delivered a runtime-parity baseline for Voice/OperOps/Codex:
  - gap matrix source-of-truth: `typedb/docs/runtime_contract_gap_matrix_v1.md`,
  - schema extended for Codex/task lineage + deferred review fields + `project.git_repo`,
  - new relation `voice_session_sources_oper_task` introduced for session-origin task linkage.
- MongoDB -> TypeDB mapping contract now includes expanded `automation_tasks` Codex/runtime fields and `automation_projects.git_repo`.
- Validation artifacts were refreshed:
  - `typedb/queries/validation_v1.tql` includes task/codex quality gates (lineage, deferred due-at, project git_repo, runtime-tag counters),
  - `typedb/scripts/typedb-ontology-validate.py` anchor checks were corrected to avoid incompatible attribute-type comparisons in TypeDB 3 inference.
- Ingestion tooling alignment:
  - `typedb/scripts/typedb-ontology-ingest.py` now runs `automation_tasks` through mapping-driven ingestion path to reduce schema/mapping drift.
- Reproducible operator runbook (executed in this wave):
  1. `cd /home/strato-space/copilot/backend && npm run ontology:typedb:py:setup`
  2. `cd /home/strato-space/copilot/backend && set -a && source .env.development && set +a`
  3. `export MONGODB_CONNECTION_STRING="mongodb://${MONGO_USER}:${MONGO_PASSWORD}@${MONGODB_HOST}:${MONGODB_PORT}/${DB_NAME}?authSource=admin&directConnection=true"`
  4. `npm run ontology:typedb:ingest:dry`
  5. `npm run ontology:typedb:ingest:apply -- --init-schema --limit 5 --collections automation_projects,automation_tasks,automation_voice_bot_sessions,automation_voice_bot_messages,automation_voice_bot_session_log,automation_voice_bot_session_merge_log`
  6. `npm run ontology:typedb:validate`

- Deep runtime-contract alignment (`copilot-aonw`) added Voice merge-log ontology coverage plus expanded session/message/session-log fields for anchors, dedup hashes, runtime diagnostics, and merge traceability.
- Validation suite was expanded with runtime-quality gates (orphan session/merge logs, image-anchor integrity, runtime-tag completeness, and close-flow `done_at` consistency checks).
- TypeDB ontology assets were reconciled with production MongoDB structure:
  - schema: `typedb/schema/str-ontology.tql`
  - mappings: `typedb/mappings/mongodb_to_typedb_v1.yaml`
  - ingestion tooling: `typedb/scripts/typedb-ontology-ingest.py`
- Ingestion pipeline now supports broader mapping-driven coverage and safer idempotent relation writes.
- Full ontology apply+validate run completed successfully for target DB `str_opsportal_v1`.
- Orphan voice-message investigation artifacts are stored in `ontology/orphan/`.
- Data cleanup was partially applied after review:
  - one recoverable orphan session was restored as a PMO stub session,
  - remaining low-value orphan messages without reliable linkage were removed from MongoDB.

## Session Outcome (2026-03-03)

- Deep ontology refresh (`copilot-3opd`) synchronized schema/mapping/ingest with current software contracts across Voice, OperOps/Codex, and FinOps.
- Schema contract updates:
  - `voice_session` now owns summary persistence fields (`summary_md_text`, `summary_saved_at`).
  - `forecast_project_month` now owns full forecast payload used by backend (`source_type`, `forecast_hours`, `forecast_cost_rub`, `rate_rub_per_hour_snapshot`, `fx_used`, `comment`, `updated_by`, `updated_source`, `updated_at`).
  - alignment fixes for mapping-owned fields in `project_group`, `person`, `oper_task`, `cost_category`, `fx_monthly`.
- Mapping contract updates:
  - `automation_voice_bot_sessions` now maps `summary_md_text` and `summary_saved_at`.
  - `automation_tasks` coalesce extended for `issue_type <- issue_type|type`.
  - `forecasts_project_month` maps `rate_rub_per_hour_snapshot` and `fx_used`.
- Ingestion runtime updates:
  - generic mapping ingester now supports `coalesce` field resolution and status normalization for bool-backed status fields.
  - selected collections switched from reduced custom ingestion to mapping-driven ingestion (`automation_customers`, `automation_projects`, `forecasts_project_month`, `finops_expense_categories`, `finops_expense_operations`, `finops_fx_rates`).
- Validation/gates updates:
  - added summary persistence checks (`summary_saved_at` <-> `summary_md_text`) in TypeDB validation script/query pack.
- Verification runbook executed successfully:
  1. `npm run ontology:typedb:ingest:dry`
  2. `npm run ontology:typedb:ingest:apply -- --init-schema --limit 200 --collections automation_customers,automation_projects,automation_project_groups,automation_tasks,automation_voice_bot_sessions,forecasts_project_month,finops_expense_categories,finops_expense_operations,finops_fx_rates`
  3. `npm run ontology:typedb:validate`
  4. No new critical orphan regressions introduced; legacy runtime-tag/orphan-message warnings remain visible as expected diagnostics.
