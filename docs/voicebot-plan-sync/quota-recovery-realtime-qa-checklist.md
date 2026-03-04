# Voice Quota Recovery Realtime QA Checklist

Issue: `copilot-w8l0.3`  
Scope: verify quota error placeholder replacement and realtime delivery in Voice session UI.

## Automated Gate

Run backend tests:

```bash
cd /home/strato-space/copilot/backend
npm run test -- \
  __tests__/voicebot/workers/workerCreateTasksFromChunksHandler.test.ts \
  __tests__/voicebot/workers/workerCreateTasksPostprocessingRealtime.test.ts \
  __tests__/voicebot/socket/voicebotSocketEventsWorker.test.ts
npm run build
```

Run frontend tests:

```bash
cd /home/strato-space/copilot/app
npm run test -- \
  __tests__/voice/transcriptionFallbackErrorSignatureContract.test.ts \
  __tests__/voice/transcriptionTimelineLabel.test.ts
npm run build
```

Pass criteria:
- all tests are green;
- both builds are green.

## Manual Gate (MCP Chrome)

Target session example: `69a7cb2002566a3e76d2dc11`.

1. Open session page:  
   `https://copilot.stratospace.fun/voice/session/69a7cb2002566a3e76d2dc11`
2. Confirm there is at least one fallback row with `Недостаточно квоты OpenAI`.
3. Confirm fallback error row has signature line in format:  
   `mm:ss - mm:ss, file.webm, HH:mm:ss`  
   Example: `74:04 - 74:04, 021-2.webm, 10:23:37`.
4. Wait for processing retries (or trigger retry path) until one quota row is transcribed.
5. Confirm same row is replaced in place with real transcript text (no page reload).
6. Confirm no stale quota placeholder remains for that row.
7. Optional create-tasks check: confirm `tickets_prepared` popup/event appears for postprocessing flow as well as direct flow.

Pass criteria:
- signature exists for quota fallback rows where metadata is available;
- realtime message update replaces placeholder with transcript text in place;
- no manual refresh is required.

## Sign-off Template

- Backend automated gate: `PASS/FAIL`
- Frontend automated gate: `PASS/FAIL`
- Manual MCP Chrome gate: `PASS/FAIL`
- Notes (session id, timestamp, anomalies):

