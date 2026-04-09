# Voice Session Forensics Playbook

Date: 2026-03-23  
Scope: `docs/*`, `backend/scripts/*`, `scripts/*` only.

## Reference Incident Example (session `69c13e953126bf876842c7ac`)

This playbook was calibrated against the checked-in reference case from `.beads/issues.jsonl` (`copilot-qfdu`):

- worker `CREATE_TASKS` completed successfully multiple times (`tasks_count=3`);
- the session still kept `session_name=''` and `review_md_text=''`;
- `processors_data.CREATE_TASKS` remained stuck at `is_processing=true` / `is_processed=false`.

This is the baseline forensic case for reproducing the failure class.

## Canonical Playbook

1. Capture a session snapshot:
- fields `status/state/is_active/session_name`;
- `processors_data.CREATE_TASKS` (`is_processing`, `is_processed`, payload/review/summary) only as an auxiliary signal.

2. Capture the timeline from `message` + `session_log`:
- latest messages by `created_at`,
- latest `session_log` events by `event_time`,
- verify whether the `create_tasks` event trail exists.
- for `automation_voice_bot_messages`, match session linkage by both string `session_id` and `ObjectId`, otherwise `messages_total=0` can be a false negative.

3. Capture task linkage:
- related `automation_tasks` by `source_ref/external_ref/source_data.session_id/source_data.voice_sessions.session_id`,
- split by `task_status` (`Draft`, `READY_10`, etc.).
- canonical task state is always `automation_tasks`, not legacy `processors_data.CREATE_TASKS`.

4. Capture queue/runtime snapshot:
- queue counts for `voicebot--*`,
- session-matched jobs in `wait/active/delayed/prioritized/failed`,
- PM2 log hits only for voice services.
- work correlation-first: if `request_id` or `correlation_id` exists, build the timeline around that identifier before scanning all logs.
- if Redis/BullMQ is unavailable locally, queue capture must degrade to `queue_snapshot_unavailable` instead of failing the entire forensic run.

5. Record path parity:
- manual route `POST /api/voicebot/generate_possible_tasks`;
- background worker `CREATE_TASKS`;
- explicitly verify which side effects must be identical:
  - `session_name`,
  - `summary_md_text`,
  - `review_md_text`,
  - `project_id`,
  - `processors_data.CREATE_TASKS.is_processing/is_processed`,
  - realtime refresh hints.

6. Produce an anomaly verdict:
- `session_name_empty`,
- `create_tasks_processing_stuck_candidate`,
- `create_tasks_session_patch_missing`,
- `session_queue_jobs_present`,
- `dangling_related_records_without_session_doc`,
- and link the verdict to the `bd` / incident trail.

7. Keep these layers distinct:
- session-level surfaces (`session_name`, `summary_md_text`, `review_md_text`, `summary_saved_at`, `title_generated_at`);
- legacy processor mirror (`processors_data.CREATE_TASKS.*`);
- canonical task state (`automation_tasks`).

If worker/PM2 shows `has_summary_md_text=true` / `has_scholastic_review_md=true`, but session-level surfaces are empty, the failure class is `create_tasks_session_patch_missing`, not “the model generated nothing”.

## First-Response Fast Path (5 Minutes)

Goal: produce one reproducible bundle that is immediately usable for the `bd` incident trail and handoff.

1. Capture a forensic bundle:

```bash
cd /home/strato-space/copilot/backend
RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)"
BUNDLE_DIR="../tmp/voice-investigation-artifacts/${RUN_ID}-<session_id>"
npm run voice:session:forensics -- --session <session_id> --bundle-dir "$BUNDLE_DIR"
```

If you run the CLI from the repo root or any shell that is not already sourced with backend env vars, append `--env-file backend/.env.production` (or the relevant backend env file for your target). This keeps Mongo/Redis routing aligned with the active deployment so queue snapshots do not degrade to `queue_snapshot_unavailable`.

2. Inspect the result without opening every file manually:

```bash
jq -r '.session_summaries[] | "\(.session_id)\texists=\(.exists)\tanomalies=\(.anomalies|join(","))"' "$BUNDLE_DIR/index.json"
```

3. Check key counters and queue degradation state:

```bash
jq '{session_id: .session.session_id, counters: .session.counters, queue_snapshot_error: .session.diagnostics.queue_snapshot_error, anomalies: .session.anomalies}' "$BUNDLE_DIR/<session_id>.json"
```

4. Add a short `bd` comment with the anomaly verdict and the bundle path.

## Tooling

The batch CLI:

- file: `/home/strato-space/copilot/backend/scripts/voicebot-session-forensics.ts`
- purpose: collect per-session forensic summary, Mongo timeline, and PM2 log hits for one or multiple `session_id` values.
- it also captures queue snapshots and session-matched BullMQ jobs.

