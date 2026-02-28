# TypeDB Rollout Plan (v1)

## Goal
Create a production-ready ontology layer for OperOps + FinOps + Voice, with MongoDB as source of truth during migration.

Migration baseline: TypeDB `3.x` only (hard cutover), no TypeDB `2.x` compatibility track.

Contract baseline for current sync wave (`copilot-gym6.*`):
- `docs/runtime_contract_gap_matrix_v1.md`

## Phase 0 - Environment

1. Provision TypeDB (isolated env) and create database `str_opsportal_v1`.
2. Import schema from `schema/str_opsportal_v1.tql`.
3. Create ingestion service skeleton with deadletter logging.

## Phase 1 - Core OperOps + Voice

1. Ingest `automation_projects`, `automation_customers`, `automation_tasks`.
2. Ingest `automation_voice_bot_sessions`, `automation_voice_bot_messages`, `automation_voice_bot_session_log`.
3. Ingest `automation_voice_bot_session_merge_log` for merge audit traceability.
4. Materialize critical relations:
   - `project_has_oper_task`
   - `project_has_voice_session`
   - `voice_session_has_message`
   - `voice_message_chunked_as_transcript_chunk`
   - `voice_session_has_history_step`
   - `voice_session_has_merge_log`
5. Run `queries/validation_v1.tql` and fix orphan records.
6. Enforce voice runtime contract checks:
   - pending/image-anchor consistency,
   - runtime-tag coverage in runtime-scoped voice collections,
   - close-flow consistency (`is_active=false` + `to_finalize=true` => `done_at`).

## Phase 2 - FinOps Current Live

1. Ingest `forecasts_project_month`, `finops_expense_categories`, `finops_expense_operations`, `finops_fx_rates`.
2. Materialize relations:
   - `project_has_forecast_month`
   - `cost_category_classifies_expense`
   - `project_has_cost_expense`
3. Validate with orphan and count checks.

## Phase 3 - Spec Gaps

1. Add source pipelines for missing collections when implemented in MongoDB:
   - `facts_project_month`, `fx_monthly`, `finops_month_closures`, `forecast_versions`, `project_rates`, `employee_month_cost`, `timesheets_monthly`.
2. Extend schema with stricter constraints for period lock and FX consistency.
3. Add business checks for margin and period closure semantics.

## Phase 4 - Operationalization

1. Expose read-only ontology queries for analytics and diagnostics.
2. Add CI smoke tests: schema load + sample ingestion + validation queries.
3. Enforce strict schema governance:
   - all schema changes are explicit and deterministic;
   - no compatibility shims for legacy TypeDB APIs.

## Risks

- Mongo schema drift (`status` vs `task_status`, mixed id types) may inflate deadletter volume.
- Missing source collections limit full FinOps semantics in early phases.
- Runtime tags are partially absent in legacy documents.

## Exit Criteria

- Core validation queries pass with zero critical orphans.
- TypeDB answers core graph questions for task/voice/forecast flows.
- Gap list is reduced to spec-only entities not yet available in MongoDB.
