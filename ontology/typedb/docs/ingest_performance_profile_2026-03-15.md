# TypeDB Ingest Performance Profile: 2026-03-15

## Scope

- rollout cleanup phase for `copilot-8wn1`
- command:
  - `npm run ontology:typedb:ingest:apply -- --run-id <run_id> --deadletter <path> --collections automation_tasks,automation_voice_bot_sessions`
- captured from transient run-scoped cleanup logs before `ontology:typedb:rollout:clear-logs`
- persistent source of truth after log cleanup:
  - this document

## Pre-patch Baseline

| Run ID | Collection | Progress Sample | Phase Time | Throughput |
| --- | --- | --- | --- | --- |
| `20260315T072211Z` | `automation_tasks` | `4226/4226` done | `6017506 ms` | `0.7023 docs/s` |
| `20260315T092749Z` | `automation_tasks` | `4226/4226` done | `408997 ms` | `10.3326 docs/s` |
| `20260315T072211Z` | `automation_voice_bot_sessions` | `161 scanned` before manual stop / phase switch point | `824871 ms` since task phase end | `0.1952 docs/s` |
| `20260315T092749Z` | `automation_voice_bot_sessions` | `212 scanned` before manual stop | `1153071 ms` since task phase end | `0.1839 docs/s` |

## Observations

- `automation_tasks` already benefited from the new generic mapping fast-path and cache work.
- `automation_voice_bot_sessions` did not improve in the same run family; the second measured cleanup run was slightly slower.
- The active cleanup command ran with `sync_mode=full`, so the `voice_session` fast-path gated behind incremental mode was not participating in these numbers.

## Patch Goal

- preserve the pre-patch measurements above for regression tracking;
- move the `voice_session` and `voice_message` unchanged-document fast-path so it also applies to full `--apply` runs;
- reduce repeated processor-definition upserts in session/message projection code;
- rerun cleanup after log reset and append post-patch numbers below.

## Intermediate Post-patch Check

Run `20260315T095602Z` measured the first patch set before the cleanup scope was narrowed:

| Run ID | Collection | Progress Sample | Phase Time | Throughput |
| --- | --- | --- | --- | --- |
| `20260315T095602Z` | `automation_tasks` | `4226/4226` done | `2380 ms` | `1775.6303 docs/s` |
| `20260315T095602Z` | `automation_voice_bot_sessions` | `84 scanned` before manual stop | `185096 ms` since task phase end | `0.4538 docs/s` |

Interpretation:

- base-entity unchanged fast-path solved the `automation_tasks` bottleneck completely for cleanup apply;
- `automation_voice_bot_sessions` improved versus the pre-patch cleanup run, but remained far slower than acceptable because derived session projections were still being rebuilt during the cleanup phase.

Second patch set after this measurement:

- cleanup apply now passes `--skip-session-derived-projections` from `typedb-rollout-chain.sh`;
- cleanup scope keeps core `voice_session` writes and `project_has_voice_session` relation materialization, but skips derived session projections that are not covered by the aggregate validation checks for `copilot-8wn1`.

## Post-patch Follow-up

Final cleanup run `20260315T100242Z` after enabling `--skip-session-derived-projections` in the cleanup phase:

| Run ID | Collection | Progress Sample | Phase Time | Throughput |
| --- | --- | --- | --- | --- |
| `20260315T100242Z` | `automation_tasks` | `4226/4226` done | `2578 ms` | `1639.2552 docs/s` |
| `20260315T100242Z` | `automation_voice_bot_sessions` | `1997/1997` done | `13179 ms` | `151.5289 docs/s` |

Validation immediately after cleanup stayed consistent with the cleanup objective:

- `orphan_tasks_without_project=0`
- `orphan_messages_without_session=0`
- `session_done_contract_missing_done_at=0`
- remaining warning stayed `sessions_summary_saved_at_without_text=1`

Net effect versus the original pre-patch cleanup run:

- `automation_tasks`: `10.3326 docs/s` -> `1639.2552 docs/s`
- `automation_voice_bot_sessions`: `0.1839 docs/s` -> `151.5289 docs/s`

Historical backfill for run `20260315T100242Z` continued after the cleanup+validate pair and is intentionally measured separately from the focused cleanup profile above.

## Staged Incremental Sync Tuning

