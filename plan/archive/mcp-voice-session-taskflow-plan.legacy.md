# Historical Reference: mcp@voice Session-Scoped Taskflow Parity (Possible Tasks / Tasks / Codex)

**Generated**: 2026-03-03

## Status
- Spec state: historical superseded reference
- Current task-surface source of truth:
  - [voice-task-surface-normalization-spec.md](/home/strato-space/copilot/plan/voice-task-surface-normalization-spec.md)
  - [voice-session-possible-tasks-deprecation-plan.md](/home/strato-space/copilot/plan/voice-session-possible-tasks-deprecation-plan.md)

Engineering note:
- this document preserves the earlier MCP/session-taskflow planning context only;
- removed routes and session-payload draft semantics described below are not the active runtime contract anymore.

## Overview
Deliver assistant-side task management parity with Voice UI (`Возможные задачи`, `Задачи`, `Codex`) using `session_id`-scoped MCP tools.

Target outcomes:
- Assistant can list possible tasks for a voice session.
- Assistant can create regular tasks and codex tasks with UI-equivalent routing/validation.
- Possible-task deletion is available both as standalone operation and as atomic attribute in create operations.
- Any update to possible/tasks/codex lists emits websocket updates and is consumed by clients to refresh without manual reload.

## BD Tracking
- Epic: `copilot-zktc` — https://copilot.stratospace.fun/operops/codex/task/copilot-zktc
- T1: `copilot-zktc.1` — https://copilot.stratospace.fun/operops/codex/task/copilot-zktc.1
- T2: `copilot-zktc.2` — https://copilot.stratospace.fun/operops/codex/task/copilot-zktc.2
- T3: `copilot-zktc.3` — https://copilot.stratospace.fun/operops/codex/task/copilot-zktc.3
- T4: `copilot-zktc.4` — https://copilot.stratospace.fun/operops/codex/task/copilot-zktc.4
- T5: `copilot-zktc.5` — https://copilot.stratospace.fun/operops/codex/task/copilot-zktc.5
- T6: `copilot-zktc.6` — https://copilot.stratospace.fun/operops/codex/task/copilot-zktc.6
- T7: `copilot-zktc.7` — https://copilot.stratospace.fun/operops/codex/task/copilot-zktc.7
- T8: `copilot-zktc.8` — https://copilot.stratospace.fun/operops/codex/task/copilot-zktc.8
- T9: `copilot-zktc.9` — https://copilot.stratospace.fun/operops/codex/task/copilot-zktc.9
- T10: `copilot-zktc.10` — https://copilot.stratospace.fun/operops/codex/task/copilot-zktc.10
- T11: `copilot-zktc.11` — https://copilot.stratospace.fun/operops/codex/task/copilot-zktc.11

## Prerequisites
- Backend routes in `/home/strato-space/copilot/backend/src/api/routes/voicebot/sessions.ts`
- Voice MCP server in `/home/tools/voice/src/mcp_voicebot/server.py`
- Voice Python client in `/home/tools/voice/src/lib/core.py`
- Socket namespace contract `/voicebot` and `session_update`/`message_update`

## Dependency Graph

```text
T1 ──┬── T2 ──┬── T3 ──┬── T8 ──┐
     │        │        └────────┤
     │        └── T4 ──┬── T6 ──┼── T9 ──┬── T11
     └── T5 ───────────┘   │    │        │
                            └── T7 ──────┤
T10 ──────────────────────────────────────┘
```

## Tasks

### T1: Canonical session-task contract (source of truth)
- **depends_on**: []
- **location**:
  - `/home/strato-space/copilot/backend/src/api/routes/voicebot/sessions.ts`
  - `/home/tools/voice/src/lib/core.py`
  - `/home/tools/voice/src/mcp_voicebot/server.py`
