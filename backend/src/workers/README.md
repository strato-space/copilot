# VoiceBot Workers

TypeScript VoiceBot workers live under `backend/src/workers/voicebot`.

## Runtime Entrypoint
- `src/workers/voicebot/runtime.ts` - process bootstrap + signal-safe shutdown.
- `src/workers/voicebot/runner.ts` - BullMQ worker factory for all VoiceBot queues.
- `src/workers/voicebot/manifest.ts` - typed `job_name -> handler` map.

## Start Commands
- Dev: `npm run dev:voicebot-workers`
- Prod: `npm run start:voicebot-workers`
- PM2 cutover process: `copilot-voicebot-workers-prod` (see `scripts/pm2-voicebot-cutover.ecosystem.config.js`)

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
- `handlers/summarize.ts`
- `handlers/questions.ts`
- `handlers/finalization.ts`
- `handlers/startMultiprompt.ts`
- `handlers/createTasksFromChunks.ts`
- `handlers/sendToSocket.ts`
- `handlers/notify.ts`

## Remaining Gaps
- `sendToSocket` currently logs+skips (`socket_runtime_not_available`) because dedicated worker runtime has no Socket.IO transport context; event delivery is still performed directly by backend API process.
- Notify handler currently supports HTTP webhook envelope delivery; local hook runner/event-log parity from legacy runtime is not fully ported yet.
- Telegram voice-file download path remains pending in transcribe pipeline (current TS transcribe path expects local `file_path`).
