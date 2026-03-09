# Plan: TOON Source Migration

**Generated**: 2026-03-09

## Status
- Ticket line: ⚪Open 6  🟡In Progress 0  💤Deferred 0  ⛔Blocked 0  Closed 4
- Plan status: migration slice implemented; follow-on domain wave remains open.
- Purpose: migrate ontology source-of-truth from legacy `*.tql` fragments to canonical `*.toon.yaml` fragments and normalize ontology plan/inventory layout.

## Decisions
- [x] `TOON` is a strict YAML-compatible profile, not arbitrary YAML.
- [x] Canonical generated outputs are:
  - `ontology/typedb/schema/str-ontology.yaml`
  - `ontology/typedb/schema/str-ontology.tql`
- [x] Generated inventory outputs belong under `ontology/typedb/inventory_latest/`.
- [x] Ontology-specific plans belong under `ontology/plan/`.
- [x] Aristotle causes in TOON cards use:
  - `formal_what`
  - `material_composed_of`
  - `efficient_created_by`
  - `final_goal`

## Migration
- [x] Move `ontology-and-operations.md` into `ontology/plan/`.
- [x] Create `ontology/typedb/inventory_latest/`.
- [x] Move generated inventory/sampling outputs into `ontology/typedb/inventory_latest/`.
- [x] Add TOON bootstrap path from legacy TQL fragments.
- [x] Add TOON validation path.
- [x] Generate initial `*.toon.yaml` fragments for:
  - `00-kernel`
  - `10-as-is`
  - `20-to-be`
  - `30-bridges`
- [x] Make `build` produce both:
  - `str-ontology.yaml`
  - `str-ontology.tql`
- [ ] Remove legacy `.tql` fragments as editable source after the TOON source is reviewed and stabilized.

## Output Contracts
- [x] `verify` sampling:
  - all top-level Mongo fields
  - default `20` rows
- [x] `toon` sampling:
  - compact table view
  - default `3` rows
  - configurable up to `50`
  - default columns `mapped`
- [x] Domain inventory stays marker-first and writes to `inventory_latest/`.
- [x] Generated `str-ontology.tql` injects `# @toon values:` for inventory-marked small domains.

## Next Wave
- [ ] Convert `voice_session.participants` from flat payload to relation on `person`.
- [ ] Convert `processors` and `session_processors` to dictionary-backed semantics.
- [ ] Classify structured `voice_message` fields into:
  - payload-only
  - AS-IS support objects
  - bridge objects
- [ ] Add bridge between `drive_project_file` and `drive_node`.
- [ ] Run new data-backed revision:
  - `contract-check`
  - `domain-inventory`
  - `entity-sampling`
- [ ] Record the resulting implementation wave in `bd`.

## Acceptance
- [x] `ontology:typedb:toon:validate` is green.
- [x] `ontology:typedb:build` is green.
- [x] `str-ontology.yaml` is generated.
- [x] `str-ontology.tql` is generated from TOON source.
- [x] `inventory_latest/` is the canonical home for generated inventory outputs.
- [x] Root and ontology docs fully stop describing legacy `*.tql` fragments as editable source.
- [ ] TOON source review confirms the card schema is sufficient before deleting legacy TQL fragments.

## BD Tracking
- ✓ `copilot-jxrt` — [ontology] Migrate ontology source to TOON YAML and normalize ontology plan/inventory layout
- ✓ `copilot-zmhz` — T1 Move ontology-specific plans and generated inventory outputs to canonical ontology paths
- ✓ `copilot-qsi6` — T2 Introduce TOON YAML fragment source, validator, and dual-output generator
- ✓ `copilot-9vc3` — T3 Refresh tests/docs and capture next ontology wave for participants/processors/voice-message/drive-node
- ○ `copilot-okfk` — [ontology] Next Mongo-backed wave after TOON migration
- ○ `copilot-c3ry` — T1 Model voice_session.participants as person relation
- ○ `copilot-ppvu` — T2 Convert processors and session_processors to dictionary-backed semantics
- ○ `copilot-0rzw` — T3 Split structured voice_message fields into payload vs support-object vs bridge semantics
- ○ `copilot-447w` — T4 Add drive_project_file <-> drive_node identity bridge
- ○ `copilot-fpxm` — T5 Rerun data-backed ontology audit after wave