- **description**:
  - Define canonical DTOs for:
    - possible-task row identity (`row_id` canonical locator; legacy aliases `id/task_id_from_ai/Task ID` as compatibility input only)
    - create regular task payload
    - create codex task payload
    - mutation result payload (`operation_status: success|partial|failed`, `created_task_ids`, `rejected_rows`, `codex_issue_sync_errors`)
  - Freeze atomic mutation flags for create flow (`remove_from_possible_tasks`, optional explicit `remove_items[]`).
  - Lock runtime mismatch error contract for session-scoped operations: `409 { error: "runtime_mismatch" }`.
- **validation**:
  - Contract doc/snippet exists and is referenced by backend + MCP tests.
- **status**: Completed
- **log**:
  - Added canonical `SESSION_TASKFLOW_CONTRACT` in backend route source with explicit row locator aliases, remove flags, mutation result shape, and `runtime_mismatch` 409 contract.
  - Mirrored the same contract in the Voice Python client and exposed it in the MCP server import path for downstream tool parity.
  - Added contract tests in backend and a lightweight Python source-based MCP contract test that does not require FastMCP runtime imports.
- **files edited/created**:
  - `/home/strato-space/copilot/backend/src/api/routes/voicebot/sessions.ts`
  - `/home/strato-space/copilot/backend/__tests__/voicebot/runtime/sessionUtilityRoutes.test.ts`
  - `/home/tools/voice/src/lib/core.py`
  - `/home/tools/voice/src/mcp_voicebot/server.py`
  - `/home/tools/voice/tests/unit/mcp/test_voicebot_new_tools.py`
  - `/home/tools/voice/tests/unit/mcp/test_session_taskflow_contract_source.py`

### T2: Backend API parity layer for session possible-tasks operations
- **depends_on**: [T1]
- **location**:
  - `/home/strato-space/copilot/backend/src/api/routes/voicebot/sessions.ts`
  - `/home/strato-space/copilot/backend/__tests__/voicebot/runtime/*`
- **description**:
  - Ensure stable session-scoped operations for MCP:
    - list possible tasks by `session_id`
    - create tasks/codex tasks preserving current routing semantics
    - standalone delete possible-task row
  - Keep compatibility with existing `/create_tickets` and `/delete_task_from_session` behavior.
  - Delete semantics must be idempotent and automation-friendly (`matched_count`, `deleted_count`, `not_found`).
  - Enforce deterministic row-locator handling and explicit `ambiguous_row_locator` error on collisions.
- **validation**:
  - Route tests cover success, validation errors, access control, runtime mismatch, and compatibility aliases.
- **status**: Completed
- **log**:
  - Added canonical session-scoped `POST /api/voicebot/possible_tasks` route with `session_id` input and normalized `row_id` output.
  - Extended `POST /api/voicebot/create_tickets` with `remove_from_possible_tasks` / `remove_items`, deterministic row-locator resolution, idempotent partial-success metadata, and explicit `runtime_mismatch` / `ambiguous_row_locator` handling.
  - Normalized `POST /api/voicebot/delete_task_from_session` to support canonical + legacy locator aliases and return automation-friendly deletion counters.
  - Added route/runtime tests for compatibility aliases, runtime mismatch, canonical list normalization, and idempotent delete semantics.
  - Validation completed:
    - `cd /home/strato-space/copilot/backend && npm run test -- __tests__/voicebot/runtime/sessionUtilityRoutes.test.ts __tests__/voicebot/runtime/sessionUtilityRuntimeBehavior.validation.test.ts --runInBand`
    - `cd /home/strato-space/copilot/backend && npm run build`
- **files edited/created**:
  - `/home/strato-space/copilot/backend/src/api/routes/voicebot/sessions.ts`
  - `/home/strato-space/copilot/backend/__tests__/voicebot/runtime/sessionUtilityRoutes.test.ts`
  - `/home/strato-space/copilot/backend/__tests__/voicebot/runtime/sessionUtilityRuntimeBehavior.validation.test.ts`

### T3: Backend websocket refresh emission for task-list mutations
- **depends_on**: [T2]
- **location**:
  - `/home/strato-space/copilot/backend/src/api/routes/voicebot/sessions.ts`
  - `/home/strato-space/copilot/backend/src/api/socket/voicebot.ts`
  - `/home/strato-space/copilot/backend/__tests__/voicebot/runtime/*`