Examples:

```bash
cd /home/strato-space/copilot/backend
npx tsx scripts/voicebot-session-forensics.ts --session 69c13e953126bf876842c7ac --json
```

With an explicit backend env file:

```bash
cd /home/strato-space/copilot
npx tsx backend/scripts/voicebot-session-forensics.ts \
  --env-file backend/.env.production \
  --session 69c13e953126bf876842c7ac \
  --json
```

Via npm script:

```bash
cd /home/strato-space/copilot/backend
npm run voice:session:forensics -- --session 69c13e953126bf876842c7ac --json
```

```bash
cd /home/strato-space/copilot/backend
npx tsx scripts/voicebot-session-forensics.ts \
  --session 69c13e953126bf876842c7ac \
  --session 69bb9e3de492c93c4a8c5fd6 \
  --jsonl
```

```bash
cd /home/strato-space/copilot/backend
npx tsx scripts/voicebot-session-forensics.ts \
  --session 69c13e953126bf876842c7ac \
  --markdown-file ../tmp/voice-investigation-artifacts/forensics-69c13e.md
```

Ready-made bundle mode:

```bash
cd /home/strato-space/copilot/backend
npm run voice:session:forensics -- \
  --session-url https://copilot.stratospace.fun/voice/session/69c13e953126bf876842c7ac \
  --bundle-dir ../tmp/voice-investigation-artifacts/69c13e953126bf876842c7ac
```

The bundle should contain:
- `index.json`
- `index.md`
- `<session_id>.json`
- `<session_id>.md`

`index.json` is the machine-readable multi-session index (counters/diagnostics/anomalies).  
`index.md` is the human-readable one-page triage/handoff summary.

## Anomaly Quick Map

- `session_not_found`: the session document is missing from `automation_voice_bot_sessions`; inspect dangling linkage and lifecycle cleanup.
- `dangling_related_records_without_session_doc`: messages/logs/tasks exist while the session document does not; this is already an incident-grade mismatch.
- `create_tasks_processing_stuck_candidate`: the legacy mirror `processors_data.CREATE_TASKS` is stuck in processing; compare it against canonical `automation_tasks`.
- `create_tasks_session_patch_missing`: worker logs show successful `create_tasks`, but session-level surfaces (`session_name` / `review_md_text`) were not updated.
- `session_queue_jobs_present`: live or retained queue jobs still match the session; inspect retries/requeue and stuck pipeline behavior.
- `queue_snapshot_unavailable`: queue triage could not be collected (for example Redis is unavailable); the forensic run is still valid, but queue state must be checked separately.
- `pm2_log_hits_missing`: voice-relevant PM2 logs contain no `session_id` matches; correlation by `request_id` / `correlation_id` may still be required.

## Bounded Improvement Proposal

1. Adopt the script above as the standard first-response forensic tool for voice incidents.
2. Make artifact output mandatory in the incident workflow.
   The practical default is now `--bundle-dir`, not hand-built separate files.
3. For every incident, preserve one bundle with:
- JSON summary,
- Markdown report,
- queue snapshot,
- PM2 log hits,
- `bd` comment with a concise verdict.
4. Use PM2 log hits and queue snapshots as the fast first pass for these questions:
   - did the `CREATE_TASKS` run happen at all,
   - did it finish successfully,
   - are there live jobs / retries / requeue / socket disconnect signs,
   - is there a mismatch between worker success and session Mongo state.
5. After the evidence is stable, move to a separate runtime-fix change set that restores parity between background and manual `CREATE_TASKS`.
6. Do not mix these layers in the incident summary:
- canonical task state (`automation_tasks`);
- legacy historical mirrors (`processors_data.CREATE_TASKS`);
- session-level surfaces (`session_name`, `summary_md_text`, `review_md_text`).
  First state exactly what is missing and at which layer.
7. If the incident affects automatic `CREATE_TASKS`, also verify:
- whether the run was `full session` or `incremental_refresh`,
- whether destructive stale cleanup happened on a narrowed result set,
- whether the same side effects were applied in the manual route and the worker path.

## Current Limits

- PM2 log hits are limited to grep by `session_id`; this is a fast triage surface, not a full parser for every structured log payload.
- By default the forensic CLI scans only voice-relevant PM2 logs (`backend`, `agent-services`, `voicebot-*`), not every `copilot-*.log`.
- Queue capture is limited to live/checkable BullMQ surfaces and does not replace code-path tracing.
- The `create_tasks` verdict remains heuristic (`stuck_candidate`) and does not replace code-path tracing.
- Linkage quality still depends on how well historical tasks populated `source_ref/source_data`.
