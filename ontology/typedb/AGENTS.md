# TypeDB Ontology Agent Notes

Scope: `/home/strato-space/copilot/ontology/typedb`

## Canonical Structure

- `schema/` — canonical generated TQL output plus editable annotated TQL fragments.
- `mappings/` — source-to-ontology mapping YAML contracts.
- `queries/` — validation and smoke query packs.
- `scripts/` — ingestion/validation/runtime helpers.
- `docs/` — rollout and migration notes.

## Stability Contracts

- Keep `backend/package.json` aliases `ontology:typedb:*` working.
- Keep script defaults script-relative (no hidden dependency on current shell cwd).
- Keep `scripts/requirements-typedb.txt` as the canonical dependency list for this tooling.
- Keep `schema/str-ontology.tql` generated from `schema/fragments/*.tql`; do not edit the generated schema manually.
- `copilot` ontology is the kernel/common layer; project ontologies are overlays that extend it.
- Annotated TQL fragments are the canonical editable source surface. Generated TQL remains an inspectable artifact, but is not edited directly.

## Editing Rules

- Any schema change should be matched by mapping and validation query review.
- Avoid changing IDs/attribute semantics silently; record intent in `docs/rollout_plan_v1.md`.
- Edit TQL fragments first, then rebuild the generated schema.
- Keep rich semantic comments directly in the annotated TQL fragments.
- If operator workflow changes, update:
  - `ontology/typedb/README.md`
  - repo root `CHANGELOG.md`

## Minimal Validation Before Handoff

From `/home/strato-space/copilot/backend`:

1. `npm run ontology:typedb:py:setup`
2. `npm run ontology:typedb:build`
3. `npm run ontology:typedb:contract-check`
4. `npm run ontology:typedb:domain-inventory`
5. `npm run ontology:typedb:entity-sampling`
6. `npm run ontology:typedb:ingest:dry`
7. `npm run ontology:typedb:validate`

## Current Operation Modes

- `ontology:typedb:build` — regenerate canonical schema from fragments.
- `ontology:typedb:contract-check` — validate MongoDB documents against schema+mapping without TypeDB writes.
- `ontology:typedb:ingest:*` — full scan / bootstrap path.
- `ontology:typedb:sync:*` — incremental sync path using sync-state watermarks. Current safe scope is `automation_projects` + `automation_tasks` + `automation_voice_bot_sessions` + `automation_voice_bot_messages`.
- Absence/tombstone semantics are documented in:
  - `ontology/typedb/docs/incremental_absence_policy_v1.md`
- current collection-level rule:
  - only `automation_projects` is absence-actionable on full sync;
  - tasks / sessions / messages remain protected from absence-only entity deletion in v1.

Ontology operator scripts now auto-load `backend/.env.production` when shell env is absent, so `contract-check`, `domain-inventory`, `entity-sampling`, and `ingest` can be run directly from `/home/strato-space/copilot/backend` without manual Mongo export in normal prod-local workflows.

Domain inventory selection policy:
- primary hints live inline in `schema/fragments/00-kernel/10-attributes-and-ids.tql`
- marker format: `# @toon inventory=inspect ...`
- default export/inventory selection is marker-controlled
- use `--marked-only` to stay strict
- use `--attrs ...` to force-include specific attrs
- use `--include-heuristics` only when you want discovery mode beyond TOON-marked attrs
- `automation_persons` and `automation_performers` are intentionally split:
  - `person` = contact / participant / human reference
  - `performer_profile` = internal performer/staff/account profile
  - task assignment, work-log authorship, employee linkage, and legacy finance expense linkage terminate on `performer_profile`

Entity sampling policy:
- verification sampling inspects **all top-level Mongo fields**
- TOON examples stay compact and ontology-relevant
- default operator guidance:
  - `--mode verify` for ontology/mapping review
  - `--mode toon --toon-columns mapped` for LLM-facing examples
- current defaults:
  - `verify_limit=20`
  - `toon_limit=3`
  - `toon_columns=mapped`
- generated outputs live under `ontology/typedb/inventory_latest/`

If you changed only docs, state explicitly that runtime validation was skipped.

## Recent Updates

- 2026-02-28: `copilot-gym6.*` runtime-parity wave completed for schema/mapping/validation/tooling:
  - added gap baseline `docs/runtime_contract_gap_matrix_v1.md`,
  - expanded OperOps/Codex task contract coverage in schema/mapping,
  - added `voice_session_sources_oper_task` relation and mapping path,
  - refreshed validation queries with OperTask/Codex checks.
- 2026-02-28: `typedb-ontology-validate.py` anchor checks were made TypeDB 3 inference-safe (no direct variable reuse across different attribute labels).
- 2026-02-28: `typedb-ontology-ingest.py` now ingests `automation_tasks` through generic mapping-driven path to reduce YAML/script drift.
- 2026-02-28: Deep runtime-contract alignment for Voice ontology (`copilot-aonw`): extended `voice_session` / `voice_message` / `history_step` field coverage, added `voice_session_merge_log` entity+relation, and mapped `automation_voice_bot_session_merge_log`.
- 2026-02-28: Validation pack expanded with contract checks for session-log/merge-log orphans, image-anchor integrity, runtime-tag completeness, and close-flow consistency (`is_active=false` + `to_finalize=true` should have `done_at`).