- **description**:
  - Emit deterministic room updates after any mutation affecting:
    - possible tasks list
    - tasks list (CRM)
    - codex list
  - Use stable refresh hint payload (via `session_update` extension or dedicated event), with per-list change flags.
- **validation**:
  - Tests assert emit fanout for create/delete/codex-create and include hint payload shape.
- **status**: Completed
- **log**:
  - Added a shared backend helper to emit deterministic `session_update` taskflow refresh hints into the `/voicebot` room after task-list mutations.
  - `create_tickets` now emits per-list refresh flags for `possible_tasks`, `tasks`, and `codex`.
  - `delete_task_from_session` now emits a `possible_tasks` refresh hint with an explicit mutation reason.
  - Runtime tests now assert emitted payload shape for regular create, codex+regular create, and standalone delete.
  - Validation completed:
    - `cd /home/strato-space/copilot/backend && npm run test -- __tests__/voicebot/runtime/sessionUtilityRoutes.test.ts __tests__/voicebot/runtime/sessionUtilityRuntimeBehavior.validation.test.ts __tests__/voicebot/runtime/sessionUtilityRuntimeBehavior.codexSyncAndFilters.test.ts --runInBand`
    - `cd /home/strato-space/copilot/backend && npm run build`
- **files edited/created**:
  - `/home/strato-space/copilot/backend/src/api/routes/voicebot/sessions.ts`
  - `/home/strato-space/copilot/backend/__tests__/voicebot/runtime/sessionUtilityRoutes.test.ts`
  - `/home/strato-space/copilot/backend/__tests__/voicebot/runtime/sessionUtilityRuntimeBehavior.validation.test.ts`
  - `/home/strato-space/copilot/backend/__tests__/voicebot/runtime/sessionUtilityRuntimeBehavior.codexSyncAndFilters.test.ts`

### T4: Voice Python client methods for session taskflow
- **depends_on**: [T2]
- **location**:
  - `/home/tools/voice/src/lib/core.py`
  - `/home/tools/voice/tests/unit/api/*`
- **description**:
  - Add client methods:
    - `session_possible_tasks(session_id, ...)`
    - `create_session_tasks(session_id, tickets, ...)`
    - `create_session_codex_tasks(session_id, tickets, ...)`
    - `delete_session_possible_task(session_id, row_id)`
  - Preserve compatibility for legacy response keys and normalize to canonical shape.
- **validation**:
  - Unit tests verify request body, response normalization, compatibility aliases, and error propagation.
- **status**: Completed
- **log**:
  - Added client methods for:
    - `session_possible_tasks(session_id)`
    - `create_session_tasks(session_id, tickets, ...)`
    - `create_session_codex_tasks(session_id, tickets, ...)`
    - `delete_session_possible_task(session_id, row_id)`
  - `create_*` methods now support explicit local `preview=True`, canonical request normalization, local partial-success merging, and deterministic response normalization.
  - Added unit tests for request payloads, canonical `row_id` normalization, codex wrapper semantics, and standalone delete counters.
  - Validation completed:
    - `cd /home/tools/voice && python -m pytest -o addopts='' tests/unit/api/test_session_taskflow_client_methods.py tests/unit/api/test_session_taskflow_assistant_semantics.py tests/unit/mcp/test_session_taskflow_contract_source.py -q`
    - `cd /home/tools/voice && python -m compileall src/lib/core.py tests/unit/api/test_session_taskflow_client_methods.py tests/unit/api/test_session_taskflow_assistant_semantics.py tests/unit/mcp/test_session_taskflow_contract_source.py`
- **files edited/created**:
  - `/home/tools/voice/src/lib/core.py`
  - `/home/tools/voice/tests/unit/api/test_session_taskflow_client_methods.py`

### T5: Assistant formulation/refinement semantics (preview + apply)
- **depends_on**: [T1]
- **location**:
  - `/home/tools/voice/src/lib/core.py`
  - `/home/tools/voice/src/mcp_voicebot/server.py`
