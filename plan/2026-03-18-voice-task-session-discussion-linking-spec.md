# Voice Task Session Discussion Linking Spec

## Status ⚪Open

- Spec/control ticket line (`copilot-96tc`, `copilot-br3m`): ⚪Open 1  🟡In Progress 0  💤Deferred 0  ⛔Blocked 0  ✅Closed 1
- Planned implementation ticket line (`copilot-0ylv`, `copilot-m5wz`, `copilot-vii8`, `copilot-zvxa`): ⚪Open 4  🟡In Progress 0  💤Deferred 0  ⛔Blocked 0  ✅Closed 0
- Plan status: discussion-linking contract recorded; runtime fold-in not yet completed; status block normalized to current `bd` state.
- Canonical follow-up spec ticket: `copilot-96tc`
- Planned implementation tickets: `copilot-0ylv`, `copilot-m5wz`, `copilot-vii8`, `copilot-zvxa`
- Status-normalization docs ticket: `copilot-br3m` (closed).
- Greek-scholastic guardrail: repeated discussion of non-draft tasks remains distinct from `create_tasks` and must materialize through a separate discussion-link/comment path.

**Статус документа**: follow-up contract open; discussion-linking remains design-first; status block normalized
**Дата**: 2026-03-18  
**Основание**: текущие `bd` states for `copilot-96tc`, `copilot-br3m`, `copilot-0ylv`, `copilot-m5wz`, `copilot-vii8`, `copilot-zvxa`; spec фиксирует target 1:N session-link/comment semantics, но эта wave всё ещё open в `bd`.

**Conceptual source**: [voice-dual-stream-ontology.md](/home/strato-space/copilot/ontology/plan/voice-dual-stream-ontology.md)

## Purpose
Этот документ фиксирует **relation-layer contract** для repeated discussion of existing entities in voice sessions.

Он не определяет task lifecycle.
Он не определяет product entity persistence.
Он определяет:
- как existing entities получают дополнительные session links,
- когда draft rows допускают in-place reformulation,
- когда non-draft entities допускают only relink/comment,
- и через какой action-routing channel это должно происходить.

## Ontological Scope

### In-scope entity kinds
- `task`
- `voice_session`
- `comment`

Explicit normalization:
- there is no separate `TaskDraft` entity kind,
- draft discussion semantics apply to `task` with `task_status = DRAFT_10`.

### Out-of-scope entity kinds for direct mutation in this spec
- `business_need`
- `goal_product`
- `requirement`
- `issue`
- `risk`
- `constraint`
- `decision`
- `assumption`
- `open_question`

Они могут later adopt the same relation grammar, but this spec currently normalizes discussion-linking only for the task-plane.

## Canonical Relation Layer

### Primary relation
- `task -> discussed_in -> voice_session`

### Durable realization on task docs
- `discussion_sessions[]`
- `discussion_count` (derived)

### Optional attached artifact
- `comment -> attached_to -> task`
- comment may additionally carry:
  - `source_session_id`
  - `discussion_session_id`
  - `dialogue_reference`

## Lifecycle-Sensitive Rules

### Rule A. Draft task (`DRAFT_10`)
Allowed action kinds:
- `create`
- `update`
- `link_session`
- `archive`

Meaning:
- repeated discussion of an existing `DRAFT_10` task may reformulate `name/description/priority/...` in place,
- and must also attach current session into `discussion_sessions[]`.

### Rule B. Non-draft task (`READY_10`, `PROGRESS_10`, `REVIEW_10`, `DONE_10`, etc.)
Allowed action kinds:
- `link_session`
- `add_comment`
- `archive` (only through normal task lifecycle/other contracts, not because it was re-discussed)

Meaning:
- repeated discussion of an existing non-draft task must not rewrite canonical `name/description` automatically,
- must append current session to `discussion_sessions[]` if absent,
- may add a comment if material clarification appears.

## Canonical Action Routing

### Draft-plane routing
Handled by:
- `create_tasks`
- `persistPossibleTasksForSession(...)`

Output semantics:
- only `task` entities in `DRAFT_10`
- full desired-set reconcile

### Non-draft discussion routing
Must be handled by a **separate analyzer / output channel**.

Reason:
- draft task creation/update and non-draft discussion relink are ontologically different operations.
- Therefore `create_tasks` must not be overloaded with non-draft relink semantics.

Target channel examples:
- `task_discussion_links`
- separate output block from the same session analyzer
- or backend deterministic relation pass keyed by explicit target ids

## Canonical Action Grammar For This Spec

### Entity kind: `task`
Valid actions under this spec:
- `create`
- `update`
- `link_session`
- `add_comment`
- `archive`

### Routing rules
- `create` / `update` apply only to `DRAFT_10`
- `link_session` applies to both draft and non-draft tasks
- `add_comment` applies only when discussion adds materially new clarification and direct mutation is not allowed
- `archive` is not a discussion effect by itself; it belongs to existing task-plane contracts

## Current Verified Facts
1. `create_tasks` already sees:
- transcript
- current session draft baseline
- session-scoped tasks
- project-linked tasks, including project-linked drafts from other sessions

2. Backend now already carries:
- `discussion_sessions[]`
- `discussion_count`
on task docs, with runtime payload support landed.

3. Comment contract is now normalized enough to carry session-aware metadata:
- `/api/crm/tickets/add-comment`
- `ticket_id`
- `comment.comment`
- optional `source_session_id`
- optional `discussion_session_id`
- optional `dialogue_reference`
- `comment_kind`

## Required Backend Behavior
1. When an existing task in `DRAFT_10` is reused:
- keep stable `row_id/id`
- update formulation
- append current session to `discussion_sessions[]`

2. When an existing non-draft task is re-discussed:
- do not mutate title/description
- append current session to `discussion_sessions[]`
- optionally create comment with session-aware metadata

3. `discussion_count` is always derived from unique session ids.

## Open Decisions
1. What is the exact contract of the separate non-draft discussion analyzer/output?
2. What is the minimum evidence threshold for `add_comment` vs pure `link_session`?
3. Should UI distinguish:
- `created in this session`
- `updated in this session`
- `re-discussed in this session`
4. Should the relation layer be embedded forever on task docs, or later extracted into a separate relation collection?

## Minimal Recommended Wave
1. Land task discussion linkage on draft and non-draft tasks.
2. Show `discussion_count` and linked sessions in UI.
3. Normalize comments as session-aware attached artifacts.
4. Only then add a separate non-draft discussion analyzer/output channel.

## Conclusion
This spec is the **task discussion relation contract**.

It is sound only if:
- lifecycle and discussion linkage remain orthogonal,
- draft mutation and non-draft mutation stay separated,
- `create_tasks` remains draft-only,
- non-draft repeated discussion is routed through relation/comment actions, not pseudo-task creation.
