# Playwright Migration Matrix (voicebot/webrtc -> copilot)

Date: 2026-02-18

## Scope

- Source A: `/home/strato-space/webrtc/plan/mcp-fab-auth-tests.md`
- Source B: `/home/strato-space/webrtc/plan/cdp_fab_tests.py`
- Source C: `/home/strato-space/voicebot` UI behavior required by `CHANGELOG.md` and `/home/strato-space/voicebot/plan/session-managment.md`
- Destination: `/home/strato-space/copilot/app/e2e/*.spec.ts`

## Status legend

- `[v]` migrated and green in Playwright
- `[x] not yet migrated`
- `[~] partially covered`

## Scenario mapping

| Status | Source scenario | Destination |
|---|---|---|
| `[v]` | `/voice` sessions list loads | `app/e2e/voice.spec.ts` `@unauth loads /voice sessions table` |
| `[v]` | row click opens session page | `app/e2e/voice.spec.ts` `@unauth opens session from /voice table row click` |
| `[v]` | resolver `/voice/session` -> active session | `app/e2e/voice.spec.ts` `@unauth resolves /voice/session to active-session` |
| `[v]` | resolver empty-state when no active session | `app/e2e/voice.spec.ts` `@unauth shows empty-state on /voice/session without active-session` |
| `[v]` | runtime mismatch must not infinite-load | `app/e2e/voice.spec.ts` `@unauth shows runtime mismatch screen on 404 session fetch` |
| `[v]` | `/voice` must remain usable on sessions/list error | `app/e2e/voice.spec.ts` `@unauth keeps /voice usable when sessions/list returns 500` |
| `[v]` | FAB controls order `New / Rec / Cut / Pause / Done` | `app/e2e/voice-fab-lifecycle.spec.ts` `@unauth session action order is New / Rec / Cut / Pause / Done` |
| `[v]` | `Rec` from session page activates page session and routes to FAB | `app/e2e/voice-fab-lifecycle.spec.ts` `@unauth Rec on session page activates page session then calls FAB control` |
| `[v]` | `New` routes to FAB control | `app/e2e/voice-fab-lifecycle.spec.ts` `@unauth New button routes action into FAB control` |
| `[v]` | `Done` routes to FAB control | `app/e2e/voice-fab-lifecycle.spec.ts` `@unauth Done button routes action into FAB control` |
| `[v]` | recording-state button enablement parity | `app/e2e/voice-fab-lifecycle.spec.ts` `@unauth button enablement follows recording state contract` |
| `[v]` | trigger session ready-to-summarize API flow | `app/e2e/voice-log.spec.ts` `@unauth triggers session ready-to-summarize endpoint payload` |
| `[v]` | transcript edit/delete + rollback/resend/retry log actions | `app/e2e/voice-log.spec.ts` `@unauth submits transcript segment edit and delete payloads`, `@unauth triggers rollback, resend and retry actions with proper payloads` |
| `[x] not yet migrated` | `Cut` must route into FAB control (`cut`) | planned `app/e2e/voice-fab-lifecycle.spec.ts` |
| `[x] not yet migrated` | `Pause` must route into FAB control (`pause`) | planned `app/e2e/voice-fab-lifecycle.spec.ts` |
| `[x] not yet migrated` | pause waits for all non-silent pending uploads | planned integration e2e (requires real monitoring chunk list) |
| `[x] not yet migrated` | done waits final upload and clears active state | planned integration e2e with live backend |
| `[x] not yet migrated` | session cleanup (delete created sessions, no leaked artifacts) | planned integration e2e with cleanup assertions |
| `[x] not yet migrated` | manual upload/retry and speech-filter interplay checks | planned integration e2e |
| `[x] not yet migrated` | microphone default auto-selection regression checks | planned browser integration suite (needs real media devices) |

## Current run commands

```bash
cd /home/strato-space/copilot/app
PLAYWRIGHT_BASE_URL=https://copilot.stratospace.fun npm run test:e2e -- e2e/voice.spec.ts e2e/voice-fab-lifecycle.spec.ts --project=chromium-unauth
```

Latest result:
- `10 passed` (voice.spec + voice-log.spec run: runtime mismatch, log actions, transcript edit/delete, trigger summarize)