- **description**:
  - Add explicit preview/apply semantics so assistant can discuss/refine text before create.
  - Support per-item overrides and atomic remove-on-create flags.
  - Define strict partial-success behavior: remove from possible list only rows successfully materialized.
- **validation**:
  - Tool/client contract clearly separates preview/apply and returns machine-readable row errors.
- **status**: Completed
- **log**:
  - Added explicit assistant-side `preview/apply` contract in the Voice Python client, separate from backend mutation routes.
  - Implemented deterministic helper methods that:
    - merge per-item `overrides`
    - return machine-readable `rejected_rows`
    - compute `expected_removed_row_ids` so only create-valid rows are scheduled for removal
  - Added internal MCP server wrappers for future tools so preview/apply semantics stay explicit at the tool layer.
  - Validation completed:
    - `cd /home/tools/voice && python -m pytest -o addopts='' tests/unit/api/test_session_taskflow_assistant_semantics.py tests/unit/mcp/test_session_taskflow_contract_source.py -q`
    - `cd /home/tools/voice && python -m compileall src/lib/core.py src/mcp_voicebot/server.py tests/unit/api/test_session_taskflow_assistant_semantics.py tests/unit/mcp/test_session_taskflow_contract_source.py`
- **files edited/created**:
  - `/home/tools/voice/src/lib/core.py`
  - `/home/tools/voice/src/mcp_voicebot/server.py`
  - `/home/tools/voice/tests/unit/api/test_session_taskflow_assistant_semantics.py`
  - `/home/tools/voice/tests/unit/mcp/test_session_taskflow_contract_source.py`
  - `/home/tools/voice/tests/unit/mcp/test_voicebot_new_tools.py`

### T6: MCP tools in `mcp@voice` for session taskflow
- **depends_on**: [T4, T5]
- **location**:
  - `/home/tools/voice/src/mcp_voicebot/server.py`
  - `/home/tools/voice/tests/unit/mcp/test_voicebot_new_tools.py`
- **description**:
  - Expose new tools:
    - list possible tasks by session
    - create regular tasks
    - create codex tasks
    - delete possible-task item
  - Keep signatures compact and `session`/`session_id` friendly.
- **validation**:
  - MCP unit tests cover forwarding, output normalization, and partial-success payloads.
- **status**: Completed
- **log**:
  - Exposed FastMCP tools for session-scoped taskflow:
    - `session_possible_tasks`
    - `create_session_tasks`
    - `create_session_codex_tasks`
    - `delete_session_possible_task`
  - Preview mode now stays explicit at the MCP layer and uses assistant-side local preparation without backend mutation.
  - Extended MCP contract tests (source-based in this environment) to assert new tool declarations and updated unit test fixture coverage for future FastMCP-enabled runs.
  - Validation completed:
    - `cd /home/tools/voice && python -m pytest -o addopts='' tests/unit/api/test_session_taskflow_client_methods.py tests/unit/api/test_session_taskflow_assistant_semantics.py tests/unit/mcp/test_session_taskflow_contract_source.py -q`
    - `cd /home/tools/voice && python -m compileall src/lib/core.py src/mcp_voicebot/server.py tests/unit/api/test_session_taskflow_client_methods.py tests/unit/api/test_session_taskflow_assistant_semantics.py tests/unit/mcp/test_session_taskflow_contract_source.py tests/unit/mcp/test_voicebot_new_tools.py`
- **files edited/created**:
  - `/home/tools/voice/src/mcp_voicebot/server.py`
  - `/home/tools/voice/tests/unit/mcp/test_session_taskflow_contract_source.py`
  - `/home/tools/voice/tests/unit/mcp/test_voicebot_new_tools.py`

### T7: Actions API parity for token-based automation path
- **depends_on**: [T6]
- **location**:
  - `/home/tools/voice/src/actions/main.py`
  - `/home/tools/voice/tests/unit/actions/test_actions_api_unit.py`
- **description**:
  - Add token-protected endpoints mirroring MCP taskflow operations.
  - Keep shared schema/normalization with MCP to prevent drift.
- **validation**:
  - Actions unit tests cover auth, validation, and payload parity with MCP.
