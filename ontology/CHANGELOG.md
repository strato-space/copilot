# Ontology Changelog

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
