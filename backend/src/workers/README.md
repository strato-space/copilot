# VoiceBot Workers

This directory is a placeholder for VoiceBot BullMQ workers.

## Overview

VoiceBot uses BullMQ workers for background processing:

- **voice_jobs/** - Audio transcription and processing
- **common_jobs/** - Session lifecycle management
- **processors/** - Message processors (categorization, NER, etc.)
- **postprocessing/** - Session post-processors (create_tasks, etc.)

## Current Status

**These workers are NOT included in the copilot backend.**

The voicebot workers run as a separate service (`voicebot-tgbot.js`) because:

1. They require heavy dependencies (OpenAI Whisper, Google APIs)
2. They need dedicated Redis connections for BullMQ
3. They process long-running jobs that should not block the API

## Integration Points

The copilot backend integrates with voicebot workers through:

1. **BullMQ Queues** - Jobs are added to queues from the API
2. **Socket.IO Events** - Workers emit events that the API broadcasts
3. **MongoDB** - Shared session/message state

## Queue Names

Queue names are defined in `src/constants.ts`:

- `voicebot--common` - Session lifecycle
- `voicebot--voice` - Audio transcription
- `voicebot--processors` - Message processing
- `voicebot--postprocessors` - Session finalization
- `voicebot--events` - Socket event broadcasting
- `voicebot--notifies` - External notifications

## To Enable BullMQ

1. Install dependencies:
   \`\`\`bash
   npm install bullmq ioredis
   \`\`\`

2. Configure Redis connection in `.env`:
   \`\`\`
   REDIS_CONNECTION_HOST=localhost
   REDIS_CONNECTION_PORT=6379
   REDIS_CONNECTION_PASSWORD=
   REDIS_DB_INDEX=0
   \`\`\`

3. Create queue instances in the API (see `src/services/queue.ts.example`)

4. For full worker functionality, use the original voicebot service.

## Current Scaffold in Copilot

Copilot now includes a minimal worker scaffold to unblock migration work:

- `src/workers/voicebot/manifest.ts` - typed job-name -> handler map
- `src/workers/voicebot/handlers/doneMultiprompt.ts` - queue-handler skeleton for `DONE_MULTIPROMPT`
- `src/workers/voicebot/handlers/processingLoop.ts` - runtime-scoped queue snapshot for pending work
- `src/workers/voicebot/handlers/transcribe.ts` - runtime-safe transcribe entrypoint scaffold
- `src/workers/voicebot/handlers/categorize.ts` - runtime-safe categorize entrypoint scaffold
- `src/workers/voicebot/handlers/finalization.ts` - runtime-safe finalization entrypoint scaffold

This scaffold is intentionally minimal:
- no long-running worker process is started from API runtime,
- no Telegram delivery is executed yet,
- handlers persist only safe metadata/log side effects needed for auditability.
