# Plan: copilot-xmcm Temporal Coverage and Draft Depth DAG

**Generated**: 2026-03-26
**Epic**: `copilot-xmcm`

## Normative Sources
- [2026-26-03-voice-date-depth-and-range-fix-spec.md](/home/strato-space/copilot/plan/2026-26-03-voice-date-depth-and-range-fix-spec.md)
- `bd` epic/child issues `copilot-xmcm`, `.1` ... `.8`

## Overview
This DAG is the execution companion to the finalized spec and the recalculated `bd` backlog. It mirrors the `bd` graph exactly and should be treated as the parallelization/execution view of the same work.

Target model:
- temporal selection is entity-only and reads only task-local fields;
- canonical temporal index is `created_at`, `updated_at`, `discussion_window_start_at`, `discussion_window_end_at`;
- `draft_horizon_days` and explicit `from_date/to_date` share one normalization path;
- default semantics are coverage-based and recall-biased (`entity_temporal_any`);
- `include_older_drafts` is sunsetted out of the canonical contract.

Note:
- `Этап` numbering in the companion spec denotes topic grouping, not execution order.
- execution order is defined only by the dependency graph below.

## Recalculation Controls
- Task titles and responsibility boundaries must stay identical to `bd`.
- Dependency edges in this file must stay identical to `bd graph copilot-xmcm --compact`.
- Acceptance statements here must use final field names and final matcher semantics only.
- This planning session changes backlog/docs only; no implementation code is part of this pass.

## Dependency Graph

```text
T1 (copilot-xmcm.2) ── T5 (copilot-xmcm.7) ── T6 (copilot-xmcm.3) ──┬── T7 (copilot-xmcm.1)
                                                                    └── T8 (copilot-xmcm.6)

T2 (copilot-xmcm.4) ─────────────────────────────────────────────────┘
T4 (copilot-xmcm.8) ─────────────────────────────────────────────────┘

T3 (copilot-xmcm.5)   [partially independent bounded-lookback branch]
```

## Tasks

### T1: `copilot-xmcm.2` Canonicalize temporal filter transport contract and legacy sunset telemetry
- **depends_on**: none
- **goal**: converge `tools/voice` and `copilot/backend` on one canonical temporal transport contract.
- **key scope**:
  - canonical keys: `statuses`, `project`, `response_mode`, `from_date`, `to_date`, `axis_date`, `range_mode`, `draft_horizon_days`
  - temporary legacy aliases: `task_statuses`, `project_id`, `mode`, `from`, `to`
  - canonical-over-legacy precedence
  - legacy warning/usage telemetry
  - stop client emission of `include_older_drafts` before hard-fail phase
- **control points**:
  - sunset telemetry dimensions are fixed before implementation starts
  - no stale legacy field names survive in client payload builders

### T2: `copilot-xmcm.4` Apply normalized draft-depth semantics in `/voicebot/session_tab_counts`
- **depends_on**: none
- **goal**: make Draft count semantics match the final normalized-interval model.
- **key scope**:
  - normalize `draft_horizon_days` around session `axis_date`
  - use the same entity-level matcher semantics as Draft reads
  - omission of `draft_horizon_days` stays unbounded
  - non-Draft counters remain unchanged
- **control points**:
  - default must remain `entity_temporal_any`
  - count contract must be externally verifiable

### T3: `copilot-xmcm.5` Unify bounded `project_crm_window` lookback policy (`default=14`, `clamp 1..30`)
- **depends_on**: none
- **goal**: unify runtime/docs/prompt semantics for bounded project CRM enrichment.
- **key scope**:
  - config key `VOICEBOT_PROJECT_CRM_LOOKBACK_DAYS`
  - backend clamp `1..30`
  - docs/prompt surfaces stay bounded, not unbounded
- **control points**:
  - prompt/docs must not imply unrestricted project CRM enrichment
  - this branch can start immediately but final validation must be checked against the canonical temporal contract

### T4: `copilot-xmcm.8` Enforce monotonic `updated_at` invariant on all task mutations
- **depends_on**: none
- **goal**: make `updated_at` the canonical mutation-axis timestamp everywhere.
- **key scope**:
  - shared bump helper or equivalent shared write rule
  - all mutation surfaces: status, performer, generic edit, comments, work-hours, attachments, delete/restore
  - formula: `updated_at_next = max(previous_updated_at, mutation_effective_at ?? server_now_utc)`
  - retry/replay/clock-skew coverage
- **control points**:
  - no mutation path may change task semantics without bumping `updated_at`
  - monotonicity is a contract, not a best effort

### T5: `copilot-xmcm.7` Materialize `discussion_window` temporal index for no-join linkage coverage
- **depends_on**: T1
- **goal**: project linked session coverage into task-local fields.
- **key scope**:
  - add `discussion_window_start_at`, `discussion_window_end_at`
  - derive from `source_ref`, `external_ref`, `source_data.voice_sessions[]`, `discussion_sessions[]`
  - ontology binding: `min/max(linked voice_session.created_at)`
  - unlink/boundary unlink/last unlink recompute rules
  - optional orthogonal `last_linkage_mutated_at`
  - backfill and transitional behavior documentation
