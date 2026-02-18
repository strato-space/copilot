# VoiceBot API - Tests

This repo includes a lightweight Jest test suite for a subset of the VoiceBot CRM API endpoints.

## What is covered
- `POST /voicebot/create_session`
- `POST /voicebot/add_text`
- `POST /voicebot/add_attachment`
- `POST /voicebot/session` (incl. `session_attachments`)
- `GET /voicebot/message_attachment/:message_id/:attachment_index` (smoke, axios mocked)
- `GET /voicebot/public_attachment/:session_id/:file_unique_id` (public route + error matrix)
- `POST /voicebot/trigger_session_ready_to_summarize`

Tests include both:
- Unit tests (controller-level, direct calls)
- Integration tests (Express + Supertest, JWT auth + simple permission middleware)
- Smoke tests (minimal end-to-end flow: Telegram attachment ingestion -> `session_attachments` -> attachment proxy)

## How to run

From repo root:
```bash
npm test
```

Optional helpers:
```bash
# All voicebot tests (controllers + smoke)
npm run test:voicebot

# Unit only
npm run test:voicebot:unit

# Integration only
npm run test:voicebot:integration

# Smoke only
npm run test:voicebot smoke

# Watch mode
npm run test:voicebot:watch

# Coverage
npm run test:voicebot:coverage
```

## Test structure
```
__tests__/
  setup.js                 # Jest setup (env defaults, ioredis mock)
  test-helpers.js          # Shared factories/helpers (optional)
  test-runner.js           # CLI runner for subsets (unit/integration/coverage)
  controllers/
    voicebot.test.js       # Unit tests
    voicebot-integration.test.js  # Integration tests
  smoke/
    session_management_smoke.test.js  # Telegram attachments + Screenshort proxy smoke
```

## Notes
- The suite uses `mongodb-memory-server` for isolation.
- Redis/BullMQ is not started: `ioredis` is mocked and BullMQ queues are faked via `jest.fn()`.
- For endpoint behavior details, see `docs/VOICEBOT_API.md`.
