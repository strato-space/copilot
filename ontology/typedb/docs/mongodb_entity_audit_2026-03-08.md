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

## Landed in `copilot-okfk` core voice/message wave

### `automation_voice_bot_sessions`

- `participants`
  - now materialized as `voice_session_has_participant_person` when sampled values resolve to `person_id`
  - raw `participants` payload remains as evidence / compatibility payload
- `processors` / `session_processors`
  - now split into:
    - dictionary layer: `processor_definition`
    - runtime layer: `processing_run`
  - raw `processors`, `session_processors`, and `processors_data` remain as evidence payloads

### `automation_voice_bot_messages`

- `attachments`
- `transcription`
- `categorization`
- `processors_data`
- `file_metadata`

These no longer rely only on flattened string/object payload attributes. The current ontology wave adds:

- `voice_transcription`
- `transcript_segment` linked via `voice_transcription_has_transcript_segment`
- `voice_categorization_entry`
- `file_descriptor`
- `message_attachment`
- `processing_run` linked to `voice_message`

Raw Mongo payloads remain stored on the parent AS-IS entities as evidence/backfill, but they are no longer the only semantic surface.

### Google Drive duplicate identity surface

- `automation_google_drive_projects_files`
- `automation_google_drive_structure`

This wave now materializes an explicit identity bridge:

- `drive_project_file_indexes_drive_node`

The broader question of when Drive files should also map directly to `artifact_record` stays explicitly deferred to follow-up audit work.

## Current operator policy

- verification sampling:
  - inspect all top-level Mongo fields
  - default limit `20`
- TOON examples:
  - keep compact and ontology-relevant
  - default limit `3`
  - default projection `mapped`