- **status**: Completed
- **log**:
  - Added token-protected Actions API endpoints for session taskflow parity:
    - `/voicebot/session_possible_tasks`
    - `/voicebot/create_session_tasks`
    - `/voicebot/create_session_codex_tasks`
    - `/voicebot/delete_session_possible_task`
  - Reused `VoicebotClient` taskflow normalization and client-side error mapping so Actions and MCP share one behavioral contract.
  - Expanded Actions API tests to cover auth, payload validation, preview/apply forwarding, codex-target parity, and standalone delete semantics.
  - Validation completed:
    - `cd /home/tools/voice && ./.venv/bin/python -m pytest -o addopts='' tests/unit/actions/test_actions_api_unit.py -q`
    - `cd /home/tools/voice && ./.venv/bin/python -m compileall src/actions/main.py tests/unit/actions/test_actions_api_unit.py`
- **files edited/created**:
  - `/home/tools/voice/src/actions/main.py`
  - `/home/tools/voice/tests/unit/actions/test_actions_api_unit.py`
  - `/home/tools/voice/README.md`

### T8: Voice UI/consumer refresh handling for task-list events
- **depends_on**: [T3]
- **location**:
  - `/home/strato-space/copilot/app/src/store/voiceBotStore.ts`
  - `/home/strato-space/copilot/app/src/components/codex/CodexIssuesTable.tsx`
  - `/home/strato-space/copilot/app/src/components/crm/CRMKanban.tsx`
- **description**:
  - Consume websocket refresh hints and trigger deterministic tab refreshes for:
    - `Возможные задачи`
    - `Задачи`
    - `Codex`
  - Avoid full-page reload; preserve active tab/filter state.
- **validation**:
  - Frontend tests verify that mutation events trigger correct scoped refetch/update behavior.
- **status**: Completed
- **log**:
  - Frontend store now consumes `session_update.taskflow_refresh` hints from the voice socket.
  - `possible_tasks` hint triggers a lightweight session refetch to refresh `processors_data.CREATE_TASKS` without reloading the whole page.
  - `tasks` and `codex` hints increment dedicated refresh tokens that are passed into `CRMKanban` and `CodexIssuesTable`, causing silent refetch without remounting and without dropping local UI state.
  - Added frontend contract tests for the socket/store handling and refresh-token wiring.
  - Validation completed:
    - `cd /home/strato-space/copilot/app && ./node_modules/.bin/jest --runInBand __tests__/voice/sessionPageCodexTabContract.test.ts __tests__/voice/sessionPageOperOpsTasksTabContract.test.ts __tests__/voice/voiceSocketRealtimeContract.test.ts __tests__/operops/codexIssuesTableContract.test.ts __tests__/operops/crmKanbanSourceRefFilterContract.test.ts`
    - `cd /home/strato-space/copilot/app && npm run build`
- **files edited/created**:
  - `/home/strato-space/copilot/app/src/types/voice.ts`
  - `/home/strato-space/copilot/app/src/store/voiceBotStore.ts`
  - `/home/strato-space/copilot/app/src/pages/voice/SessionPage.tsx`
  - `/home/strato-space/copilot/app/src/components/crm/CRMKanban.tsx`
  - `/home/strato-space/copilot/app/src/components/codex/CodexIssuesTable.tsx`
  - `/home/strato-space/copilot/app/__tests__/voice/sessionPageCodexTabContract.test.ts`
  - `/home/strato-space/copilot/app/__tests__/voice/sessionPageOperOpsTasksTabContract.test.ts`
  - `/home/strato-space/copilot/app/__tests__/voice/voiceSocketRealtimeContract.test.ts`
  - `/home/strato-space/copilot/app/__tests__/operops/codexIssuesTableContract.test.ts`
  - `/home/strato-space/copilot/app/__tests__/operops/crmKanbanSourceRefFilterContract.test.ts`

