# MongoDB Parity Delta — 2026-03-07

Scope of this note:
- current MongoDB operational state sampled from the last 48 hours;
- current ontology assets:
  - `schema/str-ontology.tql`
  - `mappings/mongodb_to_typedb_v1.yaml`
  - `queries/validation_v1.tql`

This note is intentionally limited to parity findings needed by:
- `copilot-guys.2` — mapping/query refresh
- follow-up schema/tooling work in:
  - `copilot-guys.1`
  - `copilot-guys.3`

## Applied in copilot-guys.2

### automation_tasks

Observed in recent Mongo docs:
- `row_id`
- `type_class`

These attributes already exist in `str-ontology.tql`, so they were added to the mapping contract.

## Remaining deltas that require schema/tooling work

### 1. voice session -> oper task linkage for canonical session URLs

Current runtime reality:
- `automation_tasks.source_ref` is not stable as a session id anymore.
- For `voice_possible_task`, `source_ref` and `external_ref` can both be canonical voice session URLs.
- For Telegram-origin tasks, `source_ref` can be a Telegram message link.

Current mapping limitation:
- `voice_session_sources_oper_task` owner lookup resolves `voice_session_id` directly from `source_ref`.
- Generic ingester currently has no transform to extract `session_id` from canonical voice URLs.

Required next-step change:
- add a mapping/tooling-level lookup transform for canonical session refs, for example:
  - `canonical_voice_ref -> session_id`
- then update `voice_session_sources_oper_task` mapping to use the normalized session id instead of raw `source_ref`.

This is a `copilot-guys.3` tooling delta.

### 2. voice sessions: summary correlation field

Observed in recent Mongo docs:
- `summary_correlation_id`

Current status:
- not modeled in `str-ontology.tql`
- not mapped

Required next-step change:
- add schema attribute for `summary_correlation_id`
- map it from `automation_voice_bot_sessions`
- optionally validate its presence only when summary workflow is active

### 3. voice messages: richer transcription/categorization runtime envelope

Observed in recent Mongo docs:
- `categorization_timestamp`
- `transcription_raw`
- `transcription.model`
- `transcription.provider`
- `transcription.schema_version`
- `task`

Current status:
- this delta is now partially resolved by first-class support objects:
  - `voice_transcription`
  - `transcript_segment`
  - `voice_categorization_entry`
  - `processing_run`
  - `file_descriptor`
  - `message_attachment`
- raw envelopes (`transcription`, `categorization`, `processors_data`, `file_metadata`, `attachments`) remain preserved as evidence payloads on the AS-IS parent entities

Current policy:
- first-class where the nested structure is stable and query-worthy
- opaque/evidence-preserving where replay/debug lineage still matters
- `transcription_raw` remains evidence-only for now

### 4. possible-task canonicality checks

Current runtime reality:
- `voice_possible_task` rows rely on canonical `row_id`
- `row_id` is the primary mutation identity

Required next-step change:
- keep validation query coverage for:
  - `source_kind = "voice_possible_task"` -> `row_id` must exist
- extend schema/tooling later if roleful task relations are moved out of JSON blobs (`relations`, `source_data.voice_sessions`)

### 5. current project sampling gap

Recent Mongo sample returned `0` recently updated docs for `automation_projects`, but `mcp@voice projects` clearly shows live project-card evolution with:
- `routing_item`
- `git_repo`
- backlog/design refs

Interpretation:
- project parity cannot be assessed by `updated_at` sampling alone
- future parity checks should include:
  - direct project collection inventory
  - `mcp@voice project(project_id)` contract
  - routing/config sources

This affects governance and context-assembly work more than raw mapping.

## Follow-up still intentionally deferred

- direct Drive file -> `artifact_record` projection remains deferred
- broader non-voice processor families in historical/orphan payloads remain evidence-only until they become active operational surfaces again
