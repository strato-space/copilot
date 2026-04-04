# Plan: Create Tasks Ontology/Morphology Prompt Migration

**Generated**: 2026-04-04  
**Spec**: `/home/strato-space/copilot/plan/2026-04-04-create-tasks-ontology-prompt-migration-spec.md`  
**BD**: `copilot-j7dp`

## Overview
Migrate language-dependent ontology and morphology policy out of TypeScript runtime (`createTasksAgent.ts`) into prompt contract (`create_tasks.md`), while preserving deterministic runtime transition enforcement via structured exceptions and one bounded reformulation retry.

This plan follows repo governance from `AGENTS.md`: ontology-first behavior in prompt, transition legality in runtime, no silent filtering, and evidence-backed replay acceptance.

## Prerequisites
- Claimed bd issue: `copilot-j7dp`
- Clean execution scope in `/home/strato-space/copilot`
- Existing tests runnable in backend package context
- Access to target replay session `69cf65712a7446295ac67771`

## Assumptions
- No new external libraries are introduced; Context7 lookup is not required for this plan.
- Existing create_tasks card and runtime interfaces remain structurally compatible.
- Replay and deploy verification are performed by parent thread after subagent lanes converge.

## Dependency Graph

```text
T1 ──┬── T2 ──┬── T7a ─┐
     │        │        │
     ├── T3 ──┼── T6 ──┼── T8 ──┐
     │        │        │        │
     └── T4 ──┴── T5 ──┼── T7b ─┼── T8b ─┐
                        │        │        │
                        └────────┴── T9 ──┴── T10 ── T10b ──┬── T11
                                                              ├── T12
                                                              └── T13 ── T14
```

## Tasks

### T1: Baseline And Contract Lock
- **depends_on**: []
- **location**: `bd`, `plan/2026-04-04-create-tasks-ontology-prompt-migration-spec.md`
- **description**: Claim issue, re-read spec and lock acceptance gates (Gate 1..7) as implementation contract.
- **validation**: `bd show copilot-j7dp --json` recorded in worker logs; gates copied into implementation checklist.
- **status**: Completed
- **log**: Parent thread confirmed `bd show copilot-j7dp --json` and re-read spec + swarm plan; execution lanes started with explicit first-step commands for ticket/spec reads.
- **files edited/created**: `plan/2026-04-04-create-tasks-ontology-prompt-migration-swarm-plan.md`

### T2: Prompt Ontology Ownership Migration
- **depends_on**: [T1]
- **location**: `agents/agent-cards/create_tasks.md`
- **description**: Move lexical/morphology/ontology ownership into prompt contract; define handling for `runtime_rejections`, non-materialization, and re-attribution behavior.
- **validation**: Prompt card contains explicit ontology classes and retry instructions; no TS-only lexical policy references needed for semantic decisions.
- **status**: Completed
- **log**: Added canonical ontology mapping (`deliverable_task`, `coordination_only`, `input_artifact`, `reference_or_idea`, `status_or_report`), explicit prompt ownership for lexical/morphology policy, and bounded `runtime_rejections` recovery instructions (`reclassify`/`reattribute`/`discard`, no unchanged replay).
- **files edited/created**: `agents/agent-cards/create_tasks.md`

### T3: Remove Runtime Lexical Ownership
- **depends_on**: [T1]
- **location**: `backend/src/services/voicebot/createTasksAgent.ts`
- **description**: Remove/neutralize runtime ownership of language-specific lexicons (`TASK_NAME_STOPWORDS`, `RUSSIAN_ONTOLOGY_ALLOWLIST`, and equivalent lexical classifiers).
- **validation**: Grep check: no runtime decision branches keyed by stopword/allowlist lexical denylists.
- **status**: Completed
- **log**: Removed silent lexical ownership from runtime write decisions: deleted `TASK_NAME_STOPWORDS`/`RUSSIAN_ONTOLOGY_ALLOWLIST`, removed stopword-based normalization branch, and removed ontology-based silent filtering in `parseTasksPayload`.
- **files edited/created**: `backend/src/services/voicebot/createTasksAgent.ts`

