# TypeDB Ontology Agent Notes

Scope: `/home/strato-space/copilot/ontology/typedb`

## Canonical Structure

- `schema/` — TypeQL schema files.
- `mappings/` — source-to-ontology mapping YAML contracts.
- `queries/` — validation and smoke query packs.
- `scripts/` — ingestion/validation/runtime helpers.
- `docs/` — rollout and migration notes.

## Stability Contracts

- Keep `backend/package.json` aliases `ontology:typedb:*` working.
- Keep script defaults script-relative (no hidden dependency on current shell cwd).
- Keep `scripts/requirements-typedb.txt` as the canonical dependency list for this tooling.

## Editing Rules

- Any schema change should be matched by mapping and validation query review.
- Avoid changing IDs/attribute semantics silently; record intent in `docs/rollout_plan_v1.md`.
- If operator workflow changes, update:
  - `ontology/typedb/README.md`
  - repo root `CHANGELOG.md`

## Minimal Validation Before Handoff

From `/home/strato-space/copilot/backend`:

1. `npm run ontology:typedb:py:setup`
2. `npm run ontology:typedb:ingest:dry`
3. `npm run ontology:typedb:validate`

If you changed only docs, state explicitly that runtime validation was skipped.
