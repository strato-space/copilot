# Ontology Agent Notes

Scope: `/home/strato-space/copilot/ontology`

## What belongs here

- ERD drafts and extraction protocols.
- TypeDB schema/mapping/query assets.
- TypeDB ingestion/validation helper scripts and their local dependency file.

## What does not belong here

- Runtime API handlers (keep in `backend/src`).
- Frontend UI logic (keep in `app/src`).
- Ad-hoc duplicates of TypeDB tooling under `backend/scripts`.

## Required Reading Order (for ontology tasks)

1. `ontology/README.md`
2. `ontology/typedb/README.md`
3. `ontology/typedb/AGENTS.md`
4. Repo root `AGENTS.md` (for runtime/product constraints if task touches APIs/UI)

## Change Discipline

- Keep schema and mapping changes atomic and documented.
- If schema/mapping changes affect runtime assumptions, update:
  - `/home/strato-space/copilot/AGENTS.md`
  - `/home/strato-space/copilot/README.md`
  - `/home/strato-space/copilot/CHANGELOG.md`
- Prefer additive evolution of ontology artifacts; avoid destructive renames without migration notes.

## Commands

Run ontology tooling via backend npm aliases (stable operator contract):

- `cd /home/strato-space/copilot/backend && npm run ontology:typedb:py:setup`
- `cd /home/strato-space/copilot/backend && npm run ontology:typedb:ingest:dry`
- `cd /home/strato-space/copilot/backend && npm run ontology:typedb:ingest:apply -- --init-schema`
- `cd /home/strato-space/copilot/backend && npm run ontology:typedb:validate`

## Recent Updates

- 2026-02-28: Expanded `typedb/schema/str_opsportal_v1.tql` and `typedb/mappings/mongodb_to_typedb_v1.yaml` to cover additional MongoDB collections and attributes.
- 2026-02-28: Upgraded `typedb/scripts/typedb-ontology-ingest.py` with mapping-driven generic ingestion, relation idempotency checks, and datetime normalization for TypeDB compatibility.
- 2026-02-28: Completed full apply+validate cycle against production MongoDB source and local TypeDB target (`str_opsportal_v1`) with successful validation.
- 2026-02-28: Investigated orphan voice messages, exported forensic payloads to `ontology/orphan/`, created one PMO stub session for recovery, and removed low-value orphan messages with no reliable session linkage.
- 2026-02-28: Registered runtime-diagnostics bug `copilot-k8v3` for incorrect UI rendering of `404 not found` as `runtime mismatch`.