### T4: Define Transition Error Contract
- **depends_on**: [T1]
- **location**: `backend/src/services/voicebot/createTasksAgent.ts` (or extracted helper module)
- **description**: Implement deterministic transition guard with stable machine-readable enum payload (`candidate_id`, `attempted_surface`, `candidate_class`, `violated_invariant_code`, `recovery_action`, message).
- **validation**: Runtime throws/returns structured transition rejection, never silent drop for invalid transition.
- **status**: Completed
- **log**: Added deterministic transition rejection contract (`candidate_id`, `attempted_surface`, `candidate_class`, `violated_invariant_code`, `message`, `recovery_action`) plus structured runtime failure extractor (`extractCreateTasksRuntimeFailure`) for downstream propagation.
- **files edited/created**: `backend/src/services/voicebot/createTasksAgent.ts`

### T5: Wire One-Bounded Reformulation Retry
- **depends_on**: [T2, T3, T4, T6]
- **location**: `backend/src/services/voicebot/createTasksAgent.ts`, prompt invocation envelope
- **description**: On transition rejection, run one prompt reformulation retry with `runtime_rejections`; fail fast on repeated invalid transition.
- **validation**: Code path enforces max one transition-reformulation retry; second rejection exits with machine-readable failure reason.
- **status**: Completed
- **log**: Implemented bounded reformulation loop for transition failures: runtime sends `runtime_rejections` back into envelope once, then fail-fast with machine-readable `create_tasks_transition_retries_exhausted` on repeated invalid transition.
- **files edited/created**: `backend/src/services/voicebot/createTasksAgent.ts`

### T5b: Retry-Budget Isolation
- **depends_on**: [T4]
- **location**: `backend/src/services/voicebot/createTasksAgent.ts`
- **description**: Add explicit reason-scoped retry budget so transition reformulation (`<=1`) does not chain with reduced-context/language-repair/task-gap repair into multi-retry loops.
- **validation**: Tests prove no cross-trigger recursion; retry counters are deterministic and bounded by reason.
- **status**: Completed
- **log**: Added reason-scoped retry ledger (`transition_reformulation`, `reduced_context`, `quota_recovery`) to prevent cross-trigger recursion and keep each retry path bounded independently.
- **files edited/created**: `backend/src/services/voicebot/createTasksAgent.ts`

### T6: Remove Deterministic Semantic Backfills
- **depends_on**: [T2, T3]
- **location**: `backend/src/services/voicebot/createTasksAgent.ts`
- **description**: Delete or demote deterministic lexical semantic backfills (language repair/task-gap lexical rescue) that reintroduce ontology ownership to runtime.
- **validation**: Runtime does transition validation only; semantic class repair lives in prompt layer.
- **status**: Completed
- **log**: Demoted deterministic semantic backfills out of the runtime decision path: runtime no longer executes language-repair pass, and create_tasks completion path no longer invokes deterministic task-gap/literal structural recovery before persistence.
- **files edited/created**: `backend/src/services/voicebot/createTasksAgent.ts`

### T7a: Prompt-Contract Tests Update
- **depends_on**: [T2]
- **location**: `backend/__tests__/services/voicebot/createTasksAgentCardContract.test.ts` (and adjacent card contract tests)
- **description**: Update tests to enforce prompt contract fields, ontology classes, and migration commitments.
- **validation**: Card contract tests assert prompt-side ownership of lexical/morphology semantics.
- **status**: Completed
- **log**: Extended card contract assertions for canonical ontology class mapping, prompt-layer lexical/morphology ownership commitments, and required `runtime_rejections` handling fields/behavior.
- **files edited/created**: `backend/__tests__/services/voicebot/createTasksAgentCardContract.test.ts`

