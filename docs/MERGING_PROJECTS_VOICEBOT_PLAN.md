# План слияния проектов VoiceBot и Copilot

Дата ревизии: 2026-02-20

## 1) Цель
Свести в один актуальный источник состояния миграции `voicebot + webrtc -> copilot`, где источником истины являются **закрытые BD тикеты** и подтверждающие тесты.

## 2) Источник истины
Используется только `bd list --all` + карточки `bd show <id>`.

Команда фиксации среза:

```bash
cd /home/strato-space/copilot
bd list --all --json
```

Срез на эту ревизию:
- Всего тикетов: `215`
- Статус `closed`: `215`
- Типы: `task=187`, `bug=23`, `feature=5`

## 3) Status legend

- `[v]` migrated and green in Playwright
- `[x] not yet migrated`
- `[~] partially covered`

## 4) Исполнительный статус миграции

| Stream | Status | BD evidence |
|---|---|---|
| Frontend `/voice` core parity | `[v]` | `copilot-z9j`, `copilot-oj3a`, `copilot-cgdd`, `copilot-deii`, `copilot-szo`, `copilot-ris`, `copilot-ltof` |
| FAB lifecycle + WebRTC Mode A/B parity | `[v]` | `copilot-jm8`, `copilot-iy8d`, `copilot-glkz`, `copilot-4y6` |
| Screenshort/Log/segment actions | `[v]` | `copilot-z9j.1`, `copilot-z9j.2`, `copilot-soys`, `copilot-vp6o`, `copilot-15rp`, `copilot-dy1y`, `copilot-odwy` |
| Realtime updates in UI | `[v]` | `copilot-zpb9`, `copilot-mwdg` |
| Runtime isolation (all domains) | `[~]` | `copilot-xh5`, `copilot-au9`, `copilot-2s0`, `copilot-3h6`, `copilot-xgk`, `copilot-zhd` |
| Voice API parity + utilities | `[~]` | `copilot-lru`, `copilot-lru.1`, `copilot-a0c` |
| Socket contracts (`/voicebot`, `session_done`) | `[~]` | `copilot-2rk`, `copilot-s93`, `copilot-ltof` |
| TS workers migration | `[~]` | `copilot-6jm`, `copilot-lnu`, `copilot-ovg`, `copilot-lcf`, `copilot-hnuz`, `copilot-gz4e`, `copilot-1ckx` |
| TG bot migration + cutover | `[~]` | `copilot-6pl`, `copilot-6pl.2`, `copilot-f1g`, `copilot-b2t`, `copilot-h84`, `copilot-gr3`, `copilot-3ey5`, `copilot-hsxw` |
| Upload/size rails + full-track policy | `[~]` | `copilot-gpy`, `copilot-kyja`, `copilot-hmkq`, `copilot-xv4a` |
| Dedupe (online + historical) | `[~]` | `copilot-ryl8`, `copilot-eojq`, `copilot-qeq0`, `copilot-32vw` |
| Legacy cleanup in Copilot repo | `[~]` | `copilot-vsen`, `copilot-mcsf` |
| Full repo test sweep | `[v]` | `copilot-ia38`, `copilot-b13`, `copilot-fko` |

## 5) Детальный чеклист по миграции

### 5.1 Frontend /voice
- `[v]` Перенесён и выровнен header/session card, controls `New / Rec / Cut / Pause / Done`.
  - BD: `copilot-z9j`, `copilot-oj3a`, `copilot-cgdd`, `copilot-szo`, `copilot-ris`
- `[v]` Кнопка `Done` закрывает сессию детерминированно (исправлен stale state `Ready`).
  - BD: `copilot-ltof`
- `[v]` Tabs `Transcription / Categorization / Screenshort / Log` + segment actions + rollback.
  - BD: `copilot-z9j.1`, `copilot-z9j.2`, `copilot-vp6o`, `copilot-soys`
- `[v]` Удаление сегмента транскрипции синхронно чистит категоризацию/пустые строки.
  - BD: `copilot-dy1y`, `copilot-15rp`
- `[v]` Формат подписи сегмента приведён к диапазону/файлу/локальному времени.
  - BD: `copilot-odwy`
- `[v]` Realtime апдейты категоризации/финализации без refresh.
  - BD: `copilot-zpb9`, `copilot-mwdg`

### 5.2 WebRTC + FAB
- `[v]` Локальная интеграция webrtc runtime в copilot.
  - BD: `copilot-d8s`
- `[v]` FAB lifecycle покрыт e2e (включая firefox-flake stabilization).
  - BD: `copilot-jm8`, `copilot-iy8d`
- `[~]` Full-track сохраняется в Monitor, но upload на backend выключен (до diarization flow).
  - BD: `copilot-hmkq`, `copilot-xv4a`, `copilot-lj5f`
- `[~]` Size rails/413 фиксы есть, но поведение лимитов не закрыто Playwright-сценарием с реальным large upload.
  - BD: `copilot-gpy`, `copilot-kyja`

### 5.3 Backend API + Socket + Runtime
- `[~]` Voice API parity (flat + utility routes) перенесён.
  - BD: `copilot-lru`, `copilot-lru.1`, `copilot-a0c`
