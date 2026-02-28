# Runtime Contract Gap Matrix (Voice/OperOps/Codex -> TypeDB)

Date: 2026-02-28  
Issue: `copilot-gym6.1`

## Purpose

This matrix is the source-of-truth baseline for `copilot-gym6.2+` and captures confirmed gaps between:
- runtime contracts in backend/workers/frontend (Voice/OperOps/Codex),
- current TypeDB artifacts (`schema`, `mapping`, `ingest`, `validation`).

## Evidence Scope

- Backend API:
  - `backend/src/api/routes/voicebot/sessions.ts`
  - `backend/src/api/routes/crm/codex.ts`
- Workers:
  - `backend/src/workers/voicebot/handlers/transcribe.ts`
  - `backend/src/workers/voicebot/handlers/codexDeferredReview.ts`
  - `backend/src/workers/voicebot/handlers/processingLoop.ts`
- Frontend source-contract usage:
  - `app/src/utils/voiceSessionTaskSource.ts`
  - `app/src/pages/voice/SessionPage.tsx`
  - `app/src/components/voice/CodexTasks.tsx`
- TypeDB artifacts:
  - `ontology/typedb/schema/str_opsportal_v1.tql`
  - `ontology/typedb/mappings/mongodb_to_typedb_v1.yaml`
  - `ontology/typedb/scripts/typedb-ontology-ingest.py`
  - `ontology/typedb/queries/validation_v1.tql`

## Gap Matrix

| # | Runtime contract (evidence) | Current ontology coverage | Required change | Target artifact(s) | Risk if unchanged |
|---|---|---|---|---|---|
| 1 | Codex task payload uses `source_ref`, `external_ref`, `source_kind`, `created_by_name`, `dependencies_from_ai`, `dialogue_reference`, `dialogue_tag`, `codex_task`, `source_data.*` (`sessions.ts:321-348`, `sessions.ts:3298-3327`, `sessions.ts:3447-3485`, `transcribe.ts:362-403`). | `oper_task` schema owns only legacy/base fields (`str_opsportal_v1.tql:515-560`); mapping for `automation_tasks` omits most codex/source fields (`mongodb_to_typedb_v1.yaml:180-243`). | Extend `oper_task` attributes and mapping for Codex/source lineage fields. Keep names aligned with runtime payload keys. | `schema/str_opsportal_v1.tql`, `mappings/mongodb_to_typedb_v1.yaml`, `scripts/typedb-ontology-ingest.py` | Codex/voice-origin tasks lose lineage; graph answers diverge from UI/API. |
| 2 | Project `git_repo` is mandatory for Codex task routing (`sessions.ts:3257-3273`, `transcribe.ts:181-200`). | Project mapping has no `git_repo` (`mongodb_to_typedb_v1.yaml:37-57`); project entity does not own it. | Add `git_repo` to project ontology contract (schema + mapping + ingest). | `schema/str_opsportal_v1.tql`, `mappings/mongodb_to_typedb_v1.yaml`, `scripts/typedb-ontology-ingest.py` | Cannot diagnose Codex eligibility at project level in ontology. |
| 3 | Deferred review lifecycle persists many fields (`codex_review_summary_*`, retry/error fields, approval card metadata, due-at processing gates) (`codexDeferredReview.ts:756-927`). | No explicit deferred-review lifecycle coverage in `oper_task` schema/mapping. | Model deferred-review lifecycle attributes with explicit nullable semantics and retry timeline. | `schema/str_opsportal_v1.tql`, `mappings/mongodb_to_typedb_v1.yaml` | Lost observability for review pipeline; difficult failure triage. |
| 4 | Runtime isolation uses `runtime_tag` in task/session/message processing (`sessions.ts:3340-3361`, `processingLoop.ts:87-93`, `processingLoop.ts:188-199`). | `oper_task` mapping lacks `runtime_tag` (`mongodb_to_typedb_v1.yaml:180-243`); `oper_task` schema lacks it (`str_opsportal_v1.tql:515-560`). | Add `runtime_tag` to task contract and include runtime-tag completeness checks for tasks where required. | `schema/str_opsportal_v1.tql`, `mappings/mongodb_to_typedb_v1.yaml`, `queries/validation_v1.tql` | Cross-runtime leakage in task analytics/joins and weak parity with backend filters. |
| 5 | Voice session -> task linkage in UI/API uses `source_ref`/`external_ref` and nested `source_data.session_id` (`voiceSessionTaskSource.ts:98-142`, `SessionPage.tsx:232-287`, `CodexTasks.tsx:77-99`, `sessions.ts:3447-3485`). | Ontology relates tasks to project only (`project_has_oper_task`), no first-class session-origin linkage for tasks. | Add explicit session-origin relation or equivalent canonical join contract from task to voice session. | `schema/str_opsportal_v1.tql`, `mappings/mongodb_to_typedb_v1.yaml`, `scripts/typedb-ontology-ingest.py` | Cannot reliably answer "tasks created from this session" in graph layer. |
| 6 | Ingest script hardcodes custom ingesters for `automation_tasks`, `automation_voice_bot_sessions`, `automation_voice_bot_messages` (`typedb-ontology-ingest.py:694-980`, `typedb-ontology-ingest.py:1627-1633`). `ingest_tasks` writes minimal subset (`typedb-ontology-ingest.py:709-716`). | Mapping file has richer contract than executed write-path for tasks; drift can persist silently. | Align ingesters with mapping as single contract source (or document explicit intentional divergence with tests). | `scripts/typedb-ontology-ingest.py`, `mappings/mongodb_to_typedb_v1.yaml`, docs | Silent contract drift between YAML and actual TypeDB writes. |
| 7 | Validation pack currently focuses on voice checks (anchor/runtime-tag/close-flow) (`validation_v1.tql:98-156`). | No validation checks for codex task lineage, deferred-review consistency, project git_repo readiness, or task runtime-tag completeness. | Extend validation query set for task/codex quality gates with diagnostic separation (missing vs mismatch vs orphan). | `queries/validation_v1.tql` | Regressions pass undetected; troubleshooting remains manual. |
| 8 | OperOps Codex endpoints can read issues from `bd` CLI (`codex.ts:199-211`, `codex.ts:236-260`), including sync-retry path (`codex.ts:109-175`). | Ontology source boundary is Mongo-only (`mongodb_to_typedb_v1.yaml`), no direct `bd` ingestion path. | Define explicit boundary decision: mirror `bd` issues into Mongo/bridge collection or mark out-of-scope in ontology docs and validation assumptions. | `docs` (+ optional new ingestion source contract) | Ontology will not represent full Codex issue universe shown by OperOps endpoints. |

## Child-Task Handoff Mapping

- `copilot-gym6.2` (schema): rows `1,2,3,4,5`.
- `copilot-gym6.3` (mapping): rows `1,2,3,4,5,6`.
- `copilot-gym6.4` (validation): rows `4,7` (+ doc decision from row `8`).
- `copilot-gym6.5` (scripts + verification): row `6`, then end-to-end setup/ingest/validate cycle.
- `copilot-gym6.6` (docs/changelog): reflect adopted decisions, especially row `8` boundary.

## Open Decision (Must Be Explicit)

- Row `8` requires a product/data-platform decision:
  - either Codex `bd` issue stream is intentionally out-of-ontology scope,
  - or a canonical mirror/bridge contract must be introduced before validation can claim full OperOps/Codex parity.
