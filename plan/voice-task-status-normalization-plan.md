# Plan: Voice Task Status Normalization

**Generated**: 2026-03-10
**Estimated Complexity**: High

## Current Task Status Dictionary (AS-IS)

Current CRM task statuses as defined in the shared constants, supplemented with a production database snapshot of active non-deleted tasks in `automation_tasks` collected on 2026-03-10.

| Status key | Status label | Current active count | Current role / observation |
|---|---|---:|---|
| `NEW_0` | `Backlog` | 172 | General backlog bucket; currently overloaded by draft Voice possible-task rows |
| `NEW_10` | `New / Request` | 0 | Raw incoming request before clarification |
| `NEW_20` | `New / Clientask` | 0 | Client-origin request that is not yet normalized into delivery flow |
| `NEW_30` | `New / Detail` | 0 | Needs clarification or decomposition before planning |
| `NEW_40` | `New / Readyforplan` | 0 | Ready to enter the planning pipeline |
| `PLANNED_10` | `Plan / Approval` | 0 | Plan prepared and waiting for approval |
| `PLANNED_20` | `Plan / Performer` | 0 | Planned and assigned at performer-planning stage |
| `READY_10` | `Ready` | 37 | Accepted and ready for execution; currently the cleanest post-acceptance status |
| `PROGRESS_0` | `Rejected` | 0 | Explicit rejection state |
| `PROGRESS_10` | `Progress 10` | 6 | Execution started |
| `PROGRESS_20` | `Progress 25` | 0 | Intermediate execution checkpoint |
| `PROGRESS_30` | `Progress 50` | 0 | Mid / late execution checkpoint |
| `PROGRESS_40` | `Progress 90` | 0 | Nearly complete |
| `REVIEW_10` | `Review / Ready` | 54 | Ready for review |
| `REVIEW_20` | `Review / Implement` | 0 | Rework cycle after review |
| `AGREEMENT_10` | `Upload / Deadline` | 0 | Preparing for delivery / deadline alignment |
| `AGREEMENT_20` | `Upload / Delivery` | 0 | Final delivery / release stage |
| `DONE_10` | `Done` | 79 | Done, but not yet fully closed |
| `DONE_20` | `Complete` | 210 | Fully completed work |
| `DONE_30` | `PostWork` | 0 | Post-delivery work |
| `ARCHIVE` | `Archive` | 2997 | Historical closed-task tail; dominant terminal bucket |
| `PERIODIC` | `Periodic` | 10 | Repeating / recurring work |

### Snapshot Note

- Total active non-deleted tasks in production: **3569**
- There are also **4** active rows with missing `task_status` (`null`) in the database; those are separate legacy data-quality problems and should be normalized independently.

## Current Database Statistics (Voice Slice, Production Snapshot)

Voice non-codex tasks (`source = VOICE_BOT`, `codex_task != true`, active non-deleted) currently split like this:

| task_status | source_kind | Count | Interpretation |
|---|---|---:|---|
| `Backlog` | `voice_possible_task` | 94 | Canonical draft possible-task rows |
| `Ready` | `voice_session` | 13 | Clean accepted / materialized Voice tasks |
| `Ready` | `(missing)` | 12 | Legacy accepted Voice tasks without normalized `source_kind` |
| `Review / Ready` | `(missing)` | 9 | Legacy Voice tasks already in review without normalized `source_kind` |
| `Progress 10` | `(missing)` | 1 | Legacy Voice task already in execution without normalized `source_kind` |
| `Archive` | `(missing)` | 32 | Historical archived Voice-linked tasks without normalized `source_kind` |

Voice summary bucket:

| Voice bucket | Count | Meaning |
|---|---:|---|
| `draft_possible` | 94 | Current draft possible tasks |
| `materialized_voice_session` | 13 | Current accepted Voice tasks with normalized `source_kind=voice_session` |
| `legacy_missing_source_kind` | 54 | Historical Voice tasks that still rely on session linkage but lack explicit `source_kind` |

Most important observation from the database snapshot:

- the **current production dataset does not show active `voice_session + NEW_0` rows**,
- but the **current code path still allows that outcome** through `process_possible_tasks`,
- so the model is semantically unsafe even if the existing data has only partially drifted so far.

## Proposed Split Criterion For `NEW_0`

Proposed normalization rule:

- `DRAFT`: new status used only for drafts from `Возможные задачи`
- `BACKLOG`: new canonical status for real backlog tasks
- `NEW_0`: temporary legacy status that should be eliminated after migration

### Split Criterion

For every current row with status `NEW_0 / Backlog`:

1. If `source_kind = voice_possible_task`, classify it as `DRAFT`.
2. If `source_kind != voice_possible_task`, classify it as `BACKLOG`.
3. If `source_kind` is missing, use the fallback criterion:
   - if the row carries draft possible-task markers (`source_data.voice_task_kind = possible_task`, draft session projection, draft locator chain), classify it as `DRAFT`;
   - otherwise classify it as `BACKLOG`.

### Practical Conclusion From The Current Dataset

- In the current production snapshot this criterion is already almost unambiguous:
  - `94` rows with `Backlog + voice_possible_task` should move to `DRAFT`;
  - no active `voice_session + NEW_0` rows were found;
  - remaining non-voice `NEW_0` rows should become `BACKLOG`.

### New Target Semantics

- `DRAFT`:
  - only for possible tasks,
  - not treated as part of the accepted delivery backlog,
  - shown in `Возможные задачи` and other draft-oriented review surfaces.
- `BACKLOG`:
  - a real task already accepted into the system as a backlog item,
  - may already have project, performer, relationships, and an OperOps card,
  - participates in the normal task lifecycle.

## Overview

Voice task flows currently mix three different concepts inside the same CRM status space:

1. draft possible tasks produced by Voice AI,
2. accepted tasks materialized from the `Possible Tasks` tab,
3. legacy tasks created through the older `create_tickets` path.

This creates a status-semantics collision:

- `Possible Tasks` master rows live in `NEW_0 / Backlog`,
- the current `process_possible_tasks` flow also materializes accepted tasks into `NEW_0 / Backlog`,
- the older `create_tickets` flow materializes into `READY_10 / Ready`,
- Voice session `Задачи` counts currently include all non-codex session-linked tasks, so draft `voice_possible_task` rows leak into the same tab as accepted OperOps tasks.

The result matches the operator confusion already visible in production: `Backlog` may contain rows with performer, project, and task card even though those rows still mix draft and accepted work semantics.

This plan normalizes the model so draft rows and accepted OperOps tasks are never ambiguous again.

## Current State Audit

### Canonical entities and statuses

| Flow | Storage shape | Source kind | Status key | UI label | Notes |
|---|---|---|---|---|---|
| Voice possible task draft | `automation_tasks` master row | `voice_possible_task` | `NEW_0` | `Backlog` | Saved by `save_possible_tasks` / AI persistence |
| Accepted from `Possible Tasks` tab | `automation_tasks` task row | `voice_session` | `NEW_0` | `Backlog` | Current `process_possible_tasks` path; main semantic bug |
| Legacy create path | `automation_tasks` task row | `voice_session` | `READY_10` | `Ready` | Current `create_tickets` path |
| Codex issue | `automation_tasks` or BD sync issue | `voice_session` + `codex_task=true` | separate path | separate tab | Out of scope for this status-normalization track |

### Current code paths

- `save_possible_tasks` persists or updates possible-task master rows and keeps them in `NEW_0`.
  - Backend: `backend/src/services/voicebot/persistPossibleTasks.ts`
  - Backend route: `backend/src/api/routes/voicebot/sessions.ts`
- `process_possible_tasks` takes selected rows from the `Possible Tasks` tab and materializes them into real tasks, but still writes `targetTaskStatus = NEW_0`.
  - Frontend caller: `app/src/store/voiceBotStore.ts`
  - Backend route: `backend/src/api/routes/voicebot/sessions.ts`
- `create_tickets` materializes tasks into `READY_10`.
  - Backend route: `backend/src/api/routes/voicebot/sessions.ts`
- Voice session `Задачи` tab counts all session-linked non-codex tasks and therefore includes both:
  - `source_kind = voice_possible_task`
  - `source_kind = voice_session`

## Root Cause

Status currently carries two orthogonal meanings at once:

- workflow stage (`draft` vs `accepted`),
- delivery status (`Backlog`, `Ready`, `Progress`, `Review`, and so on).

`NEW_0` is overloaded for both:

- "draft possible task not yet accepted",
- "accepted task already materialized from Voice".

That is the core modeling bug.