- `[~]` Socket namespace/authz/session_done parity перенесены.
  - BD: `copilot-2rk`, `copilot-s93`, `copilot-ltof`
- `[~]` Runtime isolation развернут по Voice/CRM/FinOps/miniapp.
  - BD: `copilot-xh5`, `copilot-au9`, `copilot-2s0`, `copilot-3h6`, `copilot-xgk`, `copilot-zhd`

### 5.4 Workers + Processing
- `[~]` TS handlers для core jobs и runner запущены.
  - BD: `copilot-6jm`, `copilot-lnu`, `copilot-ovg`, `copilot-lcf`
- `[~]` Закрыты баги stuck transcription/requeue filters/scheduler.
  - BD: `copilot-hnuz`, `copilot-gz4e`, `copilot-1ckx`
- `[~]` Dedupe/skip-retranscribe на уровне hash/filename работает; historical cleanup добавлен.
  - BD: `copilot-ryl8`, `copilot-eojq`, `copilot-qeq0`, `copilot-32vw`

### 5.5 Telegram bot
- `[~]` TS runtime + non-command ingress + cutover выполнены.
  - BD: `copilot-6pl`, `copilot-6pl.2`, `copilot-f1g`, `copilot-b2t`, `copilot-h84`, `copilot-gr3`
- `[~]` Командный контракт и menu-surface (`/start /session /done`, при поддержке `/login /help`) выровнен.
  - BD: `copilot-3ey5`, `copilot-hsxw`

## 6) Финальная структура проекта (после миграции)

```text
copilot/
  backend/
    src/
      api/routes/voicebot/
        index.ts                # flat + compatibility voice routes
        sessions.ts             # session CRUD, active-session, utility routes
        uploads.ts              # upload_audio, attachment endpoints
        transcription.ts        # edit/delete segment routes
        permissions.ts          # access routes
      api/socket/voicebot.ts    # /voicebot namespace, session_done, realtime fanout
      services/
        runtimeScope.ts         # runtime_tag rules (prod-family/non-prod strict)
        db.ts                   # runtime-aware mongo proxy/filtering
      workers/voicebot/
        runner.ts               # TS worker runner
        manifest.ts             # queue->handler bindings
        handlers/*.ts           # transcribe/categorize/finalize/done/... handlers
      voicebot_tgbot/
        runtime.ts              # TS Telegram runtime entry
        commandHandlers.ts      # /start /session /done /login /help
        ingressHandlers.ts      # text/voice/photo/document routing
  app/
    src/pages/voice/
      SessionPage.tsx           # voice session screen
      SessionResolverPage.tsx   # /voice/session resolver
    src/components/voicebot/
      MeetingCard.*             # header + state controls
      TranscriptionTable.*      # segments, actions, signatures
      Screenshort.*             # attachments/public uri preview
      LogTab.*                  # session event log + actions
    src/store/voiceBotStore.ts  # voice page state + API wiring
    public/webrtc/
      webrtc-voicebot-lib.js    # embedded local runtime (FAB)
      fab.html
      monitoring.html
      fab.css
```

### Что перенесено из `voicebot` по слоям
- В `api`: контроллерный контракт voicebot (`sessions`, `uploads`, `transcription`, `permissions`, utility routes).
- В `middleware/services`: runtime isolation + socket authz + session access checks.
- Во `front`: Session page, controls lifecycle, tabs, log/actions, attachment preview, resolver.
- В `webrtc`: локальные FAB assets и runtime orchestration.

## 7) Playwright coverage
Подробная матрица: `docs/PLAYWRIGHT_MIGRATION_MATRIX.md`.

Итог по BD:
- `[v]` ключевые frontend migration сценарии и lifecycle покрыты Playwright (`copilot-jm8`, `copilot-iy8d`, `copilot-fko`, `copilot-ia38`).
- `[~]` backend/runtime/TG/worker блоки подтверждены unit+integration+ops, но не обязаны иметь прямую Playwright проверку.

## 8) Решённые противоречия старого плана

- Старый тезис: держать legacy runtime в Copilot.
  - Решение по BD: удалить из Copilot и оставить reference во внешнем `/home/strato-space/voicebot`.
  - BD: `copilot-vsen`.

- Старый тезис: migration без обязательного тест-gate.
  - Решение по BD: полный test sweep обязателен, включая e2e.
  - BD: `copilot-ia38`, `copilot-b13`.

- Старый тезис: full-track можно грузить на backend всегда.
  - Решение по BD: monitor-only до включения diarization pipeline.
  - BD: `copilot-hmkq`, `copilot-xv4a`, `copilot-lj5f`.

## 9) Что ещё не migrated в Playwright (x)

- `[x]` E2E сценарий реального large-upload с живыми медиа-устройствами и проверкой edge лимитов/ретраев.
- `[x]` E2E сценарий clipboard image -> categorization block linkage на живом backend (сейчас подтверждено преимущественно unit/integration и ручным smoke).
- `[x]` E2E сценарий TG ingress (voice/photo/document) -> появление в `/voice/session/*` end-to-end через Telegram API.

## 10) Операционные команды проверки

```bash
cd /home/strato-space/copilot
bd list --all
bd show copilot-ia38
bd show copilot-jm8
bd show copilot-ltof
bd show copilot-vsen
```
