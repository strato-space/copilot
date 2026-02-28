# MERGING_FRONTENDS_VOICEBOT.PLAN

Дата ревизии: 2026-02-20

## 1) Цель
Зафиксировать фактическое состояние миграции frontend voice-контура в Copilot по **закрытым BD задачам** и тестовым артефактам.

## 2) Источник истины
Приоритет:
1. `bd list --all` (факт закрытия/объёма)
2. `bd show <id>` (close reason / доказательства)
3. Код и e2e в `app/src/**`, `app/e2e/**`

## 3) Status legend

- `[v]` migrated and green in Playwright
- `[x] not yet migrated`
- `[~] partially covered`

## 4) Фактический статус frontend migration

| Capability | Status | Closed BD | Test evidence |
|---|---|---|---|
| Session page header parity (layout, controls row, footer status widget) | `[v]` | `copilot-oj3a`, `copilot-cgdd`, `copilot-0sp5` | `e2e/voice-fab-lifecycle.spec.ts` |
| Controls contract `New/Rec/Cut/Pause/Done` | `[v]` | `copilot-z9j`, `copilot-szo`, `copilot-ris` | `e2e/voice-fab-lifecycle.spec.ts` |
| `Done` closes session correctly (no stuck Ready) | `[v]` | `copilot-ltof` | e2e + bugfix verification in BD |
| Session resolver and runtime mismatch screen | `[v]` | `copilot-z9j`, `copilot-ueu`, `copilot-uzp` | `e2e/voice.spec.ts` |
| Tabs: `Transcription / Categorization / Screenshort / Log` | `[v]` | `copilot-z9j.1`, `copilot-z9j.2`, `copilot-wxa`, `copilot-yup` | `e2e/voice.spec.ts`, `e2e/voice-log.spec.ts` |
| Segment actions (copy/edit/delete/rollback) + cascade cleanup | `[v]` | `copilot-z9j.2`, `copilot-dy1y`, `copilot-15rp`, `copilot-ot2` | `e2e/voice-log.spec.ts` + unit |
| Signature line format under transcript segment | `[v]` | `copilot-odwy` | unit/ui checks |
| Realtime categorization/fin updates via socket | `[~]` | `copilot-zpb9`, `copilot-mwdg` | confirmed by BD + MCP/manual smoke; no deterministic isolated Playwright case |
| Screenshot caption uses `public_attachment` + hover copy | `[v]` | `copilot-soys`, `copilot-vp6o` | ui/unit + backend route checks |
| Clipboard ingest (text/image chunk + linked categorization block) | `[~]` | `copilot-km0w`, `copilot-7owt` | implemented and tested on unit/integration; no stable dedicated live Playwright flow |
| Full-track rows visible in Monitor, upload disabled | `[~]` | `copilot-hmkq`, `copilot-xv4a`, `copilot-lj5f` | policy enforced in runtime + docs; no dedicated Playwright assertion |
| Upload oversize rails (413/502 UX) | `[~]` | `copilot-gpy`, `copilot-kyja` | backend/unit/manual verified, not fully real-media e2e |
| Firefox lifecycle flake stabilization | `[v]` | `copilot-iy8d` | repeat-each stress pass in BD close reason |
| FAB persistence across route navigation | `[v]` | `copilot-4y6` | `e2e/voice-fab-lifecycle.spec.ts` |

## 5) Что из старого плана заменено решениями из BD

- Старый draft предполагал coexistence с legacy runtime в репозитории.
  - Факт: legacy удалён (`copilot-vsen`), frontend работает на текущем TS runtime.
- Старый draft допускал ручной безтестовый приём migration.
  - Факт: есть обязательный gate `copilot-ia38` + профильные e2e (`copilot-jm8`, `copilot-iy8d`).
- Старый draft не фиксировал runtime-mismatch UX.
  - Факт: explicit экран вместо infinite loader (`copilot-ueu`, `copilot-uzp`).

## 6) Remaining frontend scope (`[x]`)

- `[x]` Playwright e2e через Telegram transport (message/photo/document -> UI timeline).
- `[x]` Playwright e2e с живым large file upload и реальными browser media devices.
- `[x]` Отдельный deterministic Playwright кейс на websocket-only realtime update (без polling fallback).

Примечание: эти `x` не блокируют текущую поставку, но остаются как следующая волна hardening.

## 7) Минимальный набор проверок после изменений

```bash
cd /home/strato-space/copilot/app
npm run e2e:install
PLAYWRIGHT_BASE_URL=https://copilot.stratospace.fun npm run test:e2e -- e2e/voice.spec.ts e2e/voice-fab-lifecycle.spec.ts e2e/voice-log.spec.ts --project=chromium-unauth
PLAYWRIGHT_BASE_URL=https://copilot.stratospace.fun PLAYWRIGHT_INCLUDE_FIREFOX=1 npm run test:e2e -- e2e/voice-fab-lifecycle.spec.ts --project=firefox-unauth
```

## 8) Ссылки на ключевые закрытые задачи

- Foundation: `copilot-z9j`, `copilot-z9j.1`, `copilot-z9j.2`, `copilot-oj3a`, `copilot-cgdd`
- Lifecycle + browser stability: `copilot-jm8`, `copilot-iy8d`, `copilot-ltof`, `copilot-4y6`
- Realtime + cleanup: `copilot-zpb9`, `copilot-mwdg`, `copilot-dy1y`, `copilot-15rp`
- Attachments + caption/public URL: `copilot-vp6o`, `copilot-soys`
- Monitor/full-track policy: `copilot-hmkq`, `copilot-xv4a`, `copilot-lj5f`
- Final verification: `copilot-ia38`
