# Voice Session Tasks: Edit Parity With OperOps CRM

**Created**: 2026-03-12  
**Status**: implemented by shared `CRMKanban` reuse; no separate execution wave currently required

## Summary

Voice session tab `Задачи` should support the same task editing affordances as OperOps CRM for the same underlying task documents.

This is a separate feature track from voice task status normalization.

The goal is not to introduce a second task editor for Voice, but to make the Voice session task grid behave like the existing OperOps `CRMKanban` surface.

## Current state

Current Voice session `Задачи` tab:
- uses `CRMKanban`
- filters by current voice session source refs
- filters by current accepted-task status subtabs

Current gap reported by operators:
- edit control in Voice session `Задачи` does not behave like OperOps CRM
- expected parity includes:
  - **Edit task button**
  - **inline grid editing**

Reference surface:
- `https://copilot.stratospace.fun/operops/crm`

Voice surface:
- `https://copilot.stratospace.fun/voice/session/:id`

## Target UX contract

### Edit task button

Voice session `Задачи` must expose the same edit affordance as OperOps CRM:
- same visibility rules
- same permission expectations
- same target task object

Expected behavior:
- clicking edit opens the same task editing flow/operators use in OperOps
- the opened task is the exact same underlying task document as in CRM

### Inline grid editing

Voice session `Задачи` grid must support the same inline editing affordances as `CRMKanban` for allowed fields.

Expected parity:
- same interaction model
- same save/cancel behavior
- same validation behavior
- same optimistic/realtime refresh expectations

## Shared source of truth

Voice `Задачи` must not maintain its own edit model.

Source of truth:
- the same `automation_tasks` rows as OperOps CRM

This implies:
- edits from Voice and edits from OperOps converge on the same backend contract
- no Voice-only shadow editing state or duplicated task-edit backend path

## Editing scope

### Fields expected to match current `CRMKanban`

Voice session `Задачи` should support the same currently allowed edit surfaces as shared `CRMKanban`, especially:
- title
- performer
- priority
- task status
- task type
- shipment/upload date if already supported by the shared grid
- explicit edit action entrypoint

### Not in scope for this spec

- draft `Possible Tasks` editing behavior
- Codex task editing behavior
- new Voice-specific edit-only fields

This spec applies only to:
- accepted tasks shown in Voice session tab `Задачи`

## Backend/frontend implications

### Frontend

Preferred implementation path:
- reuse `CRMKanban` behavior in the Voice embedding context
- pass the missing props/config/permissions needed for parity

Avoid:
- Voice-only duplicate edit logic
- a separate Voice-specific task grid implementation unless parity cannot be reached through reuse

### Backend

Preferred backend path:
- reuse current task update routes and update payload semantics already used by OperOps
- do not invent a new Voice-only task-edit API unless current shared update flow is objectively insufficient

### Filtering / scoping

Voice session `Задачи` remains session-scoped:
- filtered by current voice session source refs
- filtered by current accepted-task status subtab

After edit:
- task remains visible if it still matches current filter
- task disappears only if the new value legitimately moves it out of the current filter/tab

## Failure behavior

If save fails:
- user gets the same feedback quality as in OperOps
- no silent no-op
- no stale optimistic state that survives reload

If realtime refresh happens after save:
- row converges to backend truth
- no duplicate rows
- no ghost stale values

## Test plan

### Contract checks
- Voice `Задачи` uses the same `CRMKanban` editing affordances as OperOps
- no duplicated Voice-only edit path appears unless explicitly justified

### UI behavior
- edit button is visible where it is visible in OperOps
- inline editing works for the same fields
- save/cancel behavior matches OperOps

### Data behavior
- editing in Voice changes the same underlying task as editing in OperOps
- after reload, updated values persist
- session-scoped filter still behaves correctly after edit

### Regression
- accepted tasks remain editable
- draft `Possible Tasks` are not accidentally routed through the same editing semantics

## Assumptions

- `CRMKanban` is the canonical edit surface for accepted tasks.
- Voice `Задачи` should reuse existing task-edit logic, not fork it.
- This spec covers accepted-task editing only.
- Any required backend changes should be minimal and reuse current task update routes where possible.

## Implementation items

No mandatory implementation items are currently выделяются from this spec.

Current engineering interpretation:
- accepted-task edit parity is already achieved through embedded `CRMKanban` reuse in Voice session `Задачи`;
- only new operator-reported parity regressions should reopen this track.