After the cleanup-specific wave, the operator surface was reworked into staged incremental sync:

- phase 1: `projection_scope=core`
- phase 2: `projection_scope=derived`

Key optimization milestones:

- unchanged core relation short-circuits for:
  - `project_has_oper_task`
  - `project_has_voice_session`
  - `voice_session_has_message`
- batch attribute reconcile for entity updates
- commit retry/backoff for retryable TypeDB isolation conflicts
- `voice_message` attr split into core vs derived sets
- explicit `delete_voice_message_derived_family()` before derived rebuild
- append-only derived reinsertion for message support objects/relations
- Mongo-side field projection so `projection_scope=core` does not fetch heavy transcription/categorization/processors payloads

### Shared DB Staged Incremental Snapshots

These runs were measured against the shared `str_opsportal_v1` database, so they are still exposed to external `STC2` contention from other writers. They are useful for trend comparison, not as final clean SLA numbers.

| Run ID | Observation | Value |
| --- | --- | --- |
| `20260315T114922Z` | `automation_tasks` core complete | `4225 rows / 68148 ms` |
| `20260315T122444Z` | `automation_tasks` core complete before `STC2` | `4225 rows / 61695 ms` |
| `20260315T123050Z` | `automation_projects` core complete | `104 rows / 6471 ms` |
| `20260315T123050Z` | `automation_tasks` core complete | `4225 rows / 65292 ms` |
| `20260315T131653Z` | `automation_voice_bot_messages` scanned milestone | `250 rows at elapsed_ms=132637` |
| `20260315T161830Z` | `automation_voice_bot_messages` scanned milestone after core/derived attr split | `250 rows at elapsed_ms=121071` |
| `20260315T163438Z` | `automation_voice_bot_messages` scanned milestone after attr split + derived-family delete/rebuild path | `5500 rows at elapsed_ms=933590` |
| `20260315T165229Z` | `automation_tasks` core complete before repeated `STC2` retries exhausted | `4225 rows / 68417 ms` |

Interpretation:

- `automation_projects` and `automation_tasks` improved materially and are no longer the dominant daily tail.
- The remaining daily bottleneck is now concentrated in `automation_voice_bot_messages`.
- Shared-environment `STC2` conflicts still prevent one clean end-to-end staged incremental wall-clock on `str_opsportal_v1`.

## Isolated Full-From-Scratch Benchmark

### Attempt 1: `str_opsportal_profile_bench_20260315`

This was the first clean isolated full benchmark on a dedicated TypeDB database.

| Observation | Value |
| --- | --- |
| overall wall time until failure | `766.13 s` |
| `automation_tasks` full load complete | `4226 rows / 209649 ms` |
| `automation_work_hours` full load complete | `4632 rows / 324986 ms` |
| `automation_voice_bot_sessions` progress before failure | `1750 rows at elapsed_ms=731730` |
| failure class | duplicate `task_draft_id` (`task-context-001`) |

Fix applied after attempt 1:

- `task_draft_id` became session-scoped (`{session_id}:task-draft:{row_id}`) instead of using raw `task-context-*` ids as global keys.

### Attempt 2: smoke validation after `task_draft_id` fix

- scratch DB: `str_opsportal_profile_smoke_taskdraft_fix2`
- result:
  - the previous `task_draft_id` collision no longer reproduced
  - a new blocker appeared later in `voice_message` support objects: duplicate `file_descriptor_id` from reused file ids

Fix applied after attempt 2:

- `file_descriptor_id` became message-scoped (`{message_id}:file:{raw_file_id}`)
- `message_attachment_id` became message-scoped (`{message_id}:attachment:{raw_attachment_id}`)
- Mongo projection collision was also fixed by removing conflicting `transcription.*` subfield projection when the full `transcription` object is already requested

### Attempt 3: smoke validation after file-support key fix

- scratch DB: `str_opsportal_profile_smoke_taskdraft_fix3`
- result:
  - smoke path passes with `--limit 1`
  - schema recreation, append-only full ingest, and post-load validate all complete successfully on the isolated DB

Current benchmark status:

- isolated full-from-scratch benchmarking is now operationally unblocked at smoke level
- one full no-limit rerun is still needed to replace the failed-at-`766.13s` figure with a clean final wall-clock
