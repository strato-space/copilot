# Historical Reference: Live Possible Tasks During Meeting

**Generated**: 2026-03-06

## Status ✅Closed

- Epic ticket (`copilot-6d9d`): ✅Closed 1
- Task-surface rollout ticket line (`copilot-6d9d.*`): ⚪Open 0  🟡In Progress 0  💤Deferred 0  ⛔Blocked 0  ✅Closed 9
- Plan status: historical live-possible-tasks rollout is completed and superseded by the current task-surface normalization and deprecation specs.
- Current task-surface source of truth:
- [voice-task-surface-normalization-spec.md](/home/strato-space/copilot/plan/closed/voice-task-surface-normalization-spec.md)
- [voice-session-possible-tasks-deprecation-plan.md](/home/strato-space/copilot/plan/closed/voice-session-possible-tasks-deprecation-plan.md)

**Статус документа**: historical superseded reference; keep for rollout history and pre-normalization live-possible-tasks planning context only
**Дата**: 2026-03-06
**Основание**: closed state of `copilot-6d9d`, fully closed child rollout line, and later task-surface truth being carried by the normalization and deprecation docs above.

Engineering note:
- this document preserves the earlier live-possible-tasks planning context only;
- draft status and route semantics described below are not the active runtime contract anymore.

## BD Tracking
- Epic: `copilot-6d9d` — https://copilot.stratospace.fun/operops/codex/task/copilot-6d9d
- T0: `copilot-6d9d.1` — https://copilot.stratospace.fun/operops/codex/task/copilot-6d9d.1
- T1: `copilot-6d9d.2` — https://copilot.stratospace.fun/operops/codex/task/copilot-6d9d.2
- T2: `copilot-6d9d.3` — https://copilot.stratospace.fun/operops/codex/task/copilot-6d9d.3
- T3: `copilot-6d9d.4` — https://copilot.stratospace.fun/operops/codex/task/copilot-6d9d.4
- T4: `copilot-6d9d.5` — https://copilot.stratospace.fun/operops/codex/task/copilot-6d9d.5
- T5: `copilot-6d9d.6` — https://copilot.stratospace.fun/operops/codex/task/copilot-6d9d.6
- T6: `copilot-6d9d.7` — https://copilot.stratospace.fun/operops/codex/task/copilot-6d9d.7
- T7: `copilot-6d9d.8` — https://copilot.stratospace.fun/operops/codex/task/copilot-6d9d.8
- T8: `copilot-6d9d.9` — https://copilot.stratospace.fun/operops/codex/task/copilot-6d9d.9

## Overview
Implement live generation of possible tasks during an active Voice meeting.

Core decisions:
- use only `agents/agent-cards/create_tasks.md` as the generation prompt;
- store possible tasks in `automation_tasks` as the master system;
- use existing status `NEW_0 / Backlog` for possible tasks;
- keep session-local state as a lightweight projection only;
- redesign OperOps `Voice` around `NEW_0` tasks, with an orphan bucket first and session groups after that;
- treat `source_kind` as metadata only, not as the primary filter for the feed.

## Target Outcomes
- Voice session header has a `Tasks` button before `Summarize`.
- The button works before session close and uses currently available transcript context.
- `create_tasks` accepts structured input via `raw_text`, `session_id`, or optional `session_url`.
- The prompt can enrich context via MCP `voice` and `gsh`.
- Generated tasks contain enough executor-ready context even when the assignee cannot open the source session.
- Duplicate clicks merge into existing project/session task space instead of replacing or cloning.
- Multi-session discussion of one topic links to one task; major clarification creates a new task with `discovered-from`.
- OperOps `Voice` becomes a grouped review surface for all `NEW_0` possible tasks and their processed descendants.

## Mongo + Relation Contract
- Master store: `automation_tasks`.
- Initial possible-task status: `NEW_0`.
- Processing path: `NEW_0 -> READY_10`, no second task document.
- Primary linkage fields:
  - `external_ref`: canonical session URL
  - `source_ref`: canonical session URL
  - `source_data.session_id`
  - `source_data.session_name`
  - `source_data.voice_sessions[]`
- Relation fields:
  - `parent_task_id`
  - `parent_task_db_id`
  - `dependencies[]` with `dependency_type`
- Allowed dependency types:
  - `waits-for`
  - `blocks`
  - `relates_to`
  - `discovered-from`

## UI Contract
- Voice session page:
  - `Tasks` button before `Summarize`
  - session tab `Возможные задачи` reads Mongo-backed possible tasks
  - delete/unlink behavior follows session-link semantics
- OperOps `Voice`:
  - first group: orphan `NEW_0` tasks with no voice linkage
  - then session groups, newest session first
  - possible tasks expanded, processed tasks collapsed
  - relationship rendering reuses Codex relationship semantics and pictograms

## Temporary MCP Voice Enrichment
- Extend `/home/tools/voice` so project-oriented reads can attach a temporary routing-item block derived from `/home/strato-space/settings/routing-prod.json` by `project_id`.
- Use that routing-item block to discover roadmap/backlog Google Sheets references for prompt enrichment.
- This is transitional and will later be replaced by native project-card storage.

## Current Inventory Snapshot
- Active `NEW_0 / Backlog` tasks in Mongo, excluding deleted/archive: `78`
- Linked to voice sessions: `0`
- Orphan tasks: `78`

## Dependency Graph
```text
copilot-6d9d.1 -> copilot-6d9d.2
copilot-6d9d.1 -> copilot-6d9d.3
copilot-6d9d.1 -> copilot-6d9d.4
copilot-6d9d.2 -> copilot-6d9d.5
copilot-6d9d.3 -> copilot-6d9d.5
copilot-6d9d.4 -> copilot-6d9d.5
copilot-6d9d.5 -> copilot-6d9d.6
copilot-6d9d.4 -> copilot-6d9d.7
copilot-6d9d.5 -> copilot-6d9d.7
copilot-6d9d.4 -> copilot-6d9d.8
copilot-6d9d.5 -> copilot-6d9d.8
copilot-6d9d.6 -> copilot-6d9d.9
copilot-6d9d.7 -> copilot-6d9d.9
copilot-6d9d.8 -> copilot-6d9d.9
```

## Acceptance Checklist
- Prompt/runtime:
  - structured input modes work
  - `gsh` is exposed to agent runtime
  - prompt excludes finance/evaluative noise
- Backend:
  - possible tasks persist in `automation_tasks`
  - `/voicebot/possible_tasks` reads Mongo-backed tasks
  - processing route performs status transition only
- UI:
  - `Tasks` button is visible and active in session page
  - OperOps `Voice` shows orphan-first grouping and session grouping
- Relations:
  - Parent / Children / Depends On / Blocks / Related / Discovered From render consistently
- QA:
  - duplicate clicks merge
  - multi-session linking works
  - clarified tasks create `discovered-from`