### T9: End-to-end regression pack (backend + voice repo + client behavior)
- **depends_on**: [T3, T6, T7, T8]
- **location**:
  - `/home/strato-space/copilot/backend/__tests__/voicebot/runtime/*`
  - `/home/tools/voice/tests/unit/*`
  - `/home/tools/voice/tests/integration/*`
  - `/home/strato-space/copilot/app/__tests__/voice/*`
- **description**:
  - Add regressions for:
    - session-scoped list/create/delete
    - codex-only creation path
    - websocket-driven refresh end-to-end
    - atomic delete attribute behavior
    - concurrency/idempotency (concurrent create/delete, duplicate row ids, retry-safe apply).
- **validation**:
  - Targeted suites pass in both repos; no contract regressions in existing voice taskflow.
- **status**: Completed
- **log**:
  - Added regression coverage for duplicate `remove_items` aliases in backend create flow, retry-safe local apply failure in the Voice client, and additive frontend refresh-token increments for repeated websocket hints.
  - Re-ran targeted cross-repo suites across backend runtime routes, Voice client/MCP/Actions tests, and frontend Voice/Codex taskflow contracts.
  - Validation completed:
    - `cd /home/strato-space/copilot/backend && npm run test -- __tests__/voicebot/runtime/sessionUtilityRoutes.test.ts __tests__/voicebot/runtime/sessionUtilityRuntimeBehavior.validation.test.ts __tests__/voicebot/runtime/sessionUtilityRuntimeBehavior.codexSyncAndFilters.test.ts --runInBand`
    - `cd /home/tools/voice && ./.venv/bin/python -m pytest -o addopts='' tests/unit/api/test_session_taskflow_client_methods.py tests/unit/api/test_session_taskflow_assistant_semantics.py tests/unit/mcp/test_session_taskflow_contract_source.py tests/unit/mcp/test_voicebot_new_tools.py tests/unit/actions/test_actions_api_unit.py -q`
    - `cd /home/strato-space/copilot/app && ./node_modules/.bin/jest --runInBand __tests__/voice/sessionPageCodexTabContract.test.ts __tests__/voice/sessionPageOperOpsTasksTabContract.test.ts __tests__/voice/voiceSocketRealtimeContract.test.ts __tests__/operops/codexIssuesTableContract.test.ts __tests__/operops/crmKanbanSourceRefFilterContract.test.ts`
    - `cd /home/strato-space/copilot/backend && npm run build`
    - `cd /home/strato-space/copilot/app && npm run build`
- **files edited/created**:
  - `/home/strato-space/copilot/backend/__tests__/voicebot/runtime/sessionUtilityRuntimeBehavior.validation.test.ts`
  - `/home/tools/voice/tests/unit/api/test_session_taskflow_client_methods.py`
  - `/home/strato-space/copilot/app/__tests__/voice/voiceSocketRealtimeContract.test.ts`

### T10: Cross-repo rollout sequencing and rollback gates
- **depends_on**: []
- **location**:
  - `/home/strato-space/copilot/plan/archive/mcp-voice-session-taskflow-plan.legacy.md`
  - `/home/tools/voice/README.md`
- **description**:
  - Define deployment order to avoid production breakage:
    1) backend compatible contract
    2) voice client
    3) MCP tools
    4) actions parity
    5) frontend refresh consumers
  - Define compatibility window and rollback conditions per stage.
