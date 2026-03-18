# Voice Task Surface Normalization Spec 2

## Status ⚪Open

- Task-surface ticket line: ⚪Open 4  🟡In Progress 0  💤Deferred 0  ⛔Blocked 0  ✅Closed 0
- Plan status: follow-up contract recorded; runtime simplification landed and prod-smoked; `bd` closure/doc fold-in pending.
- Canonical follow-up spec ticket: `copilot-jn28`
- Related runtime/docs tickets: `copilot-3d7n`, `copilot-muzv`, `copilot-br3m`

**Статус документа**: follow-up contract open; runtime simplification landed; doc normalization pending
**Дата**: 2026-03-18  
**Основание**: текущие `bd` states for `copilot-jn28`, `copilot-3d7n`, `copilot-muzv`, `copilot-br3m`; текущие comments уже фиксируют landed draft-reconcile/backlog-cleanup work, но все follow-up tickets остаются open.

**Conceptual source**: [voice-dual-stream-ontology.md](/home/strato-space/copilot/plan/voice-dual-stream-ontology.md)

## Purpose
Этот документ фиксирует **task-plane only** contract для voice-driven draft task baseline.

Он не описывает:
- product entities (`business_need`, `requirement`, `goal_product`),
- comment semantics,
- non-draft discussion-linking logic,
- general runtime ontology outside task-plane.

Он описывает только:
- как `DRAFT_10` task rows читаются,
- как пересчитываются,
- как связываются с session/project,
- и какие task-plane actions допустимы.

## Ontological Scope

### In-scope entity kinds
- `task`
- `voice_session`

Explicit normalization:
- there is no separate `TaskDraft` entity kind,
- historical wording `TaskDraft` means `task` with `task_status = DRAFT_10`.

### Out-of-scope entity kinds
- `business_need`
- `goal_product`
- `requirement`
- `issue`
- `risk`
- `constraint`
- `decision`
- `assumption`
- `open_question`

Они могут присутствовать в transcript и project context, но этот документ не делает их частью task-plane storage contract.

## Canonical Task-Plane Relations

### Primary relation
- `task -> discussed_in -> voice_session`

### Storage-side realization today
На task docs это выражается через:
- `discussion_sessions[]`
- `discussion_count` (derived)
- compatibility mirror in `source_data.voice_sessions[]`

### Context relations
- `task -> belongs_to -> project`
- `task -> has_status -> DRAFT_10`
- `task -> evidenced_by -> transcript_segment | voice_message` (through `dialogue_reference` today, stronger evidence model later)

## Canonical Entity Shape: Draft Task

A session draft row is a `task` with these canonical task-plane properties:
- `row_id`
- `id`
- `name`
- `description`
- `priority`
- `priority_reason`
- `performer_id`
- `project_id`
- `task_type_id`
- `dialogue_tag`
- `task_id_from_ai`
- `dependencies_from_ai[]`
- `dialogue_reference`
- `task_status = DRAFT_10`
- `discussion_sessions[]`
- `discussion_count` (derived)

Compatibility/provenance fields may remain:
- `source_ref`
- `external_ref`
- `source_data`
- `source_kind`

But they are not the semantic discriminator of draftness.

## Canonical Draft Criterion
Canonical lifecycle key: `DRAFT_10`.
Compatibility label during transition: `Draft`.

A row belongs to the session Draft baseline iff:
1. it is a `task`,
2. it is linked to the current `voice_session`,
3. `task_status = DRAFT_10` (stored/display compatibility label currently `Draft`),
4. it is not deleted.

`source_kind=voice_possible_task` is no longer required as the primary semantic gate.

## Canonical Read Contract

### `voice.session_tasks(session_id, bucket="draft")`
This route/tool is the canonical read surface for the current session draft baseline.

Behavior:
- reads session-linked `DRAFT_10` rows,
- dedupes by `row_id`,
- prefers active/current row if duplicate lineage exists,
- returns normalized draft rows,
- includes `discussion_sessions[]` and `discussion_count`.

### `voice.session_task_counts(session_id)`
Task counts must be computed from the same task-plane view:
- Draft counts from canonical session-linked `DRAFT_10` rows,
- accepted counts from non-draft task-plane,
- no semantic dependence on `source_kind`.

## Canonical Write Contract

### `create_tasks`
`create_tasks` is a draft-plane analyzer only.

Its semantic job:
- inspect transcript + current draft baseline + session/project task context,
- produce the full desired set of session-linked `DRAFT_10` task rows.

It must not:
- create non-draft mutations,
- relink existing non-draft tasks,
- create comments,
- emit product-plane entities.

### `persistPossibleTasksForSession(...)`
This is the canonical draft reconcile.

Behavior:
1. upsert desired `DRAFT_10` rows by `row_id/id`,
2. preserve session/project linkage,
3. merge/refresh `discussion_sessions[]`,
4. remove absent rows from the live baseline,
5. keep lifecycle status orthogonal to discussion linkage.

## Allowed Task-Plane Actions
Within this spec, only these action kinds are valid:
- `create`
- `update`
- `link_session`
- `archive`

Semantics:
- `create`: new `DRAFT_10` task row
- `update`: reformulate an existing `DRAFT_10` task row in place
- `link_session`: attach current session to an existing `DRAFT_10` row reused from another session
- `archive`: remove a row from the current live draft baseline

`add_comment` is out of scope for this document.

## Current Verified Runtime Facts
1. `create_tasks` reads:
- transcript via `voice.fetch(..., mode="transcript")`
- current draft baseline via `voice.session_tasks(..., bucket="draft")`
- session-scoped tasks via `voice.crm_tickets(session_id=...)`
- project-scoped tasks via `voice.project(...)` and `voice.crm_tickets(project_id=...)`

2. Draft baseline no longer uses operational `stale` semantics.

3. Runtime deploy path restarts voicebot workers together with backend, so stale in-memory draft logic no longer persists across deploys.

4. Discussion linkage on draft rows is already available in runtime payloads.

## Migration Outcome Already Landed
Already implemented/runtime-smoked:
- operational `source_data.refresh_state = stale` removed from active semantics;
- current live baseline = one visible `DRAFT_10` set per session;
- `discussion_sessions[]` / `discussion_count` added to draft rows;
- `source_kind=voice_possible_task` reduced to metadata role.

## Open Decisions (Task-plane only)
1. When a desired-set recompute drops a draft row, should storage policy be soft-delete only or allow harder cleanup later?
2. Should project context for draft recompute continue to include draft rows from other sessions, or be narrowed later?
3. When exact `row_id` reuse is absent, what conservative identity rule should govern cross-session draft reuse?

## Conclusion
This spec is the **task-plane contract** for session-linked `DRAFT_10` rows.

It is sound only if:
- draftness is defined by lifecycle status plus session linkage,
- discussion linkage remains orthogonal to lifecycle,
- `create_tasks` remains draft-only,
- product-plane and non-draft discussion semantics stay outside this contract.
