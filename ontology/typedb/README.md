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
- Generated schema is built from `schema/fragments/*` via `scripts/build-typedb-schema.py`.


## Schema Layout

- `schema/fragments/00-kernel/*` - shared attributes, ids, and reusable base vocabulary
- `schema/fragments/10-as-is/*` - current operational semantics mirrored from Mongo/runtime
- `schema/fragments/20-to-be/*` - target-state semantic model fragments
- `schema/fragments/30-bridges/*` - explicit AS-IS <-> TO-BE bridge semantics
- `schema/str-ontology.tql` - canonical generated schema artifact for ingest/apply

## SemanticCards and Per-Project AFS

- Ontology uses a dual surface:
  - formal surface: TypeQL fragments + generated schema
  - semantic surface: markdown SemanticCards
- Platform-level semantic companion lives at `ontology/typedb/docs/semantic-glossary.md`.
- Each project is expected to have a local AFS root under `/home/strato-space/<project-slug>/` with:
  - `ontology/tql/`
  - `ontology/semantic/`
  - `context/`
  - `artifacts/`
  - `README.md`
  - `AGENTS.md`
- `copilot` ontology is the kernel/common layer. Project ontologies are overlays that extend the kernel with domain-specific semantics and project-local SemanticCards.

## TO-BE and Bridges

- `20-to-be` now models object-bound target semantics aligned with Mode Engine and FPF, not generic memory buckets.
- `30-bridges` now expresses AS-IS -> TO-BE semantic translation for projects, sessions, tasks, object history, and semantic artifacts.
- These layers are for reasoning and traceability only; they are not a runtime CRUD source of truth.

## Current TO-BE Semantic Core

The current `20-to-be` layer defines:
- project/context semantics:
  - `project_context_card`
  - `context_pack`
  - `context_bundle`
- agent/pipeline semantics:
  - `agent_role`
  - `prompt_pipeline`
- Mode Engine semantics:
  - `mode_definition`
  - `mode_segment`
  - `interaction_scope`
  - `aggregation_window`
  - `output_contract`
  - `promise_content`
  - `admissibility_gate`
  - `writeback_gate`
- artifact semantics:
  - `artifact_record`
  - `artifact_patch`
- object-bound lifecycle semantics:
  - `object_revision`
  - `object_event`
  - `object_note`
  - `object_conclusion`
  - `object_manifest`
  - `writeback_decision`
  - `review_annotation`
  - `access_policy`
- task semantics:
  - `target_task_view`
- typed memory classifications:
  - `working_memory`
  - `session_memory`
  - `project_memory`
  - `shared_memory`

The current `30-bridges` layer defines bridge families such as:
- `as_is_project_maps_to_project_context_card`
- `as_is_voice_session_maps_to_mode_segment`
- `as_is_oper_task_maps_to_target_task_view`
- `as_is_possible_task_maps_to_target_task_view`
- `as_is_voice_message_maps_to_object_event`
- `as_is_summary_maps_to_object_conclusion`
- `as_is_attachment_maps_to_artifact_record`

Object-bound bridge / lifecycle semantics live in TO-BE relations such as:
- `object_manifest_assembled_for_context_bundle`
- `writeback_decision_writes_object_note`
- `review_annotation_approves_writeback`
- `access_policy_governs_context_bundle`
- `project_context_card_binds_context_pack`
- `context_pack_supports_mode_definition`

Not in TO-BE core:
- `routing_item_template`
- `routing_item_instance`
- generic standalone memory entities

These remain operational/runtime-facing or are intentionally replaced by object-bound semantics.

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
- Extended `schema/str-ontology.tql` for OperOps/Codex task lifecycle:
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

## Runtime Contract Alignment (2026-03-03, copilot-3opd)

- Schema alignment completed for mapping-owned fields that previously were silently skipped:
  - `project_group`: `project_groups_ids`, `client_id`
  - `person`: `performer_id`
  - `oper_task`: `is_deleted`
  - `forecast_project_month`: `source_type`, `forecast_hours`, `forecast_cost_rub`, `rate_rub_per_hour_snapshot`, `fx_used`, `comment`, `updated_by`, `updated_source`, `updated_at`
  - `cost_category`: `created_by`, `updated_by`
  - `fx_monthly`: `source`, `created_by`, `created_at`
  - `voice_session`: `summary_md_text`, `summary_saved_at`