## Normalization Goal

Adopt one unambiguous rule set:

1. `Possible Tasks` are draft rows only.
2. Draft rows may reuse `automation_tasks` if necessary, but they must never be counted or rendered as accepted Voice session tasks.
3. Accepting a row from `Possible Tasks` must create or promote a real OperOps task into `BACKLOG`, not into the same draft status bucket.
4. Voice session `Задачи` must show accepted OperOps tasks only.
5. `NEW_0` must disappear from the target status dictionary and remain only as migration input.
6. Historical mixed rows must be migrated into one canonical model.

## Recommended Target Model

### Recommended semantics

- Replace `NEW_0` with two explicit target statuses:
  - `DRAFT`
  - `BACKLOG`
- Keep draft possible tasks as:
  - `source_kind = voice_possible_task`
  - `task_status = DRAFT`
- Materialized accepted tasks from the `Possible Tasks` tab must become:
  - `source_kind = voice_session`
  - `task_status = BACKLOG`
- Existing real backlog tasks currently living in `NEW_0` must also become:
  - `task_status = BACKLOG`
- Voice session `Задачи` counts and table queries must exclude:
  - `source_kind = voice_possible_task`
- Voice session `Возможные задачи` must remain the only place where `voice_possible_task` drafts are shown in the session UI.

### Why this target is preferred

- It removes the current ambiguity where one status means both "draft" and "real backlog task".
- It makes the meaning of `Возможные задачи` explicit at the status level.
- It aligns explicit user acceptance with a post-draft backlog status instead of jumping directly into execution readiness.
- It preserves current operator intuition: if a row is in `Задачи`, it is already a real task.
- It simplifies the status model because `NEW_0` disappears from the target dictionary.

## Open Product Decisions

These decisions should be resolved before implementation starts:

1. Should draft possible tasks require performer selection before acceptance, or should performer remain optional until materialization?
2. Should `DRAFT` and `BACKLOG` be introduced as exact new status keys, or should they use prefixed CRM-style keys such as `DRAFT_10` and `BACKLOG_10` with labels `Draft` / `Backlog`?
3. Should `voice_possible_task` drafts remain in `automation_tasks`, or move to a separate storage model later?
4. Should the older `create_tickets` path be retired entirely once the accepted default status becomes `BACKLOG`?

Default assumption for this plan:

- keep drafts in `automation_tasks` for now,
- keep performer editable on drafts,
- promote accepted rows to `BACKLOG`,
- deprecate and remove `NEW_0` after migration.

## Sprint 1: Freeze The Canonical Status Policy

**Goal**: Establish the status/source-kind truth table and remove ambiguity from contracts before data migration.

**Demo / Validation**:

- Architecture review can answer, for any Voice-originated row:
  - is it draft or accepted?
  - where should it appear in UI?
  - what status/source_kind combination is legal?

### Task 1.1: Write the status truth table

- **Location**: `plan/voice-task-status-normalization-plan.md`, `AGENTS.md`, `README.md`
- **Description**: Document allowed combinations of `source_kind`, `task_status`, and visible UI surfaces.
- **Dependencies**: None.
- **Acceptance Criteria**:
  - draft vs accepted is explicitly defined;
  - `voice_possible_task + DRAFT` is marked as draft-only;
  - `voice_session + BACKLOG` is marked as the accepted default;
  - `NEW_0` is marked as legacy input only.
- **Validation**:
  - review with product owner or operator.

### Task 1.2: Define illegal combinations

- **Location**: `docs/` or a follow-up note under `plan/`
- **Description**: Enumerate disallowed states, especially `voice_session + DRAFT` and any surviving `NEW_0` after migration.
- **Dependencies**: Task 1.1.
- **Acceptance Criteria**:
  - illegal combinations are listed with intended remediation.
- **Validation**:
  - cross-check against current DB examples.

## Sprint 2: Backend Contract Normalization

**Goal**: Make backend routes reflect the canonical model and eliminate `NEW_0` from runtime status semantics.

**Demo / Validation**:

- Selecting a row in `Possible Tasks` creates a real task in `Backlog`.
- Session `Задачи` count excludes draft rows.

### Task 2.1: Normalize acceptance target status