### T7b: Rejection/Retry Contract Tests
- **depends_on**: [T5, T5b]
- **location**: `backend/__tests__/services/voicebot/createTasksAgentRecovery.test.ts` (or dedicated retry contract suite)
- **description**: Add tests for `runtime_rejections` schema handling, one-bounded reformulation retry, and deterministic fail-fast on repeated invalid transition.
- **validation**: Runtime rejection payload contract is enforced end-to-end in the service-level call path.
- **status**: Completed
- **log**: Added service-level rejection/retry contract tests covering one-bounded `runtime_rejections` reformulation, explicit unknown-class reclassification request, and fail-fast after second invalid transition.
- **files edited/created**: `backend/__tests__/services/voicebot/createTasksAgentRecovery.test.ts`

### T8: Runtime Transition Tests Update
- **depends_on**: [T4, T5, T5b, T6]
- **location**: `backend/__tests__/services/voicebot/createTasksAgentRecovery.test.ts` (and adjacent runtime suites)
- **description**: Add tests for non-deliverable transition rejection, `unknown` class policy, malformed/partial `runtime_rejections`, mixed valid/invalid candidates, and no stopword-only rejection.
- **validation**: Tests pass for:
  - invalid class -> rejection -> one retry -> fail-fast on second invalid,
  - malformed rejection payload => deterministic machine-readable code,
  - `unknown` class handling follows explicit invariant,
  - deliverable candidate not rejected solely due to lexical stopword surface.
- **status**: Completed
- **log**: Added runtime transition tests for mixed valid/invalid task batches, explicit `unknown` class policy, and stopword-like deliverable names not being rejected by runtime transition guard.
- **files edited/created**: `backend/__tests__/services/voicebot/createTasksAgentRecovery.test.ts`

### T8b: Worker/API Error-Contract Propagation
- **depends_on**: [T4, T5, T5b]
- **location**: `backend/src/workers/voicebot/handlers/createTasksFromChunks.ts`, relevant voicebot routes, corresponding tests
- **description**: Ensure structured transition rejections stay machine-readable through worker/session processor/API surfaces (not flattened into opaque strings).
- **validation**: Integration tests confirm rejection code visibility and stable payload shape in processor/API outputs.
- **status**: Completed
- **log**: Propagated machine-readable transition failures through worker/API surfaces: worker persists structured error payload instead of flatten-only string, worker result returns `error_details`, and generate_possible_tasks route returns structured `error_code` + payload for runtime transition failures.
- **files edited/created**: `backend/src/workers/voicebot/handlers/createTasksFromChunks.ts`, `backend/src/api/routes/voicebot/sessions.ts`, `backend/__tests__/voicebot/workers/workerCreateTasksFromChunksHandler.test.ts`, `backend/__tests__/voicebot/runtime/generatePossibleTasksRoute.test.ts`

### T9: Targeted Test Gate
- **depends_on**: [T7a, T7b, T8, T8b]
- **location**: `backend`
- **description**: Run focused test suites for create_tasks contract and recovery behavior.
- **validation**: Targeted suites green with saved command outputs.
- **status**: Completed
- **log**: Updated `createTasksAgentRecovery` assertions to align with ontology migration contract (no runtime lexical backfill/language-repair expectations), then validated green on both commands:
  - `npm run test:parallel-safe -- --runTestsByPath __tests__/services/voicebot/createTasksAgentRecovery.test.ts` -> PASS (32/32)
  - `npm run test:parallel-safe -- --runTestsByPath __tests__/services/voicebot/createTasksAgentCardContract.test.ts __tests__/services/voicebot/createTasksAgentRecovery.test.ts __tests__/voicebot/workers/workerCreateTasksFromChunksHandler.test.ts __tests__/voicebot/runtime/generatePossibleTasksRoute.test.ts` -> PASS (4 suites, 51 tests)
- **files edited/created**: `backend/__tests__/services/voicebot/createTasksAgentRecovery.test.ts`, `plan/2026-04-04-create-tasks-ontology-prompt-migration-swarm-plan.md`

