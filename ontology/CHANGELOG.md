# Ontology Changelog

## 2026-03-03

### PROBLEM SOLVED

- **22:20** Mapping contract contained fields that were not owned in schema for several entities (`project_group`, `person`, `oper_task`, `forecast_project_month`, `cost_category`, `fx_monthly`), causing silent attribute drops in generic ingestion. Schema ownership was aligned to remove these gaps.
- **22:30** Generic ingestion path did not honor mapping-level `coalesce` rules, so legacy fallback fields (for example task `status` and `type`) could be skipped even when declared in mapping. `coalesce` support was implemented.
- **22:35** A subset of collections still used reduced custom ingesters despite richer mapping definitions, preserving schema/mapping/script drift. Those collections were moved to mapping-driven ingestion where special handling is not required.
- **22:40** Voice session summary persistence fields introduced in backend (`summary_md_text`, `summary_saved_at`) were missing from ontology contract. Schema + mapping + ingestion were updated.

### FEATURE IMPLEMENTED

- **22:32** Added generic mapping ingestion enhancements:
  - attribute-level `coalesce` resolution (`mapping.coalesce`),
  - bool-backed `status` normalization (`active` / `inactive`) in mapping-driven path.
- **22:38** Added validation quality gates for summary persistence:
  - `sessions_summary_saved_at_without_text`,
  - `sessions_summary_text_without_saved_at`.
- **22:42** Added forecast payload coverage for runtime FinOps usage:
  - `rate_rub_per_hour_snapshot`, `fx_used` in mapping + schema ownership.

### CHANGES

- Updated schema: `ontology/typedb/schema/str_opsportal_v1.tql`
  - new attributes: `summary_md_text`, `summary_saved_at`, `rate_rub_per_hour_snapshot`,
  - ownership alignment for mapped fields across Voice/OperOps/FinOps entities.
- Updated mapping: `ontology/typedb/mappings/mongodb_to_typedb_v1.yaml`
  - `automation_voice_bot_sessions`: summary fields,
  - `automation_tasks`: `issue_type` coalesce (`issue_type | type`),
  - `forecasts_project_month`: `rate_rub_per_hour_snapshot`, `fx_used`.
- Updated ingest runtime: `ontology/typedb/scripts/typedb-ontology-ingest.py`
  - mapping `coalesce` support,
  - status normalization in generic mapping path,
  - switched to mapping-driven ingestion for:
    `automation_customers`, `automation_projects`, `forecasts_project_month`,
    `finops_expense_categories`, `finops_expense_operations`, `finops_fx_rates`.
- Updated validation assets:
  - `ontology/typedb/scripts/typedb-ontology-validate.py`
  - `ontology/typedb/queries/validation_v1.tql`
- Updated docs:
  - `ontology/README.md`
  - `ontology/typedb/README.md`

## 2026-02-28

### PROBLEM SOLVED

- **02:50** Voice runtime contracts evolved after software refinements (session merge logs, pending image-anchor flow, upload dedup/hash diagnostics, worker error fields), but ontology ingest still captured only a minimal subset for sessions/messages/logs. Schema and mapping were expanded to eliminate this semantic drift.
- **03:05** Session log fields (`event_name`, `event_group`, `actor`, `target`, `diff`, correlation metadata) were mostly dropped because `history_step` ownership was too narrow. Ownership now matches runtime payload shape, so ingestion no longer silently truncates event semantics.
- **03:15** Merge-session audit collection (`automation_voice_bot_session_merge_log`) had no ontology representation, preventing lineage diagnostics in TypeDB. A dedicated merge-log entity and relation to target session were added.
- **00:10** Production MongoDB structure and ontology artifacts diverged, causing missing attributes/entities in TypeDB representation and incomplete relation graph after ingestion. The ontology schema and mapping were aligned with current production collections to restore structural parity.
- **00:35** TypeDB apply runs produced datetime-type ingestion errors for timezone-aware values. Datetime normalization in ingest tooling was updated to enforce TypeDB-compatible naive UTC literals.
- **01:20** Voice-message data quality checks showed orphan messages referencing non-existent sessions, reducing analytical reliability. Orphan records were audited, exported, and cleaned up with a controlled recovery path for one recoverable session ID.

### FEATURE IMPLEMENTED