- **rollout checklist** (mirrored in `/home/tools/voice/README.md`, section `Cross-repo rollout sequencing and rollback gates`):
  | Stage | Deploy order | Scope | Compatibility window | Rollback gate | Rollback action |
  |------|---|---|---|---|---|
  | S1 | 1 | Backend contract (`/api/voicebot/*`) | Keep canonical + legacy aliases until S5 is stable for 7 days. | Any contract drift for legacy routes (`/create_tickets`, `/delete_task_from_session`) or non-`runtime_mismatch` 409 behavior. | Revert backend contract changes only; keep existing client/tool versions. |
  | S2 | 2 | Voice Python client (`VoicebotClient`) | Keep dual-shape normalization (`id` aliases, row locator aliases) until S5 is stable for 7 days. | New client methods fail against S1 backend or drop canonical fields (`operation_status`, `created_task_ids`, `rejected_rows`). | Roll back client release; keep backend at S1. |
  | S3 | 3 | MCP tools (`mcp_voicebot`) | Accept both `session` and `session_id` inputs through S5 + 7 days. | MCP taskflow tools fail parity with client methods or lose partial-success payload pass-through. | Roll back MCP server only; keep S1+S2. |
  | S4 | 4 | Actions API parity (`/voicebot/*`) | Keep request/response parity with MCP through S5 + 7 days. | Actions payload diverges from MCP contract or auth/validation breaks token automation path. | Roll back Actions layer only; keep MCP and earlier stages. |
  | S5 | 5 | Frontend consumers (refresh hints for `Возможные задачи`/`Задачи`/`Codex`) | Keep previous manual refresh fallback for one release after rollout. | Realtime hint regressions (lists stale without manual reload) or scoped refresh causes tab reset/state loss. | Roll back frontend consumer changes; keep backend/client/MCP/Actions staged. |
- **validation**:
  - Rollout checklist exists in this plan and is mirrored in `/home/tools/voice/README.md`.
  - Plan references README checklist section and README references this T10 section.
- **status**: Completed
- **log**:
  - Added the stage-safe deployment order and per-stage compatibility/rollback gates for backend -> client -> MCP -> Actions -> frontend.
  - Added explicit cross-reference requirements between this plan section and `/home/tools/voice/README.md`.
- **files edited/created**:
  - `/home/strato-space/copilot/plan/archive/mcp-voice-session-taskflow-plan.legacy.md`
  - `/home/tools/voice/README.md`

### T11: Documentation + assistant usage runbook
- **depends_on**: [T9, T10]
- **location**:
  - `/home/tools/voice/README.md`
  - `/home/tools/voice/AGENTS.md`
  - `/home/strato-space/copilot/AGENTS.md`
- **description**:
  - Document new MCP/Actions operations, payloads, partial-success semantics, and websocket refresh hints.
  - Add assistant playbook: discuss -> preview -> apply -> verify lists.
- **validation**:
  - Docs include usage examples for all new tools and event semantics.
- **status**: Completed
- **log**:
  - Added a shared runbook for assistant-driven session taskflow usage: `discuss -> preview -> apply -> verify`.
  - Documented MCP and Actions examples for list/create/create_codex/delete, fixed mutation result semantics, and troubleshooting for `runtime_mismatch`, `ambiguous_row_locator`, partial success, and realtime refresh hints.
  - Mirrored the canonical taskflow contract and runbook in both `AGENTS.md` files so parent and child agents use the same workflow.
- **files edited/created**:
  - `/home/tools/voice/README.md`
  - `/home/tools/voice/AGENTS.md`
  - `/home/strato-space/copilot/AGENTS.md`

## Parallel Execution Groups

| Wave | Tasks | Can Start When |
|------|-------|----------------|
| 1 | T1, T10 | Immediately |
| 2 | T2, T5 | T1 complete |
| 3 | T3, T4 | T2 complete |
| 4 | T6, T8 | T4 + T5 complete for T6, T3 complete for T8 |
| 5 | T7 | T6 complete |
| 6 | T9 | T3, T6, T7, T8 complete |
| 7 | T11 | T9, T10 complete |

## Testing Strategy
- Copilot backend runtime route tests for session task endpoints + websocket emits.
- Voice client unit tests for payload/normalization/error behavior.
- MCP and Actions unit tests for tool/endpoint parity.
- Frontend tests for websocket hint consumption and scoped list refresh.
- Integration smoke for session-scoped create/delete and codex path.

## Risks & Mitigations
- Risk: existing UI contracts break due payload drift.
  - Mitigation: keep backward-compatible aliases and normalization tests.
- Risk: cross-repo drift (copilot backend vs voice client/mcp/actions).
  - Mitigation: shared schema contract and parity tests in both repos.
- Risk: realtime over-emission/noise.
  - Mitigation: strict event taxonomy + idempotent refresh hints.
- Risk: partial-success ambiguity in automation.
  - Mitigation: explicit `operation_status` and per-row result contract.
