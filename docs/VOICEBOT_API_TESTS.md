# Copilot VoiceBot API Test Matrix

Date: 2026-02-19

## Backend test command

```bash
cd /home/strato-space/copilot/backend
npm test -- --runInBand
```

Latest local result:
- `25` suites passed
- `170` tests passed
- Includes route-level coverage for:
  - `POST /voicebot/trigger_session_ready_to_summarize`
  - `POST /voicebot/upload_audio` duration persistence contract

## Focused parity suites

```bash
cd /home/strato-space/copilot/backend
npm test -- --runInBand __tests__/voicebot/triggerSummarizeRoute.test.ts
npm test -- --runInBand __tests__/voicebot/uploadAudioRoute.test.ts
npm test -- --runInBand __tests__/voicebot/audioUtils.test.ts
npm test -- --runInBand __tests__/voicebot/authListUsersRoute.test.ts
npm test -- --runInBand __tests__/smoke/voicebotApiSmoke.test.ts
npm test -- --runInBand __tests__/voicebot/objectLocatorRuntime.test.ts
npm test -- --runInBand __tests__/voicebot/transcriptionRuntimeRoute.test.ts
npm test -- --runInBand __tests__/voicebot/permissionsRuntimeRoute.test.ts
npm test -- --runInBand __tests__/voicebot/sessionTelegramMessage.test.ts
npm test -- --runInBand __tests__/voicebot/doneNotifyService.test.ts
npm test -- --runInBand __tests__/voicebot/workerDoneMultipromptHandler.test.ts
npm test -- --runInBand __tests__/voicebot/workerScaffoldHandlers.test.ts
npm test -- --runInBand __tests__/voicebot/tgSessionRef.test.ts
npm test -- --runInBand __tests__/voicebot/tgCommandHandlers.test.ts
npm test -- --runInBand __tests__/voicebot/voicebotSocketEventsWorker.test.ts
npm test -- --runInBand __tests__/voicebot/workerCategorizeHandler.test.ts
npm test -- --runInBand __tests__/services/dbRuntimeScopedCollectionProxy.test.ts
```

## Frontend smoke (voice routes)

```bash
cd /home/strato-space/copilot/app
PLAYWRIGHT_BASE_URL=https://copilot.stratospace.fun npm run test:e2e -- e2e/voice.spec.ts --project=chromium-unauth
```

Latest local result:
- `6` tests passed (route resolve, runtime mismatch screen, list/table load, session open).

Additional FAB lifecycle coverage:

```bash
cd /home/strato-space/copilot/app
PLAYWRIGHT_BASE_URL=https://copilot.stratospace.fun npm run test:e2e -- e2e/voice.spec.ts e2e/voice-fab-lifecycle.spec.ts --project=chromium-unauth
```

Latest local result:
- `11` tests passed (`voice.spec.ts` + `voice-fab-lifecycle.spec.ts`).

## Realtime websocket verification

Backend (automated):
- `__tests__/voicebot/voicebotSocketEventsWorker.test.ts` validates `SEND_TO_SOCKET` -> namespace room emit (`message_update`).
- `__tests__/voicebot/workerCategorizeHandler.test.ts` validates categorization handler enqueues socket events on success/error paths.

Latest targeted run:
- `2` suites passed
- `6` tests passed

Command:

```bash
cd /home/strato-space/copilot/backend
npm test -- --runInBand __tests__/voicebot/voicebotSocketEventsWorker.test.ts __tests__/voicebot/workerCategorizeHandler.test.ts
```

MCP Chrome smoke (manual):
- Open `/voice/session/:id`, verify console shows socket connected to `/voicebot`.
- Ensure `subscribe_on_session` happens for current `session_id`.
- During categorization, rows in Categorization tab must update without page refresh (`message_update` fan-out).