- **Location**: `backend/src/api/routes/voicebot/sessions.ts`
- **Description**: Change `process_possible_tasks` so accepted tasks materialize with `targetTaskStatus = BACKLOG`, and remove `NEW_0` from the post-acceptance path. Review whether `create_tickets` should align to the same target or be retired.
- **Dependencies**: Sprint 1.
- **Acceptance Criteria**:
  - no accepted task from the `Possible Tasks` tab is written as `NEW_0`;
  - no accepted task from the `Possible Tasks` tab is written as `DRAFT`;
  - route semantics are explicit and documented.
- **Validation**:
  - route test covering accepted row -> `BACKLOG`.

### Task 2.2: Introduce explicit `DRAFT` and `BACKLOG` statuses

- **Location**: shared status dictionary and all dependent mappings
- **Description**: Add explicit target statuses `DRAFT` and `BACKLOG`, define labels and integrations, and mark `NEW_0` as legacy-only.
- **Dependencies**: Task 2.1.
- **Acceptance Criteria**:
  - `NEW_0` is no longer produced by runtime write paths;
  - `DRAFT` and `BACKLOG` are available in shared dictionaries and mapping layers.
- **Validation**:
  - shared constants and mapping tests.

### Task 2.3: Exclude draft rows from Voice session `Задачи`

- **Location**: `backend/src/api/routes/voicebot/sessions.ts`
- **Description**: Update `session_tab_counts` and any session-task listing queries to exclude `source_kind = voice_possible_task`.
- **Dependencies**: Task 2.2.
- **Acceptance Criteria**:
  - `Задачи` counts only accepted `voice_session` tasks;
  - `Возможные задачи` remains the draft-only view.
- **Validation**:
  - route tests with mixed draft and accepted rows.

### Task 2.4: Stamp acceptance metadata

- **Location**: `backend/src/api/routes/voicebot/sessions.ts`
- **Description**: When a possible task is accepted or materialized, stamp metadata such as `accepted_from_possible_task`, `accepted_from_row_id`, `accepted_at`, and `accepted_by`.
- **Dependencies**: Task 2.1.
- **Acceptance Criteria**:
  - accepted rows are distinguishable without heuristics.
- **Validation**:
  - insert and update tests for materialization payloads.

## Sprint 3: Data Migration And Repair

**Goal**: Repair already mixed historical rows.

**Demo / Validation**:

- Dry-run report classifies historical rows into draft vs accepted buckets.
- Apply mode produces deterministic migrations and preserves traceability.

### Task 3.1: Build audit query/report

- **Location**: `backend/scripts/` or `backend/src/scripts/`
- **Description**: Add a dry-run script that reports:
  - rows to become `DRAFT`,
  - rows to become `BACKLOG`,
  - rows already in later delivery statuses,
  - rows with missing `source_kind`,
  - counts per session and per project.
- **Dependencies**: Sprint 2.
- **Acceptance Criteria**:
  - operators can see exactly how many mixed rows exist.
- **Validation**:
  - dry-run output on a production snapshot.

### Task 3.2: Migrate historical accepted rows

- **Location**: migration script under `backend/scripts/`
- **Description**: Split historical `NEW_0` rows into `DRAFT` and `BACKLOG` using the agreed criterion, with audit logging and no heuristic jump into `READY_10`.
- **Dependencies**: Task 3.1.
- **Acceptance Criteria**:
  - historical draft rows no longer remain in `NEW_0`;
  - historical accepted backlog rows no longer remain in `NEW_0`;
  - `NEW_0` is absent from the migrated target dataset.
- **Validation**:
  - apply-mode test on fixture or sandbox dataset.

### Task 3.3: Recompute session tab counts after migration

- **Location**: backend maintenance script or admin route
- **Description**: Refresh and revalidate session-linked counts after migration.
- **Dependencies**: Task 3.2.
- **Acceptance Criteria**:
  - existing sessions show normalized `Draft / Backlog / Ready / ...` splits.
- **Validation**:
  - smoke-check on representative sessions.

## Sprint 4: Frontend Alignment

**Goal**: Ensure Voice UI and OperOps UI reflect the normalized lifecycle cleanly.

**Demo / Validation**:

- `Возможные задачи` shows drafts only.
- `Задачи` shows accepted tasks only.
- Accepting a draft removes it from `Possible Tasks` and surfaces it in `Задачи` as `Backlog`.

### Task 4.1: Keep `Possible Tasks` draft-only in UI