- Mapping alignment updates:
  - `automation_voice_bot_sessions` includes summary persistence fields.
  - `automation_tasks` includes `issue_type` coalesce (`issue_type | type`) in addition to existing status coalesce.
  - `forecasts_project_month` includes `rate_rub_per_hour_snapshot` and `fx_used`.
- Ingestion engine alignment:
  - `ingest_collection_from_mapping` now supports `coalesce` resolution per attribute.
  - status normalization for bool-backed status sources is applied in generic mapping path (`active`/`inactive`).
  - reduced custom ingesters replaced by mapping-driven ingestion for:
    `automation_customers`, `automation_projects`, `forecasts_project_month`,
    `finops_expense_categories`, `finops_expense_operations`, `finops_fx_rates`.
- Validation pack extended with summary persistence checks:
  - `sessions_summary_saved_at_without_text`
  - `sessions_summary_text_without_saved_at`

## Contents

- `scripts/typedb-ontology-ingest.py` - MongoDB -> TypeDB ingestion tool
- `scripts/typedb-ontology-validate.py` - ontology validation checks
- `scripts/typedb-ontology-domain-inventory.py` - distinct-value inventory for dictionary-like mapped fields
- `scripts/typedb-ontology-entity-sampling.py` - Mongo-backed entity/document sampling for ontology verification and compact TOON examples
- `scripts/run-typedb-python.sh` - helper launcher for ontology Python venv
- `scripts/requirements-typedb.txt` - Python dependencies for ontology tooling
- `schema/str-ontology.tql` - canonical generated ontology schema (deploy artifact)
- `schema/fragments/*` - editable source fragments (`kernel`, `as_is`, `to_be`, `bridges`)
- `mappings/mongodb_to_typedb_v1.yaml` - MongoDB to TypeDB mapping contract
- `queries/validation_v1.tql` - validation and smoke-check queries
- `docs/rollout_plan_v1.md` - phased implementation plan

## Scope of v1 scaffold

This is a practical v1 base for implementation:
- Covers core Guide, OperOps, Voice pipeline, and FinOps concepts.
- Prioritizes entities and relations that already have MongoDB representation.
- Keeps polymorphic links (`EvidenceLink`, `EntityAttachment`) as explicit bridge entities for now.

## Status and Dictionary Domains

`status` is not one shared semantic domain across the platform.

Current live split:
- `activity_state`
  - boolean-derived `active/inactive`
  - used for `client`, `legacy_client`, `project`, `project_group`, `cost_category`, `voice_session`
- `status`
  - workflow/task status alphabet
  - kept for `oper_task`
- `event_status`
  - process/event lifecycle
  - used for `history_step`
- `deletion_state`
  - deleted/present semantics
  - used for `cost_expense`
- no primary status domain
  - `person`, `voice_message`, `voice_topic`, `epic_task`
  - these are governed by booleans or other lifecycle fields, not a meaningful status alphabet

Data-backed inventory references:
- `docs/status_domain_inventory_2026-03-08.md`
- `docs/domain_inventory_latest.md`
- `docs/domain_inventory_marked_only.md`

Primary selector policy:
- inventory fields may be marked inline in `schema/fragments/00-kernel/10-attributes-and-ids.tql` via `# @toon inventory=inspect ...`
- default inventory run is marker-controlled
- CLI may override selection with `--attrs ...`
- `--marked-only` keeps the run strictly on TOON-marked attrs plus explicit CLI attrs
- `--include-heuristics` expands the run beyond TOON-marked attrs when you explicitly want discovery mode

Entity sampling policy:
- verification sampling inspects **all top-level Mongo fields**
- TOON sampling stays compact and ontology-relevant
- defaults:
  - `verify_limit=20`
  - `toon_limit=3`
  - `toon_columns=mapped`
- `toon_columns` modes:
  - `mapped` — key + mapped attrs + relation lookup source fields
  - `minimal` — smaller human/LLM-friendly projection
  - `all` — full top-level fields
- reports:
  - `docs/entity_sampling_latest.md`
  - `docs/entity_sampling_latest.json`

## Person vs Performer Profile

`automation_persons` and `automation_performers` are semantically different and are modeled separately.

