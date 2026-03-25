# Voice Bug-Fix Wave DAG

Date: 2026-03-25
Repo: `copilot`
Parent thread role: discovery, dependency control, integration, final verification, deploy/smoke
Default subagent model: `gpt-5.3-codex`

## Scope

This wave targets reproducible Voice regressions that already have `bd` tracking and can be closed only with regression coverage strong enough to catch the failure before prod.

Active wave tickets:

- `copilot-tnc7` `[voice][ui] Transcription and Categorization tabs lost inner vertical scroll after workspace shell refactor`
- `copilot-6403` `[voice][ops] prod deploy does not recreate missing copilot-voicebot-workers runtime`
- `copilot-adb9` `[voice][create_tasks][ontology] priority enum mismatch drops extracted tasks during persistence`
- `copilot-icxn` `[voice][session_tasks] persisted Draft rows with malformed priority values crash session_tasks read route`
- `copilot-wt1o` `[voice][create_tasks] reduced-context retry still fails with string_above_max_length on long sessions`
- `copilot-n9wm` `[voice][create_tasks] session 69c37a231f1bc03e330f9641 resolved to 0 tasks despite actionable transcript and review`

Out of active implementation scope for this wave:

- `copilot-lnr4` notify endpoint `502` on `call-actions.stratospace.fun`
  - treat as tracked external integration risk unless local sender-side evidence shows a repo fix is required

## DAG

```text
T1 copilot-6403  ───────────────┐
                                │
T2 copilot-tnc7  ───────────────┼─────────────┐
                                │             │
T3 copilot-adb9 ────────┐       │             │
                        ├─> T4 copilot-icxn ─┐ │
                        │                    │ │
                        └────────────────┐   │ │
                                         └─> T6 copilot-n9wm │

T5 copilot-wt1o ─────────────────────────────┘ │
                                              │
T1 + T2 + T3 + T4 + T5 + T6 ───────────────> T7 final integration + regression sweep + deploy smoke
```

## Task Nodes

### T1. `copilot-6403`

- Problem: prod deploy/runtime bootstrap does not restore `copilot-voicebot-workers-prod` when the process is missing from PM2.
- Write surface:
  - `scripts/pm2-backend.sh`
  - PM2 ecosystem/bootstrap code touched by that script only if necessary
  - targeted backend or shell tests for bootstrap behavior
- Dependencies: none
- Done condition:
  - a deploy/bootstrap path recreates missing VoiceBot worker runtime instead of silently skipping it
  - smoke output makes the recreated runtime visible
- Required tests:
  - script-level regression test for "process missing before deploy" path
  - prod-mode command-matrix coverage: missing worker => start, existing worker => restart, non-prod => no prod voicebot PM2 touch
  - regression coverage that existing `copilot-voicebot-tgbot-prod` behavior remains intact

### T2. `copilot-tnc7`

- Problem: `Транскрипция` and `Категоризация` panes lost inner vertical scroll after layout refactor.
- Write surface:
  - `app/src/pages/voice/*`
  - `app/src/components/voice/*`
  - `app/src/index.css` or local Voice styles only if required
  - frontend contract tests
- Dependencies: none
- Done condition:
  - both tabs have functional inner scroll in the session workspace
  - no reintroduction of page-level double scroll
- Required tests:
  - contract test that asserts pane overflow container semantics for `Transcription`
  - contract test that asserts pane overflow container semantics for `Categorization`
  - workspace-shell DOM test that catches shell-level regressions in scroll-container ownership
  - if test stack permits, browser/spec test that verifies scrollable content when content exceeds pane height

### T3. `copilot-adb9`

- Problem: `create_tasks` can extract tasks but fail during persistence because decorated legacy priority labels violate ontology enum expectations.
- Write surface:
  - backend VoiceBot create-tasks pipeline
  - ontology task normalization path
  - backend tests around priority normalization/persistence
- Dependencies: none
- Done condition:
  - extracted tasks with emoji-form priorities normalize into canonical values before ontology write
  - persistence no longer fails for known repro labels
- Required tests:
  - unit test for priority normalization from decorated legacy variants into canonical `P1..P7`
  - regression test for create-task persistence path using historical malformed priority examples
  - test that verifies no raw emoji priority leaks into ontology write layer

### T4. `copilot-icxn`

