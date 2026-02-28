# PLAYWRIGHT_MIGRATION_MATRIX

Дата ревизии: 2026-02-20

## Source of truth
- BD закрытые задачи: `bd list --all`, `bd show <id>`
- e2e specs в `app/e2e/*.spec.ts`

## Status legend

- `[v]` migrated and green in Playwright
- `[x] not yet migrated`
- `[~] partially covered`

## Сводка по покрытию

| Block | Status | Evidence |
|---|---|---|
| Voice page core navigation/resolver/error states | `[v]` | `e2e/voice.spec.ts`, BD: `copilot-fko`, `copilot-ia38` |
| FAB lifecycle (`New/Rec/Cut/Pause/Done`) | `[v]` | `e2e/voice-fab-lifecycle.spec.ts`, BD: `copilot-jm8`, `copilot-iy8d` |
| Segment log/edit/delete/rollback/retry | `[v]` | `e2e/voice-log.spec.ts`, BD: `copilot-jm8`, `copilot-ia38` |
| Header/footer parity + state visuals | `[v]` | `e2e/voice-fab-lifecycle.spec.ts`, BD: `copilot-oj3a`, `copilot-cgdd`, `copilot-0sp5` |
| Realtime categorization via socket | `[~]` | BD: `copilot-zpb9`, `copilot-mwdg` (+ MCP/manual smoke), no dedicated deterministic Playwright socket test yet |
| Upload edge cases (413/oversize/full-track monitor-only) | `[~]` | BD: `copilot-gpy`, `copilot-kyja`, `copilot-hmkq`, `copilot-xv4a`; not fully e2e with real large media |
| TG ingress to timeline end-to-end | `[x]` | No Playwright e2e through Telegram transport |
| Clipboard image->categorization linked block live e2e | `[x]` | BD implemented (`copilot-km0w`, `copilot-7owt`), but no stable live e2e in Playwright yet |

## Детальная матрица сценариев

| Status | Source scenario | Destination spec/test |
|---|---|---|
| `[v]` | `/voice` sessions list loads | `e2e/voice.spec.ts` `@unauth loads /voice sessions table` |
| `[v]` | row click opens session page | `e2e/voice.spec.ts` `@unauth opens session from /voice table row click` |
| `[v]` | `/voice/session` resolves active session | `e2e/voice.spec.ts` `@unauth resolves /voice/session to active-session` |
| `[v]` | `/voice/session` empty-state when no active session | `e2e/voice.spec.ts` `@unauth shows empty-state on /voice/session without active-session` |
| `[v]` | runtime mismatch should not infinite-load | `e2e/voice.spec.ts` `@unauth shows runtime mismatch screen on 404 session fetch` |
| `[v]` | no microphone prompt on initial `/voice` load | `e2e/voice.spec.ts` `@unauth does not request microphone on initial /voice load` |
| `[v]` | Screenshort tab cards render | `e2e/voice.spec.ts` `@unauth renders Screenshort tab attachment cards` |
| `[v]` | Log tab controls render | `e2e/voice.spec.ts` `@unauth renders Log tab with rollback action controls` |
| `[v]` | session action order `New/Rec/Cut/Pause/Done` | `e2e/voice-fab-lifecycle.spec.ts` `@unauth session action order is New / Rec / Cut / Pause / Done` |
| `[v]` | `New` routes into FAB control | `e2e/voice-fab-lifecycle.spec.ts` `@unauth New button routes action into FAB control` |
| `[v]` | `Rec` activates page session then routes into FAB control | `e2e/voice-fab-lifecycle.spec.ts` `@unauth Rec on session page activates page session then calls FAB control` |
| `[v]` | `Rec` switches active session from another session | `e2e/voice-fab-lifecycle.spec.ts` `@unauth Rec switches active-session from another session to current page session` |
| `[v]` | recording-state enablement contract | `e2e/voice-fab-lifecycle.spec.ts` `@unauth button enablement follows recording state contract` |
| `[v]` | `Pause` keeps UI busy until pause resolves (upload-wait semantics) | `e2e/voice-fab-lifecycle.spec.ts` `@unauth Pause keeps controls busy until FAB pause resolves (upload-wait semantics)` |
| `[v]` | `Done` routes into FAB control | `e2e/voice-fab-lifecycle.spec.ts` `@unauth Done button routes action into FAB control` |
| `[v]` | cleanup flow removes created session row | `e2e/voice-fab-lifecycle.spec.ts` `@unauth sessions cleanup flow deletes created test session row` |
| `[v]` | rollback/resend/retry payload contract | `e2e/voice-log.spec.ts` `@unauth triggers rollback, resend and retry actions with proper payloads` |
| `[v]` | manual summarize payload contract | `e2e/voice-log.spec.ts` `@unauth triggers session ready-to-summarize endpoint payload` |
| `[v]` | transcript edit/delete payload contract | `e2e/voice-log.spec.ts` `@unauth submits transcript segment edit and delete payloads` |
| `[~]` | realtime socket push while page idles (without polling fallback) | Covered by closed BD + manual/MCP smoke (`copilot-zpb9`, `copilot-mwdg`), no isolated deterministic e2e case |
| `[x]` | Telegram ingress e2e (message -> session timeline in browser) | Planned; no Playwright transport harness |
| `[x]` | live large-file upload + nginx boundary behavior | Planned; current coverage mostly backend/unit/manual |

## Команды запуска

```bash
cd /home/strato-space/copilot/app
npm run e2e:install
PLAYWRIGHT_BASE_URL=https://copilot.stratospace.fun npm run test:e2e -- e2e/voice.spec.ts e2e/voice-fab-lifecycle.spec.ts e2e/voice-log.spec.ts --project=chromium-unauth
PLAYWRIGHT_BASE_URL=https://copilot.stratospace.fun PLAYWRIGHT_INCLUDE_FIREFOX=1 npm run test:e2e -- e2e/voice-fab-lifecycle.spec.ts --project=firefox-unauth
```

## Подтверждение из BD
- `copilot-jm8`: миграция Mode A/Mode B закрыта, chromium+firefox green.
- `copilot-iy8d`: устранён Firefox flake, repeat-each stress passes.
- `copilot-ia38`: полный app Playwright sweep закрыт (`53 passed, 4 skipped`).