- `person`
  - generic contact / participant / human reference
  - sourced from `automation_persons`
- `performer_profile`
  - internal performer/staff/account profile
  - sourced from `automation_performers`

Explicit linkage:
- `person_has_performer_profile`

Performer-backed relations terminate on `performer_profile`:
- `oper_task_assigned_to_performer_profile`
- `performer_profile_creates_work_log`
- `performer_profile_has_legacy_finance_expense`
- `performer_profile_maps_to_employee`

Generic human semantics remain on `person`, for example:
- `transcript_segment_spoken_by_person`

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
- `npm run ontology:typedb:build`
- `npm run ontology:typedb:contract-check`
- `npm run ontology:typedb:domain-inventory`
- `npm run ontology:typedb:entity-sampling`
- `npm run ontology:typedb:ingest:dry`
- `npm run ontology:typedb:ingest:apply -- --init-schema`
- `npm run ontology:typedb:sync:dry`
- `npm run ontology:typedb:sync:apply`
- `npm run ontology:typedb:validate`

### Operator Runbook (Dev, Verified 2026-02-28)

1. Prepare Python env:
   - `cd /home/strato-space/copilot/backend && npm run ontology:typedb:py:setup`
2. Rebuild generated schema:
   - `cd /home/strato-space/copilot/backend && npm run ontology:typedb:build`
3. Load backend env and construct Mongo URI if needed:
   - `set -a && source .env.development && set +a`
   - `export MONGODB_CONNECTION_STRING="mongodb://${MONGO_USER}:${MONGO_PASSWORD}@${MONGODB_HOST}:${MONGODB_PORT}/${DB_NAME}?authSource=admin&directConnection=true"`
4. Run dry ingestion:
   - `npm run ontology:typedb:ingest:dry`
5. Sync schema/apply sample (optional but useful when local TypeDB schema drifts):
   - `npm run ontology:typedb:ingest:apply -- --init-schema --limit 5 --collections automation_projects,automation_tasks,automation_voice_bot_sessions,automation_voice_bot_messages,automation_voice_bot_session_log,automation_voice_bot_session_merge_log`
6. Run validation:
   - `npm run ontology:typedb:validate`
7. For strict kernel-marked dictionary audit only:
   - `python3 ../ontology/typedb/scripts/typedb-ontology-domain-inventory.py --marked-only --mapping ../ontology/typedb/mappings/mongodb_to_typedb_v1.yaml --kernel-attrs ../ontology/typedb/schema/fragments/00-kernel/10-attributes-and-ids.tql --output ../ontology/typedb/docs/domain_inventory_marked_only.md`
8. For discovery mode beyond TOON-marked attrs:
   - `python3 ../ontology/typedb/scripts/typedb-ontology-domain-inventory.py --include-heuristics`
9. For ontology verification sampling (all top-level fields):
   - `python3 ../ontology/typedb/scripts/typedb-ontology-entity-sampling.py --mode verify`
10. For compact TOON examples for LLM context:
   - `python3 ../ontology/typedb/scripts/typedb-ontology-entity-sampling.py --mode toon --toon-columns mapped`

Note: `directConnection=true` avoids replica-set internal-hostname resolution issues observed in dev when only external host/IP is reachable.

## Full vs Incremental Sync

- Full path:
  - `ontology:typedb:ingest:dry`
  - `ontology:typedb:ingest:apply`
- Incremental path:
  - `ontology:typedb:sync:dry`
  - `ontology:typedb:sync:apply`

Current incremental semantics:
- uses sync-state watermarks in `ontology/typedb/logs/typedb-ontology-sync-state.json`
- current safe incremental scope:
  - `automation_projects`
  - `automation_tasks`
  - `automation_voice_bot_sessions`
  - `automation_voice_bot_messages`
- current implementation provides attribute reconcile + relation healing for the current high-value collections, plus source-side tombstone handling for tasks, voice sessions, and voice messages. Other collections still fall back to full-sync / additive behavior unless explicitly extended.
- explicit absence/tombstone policy is documented in:
  - `docs/incremental_absence_policy_v1.md`
- current policy distinguishes:
  - weak evidence: incremental-window absence
  - stronger evidence: collection-classified full-sync absence
  - only `automation_projects` is currently absence-actionable on full sync

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
