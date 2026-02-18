# VoiceBot Workers

TypeScript VoiceBot workers live under `backend/src/workers/voicebot`.

## Runtime Entrypoint
- `src/workers/voicebot/runtime.ts` - process bootstrap + signal-safe shutdown.
- `src/workers/voicebot/runner.ts` - BullMQ worker factory for all VoiceBot queues.
- `src/workers/voicebot/manifest.ts` - typed `job_name -> handler` map.

## Start Commands
- Dev: `npm run dev:voicebot-workers`
- Prod: `npm run start:voicebot-workers`

## Queue Coverage
Workers are started for all runtime-scoped queue names from `VOICEBOT_QUEUES`:
- `COMMON`
- `VOICE`
- `PROCESSORS`
- `POSTPROCESSORS`
- `EVENTS`
- `NOTIFIES`

Job dispatch uses `VOICEBOT_WORKER_MANIFEST`. Unknown job names fail explicitly (`voicebot_worker_handler_not_found:*`) and are logged with queue/job context.

## Implemented TS Handlers
- `handlers/doneMultiprompt.ts`
- `handlers/processingLoop.ts`
- `handlers/handleVoice.ts`
- `handlers/handleText.ts`
- `handlers/handleAttachment.ts`
- `handlers/transcribe.ts`
- `handlers/categorize.ts`
- `handlers/finalization.ts`

## Remaining Gaps
- `EVENTS` and `NOTIFIES` queue job handlers are not fully ported yet (jobs without manifest handler fail explicitly and stay visible for retry/diagnostics).
- Telegram voice-file download path remains pending in transcribe pipeline (current TS transcribe path expects local `file_path`).
