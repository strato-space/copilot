# Copilot VoiceBot Test Matrix

Date: 2026-03-06

This file is a Voice-focused shortcut over the canonical repository test workflow in [TESTING_PROCEDURE.md](/home/strato-space/copilot/docs/TESTING_PROCEDURE.md).

## Backend

Canonical commands:

```bash
cd /home/strato-space/copilot/backend
npm run test:parallel-safe
npm run test:serialized
npm run build
```

Or run the whole backend gate:

```bash
cd /home/strato-space/copilot/backend
npm test
```

Voice-heavy focused suites usually live under:
- `__tests__/voicebot/runtime`
- `__tests__/voicebot/access`
- `__tests__/voicebot/socket`
- `__tests__/voicebot/notify`
- `__tests__/voicebot/workers`
- `__tests__/voicebot/tg`
- `__tests__/voicebot/session`

## Frontend

Canonical commands:

```bash
cd /home/strato-space/copilot/app
npm test
npm run build
```

Focused voice/UI contract suites usually live under:
- `app/__tests__/voice`
- `app/__tests__/operops`

## Playwright

Install once:

```bash
cd /home/strato-space/copilot/app
npm run e2e:install
```

Run the full app e2e gate:

```bash
cd /home/strato-space/copilot/app
npm run test:e2e
```

Useful Voice-focused shards:

```bash
cd /home/strato-space/copilot/app
npm run test:e2e:voice:shard:1of2
npm run test:e2e:voice:shard:2of2
```

Useful non-voice shards:

```bash
cd /home/strato-space/copilot/app
npm run test:e2e:shard:1of2
npm run test:e2e:shard:2of2
```

## Current Voice taskflow coverage

The current Possible Tasks / `create_tasks` path is covered by:
- backend runtime route/behavior suites around:
  - `/api/voicebot/possible_tasks`
  - `/api/voicebot/save_possible_tasks`
  - `/api/voicebot/process_possible_tasks`
  - `/api/voicebot/delete_task_from_session`
- backend worker suites around:
  - `workerCreateTasksFromChunksHandler.test.ts`
  - `workerCreateTasksPostprocessingRealtime.test.ts`
  - `workerPostprocessingCreateTasksAudioMergingHandlers.test.ts`
  - `workerTranscribeHandler.test.ts`
  - `voicebotSocketCreateTasksFromChunks.test.ts`
- frontend contract suites around:
  - `MeetingCard` Tasks button
  - canonical `save_possible_tasks` response handling
  - MCP reconnect / request-failure handling

## Notes

- `make tests` is not a repository contract in this repo; use module-level commands (`backend npm run test:parallel-safe`, `backend npm run test:serialized`, `app npm test`, `app npm run build`) instead.
- Do not use old one-off path examples that assume `npm test -- --runInBand` as the canonical backend command. Backend execution is intentionally split into `parallel-safe` and `serialized` groups.
- For repository-wide orchestration, prefer [scripts/run-test-suite.sh](/home/strato-space/copilot/scripts/run-test-suite.sh) and [platforms.json](/home/strato-space/copilot/platforms.json).
- Current runner caveat: the shell runner does not yet honor `resource_lock`, so `app-voice-e2e-shard-1of2` and `app-voice-e2e-shard-2of2` can interfere when launched in parallel inside `full`. If `full` fails only with `/voice` `ERR_EMPTY_RESPONSE`, rerun these two shard commands sequentially; they currently pass in isolation.
