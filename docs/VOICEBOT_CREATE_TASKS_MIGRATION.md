# Voice CREATE_TASKS Legacy Schema Migration

This runbook migrates historical `automation_voice_bot_sessions.processors_data.CREATE_TASKS.data` rows
from legacy human-title keys to canonical schema fields.

## Canonical schema

- `id`
- `name`
- `description`
- `priority`
- `priority_reason`
- `performer_id`
- `project_id`
- `task_type_id`
- `dialogue_tag`
- `task_id_from_ai`
- `dependencies_from_ai`
- `dialogue_reference`

## Legacy keys removed from runtime

- `Task ID`
- `Task Title`
- `Description`
- `Priority`
- `Priority Reason`
- `Dependencies`
- `Dialogue Reference`

## Script

- Path: `backend/scripts/voicebot-migrate-create-tasks-schema.ts`
- Runtime: `tsx`

### 1. Verify (dry-run)

```bash
cd backend
./node_modules/.bin/tsx scripts/voicebot-migrate-create-tasks-schema.ts \
  --sample-limit 30 \
  --report-file ./logs/migrations/create-tasks-legacy-verify.json
```

Dry-run report includes:

- `scanned_sessions_total`
- `sessions_with_possible_tasks`
- `sessions_with_legacy_payloads`
- `tasks_with_legacy_payloads`
- `legacy_key_occurrences`
- `legacy_pattern_distribution`
- `runtime_distribution`
- `session_samples`

### 2. Apply migration

```bash
cd backend
./node_modules/.bin/tsx scripts/voicebot-migrate-create-tasks-schema.ts \
  --apply \
  --sample-limit 30 \
  --report-file ./logs/migrations/create-tasks-legacy-apply.json
```

Apply mode additionally:

- writes a JSONL backup file at `backend/logs/migrations/voicebot-create-tasks-legacy-backup-<timestamp>.jsonl`,
- sets canonicalized `processors_data.CREATE_TASKS.data`,
- updates `updated_at`.

### 3. Post-migration validation

```bash
cd backend
./node_modules/.bin/tsx scripts/voicebot-migrate-create-tasks-schema.ts \
  --sample-limit 30 \
  --report-file ./logs/migrations/create-tasks-legacy-post-verify.json
```

Expected post-check:

- `sessions_with_legacy_payloads = 0`
- `tasks_with_legacy_payloads = 0`

## Rollback

Rollback restores `processors_data.CREATE_TASKS.data` from apply backup JSONL:

```bash
cd backend
./node_modules/.bin/tsx scripts/voicebot-migrate-create-tasks-schema.ts \
  --rollback-file ./logs/migrations/voicebot-create-tasks-legacy-backup-<timestamp>.jsonl
```

Rollback updates session payload and `updated_at` for each backed up session.