- Problem: `POST /api/voicebot/session_tasks` returns `500` when persisted Draft rows already contain malformed priority values; read path crashes instead of tolerating/normalizing legacy data.
- Write surface:
  - backend session-tasks read path
  - possible-task mongo document validation or read-time normalization path
  - backend route tests for `session_tasks`
- Dependencies:
  - `T3` is a hard prerequisite so read-hardening follows the same canonical priority policy as the write path
- Done condition:
  - `session_tasks` route does not 500 on legacy malformed priority rows
  - response is either normalized or safely degraded, but route stays readable
- Required tests:
  - route regression test using fixture equivalent to session `69c27fd63b94e66785ee67da`
  - test for mixed valid + malformed persisted rows
  - explicit assertion for canonical output or explicit degraded output contract; no ambiguous pass-through of malformed priorities

### T5. `copilot-wt1o`

- Problem: reduced-context retry for long sessions still fails with `string_above_max_length`; retry path does not actually isolate oversized payload strongly enough.
- Write surface:
  - backend create-tasks orchestration / retry reduction code
  - agent request assembly helpers
  - backend tests using oversize fixtures
- Dependencies: none
- Done condition:
  - retry path materially shrinks the payload and avoids the same oversize class for the repro family
  - logging clearly indicates retry shape
- Required tests:
  - regression test for oversize source transcript that previously triggered `string_above_max_length`
  - assertion that retry payload excludes the original oversize field(s)
  - assertion that exactly one reduced-context retry is attempted for this failure class
  - assertion that retry path is single-purpose and deterministic

### T6. `copilot-n9wm`

- Problem: session `69c37a231f1bc03e330f9641` produced transcription/categorization/summary/review but surfaced zero tasks.
- Write surface:
  - backend create-tasks extraction semantics
  - decision logic that suppresses materialization for strategic discussions
  - backend tests with fixture derived from this session
- Dependencies:
  - `T3` because persistence failures must be removed from the signal path
  - `T4` because the user-facing success condition depends on tasks surfacing through the session-task read path
  - `T5` because reduced-context behavior can affect extraction outcome
- Done condition:
  - repro session family either materializes the actionable task(s) or intentionally emits a machine-checkable "no materialized tasks" reason that matches product rules
  - "0 tasks" is no longer a silent ambiguity
- Required tests:
  - fixture-based regression test for the `69c37a...` family
  - assertion on expected extraction decision
  - end-to-end surfacing gate: either Draft rows are readable through `/api/voicebot/session_tasks` or stored metadata exposes an explicit machine-checkable no-task reason
  - assertion that the chosen path is explainable in stored metadata/log output

### T7. Final Integration Sweep

- Owner: parent thread
- Dependencies:
  - `T1`
  - `T2`
  - `T3`
  - `T4`
  - `T5`
  - `T6`
- Required checks:
  - targeted backend/frontend test suites for all merged slices
  - build checks
  - live browser acceptance for session tabs and task surfaces
  - deploy smoke that confirms workers/runtime still healthy after release

## Swarm Launch Policy

- Only independent write surfaces should run in parallel.
- Frontend layout work (`T2`) is parallel-safe with runtime bootstrap work (`T1`).
- Backend VoiceBot taskflow issues (`T3`, `T4`, `T5`, `T6`) share overlapping files and should not be implemented in parallel without explicit ownership partitioning.
- Backend lane is lazy-launch only: start the next backend worker only after the previous backend patch is merged and its narrow regression suite passes.
- Every implementation subagent packet must begin with:
  - `1. Run \`bd show <id> --json\` and read it before any repo reads/edits.`
  - `2. Use that ticket as the canonical scope; do not rely on the parent summary when it conflicts with the ticket payload.`
- Every closing patch must add or update regression tests that would have caught the bug pre-prod.

## Initial Swarm Shape

Parallel now:

- Worker A: `T1 / copilot-6403`
- Worker B: `T2 / copilot-tnc7`

Lazy-launch backend lane after those start and after each previous backend slice is merged + verified:

- Worker C: `T3 / copilot-adb9`
- Worker D: `T4 / copilot-icxn`
- Worker E: `T5 / copilot-wt1o`
- Worker F: `T6 / copilot-n9wm`

## Risks

- `copilot-lnr4` may remain blocked on external upstream health.
- `T6` may expose a product-rule ambiguity rather than a pure bug; if so, convert that ambiguity into an explicit contract and test it.
- Historical persisted malformed rows may require a migration/backfill decision in addition to read/write hardening.