- **control points**:
  - same-write-boundary recompute for linkage mutations
  - pre-backfill behavior must be explicit for both `entity_temporal_any` and `session_linkage_only`

### T6: `copilot-xmcm.3` Implement entity-only temporal matcher in `/api/crm/tickets`
- **depends_on**: T5, T4
- **goal**: implement the final matcher on task-local temporal fields.
- **key scope**:
  - parse/validate `from_date`, `to_date`, `axis_date`, `range_mode`, `draft_horizon_days`
  - `draft_horizon_days` must be positive integer only
  - mixed explicit range + horizon => `400 ambiguous_temporal_filter`
  - `entity_temporal_any`, `entity_primary`, `session_linkage_only`
  - inclusive boundaries, support only-from / only-to
  - preserve `summary/detail` and lifecycle prefilters
  - explicitly accept recall-biased coverage tradeoff
- **control points**:
  - matcher is entity-only: no runtime traversal of comments/work-hours/sessions
  - pre-backfill linked rows degrade/exclude exactly as specified
  - autonomous tasks match only on mutation axis

### T7: `copilot-xmcm.1` Sunset and remove deprecated `include_older_drafts` alias
- **depends_on**: T6, T2
- **goal**: remove `include_older_drafts` from the canonical contract after zero-usage gate.
- **key scope**:
  - remove from canonical schemas, payload builders, docs, prompts
  - keep server-side alias only during sunset window
  - hard-fail with `400 validation_error` after gate
  - unbounded Draft visibility = omit `draft_horizon_days`
- **control points**:
  - removal must happen only after telemetry gate is satisfied
  - client-facing guidance must use omission semantics exclusively

### T8: `copilot-xmcm.6` Harden timestamp parsing across anchors and temporal index paths
- **depends_on**: T6
- **goal**: eliminate timestamp parsing ambiguity across all temporal paths.
- **key scope**:
  - remove `Date.parse(String(epoch_ms))` and equivalent hacks
  - one parser for epoch numbers, ISO strings, and `Date`
  - use parser in session anchors, `axis_date`, temporal index derivation, recency helpers
- **control points**:
  - mixed historical numeric/string values remain deterministic
  - parsing semantics must match the normalized matcher contract

## Parallel Execution Waves

| Wave | Tasks | Start condition |
|------|-------|-----------------|
| 1 | T1, T2, T3, T4 | immediately |
| 2 | T5 | after T1 |
| 3 | T6 | after T5 and T4 |
| 4 | T7, T8 | T7 after T6+T2, T8 after T6 |

## Validation Matrix

### Contract and normalization
- canonical vs legacy transport keys
- canonical-over-legacy precedence
- `draft_horizon_days` positive integer validation
- explicit range + horizon rejection
- normalized interval equivalence between explicit range and horizon around `axis_date`

### Temporal matcher
- `entity_temporal_any` = mutation overlap OR linkage overlap
- `entity_primary` = mutation overlap only
- `session_linkage_only` = linkage overlap only
- only-from / only-to intervals
- inclusive boundaries
- autonomous task behavior
- created-after-session behavior
- long-lived task behavior as intentional recall-biased coverage

### Linkage projection and transition
- `discussion_window_start_at/end_at` derivation from linked sessions
- boundary unlink recompute
- last unlink clears both linkage fields
- pre-backfill row degrades to mutation-only in `entity_temporal_any`
- pre-backfill row is excluded entirely in `session_linkage_only`

### Mutation invariant
- `updated_at` bump on comments, work-hours, attachments, delete/restore, status, performer, generic edit
- monotonicity under retry/replay/clock skew

### Session-scoped depth behavior
- `session_tab_counts` Draft path follows normalized interval semantics
- omission of `draft_horizon_days` remains unbounded
- parity with `session_tasks(bucket=Draft)` under equivalent normalized interval

### Prompt/docs bounded lookback
- `create_tasks` remains bounded by `project_crm_window`
- docs reflect `default=14`, `clamp 1..30`
- docs do not imply unbounded project CRM enrichment

## Risks and Required Controls
- **Risk**: long-lived tasks overmatch due to convex-hull coverage semantics.
  - **Control**: explicitly preserve recall-biased wording in code/tests/docs; do not reframe as event-presence matching.
- **Risk**: partial backfill makes linkage-based filtering inconsistent.
  - **Control**: preserve explicit transitional behavior and rollout metric for pre-backfill rows.
- **Risk**: alias cleanup breaks legacy callers too early.
  - **Control**: telemetry gate must precede hard-fail in T7.
- **Risk**: `updated_at` drift survives in obscure mutation paths.
  - **Control**: mutation-surface guard tests are mandatory, not optional.
- **Risk**: bounded lookback docs drift from runtime again.
  - **Control**: treat T3 as runtime+docs+prompt sync, not runtime-only config work.

## Exit Condition
This plan is complete when `bd` and this markdown file remain 1:1 aligned on:
- task titles,
- dependency edges,
- execution waves,
- final temporal field names,
- final `range_mode` semantics,
- transitional backfill behavior,
- `include_older_drafts` sunset policy.
