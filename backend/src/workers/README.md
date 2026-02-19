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
Standalone workers are started for runtime-scoped queues:
- `COMMON`
- `VOICE`
- `PROCESSORS`
- `POSTPROCESSORS`
- `NOTIFIES`

`EVENTS` queue is intentionally excluded from standalone worker runtime and is consumed by backend API process via `startVoicebotSocketEventsWorker` (has live Socket.IO context).

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
- `handlers/customPrompt.ts`
- `handlers/allCustomPrompts.ts`
- `handlers/oneCustomPrompt.ts`
- `handlers/audioMerging.ts`
- `handlers/createTasksPostprocessing.ts`
- `handlers/finalization.ts`
- `handlers/startMultiprompt.ts`
- `handlers/createTasksFromChunks.ts`
- `handlers/sendToSocket.ts`
- `handlers/notify.ts`

## Remaining Gaps
- `sendToSocket` handler remains a controlled skip in standalone workers (`socket_runtime_not_available`) by design; socket delivery is handled by backend runtime (`backend/src/services/voicebotSocketEventsWorker.ts`) consuming `VOICEBOT_JOBS.events.SEND_TO_SOCKET` from `voicebot--events-*`.
- Notify handler currently supports HTTP webhook envelope delivery; local hook runner/event-log parity from legacy runtime is not fully ported yet.
- `audioMerging` handler in TS runtime is intentionally a controlled skip unless Telegram merge transport/tooling is wired in worker process context.
- Telegram voice-file download path remains pending in transcribe pipeline (current TS transcribe path expects local `file_path`).