- **03:25** Added explicit ontology coverage for runtime voice diagnostics:
- `voice_session`: pending-anchor pointers, merge markers, close counters, and transcription error surface.
- `voice_message`: hash/dedup fields, anchor linkage metadata, categorization/transcription error payload fields, file metadata envelope.
- `history_step`: session/message/project/event metadata and runtime-tag ownership.
- **03:30** Added `voice_session_merge_log` entity + `voice_session_has_merge_log` relation and mapped merge-audit documents to target sessions.
- **03:40** Extended validation checks (`typedb-ontology-validate.py` + `queries/validation_v1.tql`) with runtime contract gates:
- orphan session-log and merge-log detection,
- anchor linkage consistency checks,
- runtime-tag completeness counters on runtime-scoped voice collections,
- close-flow consistency (`is_active=false` + `to_finalize=true` requires `done_at`).
- **00:25** Mapping-driven generic ingestion path was implemented for ontology collections beyond legacy hardcoded handlers, enabling faster onboarding of newly documented MongoDB entities.
- **00:45** Ingestion idempotency was improved with pre-insert existence checks for entities and relations to support repeatable apply runs with lower duplication risk.
- **01:05** Orphan investigation package was added under `ontology/orphan/` with per-message JSON exports and analytical README context for operator review and data-governance traceability.

### CHANGES

- **03:20** Updated `ontology/typedb/schema/str_opsportal_v1.tql`:
- Added runtime-era voice attributes (`pending_image_anchor_*`, `image_anchor_*`, `file_hash`, `hash_sha256`, dedup markers, transcription/categorization error fields, `done_count`, merge/audit fields).
- Added `voice_session_merge_log` entity and `voice_session_has_merge_log` relation.
- Expanded ownership for `voice_session`, `voice_message`, `history_step`.
- **03:22** Updated `ontology/typedb/mappings/mongodb_to_typedb_v1.yaml`:
- Expanded `automation_voice_bot_sessions`, `automation_voice_bot_messages`, `automation_voice_bot_session_log` field mappings.
- Added mapping for `automation_voice_bot_session_merge_log` with relation to `voice_session`.
- **03:24** Updated `ontology/typedb/scripts/typedb-ontology-ingest.py`:
- Added `automation_voice_bot_session_merge_log` to supported collections.
- Expanded custom voice session/message ingestion to persist current runtime fields while keeping transcript safety chunking.
- Added capped JSON-string helper to prevent oversized attribute payloads from breaking TypeDB writes.
- **03:42** Updated validation assets:
- `ontology/typedb/scripts/typedb-ontology-validate.py`
- `ontology/typedb/queries/validation_v1.tql`
- **03:45** Updated ontology docs for new runtime contract alignment:
- `ontology/README.md`
- `ontology/AGENTS.md`
- `ontology/typedb/README.md`
- `ontology/typedb/AGENTS.md`
- `ontology/typedb/docs/rollout_plan_v1.md`
- **00:20** Expanded ontology schema in `ontology/typedb/schema/str_opsportal_v1.tql` with additional entities, attributes, and relation definitions required by production collections.
- **00:22** Expanded MongoDB mapping contract in `ontology/typedb/mappings/mongodb_to_typedb_v1.yaml` to cover additional collections and relation wiring.
- **00:40** Updated `ontology/typedb/scripts/typedb-ontology-ingest.py`:
- Added mapping metadata loading and schema introspection helpers.
- Added generic collection ingester for mapping-defined entities.
- Added entity/relation existence checks and relation skip accounting.
- Added datetime normalization fix for TypeDB datetime compatibility.
- **00:41** Updated Python dependency list in `ontology/typedb/scripts/requirements-typedb.txt` (includes YAML parsing dependency used by mapping-driven ingestion).
- **00:55** Updated TypeDB documentation and operational notes:
- `ontology/typedb/README.md`
- `ontology/typedb/AGENTS.md`
- **01:15** Added ontology workspace docs:
- `ontology/AGENTS.md`
- `ontology/README.md`
- **01:30** Added orphan analysis artifacts:
- `ontology/orphan/README.md`
- `ontology/orphan/automation_voice_bot_messages/*.json`
- **01:35** Data operation summary (MongoDB runtime, out-of-repo but tied to this ontology cleanup):
- Created PMO stub session `6870c15d8b055b47afb956af` to recover valid linkage for two messages.
- Removed six low-value orphan messages with no reliable session linkage.
- **01:36** Registered follow-up product bug `copilot-k8v3` (404 not found rendered as runtime mismatch in Voice SessionPage diagnostics).