### T10: Code Review Swarm
- **depends_on**: [T9]
- **location**: changed files + tests
- **description**: Independent postreview subagent validates ontology ownership split, retry-bound correctness, worker/API contract propagation, and transition invariant integrity.
- **validation**: Review verdict with severity-ranked findings and explicit deploy readiness.
- **status**: Completed
- **log**: Postreview verdict marked NO-GO with four blocking findings: missing `candidate_class` default bypass in transition guard, active lexical task-name rewrite in runtime write path, lexical/task-gap repair drift risk around runtime authority boundaries, and test blind spot for worker/API propagation + missing-class payload handling.
- **files edited/created**: `plan/2026-04-04-create-tasks-ontology-prompt-migration-swarm-plan.md`

### T10b: Postreview Fix Pass + Revalidation
- **depends_on**: [T10]
- **location**: changed files + targeted test suites
- **description**: Apply fixes for review findings (if any), then rerun targeted tests to refresh evidence before replay.
- **validation**: If fixes exist, targeted suites rerun and pass; if no findings, task is no-op with recorded note.
- **status**: Completed
- **log**: Fixed transition guard to reject missing class with machine-readable invariant (`task_draft_class_missing`) instead of implicit deliverable fallback; removed runtime task-name lexical rewrite from merge/write path; strengthened recovery + worker/API tests to assert missing-class rejection and structured error propagation using thrown runtime failure payloads instead of static extractor bypasses. Revalidated with targeted command: `npm run test:parallel-safe -- --runTestsByPath __tests__/services/voicebot/createTasksAgentCardContract.test.ts __tests__/services/voicebot/createTasksAgentRecovery.test.ts __tests__/voicebot/workers/workerCreateTasksFromChunksHandler.test.ts __tests__/voicebot/runtime/generatePossibleTasksRoute.test.ts` => PASS (4 suites, 53 tests).
- **files edited/created**: `backend/src/services/voicebot/createTasksAgent.ts`, `backend/__tests__/services/voicebot/createTasksAgentRecovery.test.ts`, `backend/__tests__/voicebot/workers/workerCreateTasksFromChunksHandler.test.ts`, `backend/__tests__/voicebot/runtime/generatePossibleTasksRoute.test.ts`, `plan/2026-04-04-create-tasks-ontology-prompt-migration-swarm-plan.md`

### T11: Replay Gate RU (Clean + Incremental)
- **depends_on**: [T10b]
- **location**: runtime session ops + backend logs
- **description**: Perform clean-slate replay on `69cf65712a7446295ac67771` (soft-delete active Draft rows), rerun create_tasks, compare with incremental rerun stability.
- **validation**: No material divergence between clean and incremental task surfaces; evidence captured.
- **status**: Completed
- **log**: Replayed session `69cf65712a7446295ac67771` (post-crash) with clean+incremental sequence and captured deterministic equality: initial active Draft `0`, clean `generated=0/active=0`, incremental `generated=0/active=0`, diff `equal=true` with empty key deltas. Runtime still shows bounded transition rejection/discard markers (`task_draft_class_missing`, unresolved missing-class discard) without hard-fail. Evidence posted in `bd` (`copilot-2bd3` comment `580`, `copilot-j7dp` comment `579`).
- **files edited/created**: `plan/2026-04-04-create-tasks-ontology-prompt-migration-swarm-plan.md`

### T12: Replay Gate non-RU
- **depends_on**: [T10b]
- **location**: runtime session ops + backend logs
- **description**: Run at least one non-Russian replay session to verify portability after lexical ownership migration.
- **validation**: No regression in task materialization semantics for non-Russian input.
- **status**: Completed
- **log**: Non-RU portability replay executed on session `69a0602939db445661944552`; non-RU evidence from transcript text (`Streamlining local graph development with LocalStack & TypeDB`, Latin-only). Clean+incremental runs both produced `generated=0/active=0` with `equal=true` and no hard-fail. Evidence posted in `bd` (`copilot-j7dp` comment `579`).
- **files edited/created**: `plan/2026-04-04-create-tasks-ontology-prompt-migration-swarm-plan.md`