- **Location**: `app/src/store/voiceBotStore.ts`, `app/src/components/voice/PossibleTasks.tsx`
- **Description**: Make frontend assumptions explicit: acceptance promotes a row out of draft flow rather than leaving it in the same semantic state.
- **Dependencies**: Sprint 2.
- **Acceptance Criteria**:
  - the accept flow does not leave an accepted row visually indistinguishable from a draft.
- **Validation**:
  - UI contract test for the accept flow.

### Task 4.2: Align Voice session `Задачи` with accepted-only semantics

- **Location**: `app/src/pages/voice/SessionPage.tsx`
- **Description**: Keep `Задачи` dependent on backend `status_counts`, but validate that counts and tabs reflect accepted tasks only.
- **Dependencies**: Sprint 2.
- **Acceptance Criteria**:
  - no draft `DRAFT` row from `voice_possible_task` appears in `Задачи`.
- **Validation**:
  - browser smoke-check on mixed historical sessions.

### Task 4.3: Align the OperOps Voice backlog view

- **Location**: `app/src/pages/operops/CRMPage.tsx`, `app/src/pages/operops/voiceTabGrouping.ts`
- **Description**: Confirm that the OperOps `Voice` backlog continues to represent draft `DRAFT` possible tasks intentionally, while session `Задачи` remains accepted-only.
- **Dependencies**: Sprint 2.
- **Acceptance Criteria**:
  - OperOps backlog remains the draft-review workspace;
  - Voice session `Задачи` is not a duplicate of that backlog.
- **Validation**:
  - contract test and manual review.

## Sprint 5: Regression Coverage And Rollout

**Goal**: Lock the model with tests and deployment checks.

**Demo / Validation**:

- Two known production sessions should show normalized counts after rollout.

### Task 5.1: Add backend regression tests

- **Location**: `backend/__tests__/voicebot/session/`
- **Description**: Cover mixed draft and accepted rows, accepted-row status target, and status-count exclusion rules.
- **Dependencies**: Sprint 2.
- **Acceptance Criteria**:
  - tests fail if draft rows re-enter session `Задачи`.
- **Validation**:
  - Jest backend suite.

### Task 5.2: Add frontend regression tests

- **Location**: `app/__tests__/voice/`
- **Description**: Cover the `Possible Tasks` accept flow, session tab counts and labels, and task visibility across `Возможные задачи` vs `Задачи`.
- **Dependencies**: Sprint 4.
- **Acceptance Criteria**:
  - tests fail if frontend reintroduces mixed draft and accepted semantics.
- **Validation**:
  - Jest frontend suite.

### Task 5.3: Production smoke checklist

- **Location**: runbook in `plan/` or `docs/`
- **Description**: Validate on real sessions after deploy:
  - a session with both drafts and accepted tasks,
  - a session with only drafts,
  - a session with only accepted tasks.
- **Dependencies**: Sprint 3 and Sprint 4.
- **Acceptance Criteria**:
  - counts and visible rows match the target model.
- **Validation**:
  - browser-based smoke-check on production.

## Testing Strategy

- Backend:
  - route tests for `possible_tasks`, `process_possible_tasks`, `create_tickets`, and `session_tab_counts`,
  - migration dry-run and apply tests.
- Frontend:
  - session task-tab contracts,
  - accept-from-possible-tasks flow,
  - cross-tab visibility assertions.
- Production:
  - inspect `session_tab_counts` payloads,
  - inspect Voice session `Задачи` rows,
  - confirm that draft rows are `DRAFT`,
  - confirm that accepted rows are `BACKLOG` by default.

## Potential Risks And Gotchas

- Historical `NEW_0` rows with missing `source_kind` may not always be distinguishable from untouched drafts without explicit acceptance metadata.
- Some operators may rely on seeing accepted Voice tasks in `Backlog`; rollout will require communication.
- OperOps `Voice` backlog and Voice session `Задачи` can drift again if source-kind filtering is not mirrored in both backend and frontend.
- Migration scripts must be idempotent and dry-run-first.

## Rollback Plan

- Revert frontend visibility logic for Voice session `Задачи`.
- Revert the backend status split only if the migration has not yet been applied.
- Keep the migration apply step behind an explicit operator flag; do not auto-run it on deploy.
- Preserve an audit report of all migrated task IDs so status rollback can be scripted if needed.
