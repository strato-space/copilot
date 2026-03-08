# MongoDB Entity Audit — 2026-03-08

This note captures the latest Mongo-backed AS-IS ontology review using:

- `ontology:typedb:contract-check`
- `ontology:typedb:domain-inventory`
- `ontology:typedb:entity-sampling`

## Resolved in this wave

### `automation_finances_income`

- `task_type`
  - live Mongo stores `_id` values of `automation_finances_income_types`
  - relation now resolves by `legacy_finance_income_type_id`, not `name`
- `project`
  - live Mongo stores project names, not project `_id`
  - relation now resolves by `project.name`
- `performer`
  - live Mongo stores performer `_id`
  - ontology now treats it as `performer_id` and links to `performer_profile`

### `automation_persons`

- `contacts`
  - no longer mislabeled as `notifications`
  - mapped as `contacts_payload`
- `projects`
  - no longer mislabeled as `projects_access`
  - mapped as `project_participations`

## Still open / next-wave candidates

### `automation_voice_bot_sessions`

- `participants`
  - sampled values are person ids
  - should likely become a relation to `person`
- `processors` / `session_processors`
  - list-valued process vocabularies
  - should likely move toward dictionary-backed or relation-backed semantics

### `automation_voice_bot_messages`

- `attachments`
- `transcription`
- `categorization`
- `processors_data`
- `file_metadata`

These are structurally rich payloads currently flattened into string/object payload attributes. They are acceptable as AS-IS placeholders, but they are strong candidates for richer support objects or bridge objects.

### Google Drive duplicate identity surface

- `automation_google_drive_projects_files`
- `automation_google_drive_structure`

There is overlap in artifact identity (`file_id` vs `id`) and project-scoped projection semantics. An explicit bridge may be needed if both surfaces remain first-class.

## Current operator policy

- verification sampling:
  - inspect all top-level Mongo fields
  - default limit `20`
- TOON examples:
  - keep compact and ontology-relevant
  - default limit `3`
  - default projection `mapped`