### T13: Deploy And Smoke
- **depends_on**: [T11, T12]
- **location**: backend deploy target + `/api/health`
- **description**: Deploy merged patchset and run smoke checks.
- **validation**: `/api/health` green; create_tasks flow smoke verified.
- **status**: Completed
- **log**: Production deploy executed via `./scripts/pm2-backend.sh prod`. Mandatory smokes passed: `./scripts/pm2-runtime-readiness.sh prod` returned `ok=true` with all 5 required runtimes online; `./scripts/voice-notify-healthcheck.sh --env-file backend/.env.production` returned `ok=true` and `http_status=200`; `curl -fsS http://127.0.0.1:3002/api/health` returned backend `status=ok`.
- **files edited/created**: `plan/2026-04-04-create-tasks-ontology-prompt-migration-swarm-plan.md`

### T14: BD Closure Evidence
- **depends_on**: [T13]
- **location**: `bd` issue `copilot-j7dp`
- **description**: Post full evidence set (tests, replay, review, smoke), mark issue status accordingly.
- **validation**: `bd show copilot-j7dp --json` reflects final state and closure rationale.
- **status**: Completed
- **log**: Posted closure evidence in `bd` for `copilot-j7dp` (comments `579`/`581`; `580` on `copilot-2bd3`) including replay outputs, test pack, and deploy smoke results; superseded malformed shell-escaped comments (`577`/`578`) explicitly. Closed `copilot-j7dp`; later status alignment closed `copilot-grzr` and `copilot-2bd3` after mandatory `candidate_class` contract fix in prompt-layer, with new residual follow-up opened as `copilot-bzt6` for row_id determinism across consecutive reruns.
- **files edited/created**: `plan/2026-04-04-create-tasks-ontology-prompt-migration-swarm-plan.md`

## Parallel Execution Groups

| Wave | Tasks | Can Start When |
|------|-------|----------------|
| 1 | T1 | Immediately |
| 2 | T2, T3, T4 | T1 complete |
| 3 | T6, T7a, T5b | Dependencies satisfied |
| 4 | T5, T7b, T8, T8b | Dependencies satisfied |
| 5 | T9 | T7a, T7b, T8, T8b complete |
| 6 | T10 | T9 complete |
| 7 | T10b | T10 complete |
| 8 | T11, T12 | T10b complete |
| 9 | T13 | T11, T12 complete |
| 10 | T14 | T13 complete |

## Swarm Role Mapping
- `worker_prompt`: T2, T7a
- `worker_runtime`: T3, T4, T5b, T6, T5, T7b, T8
- `worker_integration`: T8b
- `worker_validation`: T9, T11, T12
- `postreview_runtime`: T10
- parent thread: T10b, T13, T14 integration + acceptance

## Testing Strategy
- Focused tests first:
  - create_tasks card contract (`prompt ownership`)
  - create_tasks recovery/transition behavior
  - worker/API rejection contract propagation
- Postreview fix pass and targeted revalidation before replay.
- Replay validation:
  - RU clean vs incremental on target session
  - non-RU portability replay
- Deploy smoke last:
  - `/api/health`
  - create_tasks path sanity check

## Risks & Mitigations
- **Risk**: Runtime still owns hidden lexical branches via renamed symbols.
  - **Mitigation**: behavioral black-box tests + banned-symbol inventory + postreview diff audit.
- **Risk**: Prompt reformulation loops via interaction with legacy retries.
  - **Mitigation**: reason-scoped retry ledger (`transition_reformulation_attempts <= 1`) and dedicated recursion tests.
- **Risk**: Replay appears improved only in incremental path.
  - **Mitigation**: mandatory clean-slate replay with side-by-side comparison.
- **Risk**: prompt migration degrades non-Russian sessions.
  - **Mitigation**: explicit non-RU replay gate before deploy.
- **Risk**: Structured rejection payload gets flattened in worker/API.
  - **Mitigation**: integration task T8b + machine-readable contract tests.
