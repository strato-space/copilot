# Ontology Changelog

## 2026-02-28

### PROBLEM SOLVED

- **00:10** Production MongoDB structure and ontology artifacts diverged, causing missing attributes/entities in TypeDB representation and incomplete relation graph after ingestion. The ontology schema and mapping were aligned with current production collections to restore structural parity.
- **00:35** TypeDB apply runs produced datetime-type ingestion errors for timezone-aware values. Datetime normalization in ingest tooling was updated to enforce TypeDB-compatible naive UTC literals.
- **01:20** Voice-message data quality checks showed orphan messages referencing non-existent sessions, reducing analytical reliability. Orphan records were audited, exported, and cleaned up with a controlled recovery path for one recoverable session ID.

### FEATURE IMPLEMENTED

- **00:25** Mapping-driven generic ingestion path was implemented for ontology collections beyond legacy hardcoded handlers, enabling faster onboarding of newly documented MongoDB entities.
- **00:45** Ingestion idempotency was improved with pre-insert existence checks for entities and relations to support repeatable apply runs with lower duplication risk.
- **01:05** Orphan investigation package was added under `ontology/orphan/` with per-message JSON exports and analytical README context for operator review and data-governance traceability.

### CHANGES

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
