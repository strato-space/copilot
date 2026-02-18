# План слияния проектов voicebot и copilot

## Ревизия 2026-02-17+ (source-of-truth)

Этот блок фиксирует актуальный план после изменений в `voicebot` и `webrtc` (active-session contract, runtime isolation, FAB lifecycle, TG bot команды).

### Scope (обновлено)
- Полная замена `/voice` в `copilot` на актуальный контур из `voicebot + webrtc`.
- Прямой cutover `@strato_voice_bot` на `copilot` после `dev -> smoke -> prod`.
- Runtime isolation для **всего copilot** на общей Mongo/Redis через `runtime_tag`.
- Voice flat API contract под `/api/voicebot/*` с временными legacy alias.

### Прогресс текущей сессии
- Сделан runtime foundation:
  - `backend/src/services/runtimeScope.ts`
  - runtime-aware DB proxy в `backend/src/services/db.ts`
  - `RUNTIME_TAG` / `IS_PROD_RUNTIME` в `backend/src/constants.ts`
- Усилен socket `/voicebot`:
  - `backend/src/services/session-socket-auth.ts`
  - переписан `backend/src/api/socket/voicebot.ts` (explicit `session_done`, authz, ack `{ok,error}`)
- Начата API parity:
  - flat mounting + legacy aliases в `backend/src/api/routes/voicebot/index.ts`
  - расширение `backend/src/api/routes/voicebot/sessions.ts` (`active_session`, `activate_session`, `create_session`, `projects`, `add_text`, `add_attachment`, aliases)
  - `backend/src/api/routes/voicebot/uploads.ts` переписан под `upload_audio` + attachment endpoints.
- Закрыты advanced voice endpoints parity:
  - в `backend/src/api/routes/voicebot/sessions.ts` реализованы `rollback_event`, `resend_notify_event`, `retry_categorization_event`, `retry_categorization_chunk` (без `501` placeholders).
  - добавлен `backend/src/api/routes/voicebot/messageHelpers.ts` (канонизация сегментов, reset categorization, cleanup payload).
  - добавлены сервисы `backend/src/services/voicebotOid.ts`, `backend/src/services/voicebotSessionLog.ts`, `backend/src/services/voicebotObjectLocator.ts`, `backend/src/services/transcriptionTimeline.ts`.
- Исправлен runtime/web smoke blocker:
  - добавлен endpoint `POST /api/voicebot/auth/list-users` в `backend/src/api/routes/voicebot/sessions.ts` (убран `404` в FAB/settings на `/voice`).
- Проверки:
  - `backend`: `npm run build` — OK
  - `backend`: `npm test -- --runInBand` — OK (`25 suites`, `170 tests`)
  - `app`: `npm run build` — OK
  - `app`: `PLAYWRIGHT_BASE_URL=https://copilot.stratospace.fun npm run test:e2e -- e2e/voice.spec.ts --project=chromium-unauth` — OK (`6 passed`)
  - MCP Chrome smoke: `https://copilot.stratospace.fun/voice` и `https://copilot-dev.stratospace.fun/voice` открываются без console/network errors.

### Повторный gap-аудит (история `voicebot` с 2026-02-05)
- Источник ревизии: `git log --since=2026-02-05` в `/home/strato-space/voicebot` + route/component diff against `/home/strato-space/copilot`.
- Зафиксированные незакрытые дельты:
  - Frontend parity: в copilot пока отсутствует контур `Screenshort` + `SessionLog` и полный attachment-preview контракт (`session_attachments`, `direct_uri`, `message_attachment` fallback, MIME-safe blob preview).
  - Frontend parity: в copilot не доведены segment actions уровня voicebot (hover Copy/Edit/Delete + rollback UX + синхронизация с Categorization после edit/delete).
  - Backend parity: отсутствует группа utility endpoints из voicebot (`task_types/topics/project-files/upload-progress/summarize-trigger/custom-prompt-result/...`).
  - Runtime execution parity: в copilot пока нет переноса voice workers runtime (`processing_loop`, `voice_jobs`, `common_jobs`, notifies/events), поэтому cutover TG bot остается неполным.
  - TG bot parity: не перенесен полный контракт команд `/start /session /done /login /help` и формат 4-line сообщений.

### BD декомпозиция и ссылки
Источник задач: `../.beads/issues.jsonl`

| ID | Задача | Статус | Как открыть |
|---|---|---|---|
| `copilot-37l` | Voicebot gap-audit + sync matrix + migration spec refresh | open | `bd show copilot-37l` |
| `copilot-xh5` | Runtime foundation: RUNTIME_TAG + runtimeScope helpers | in_progress | `bd show copilot-xh5` |
| `copilot-au9` | Runtime isolation: Voice domain data paths | in_progress | `bd show copilot-au9` |
| `copilot-2s0` | Runtime isolation: CRM/OperOps domain data paths | open | `bd show copilot-2s0` |
| `copilot-3h6` | Runtime isolation: FinOps/reports/miniapp data paths | open | `bd show copilot-3h6` |
| `copilot-lru` | Voice API parity + Zod schemas + legacy aliases | in_progress | `bd show copilot-lru` |
| `copilot-2rk` | Socket `/voicebot` authz parity + explicit `session_done` | in_progress | `bd show copilot-2rk` |
| `copilot-z9j` | Frontend `/voice` source-sync + `New/Rec/Cut/Pause/Done` | open | `bd show copilot-z9j` |
| `copilot-d8s` | WebRTC local runtime integration in copilot | open | `bd show copilot-d8s` |
| `copilot-6pl` | TG bot migration to copilot + direct cutover | open | `bd show copilot-6pl` |
| `copilot-b13` | Test hardening: unit/integration/playwright/mcp-chrome smoke | in_progress | `bd show copilot-b13` |
| `copilot-cs8` | Dev deploy -> smoke -> prod deploy + rollback | open | `bd show copilot-cs8` |
| `copilot-z9j.1` | Voice UI parity: Screenshort + SessionLog tabs with attachment preview contract | open | `bd show copilot-z9j.1` |
| `copilot-z9j.2` | Voice UI parity: transcription segment actions + rollback UX | open | `bd show copilot-z9j.2` |
| `copilot-lru.1` | Voice API parity: port remaining utility endpoints from voicebot | open | `bd show copilot-lru.1` |
| `copilot-6pl.1` | Voice runtime workers in copilot: processing_loop + transcribe/categorize/finalization | open | `bd show copilot-6pl.1` |
| `copilot-6pl.2` | TG bot parity: commands contract + 4-line event formatter | open | `bd show copilot-6pl.2` |

### Чеклист задач (обновляемый, маркер `[v]` = требует обновления/повторной проверки)

- [v] `copilot-37l` Обновить spec matrix `voicebot -> copilot`, отметить дельты после 2026-02-05.
- [v] `copilot-xh5` Проверить покрытие runtime filter во всех runtime-scoped коллекциях.
- [v] `copilot-au9` Довести voice endpoints до flat контракта (`session`, `sessions`, `active_session`, `activate_session`, `create_session`, `upload_audio`, `add_text`, `add_attachment`, `message_attachment`, `public_attachment`).
- [v] `copilot-2rk` Проверить `session_done` (explicit `session_id`, backend performer from JWT, no client trust).
- [v] `copilot-lru` Добавить/доработать Zod-схемы на voice API входах и совместимость legacy aliases.
- [v] `copilot-z9j` Реализовать `/voice/session` resolver + runtime-mismatch error screen (без infinite loader).
- [v] `copilot-z9j.1` Довести tabs `Screenshort` + `Log` и attachment preview контракт (`session_attachments`, `direct_uri`, auth-fallback).
- [v] `copilot-z9j.2` Довести segment-level UX (copy/edit/delete/rollback) + sync с Categorization после мутаций.
- [v] `copilot-d8s` Подключить локальный WebRTC runtime (`app/public/webrtc/*`, same-origin script).
- [v] `copilot-6pl` Перенести TG bot команды `/start /session /done /login /help` + 4-line output format.
- [v] `copilot-lru.1` Добрать utility endpoints parity (`task_types/topics/project-files/upload-progress/summarize-trigger/custom-prompt-result/...`).
- [v] `copilot-6pl.1` Перенести worker runtime voicebot (queues/jobs/retry guards/runtime isolation).
- [v] `copilot-6pl.2` Реализовать TG command/output parity (4-line formatter + `/login` one-time tg_auth).
- [v] `copilot-b13` Добавить глубокие unit/integration/Playwright сценарии T1-T18 из плана.
- [v] `copilot-cs8` Провести dev smoke, затем prod deploy и post-deploy checks.

### Финальная структура проекта

Source of truth: см. раздел `## Финальная структура проекта` ниже (актуализирован по состоянию на 2026-02-18).

### Проверка changelog voicebot (с 2026-02-05)
- Создана матрица 1:1 (каждый bullet changelog = отдельная BD-задача): `docs/VOICEBOT_CHANGELOG_GAP_MATRIX_2026-02-05.md`.
- Исходный JSON-артефакт: `docs/VOICEBOT_CHANGELOG_GAP_MATRIX_2026-02-05.json`.
- Meta-задача трекинга: `copilot-7bm`.
- Все созданные задачи можно смотреть по label:
  - `bd list --all | rg 'voicebot-changelog-gap'`

### Прогресс 2026-02-18
- [v] `copilot-a0c`: parity для `/api/voicebot/trigger_session_ready_to_summarize` + route-level test (`backend/__tests__/voicebot/triggerSummarizeRoute.test.ts`) + API docs (`docs/VOICEBOT_API.md`, `docs/VOICEBOT_API_CODE_EXAMPLES.md`, `docs/VOICEBOT_API_TESTS.md`).
- [v] `copilot-ayv`: ffprobe duration probing parity (`backend/src/utils/audioUtils.ts`) и сохранение `duration` в `upload_audio` сообщении/metadata + test coverage (`backend/__tests__/voicebot/audioUtils.test.ts`, `backend/__tests__/voicebot/uploadAudioRoute.test.ts`).
- [v] `copilot-1ot`: добавлен smoke suite `backend/__tests__/smoke/voicebotApiSmoke.test.ts` (critical flat endpoints без 404 regressions).
- [v] Синхронизированы doc-only planning артефакты из `voicebot/plan` в `docs/voicebot-plan-sync/*` (WBS, implementation draft, event-log plans).
- [v] Старт runtime-isolation wave: добавлен audit `docs/RUNTIME_ISOLATION_AUDIT_2026-02-18.md`; `voicebotObjectLocator` переведен на runtime-scoped upsert/find + тест `backend/__tests__/voicebot/objectLocatorRuntime.test.ts`.
- [v] Точечные runtime-фиксы по маршрутам: `backend/src/api/routes/voicebot/transcription.ts`, `backend/src/api/routes/voicebot/permissions.ts`, `backend/src/api/routes/voicebot/uploads.ts` + route tests (`transcriptionRuntimeRoute`, `permissionsRuntimeRoute`, `uploadAudioRoute` assertions).
- [v] Начат TG parity chunk: добавлен форматтер 4-строчного Telegram-сообщения `backend/src/voicebot_tgbot/sessionTelegramMessage.ts` + тест `backend/__tests__/voicebot/sessionTelegramMessage.test.ts` (event/url/session-name/project-name).
- [v] Интеграция форматтера в done/notify flow: `backend/src/api/socket/voicebot.ts` теперь формирует `notify_preview` для `session_done` и пишет `notify_requested` event-log через `backend/src/services/voicebotDoneNotify.ts` (`doneNotifyService.test.ts`).
- [v] Расширен TG command parity scaffold: добавлены `backend/src/voicebot_tgbot/commandHandlers.ts`, `backend/src/voicebot_tgbot/activeSessionMapping.ts`, `backend/src/voicebot_tgbot/sessionRef.ts` с контрактом `/start /session /done /login /help` (active-session mapping по `telegram_user_id + runtime_tag`, `/login` one-time `tg_auth`, 4-line сообщения для `/start|/session|/done`), плюс тесты `tgCommandHandlers.test.ts`, `tgSessionRef.test.ts`.
- [v] Done-flow теперь очищает active-session mapping: `backend/src/workers/voicebot/handlers/doneMultiprompt.ts` и `backend/src/api/socket/voicebot.ts` вызывают cleanup по `session_id` и `telegram_user_id`.
- [v] Runtime-safe one-time token auth: `backend/src/api/routes/auth.ts` ищет/обновляет `automation_one_use_tokens` через runtime filter.
- [v] Расширен каркас workers: `backend/src/workers/voicebot/manifest.ts` + handlers `doneMultiprompt`, `processingLoop`, `transcribe`, `categorize`, `finalization` (runtime-scoped безопасные entrypoints; heavy engines пока вне copilot runtime) + тесты `workerDoneMultipromptHandler.test.ts`, `workerScaffoldHandlers.test.ts`.
- [v] Расширен перенос Playwright Mode A/Mode B сценариев: `app/e2e/voice-fab-lifecycle.spec.ts` (порядок `New/Rec/Cut/Pause/Done`, `Rec -> activate_session`, `New/Done -> FAB control`, state enablement parity в recording-state).
- [v] Добавлена матрица переноса сценариев из `voicebot/webrtc` в copilot e2e: `docs/PLAYWRIGHT_MIGRATION_MATRIX.md` (`[v]/[x]/[~]` статусы и команды прогонов).
- [v] MCP Chrome smoke: `/voice` на `https://copilot.stratospace.fun/voice` открывается без infinite loader, видны таблица сессий и FAB toolbar `New/Rec/Cut/Pause/Done`.
- [v] Закрыты changelog-gap верификации `copilot-0mi` и `copilot-22x`: подтвержден единый 4-line формат TG-сообщений (`/start`, `/session`, `/done`, `done/notify`) и `/login`, независимый от active-session; доказательства в тестах `backend/__tests__/voicebot/tgCommandHandlers.test.ts`, `backend/__tests__/voicebot/sessionTelegramMessage.test.ts`, `backend/__tests__/voicebot/doneNotifyService.test.ts`.
- [v] Закрыты changelog-gap верификации `copilot-ev4` и `copilot-8zr`: подтверждена детерминированная active-session модель без fallback на случайные открытые сессии и socket authz для `session_done`; добавлен `backend/__tests__/voicebot/voicebotSocketAuth.test.ts` и расширен `backend/__tests__/voicebot/tgCommandHandlers.test.ts`.
- [v] Закрыты changelog-gap верификации `copilot-2sj` и `copilot-uzp`: подтвержден cleanup перекрывающихся categorization-рядов при delete/rollback (`backend/__tests__/voicebot/messageHelpers.test.ts`) и подтвержден runtime-mismatch экран без infinite loader (`app/e2e/voice.spec.ts`, Playwright run против `https://copilot.stratospace.fun`).
- [v] Закрыты changelog-gap верификации `copilot-nvg` и `copilot-obm`: подтверждена parity сессионных `New/Rec/Cut/Pause/Done` контролов и строгая active-session семантика для TG/Web/WebRTC по backend+e2e прогонам (`backend/__tests__/voicebot/tgCommandHandlers.test.ts`, `app/e2e/voice-fab-lifecycle.spec.ts`).
- [v] Закрыты конфигурационные changelog-gap `copilot-61m` и `copilot-kks`: проверены `voicebot_runtime/.env.example` (`VOICE_BOT_NOTIFY_HOOKS_CONFIG`) и `voicebot_runtime/notifies.hooks.yaml` (абсолютный `/usr/local/bin/uv` для PM2/systemd-стабильности).
- [v] Закрыты notify-flow changelog-gap `copilot-vq4`, `copilot-qeb`, `copilot-b3v`: подтверждены `session_ready_to_summarize` route/event parity и локальный hooks runner c fire-and-forget исполнением и диагностическим логированием (`voicebot_runtime/voicebot-backend.js`), плюс test evidence по route/smoke (`backend/__tests__/voicebot/triggerSummarizeRoute.test.ts`, `backend/__tests__/smoke/voicebotApiSmoke.test.ts`).
- [v] Закрыты changelog-gap `copilot-xgk` и `copilot-s93`: runtime-isolation contract усилен для aggregate `$lookup`-pipeline (`backend/src/services/db.ts`, `backend/src/services/runtimeScope.ts`) и socket auth contract покрыт unit-tests (`backend/__tests__/services/dbAggregateRuntimeScope.test.ts`, `backend/__tests__/voicebot/voicebotSocketAuth.test.ts`).
- [v] Закрыты changelog-gap `copilot-sm0` и `copilot-orh`: подтверждены строгий 4-line Telegram output контракт и `/login` one-time `tg_auth`, независимый от active-session; тесты `backend/__tests__/voicebot/sessionTelegramMessage.test.ts`, `backend/__tests__/voicebot/doneNotifyService.test.ts`, `backend/__tests__/voicebot/tgCommandHandlers.test.ts`.
- [v] Закрыты changelog-gap `copilot-ueu` и `copilot-szo`: подтверждены runtime-mismatch экран без infinite loader и parity управления `New/Rec/Cut/Pause/Done` на page+FAB; тесты `app/e2e/voice.spec.ts` и `app/e2e/voice-fab-lifecycle.spec.ts`.
- [v] Закрыты changelog-gap `copilot-ajg` и `copilot-qkd`: подтверждены backend session flow и Web API/UI active-session controls (create/activate/active-session + runtime compatibility) по тестам `backend/__tests__/voicebot/sessions.test.ts`, `backend/__tests__/voicebot/sessionsRuntimeCompatibilityRoute.test.ts`, `backend/__tests__/voicebot/tgCommandHandlers.test.ts`.
- [v] Закрыты changelog-gap `copilot-ris` и `copilot-3tx`: подтверждена state-driven pictogram parity для `MeetingCard` (runtime states `recording/cutting/paused/final_uploading/error/closed/ready`) + порядок `New/Rec/Cut/Pause/Done`; добавлены unit-tests `app/__tests__/voice/meetingCardStateMapping.test.ts`.
- [v] Закрыты changelog-gap `copilot-2mo` и `copilot-yud`: подтвержден sync active-session localStorage/event-канала между page и FAB (`VOICEBOT_ACTIVE_SESSION_ID`, `voicebot:active-session-updated`) и обновлена документация `README.md` по контракту toolbar/status.
- [v] Закрыты changelog-gap `copilot-e2o` и `copilot-r75`: подтвержден unified Telegram formatter path + `/login` one-time token flow в copilot (`sessionTelegramMessage`, `commandHandlers`, `doneNotifyService`).
- [v] Закрыты changelog-gap `copilot-amj` и `copilot-1he`: подтверждены runtime-isolation implementation и API/routes/frontend integration parity по backend+Playwright тестам.
- [v] Закрыты changelog-gap `copilot-9x8` и `copilot-602`: дополнена Playwright matrix + e2e-покрытие для `trigger_session_ready_to_summarize`, transcript edit/delete и rollback/resend/retry log flows (`app/e2e/voice-log.spec.ts`, `app/e2e/voice.spec.ts`, `docs/PLAYWRIGHT_MIGRATION_MATRIX.md`).
- [v] Закрыты changelog-gap `copilot-6jv` и `copilot-f4f`: подтверждены `/login` one-time semantics (независимо от active-session) и UX/диагностика загрузки сессии (404 runtime-mismatch vs generic error) в `SessionPage` + `voiceBotStore`; тесты `backend/__tests__/voicebot/tgCommandHandlers.test.ts`, `app/__tests__/voice/sessionPageRequestDiagnostics.test.ts`, `app/e2e/voice.spec.ts`.
- [v] Закрыты changelog-gap `copilot-dmw`, `copilot-jte`, `copilot-csk`, `copilot-9gj`: подтвержден стабильный public attachment контракт без auth-gate для внешних consumers (`/public_attachment` и legacy `/uploads/public_attachment`) и dual-link payload `session_attachments` (`uri` + `direct_uri`); тесты `backend/__tests__/voicebot/publicAttachmentRoute.test.ts` и `backend/__tests__/voicebot/sessionsRuntimeCompatibilityRoute.test.ts`.
- [v] Закрыты changelog-gap `copilot-yup`, `copilot-aqt`, `copilot-0da`, `copilot-97q`: подтверждены frontend `direct_uri` rendering/normalization (`Screenshort` + `voiceBotStore`) и backend auth-gate parity для unauth `/voicebot/public_attachment/*`.
- [v] Закрыты changelog-gap `copilot-n5l` и `copilot-dep`: подтверждены docs/tests parity по public attachment delivery и детерминированная TG session handoff модель (`/start` create+activate, `/session` strict active lookup, `/done` close+clear).
- [v] Закрыты changelog-gap `copilot-wca` и `copilot-gvq`: подтверждены правила выбора сессии для TG flow (strict active-session без fallback) и операторская discoverability команд (`/help` + `/login`).
- [v] Закрыты changelog-gap `copilot-g4v` и `copilot-xqt`: подтвержден token-safe attachment read model (без Telegram token URL в UI) и канонический формат `/session`/`/login` ответов с metadata.
- [v] Закрыты changelog-gap `copilot-8qn` и `copilot-3y0`: подтверждено, что migration-spec в copilot покрывает lifecycle/session-routing модель и полный операторский набор TG-команд (`/start` `/session` `/done` `/login`).
- [v] Закрыты changelog-gap `copilot-328` и `copilot-wxa`: подтверждена end-to-end цепочка session attachments и UI-вкладка `Screenshort` (preview/caption/timestamp).
- [v] Закрыты changelog-gap `copilot-xhb` и `copilot-emo`: подтверждены Jest smoke tests для Telegram attachment flow/proxy endpoints и нормализация TG response формата на public-host links + metadata.
- [v] Закрыты changelog-gap `copilot-2nj` и `copilot-mwg`: подтверждены auto-recovery после `insufficient_quota` (quota-only corruption clear + requeue) и защита от Redis enqueue-fail (rollback `is_processing` при ошибке `queue.add`); unit-tests в `voicebot_runtime/__tests__/common_jobs/processing_loop_quota_recovery.test.js` и `voicebot_runtime/__tests__/voicebot/categorization_enqueue_failure.test.js`.
- [v] Закрыты changelog-gap `copilot-l20` и `copilot-0g1`: подтверждены Redis cleanup safety rails (history-only clean + trimEvents, no wait deletion) и cost-controls категоризации (skip slash-команд/короткого мусора); tests `voicebot_runtime/__tests__/services/redis_monitor_safety.test.js` и `voicebot_runtime/__tests__/voicebot/categorization_cost_controls.test.js`.
- [v] Закрыты changelog-gap `copilot-7vb` и `copilot-6lv`: подтверждены attachment-aware LLM context (proxy URLs для Telegram screenshots/documents) и auto-recovery processing_loop для quota-stopped transcribe/categorization (requeue + stale lock reset); tests `voicebot_runtime/__tests__/services/voicebot_ai_context_attachments.test.js` и расширенный `voicebot_runtime/__tests__/common_jobs/processing_loop_quota_recovery.test.js`.
- [v] Закрыты changelog-gap `copilot-e7y` и `copilot-6ym`: подтверждены retry/backoff метаданные и hard-stop лимиты для transcription/categorization (gate по `*_next_attempt_at` + max attempts) и BullMQ bounded retention + enqueue rollback (Redis OOM/noeviction); tests `voicebot_runtime/__tests__/common_jobs/processing_loop_retry_gating.test.js`, `voicebot_runtime/__tests__/processors/categorization_retry_gating.test.js`, `voicebot_runtime/__tests__/processors/questioning_enqueue_failure_rollback.test.js`, `voicebot_runtime/__tests__/bullmq_default_job_options_retention.test.js`.
- [v] Закрыты changelog-gap `copilot-st8` и `copilot-6of`: подтверждены Redis protection rails (history-only cleanup + trimEvents + never touch wait/active/delayed + REDIS_USERNAME in bull-board/diagnostics) и LLM cost controls (VOICEBOT_*_MODEL env knobs + model_not_found fallback + short-text skip guards); tests `voicebot_runtime/__tests__/services/redis_monitor_safety.test.js`, `voicebot_runtime/__tests__/services/redis_username_support.test.js`, `voicebot_runtime/__tests__/voice_jobs/categorize_model_env.test.js`, `voicebot_runtime/__tests__/postprocessing/create_tasks_model_fallback.test.js`.
- [v] Закрыты changelog-gap `copilot-5b2` и `copilot-g7i`: подтверждена актуальная session-management спецификация в `voicebot_runtime/plan/session-managment.md` (active-session/pageSessionId, TG команды `/start` `/session` `/done` `/login`, link normalization, порядок `New/Rec/Cut/Pause/Done`, strict no-fallback); test `voicebot_runtime/__tests__/plan/session_management_spec_smoke.test.js`.
- [v] Закрыты changelog-gap `copilot-w8b` и `copilot-9xw`: подтверждены backend attachment endpoints + persistence (message_type + attachments[] + session_attachments + /voicebot/message_attachment proxy + public direct_uri) и frontend Screenshort tab wiring (direct_uri primary, uri/url fallback); tests `backend/__tests__/smoke/voicebotAttachmentSmoke.test.ts`, `backend/__tests__/voicebot/sessionsRuntimeCompatibilityRoute.test.ts`, `app/__tests__/voice/screenshortDirectUri.test.ts`.
- [v] Закрыты changelog-gap `copilot-irv` и `copilot-0vc`: подтверждены TG formatting/session-resolution parity (4-line formatter + canonical links + strict active-session semantics) и retry controls/hard-stop behavior (attempt counters + next_attempt_at gating + max attempts markers + quota retry path); tests `backend/__tests__/voicebot/sessionTelegramMessage.test.ts`, `backend/__tests__/voicebot/tgCommandHandlers.test.ts`, `voicebot_runtime/__tests__/common_jobs/processing_loop_retry_gating.test.js`, `voicebot_runtime/__tests__/processors/categorization_retry_gating.test.js`.
- [v] Закрыты changelog-gap `copilot-4bp` и `copilot-5qu`: подтверждены queue retention + enqueue safety (bounded BullMQ retention + rollback is_processing on enqueue failure) и redis_monitor emergency cleanup rails (history-only clean + trimEvents, never touches wait/active/delayed); tests `voicebot_runtime/__tests__/bullmq_default_job_options_retention.test.js`, `voicebot_runtime/__tests__/voicebot/categorization_enqueue_failure.test.js`, `voicebot_runtime/__tests__/services/redis_monitor_safety.test.js`.
- [v] Закрыты changelog-gap `copilot-aaa` и `copilot-3em`: подтверждены cost-controls изменения (skip short/command categorization + bounded prompt sizes for CATEGORIZATION/TASK_CREATION) и документация env knobs/auto-reprocessing notes; tests `voicebot_runtime/__tests__/voicebot/categorization_cost_controls.test.js`, `voicebot_runtime/__tests__/prompts/prompt_length_cost_controls.test.js`, `voicebot_runtime/__tests__/docs/llm_cost_controls_docs_smoke.test.js`.
- [v] Закрыты changelog-gap `copilot-b6w` и `copilot-qkq`: подтверждены large upload UX parity (byte-level progress via axios onUploadProgress + MB counters, no forced multipart Content-Type) и edge/Nginx upload limits (client_max_body_size 700m + 600s timeouts for /api); tests `app/__tests__/voice/audioUploadProgress.test.ts`, `backend/__tests__/deploy/nginxUploadLimits.test.ts`.

### Тестовый чеклист T1-T18 (актуальный статус, `[v]` = подтверждено тестами)
- [x] T1 `POST /api/voicebot/active_session` без active -> `{active_session:null}`.
- [x] T2 `POST /api/voicebot/create_session` создает и активирует новую сессию.
- [x] T3 Socket `session_done` с чужой сессией -> `{ok:false,error:'forbidden'}`.
- [v] T4 `/voice/session` при active-session делает redirect на `/voice/session/:id` (Playwright).
- [v] T5 `/voice/session/:id` для runtime mismatch показывает явный error-screen, без infinite loader (Playwright + MCP Chrome).
- [x] T6 Разделение page `Done` vs FAB `Done` (pageSessionId vs activeSessionId).
- [x] T7 `New` всегда создает новую сессию и стартует запись.
- [x] T8 `Rec` на странице сессии активирует её и пишет туда.
- [x] T9 TG `/session` без аргумента возвращает только active или “не найдена”.
- [x] T10 TG `/session <id|url>` активирует при доступе.
- [x] T11 TG `/done` закрывает active и очищает mapping.
- [v] T12 TG `/login` отдает one-time tg_auth URL независимо от active-session.
- [x] T13 TG event message format = 4 строки (`event/url/session/project`).
- [x] T14 Runtime leakage check (dev/prod изоляция end-to-end).
- [x] T15 Upload в чужой runtime -> `409 runtime_mismatch`.
- [x] T16 `delete_transcript_chunk` синхронно обновляет transcription/categorization проекции.
- [x] T17 Playwright full lifecycle `/voice` (New/Rec/Cut/Pause/Done + attachments + log).
- [v] T18 MCP Chrome smoke на dev/prod (базовые `/voice` маршруты и network health).

## Общая информация
**Дата:** 5 февраля 2026  
**Автор:** AI Assistant  
**Цель:** Слияние backend из проекта voicebot в copilot (copilot остается финальным проектом)

**Ссылка на предыдущий план слияния:** [MEGING_PROJECTS_PLAN.md](/Users/tony_bit/Documents/strato-space/copilot/MEGING_PROJECTS_PLAN.md)

---

## Этап 1: Слияние бэкенда VoiceBot (текущий этап)

### Исходное состояние

#### voicebot-backend.js
- **Технологии:** Node.js CommonJS, Express
- **Порт:** BACKEND_PORT (из .env)
- **База данных:** MongoDB + Redis (BullMQ)
- **Основные функции:**
  - Авторизация (`/try_login`, `/auth_token`, JWT verification middleware)
  - CRM маршруты:
    - `/upload` - загрузка файлов
    - `/voicebot` - VoiceBot сессии, проекты, загрузка аудио
    - `/auth` - авторизация
    - `/permissions` - управление правами доступа
    - `/persons` - управление персонами
    - `/transcription` - транскрипция
    - `/crm` - CRM функции
    - `/LLMGate` - запуск произвольных промптов
  - Socket.IO для VoiceBot events (реал-тайм обновления сессий)
  - BullMQ Workers (EVENTS, NOTIFIES)
  - Google APIs (Drive, Sheets, Docs)
  - MCP Proxy (setupMCPProxy)
  - Статическая раздача `app/dist` (VoiceBot UI)
  - Permission Manager (RBAC)
  - Периодическое сканирование Google Drive папок проектов

- **BullMQ Очереди:**
  - `voicebot--common` - общие задачи
  - `voicebot--voice` - голосовые задачи
  - `voicebot--processors` - процессоры
  - `voicebot--postprocessors` - постпроцессоры
  - `voicebot--events` - события для Socket.IO
  - `voicebot--notifies` - уведомления

- **Зависимости (специфичные для VoiceBot):**
  - `ioredis`, `bullmq` - очереди
  - `google-auth-library`, `google-spreadsheet`, `googleapis` - Google APIs
  - `socket.io` - WebSocket
  - `jsonwebtoken`, `bcrypt` - авторизация
  - `dayjs` - работа с датами
  - `lodash` - утилиты
  - Permission system (`permissions/`)
  - MCP Proxy (`services/setupMCPProxy.js`)

#### Связанные библиотеки и модули
```
voicebot/
├── crm/
│   ├── routes/
│   │   ├── auth.js
│   │   ├── crm.js
│   │   ├── llmgate.js
│   │   ├── permissions.js
│   │   ├── persons.js
│   │   ├── transcription.js
│   │   ├── uploads.js
│   │   └── voicebot.js
│   └── controllers/
│       ├── audio_upload.js
│       ├── auth.js
│       ├── crm.js
│       ├── index.js
│       ├── llmgate.js
│       ├── permissions.js
│       ├── persons.js
│       ├── transcription.js
│       ├── upload.js
│       └── voicebot.js
├── services/
│   ├── mcpProxyClient.js
│   ├── mcpSessionManager.js
│   └── setupMCPProxy.js
├── permissions/
│   ├── permission-manager.js
│   └── permissions-config.js
├── utils/
│   └── ...
├── utils.js
├── constants.js
└── voicebot/               # Процессоры и промпты (НЕ ПЕРЕНОСИМ)
    ├── common_jobs/
    ├── custom_prompts/
    ├── postprocessing/
    ├── processors/
    ├── prompts/
    └── voice_jobs/
```

#### copilot/backend (текущее состояние после слияния с automation)
- **Технологии:** TypeScript ESM, Express
- **Порт:** 3002 (API_PORT)
- **Уже интегрировано:**
  - MongoDB + Redis
  - Winston логирование
  - Prometheus метрики
  - CRM маршруты из automation (`/api/crm/*`)
  - FinOps маршруты (`/api/fund`, `/api/plan-fact`)
  - Google APIs (Sheets, Drive)
  - Socket.IO (FinOps namespace)
  - Graceful shutdown

### Ключевые различия

| Аспект | voicebot-backend.js | copilot/backend |
|--------|---------------------|-----------------|
| Язык | CommonJS JavaScript | TypeScript ESM |
| API префикс | `/` (root) | `/api` |
| Auth middleware | JWT + whitelist paths | Cookie + AppError |
| Permission system | PermissionManager (RBAC) | Базовый (только auth) |
| Socket.IO events | VoiceBot sessions (subscribe/unsubscribe) | FinOps updates |
| BullMQ Workers | EVENTS, NOTIFIES (inline) | Нет inline workers |
| MCP Proxy | setupMCPProxy (Socket.IO) | Нет |
| Google Drive scanning | Периодическое (AsyncPolling) | Нет |

---

## Уточняющие вопросы для составления детального ТЗ

### 1. Архитектура и стратегия слияния

**Q1.1:** Какие маршруты из voicebot-backend переносить?
- [x] Все маршруты (`/upload`, `/voicebot`, `/auth`, `/permissions`, `/persons`, `/transcription`, `/crm`, `/LLMGate`)
- [ ] Только часть маршрутов (какие?)
- [ ] VoiceBot-специфичные (`/voicebot`, `/transcription`) исключить?

**Q1.2:** Как поступить с `/voicebot` маршрутами?
- [x] Перенести полностью под `/api/voicebot/*`
- [ ] Исключить из слияния (VoiceBot остаётся отдельным сервисом)
- [ ] Перенести только read-only endpoints (сессии, проекты)

**Q1.3:** Как поступить с `/LLMGate` (запуск произвольных промптов)?
- [x] Перенести под `/api/llmgate`
- [ ] Исключить (зависит от voicebot processors)
- [ ] Переосмыслить архитектуру

**Q1.4:** Как будет организован API?
- [x] Все под `/api/*` (текущий copilot стиль)
- [ ] VoiceBot под `/api/voicebot/*`, остальное под `/api/*`
- [ ] Другая структура?

---

### 2. Permission System (RBAC)

**Q2.1:** Система прав доступа в voicebot гораздо более развита чем в copilot. Стратегия?
- [x] Перенести PermissionManager целиком в copilot
- [x] Использовать базовую auth из copilot
- [ ] Объединить: базовая auth + расширенные permissions для VoiceBot endpoints
Ответ: нужно перенести PermissionManager для сохранения информации о правах и ролях
но сейчас надо упростить систему доступ - сделать ограничение для всего проекта copilot - оставить доступ только для ролей Super Admin и Administrator


**Q2.2:** Какие permission groups актуальны?
- `VOICEBOT_SESSIONS` (READ_OWN, UPDATE, PROCESS)
- `PROJECTS` (READ_ASSIGNED)
- Нужно ли всё это?
Ответ: переносим информацию о настройках/конфигурациях доступа но вешаем ограничение на доступ ко всему сервису copilot
---

### 3. Socket.IO Events

**Q3.1:** VoiceBot использует Socket.IO для real-time обновлений сессий:
- subscribe_on_session / unsubscribe_from_session
- session_done
- post_process_session
- create_tasks_from_chunks

Стратегия:
- [x] Добавить namespace `/voicebot` в существующий Socket.IO
- [ ] Создать отдельный Socket.IO сервер для VoiceBot
- [ ] Исключить VoiceBot Socket.IO events (оставить в отдельном сервисе)

**Q3.2:** BullMQ workers EVENTS и NOTIFIES встроены в voicebot-backend.js. Как поступить?
- [ ] Перенести inline workers в copilot backend
- [x] Вынести workers в отдельный сервис внутри copilot
- [ ] Оставить workers в voicebot (не переносить)

---

### 4. MCP Proxy

**Q4.1:** MCP Proxy (setupMCPProxy) используется для AI агентов через Socket.IO. Стратегия:
- [x] Перенести MCP Proxy в copilot backend
- [ ] Оставить MCP Proxy в voicebot (не переносить)
- [ ] Создать отдельный MCP сервис

---

### 5. Google Drive Scanning

**Q5.1:** Периодическое сканирование Google Drive папок проектов (scanProjectsDriveFolders):
- [ ] Перенести в copilot backend
- [ ] Вынести в отдельный worker сервис
- [x] Оставить в voicebot

---

### 6. База данных

**Q6.1:** VoiceBot использует те же коллекции MongoDB что и automation/copilot (см. constants.js). 
Добавляются специфичные коллекции:
- `VOICE_BOT_SESSIONS`
- `VOICE_BOT_MESSAGES`
- `VOICE_BOT_TOPICS`
- `ONE_USE_TOKENS`
- `PROMPTS_STATUSES`
- `AGENTS_STATUSES`
- `AGENTS_RUN_RESULTS`

Стратегия:
- [x] Объединить constants.js - добавить новые коллекции
- [ ] Раздельные constants для VoiceBot и CRM

**Q6.2:** Redis используется для BullMQ очередей с suffix на основе VOICE_BOT_IS_BETA:
- [x] Сохранить логику suffix (для dev/prod изоляции)
- [ ] Упростить (без suffix)

---

### 7. Авторизация

**Q7.1:** VoiceBot имеет два метода авторизации:
- `/try_login` - логин/пароль (bcrypt)
- `/auth_token` - одноразовый токен из Telegram

Copilot использует:
- `/api/try_login` - proxy к Voicebot API

Стратегия:
- [ ] Использовать auth из voicebot (полный функционал)
- [x] Объединить: copilot auth + one-time token из voicebot
- [ ] Оставить proxy к внешнему Voicebot API

---

### 8. Зависимости от voicebot-tgbot.js

**Q8.1:** Некоторые функции voicebot-backend.js вызываются из voicebot-tgbot.js (processing loop, session creation). 
Как это влияет на слияние?
- [ ] Backend полностью независим, tgbot остаётся отдельным
- [x] Нужно проверить точки интеграции
Ответ: tgbot будем переносить на последующих этапах, добавь подробные заглушки/комментарии в код чтобы потом было проще добавить сервис tgbot
---

### 9. Что НЕ переносить

**Q9.1:** Подтвердите список того, что НЕ переносится:
- [x] `voicebot/` директория (processors, prompts, jobs) - обрабатываются в voicebot-tgbot.js
- [x] voicebot-tgbot.js
- [ ] agents/ директория (fast-agent)
- [x] echo-tgbot.js
- [x] voicebot-queue-monitor.js
Дополнение к ответу: agents/ ОБЯЗАТЕЛЬНО НУЖНО перенести
---

### 10. Deployment

**Q10.1:** После слияния, как будут работать сервисы?
- [x] Один copilot-backend с VoiceBot функционалом
- [ ] copilot-backend + voicebot-tgbot (отдельно)
- [ ] copilot-backend + voicebot-backend (оба работают)

**Q10.2:** Фронтенд VoiceBot (app/):
- [x] Будет следующим этапом слияния фронтендов
- [ ] Остаётся отдельным
- [ ] Раздаётся из copilot-backend

---

## Итоговые решения (на основе ответов)

### Стек технологий
| Аспект | Решение |
|--------|---------|
| Язык | TypeScript ESM (copilot стиль) |
| API префикс | Все под `/api/*` |
| Порт | 3002 (API_PORT) |
| База данных | Одно подключение MongoDB, добавить VoiceBot коллекции |
| Redis/BullMQ | Сохранить логику suffix для dev/prod изоляции |
| Socket.IO | Один сервер с namespace `/voicebot` для VoiceBot events |
| Auth | Объединить copilot auth + one-time token из voicebot |
| Permission | Перенести PermissionManager, но ограничить доступ ролями Super Admin / Administrator |
| MCP Proxy | Перенести в copilot backend |
| BullMQ Workers | Вынести в отдельный сервис внутри copilot |
| PM2 | Единый сервис `copilot-backend` |

### Что включается в слияние
- ✅ Все маршруты из voicebot (`/upload`, `/voicebot`, `/auth`, `/permissions`, `/persons`, `/transcription`, `/crm`, `/LLMGate`)
- ✅ PermissionManager (с упрощенным доступом — только Super Admin / Administrator)
- ✅ Socket.IO events для VoiceBot (namespace `/voicebot`)
- ✅ MCP Proxy (services/setupMCPProxy.js → services/mcp/)
- ✅ One-time token авторизация (`/auth_token`)
- ✅ **agents/ директория** (fast-agent с AgentCards)
- ✅ VoiceBot коллекции в constants.ts
- ✅ Заглушки/TODO комментарии для будущей интеграции voicebot-tgbot

### Что НЕ включается в слияние
- ❌ `voicebot/` директория (processors, prompts, voice_jobs) — остаётся для voicebot-tgbot
- ❌ voicebot-tgbot.js (будет перенесён на следующем этапе)
- ❌ echo-tgbot.js
- ❌ voicebot-queue-monitor.js
- ❌ Периодическое сканирование Google Drive (scanProjectsDriveFolders) — остаётся в voicebot

### Следующие этапы (после слияния backend)
1. **Этап 2:** Слияние фронтендов (voicebot/app/ + copilot/app/)
2. **Этап 3:** Перенос voicebot-tgbot.js
3. **Этап 4:** Production деплой

---


## Финальная структура проекта

Актуализировано по состоянию на 2026-02-18. Ниже — целевая структура интеграции `voicebot -> copilot` по слоям.

### 1) Что из `voicebot` идет в API (`copilot/backend/src/api/routes/voicebot/*`)

| Source (`/home/strato-space/voicebot`) | Target (`/home/strato-space/copilot`) | Статус |
|---|---|---|
| `crm/routes/voicebot.js` + `crm/controllers/voicebot.js` (session/read/write, active-session, edit/delete/rollback, retry/resend, attachments) | `backend/src/api/routes/voicebot/sessions.ts` | in progress parity |
| `crm/routes/uploads.js` + `crm/controllers/audio_upload.js` | `backend/src/api/routes/voicebot/uploads.ts` | integrated |
| `crm/routes/transcription.js` + `crm/controllers/transcription.js` | `backend/src/api/routes/voicebot/transcription.ts` | integrated |
| `crm/routes/persons.js` + `crm/controllers/persons.js` | `backend/src/api/routes/voicebot/persons.ts` | integrated |
| `crm/routes/permissions.js` + `crm/controllers/permissions.js` | `backend/src/api/routes/voicebot/permissions.ts` | integrated |
| `crm/routes/llmgate.js` + `crm/controllers/llmgate.js` | `backend/src/api/routes/voicebot/llmgate.ts` | integrated |
| flat + legacy alias mounting | `backend/src/api/routes/voicebot/index.ts` | integrated |

### 2) Что из `voicebot` идет в middleware/services

| Source (`/home/strato-space/voicebot`) | Target (`/home/strato-space/copilot`) | Назначение | Статус |
|---|---|---|---|
| `permissions/permission-manager.js` | `backend/src/permissions/permission-manager.ts` | RBAC/ACL checks | integrated |
| auth/session guards в `voicebot-backend.js` | `backend/src/api/middleware/auth.ts`, `backend/src/api/middleware/roleGuard.ts` | performer auth + admin gate | integrated |
| runtime isolation (`constants.js`, `services/runtimeScope.js`) | `backend/src/constants.ts`, `backend/src/services/runtimeScope.ts`, `backend/src/services/db.ts` | prod/dev data isolation | integrated (ongoing extension) |
| socket auth/access helpers | `backend/src/services/session-socket-auth.ts` + `backend/src/api/socket/voicebot.ts` | explicit `session_done`, authz | integrated |
| timeline/object-locator/session-log helpers | `backend/src/services/transcriptionTimeline.ts`, `backend/src/services/voicebotObjectLocator.ts`, `backend/src/services/voicebotSessionLog.ts`, `backend/src/services/voicebotOid.ts` | edit/rollback and transcript consistency | integrated |

### 3) Куда попадает front (`voicebot/app` -> `copilot/app/src/pages/voice/*`)

| Source (`/home/strato-space/voicebot/app`) | Target (`/home/strato-space/copilot/app`) | Статус |
|---|---|---|
| `pages/SessionPage.jsx`, `pages/SessionsListPage.jsx`, resolver behavior | `src/pages/voice/SessionPage.tsx`, `src/pages/voice/SessionsListPage.tsx`, `src/pages/voice/SessionResolverPage.tsx` | in progress parity |
| store `store/voiceBot.js` | `src/store/voiceBotStore.ts` | in progress parity |
| components: `MeetingCard`, `Transcription`, `Categorization`, `SessionStatusWidget`, `SessionLog`, `Screenshort` | `src/components/voice/*` | in progress parity |
| voice shell routing/layout | `src/pages/VoiceLayout.tsx`, `src/App.tsx` | integrated |

### 4) WebRTC components integration (где подключено в copilot)

| Source | Target in Copilot | Назначение |
|---|---|---|
| `/home/strato-space/webrtc/src/webrtc-voicebot-lib.js` | `app/public/webrtc/webrtc-voicebot-lib.js` | Runtime FAB/WebRTC logic |
| `/home/strato-space/webrtc/src/components/*` | `app/public/webrtc/components/*` | Static FAB dependencies |
| `/home/strato-space/webrtc/src/settings.html` + `monitoring.html` | `app/public/webrtc/settings.html`, `app/public/webrtc/monitoring.html` | Settings/monitoring UI |
| Copilot loader | `app/src/components/voice/WebrtcFabLoader.tsx` | Dynamic script injection |
| Env binding | `app/.env.development`, `app/.env.production`, `app/.env.localhost` (`VITE_WEBRTC_VOICEBOT_SCRIPT_URL=/webrtc/webrtc-voicebot-lib.js`) | Same-origin runtime URL |
| Mount point | `app/src/pages/VoiceLayout.tsx` | FAB loader activation for `/voice/*` |

### 5) Runtime isolation rule (применяется ко всем voice-путям)
- runtime-scoped collections читаются/пишутся через `runtime_tag` фильтры.
- prod читает `runtime_tag=prod` + legacy without tag.
- non-prod читает строго свой runtime tag.
- mutating runtime mismatch -> `404`/`409` по контракту API.


## Детальное ТЗ на слияние

### Фаза 1: Подготовка инфраструктуры

#### 1.1 Обновление constants.ts
```
Файл: backend/src/constants.ts
Задача: Добавить VoiceBot-специфичные константы из voicebot/constants.js

Добавить:
- voice_bot_queues (COMMON, VOICE, PROCESSORS, POSTPROCESSORS, EVENTS, NOTIFIES)
- voice_bot_jobs (common, voice, postprocessing, events, notifies)
- voice_bot_session_types, voice_bot_session_source, voice_bot_session_access
- voice_bot_processors
- voice_message_sources
- file_storage
- Новые коллекции:
  - VOICE_BOT_SESSIONS
  - VOICE_BOT_MESSAGES
  - VOICE_BOT_TOPICS
  - ONE_USE_TOKENS
  - PROMPTS_STATUSES
  - AGENTS_STATUSES
  - AGENTS_RUN_RESULTS
  - PERSONS
  - TG_VOICE_SESSIONS
- mcp_events
- socket_config (обновить CORS_ORIGIN)
- Логика VOICE_BOT_IS_BETA suffix для очередей
```

#### 1.2 Permission System
```
Файлы: 
  - backend/src/permissions/permission-manager.ts
  - backend/src/permissions/permissions-config.ts
  - backend/src/api/middleware/permissions.ts
  - backend/src/api/middleware/roleGuard.ts

Задача: Перенести PermissionManager из voicebot/permissions/

Особенности:
- Конвертировать JS → TS
- Добавить roleGuard middleware для ограничения доступа (Super Admin, Administrator)
- Сохранить полную конфигурацию прав для будущего использования
```

#### 1.3 MCP Proxy
```
Файлы:
  - backend/src/services/mcp/index.ts
  - backend/src/services/mcp/proxyClient.ts
  - backend/src/services/mcp/sessionManager.ts

Задача: Перенести MCP Proxy из voicebot/services/

Источники:
  - voicebot/services/setupMCPProxy.js → mcp/index.ts
  - voicebot/services/mcpProxyClient.js → mcp/proxyClient.ts
  - voicebot/services/mcpSessionManager.js → mcp/sessionManager.ts

Конвертация JS → TS
```

### Фаза 2: Миграция маршрутов VoiceBot

#### 2.1 VoiceBot Routes
```
Источник: voicebot/crm/routes/*.js + voicebot/crm/controllers/*.js
Назначение: backend/src/api/routes/voicebot/*.ts

Порядок миграции:
1. voicebot.js → voicebot/sessions.ts (сессии, проекты, загрузка аудио)
2. transcription.js → voicebot/transcription.ts
3. persons.js → voicebot/persons.ts
4. permissions.js → voicebot/permissions.ts (API для управления правами)
5. llmgate.js → voicebot/llmgate.ts
6. uploads.js → voicebot/uploads.ts
7. auth.js → обновить существующий auth.ts (добавить one-time token)
8. crm.js → объединить с существующим crm/
```

#### 2.2 Шаблон конвертации с PermissionManager
```typescript
// Было (CommonJS + PermissionManager):
const express = require('express');
const router = express.Router();
const PermissionManager = require('../../permissions/permission-manager');
const { PERMISSIONS } = require('../../permissions/permissions-config');

router.post('/session',
    PermissionManager.requirePermission([PERMISSIONS.VOICEBOT_SESSIONS.READ_OWN]),
    controller.voicebot.session
);
module.exports = router;

// Стало (TypeScript ESM + roleGuard):
import { Router, type Request, type Response } from 'express';
import { requireRole } from '../../middleware/roleGuard.js';
import { requirePermission } from '../../middleware/permissions.js';
import { PERMISSIONS } from '../../permissions/permissions-config.js';

const router = Router();

// Ограничение доступа: только Super Admin / Administrator
router.use(requireRole(['SUPER_ADMIN', 'ADMINISTRATOR']));

router.post('/session',
    requirePermission([PERMISSIONS.VOICEBOT_SESSIONS.READ_OWN]),
    async (req: Request, res: Response) => { ... }
);

export default router;
```

### Фаза 3: Socket.IO VoiceBot Events

#### 3.1 VoiceBot Socket Namespace
```
Файл: backend/src/api/socket/voicebot.ts

Задача: Создать namespace /voicebot для VoiceBot events

События:
- subscribe_on_session / unsubscribe_from_session
- session_done
- post_process_session
- create_tasks_from_chunks

Из voicebot-backend.js:
- socketSessionMap (socket.id → Set of session_ids)
- sessionSocketMap (session_id → Set of socket ids)

Добавить TODO комментарии для интеграции с voicebot-tgbot
```

#### 3.2 Обновление Socket.IO setup
```
Файл: backend/src/api/socket/index.ts

Задача: Добавить namespace /voicebot

import { registerVoicebotSocketHandlers } from './voicebot.js';

// В registerSocketHandlers:
const voicebotNs = io.of('/voicebot');
registerVoicebotSocketHandlers(voicebotNs, db, queues, logger);
```

### Фаза 4: BullMQ Workers

#### 4.1 Workers как отдельный сервис
```
Файлы:
  - backend/src/workers/index.ts     # Entry point
  - backend/src/workers/events.ts    # EVENTS worker
  - backend/src/workers/notifies.ts  # NOTIFIES worker

Задача: Вынести BullMQ workers из voicebot-backend.js

EVENTS worker: отправляет события в Socket.IO
NOTIFIES worker: отправляет уведомления на внешний URL

Добавить:
- npm script: "workers": "tsx src/workers/index.ts"
- PM2 сервис: copilot-workers (отдельно от copilot-backend)

TODO: Добавить заглушки для интеграции с voicebot-tgbot
```

### Фаза 5: Auth с One-Time Token

#### 5.1 Обновление Auth
```
Файл: backend/src/api/routes/auth.ts

Добавить:
- POST /api/auth_token — авторизация по одноразовому токену из Telegram

Логика из voicebot-backend.js:
- Проверка токена в коллекции ONE_USE_TOKENS
- Проверка срока действия (24 часа)
- Пометка токена как использованного
- Генерация JWT
```

### Фаза 6: Перенос agents/

#### 6.1 Fast-Agent
```
Источник: voicebot/agents/
Назначение: copilot/agents/

Перенести:
- agent-cards/ (create_tasks.md, generate_session_title.md)
- fastagent.config.yaml
- fastagent.secrets.yaml.example
- ecosystem.config.cjs
- pm2-agents.sh
- pyproject.toml
- fastagent.secrets.yaml (содержит секреты поэтому добавить в .gitignore)


Не переносить:
- .venv/ (создаётся локально)
- logs/ (создаётся автоматически)
```

### Фаза 7: Обновление index.ts

#### 7.1 Главный Entry Point
```
Файл: backend/src/index.ts

Обновить:
- Подключить voicebot роутер: app.use('/api/voicebot', voicebotRouter)
- Подключить MCP Proxy: setupMCPProxy(io, config, logger)
- Подключить PermissionManager
- Добавить roleGuard middleware перед всеми /api/* роутами
- Обновить graceful shutdown (MCP Proxy cleanup)
- Добавить TODO комментарии для voicebot-tgbot интеграции
```

---

## Чеклист задач (архив от 2026-02-05)

### Инфраструктура
- [x] Обновить `backend/src/constants.ts` (VoiceBot константы, коллекции, очереди)
- [x] Создать `backend/src/permissions/permission-manager.ts`
- [x] Создать `backend/src/permissions/permissions-config.ts`
- [x] Создать `backend/src/permissions/types.ts`
- [x] Создать `backend/src/permissions/roles.ts`
- [x] Создать `backend/src/api/middleware/roleGuard.ts`
- [x] Создать `backend/src/api/middleware/auth.ts` (VoiceBot auth middleware)

### MCP Proxy
- [x] Создать `backend/src/services/mcp/index.ts` (stub - requires @modelcontextprotocol/sdk)
- [x] Создать `backend/src/services/mcp/proxyClient.ts` (stub)
- [x] Создать `backend/src/services/mcp/sessionManager.ts` (stub)

### VoiceBot Routes (конвертация JS → TS)
- [x] `voicebot.js` → `api/routes/voicebot/sessions.ts`
- [x] `transcription.js` → `api/routes/voicebot/transcription.ts`
- [x] `persons.js` → `api/routes/voicebot/persons.ts`
- [x] `permissions.js` → `api/routes/voicebot/permissions.ts`
- [x] `llmgate.js` → `api/routes/voicebot/llmgate.ts` (stub - requires openai package)
- [x] `uploads.js` → `api/routes/voicebot/uploads.ts`
- [x] Создать `api/routes/voicebot/index.ts` (router hub)

### Controllers (конвертация JS → TS)
- [x] `voicebot.js` → логика в sessions.ts
- [x] `transcription.js` → логика в transcription.ts
- [x] `persons.js` → логика в persons.ts
- [x] `permissions.js` → логика в permissions.ts
- [x] `llmgate.js` → логика в llmgate.ts
- [x] `audio_upload.js` → логика в uploads.ts
- [x] `upload.js` → логика в uploads.ts

### Socket.IO
- [x] Создать `backend/src/api/socket/voicebot.ts`
- [x] Обновить `backend/src/api/socket.ts` (добавить /voicebot namespace)

### BullMQ Workers
- [x] Создать `backend/src/workers/README.md` (documentation)
- [x] Создать `backend/src/services/queue.ts.example` (example setup)
- [ ] Создать `backend/src/workers/index.ts` (отложено - отдельный сервис)
- [ ] Создать `backend/src/workers/events.ts` (отложено - отдельный сервис)
- [ ] Создать `backend/src/workers/notifies.ts` (отложено - отдельный сервис)
- [ ] Добавить npm script "workers"
- [ ] Добавить PM2 конфиг для workers

### Auth
- [x] Обновить `backend/src/api/routes/auth.ts` (добавить /auth_token) ✅

### Agents
- [x] Создать `agents/README.md` (полная документация)
- [x] Перенести `agent-cards/create_tasks.md`
- [x] Перенести `agent-cards/generate_session_title.md`
- [x] Перенести `fastagent.config.yaml`
- [x] Перенести `fastagent.secrets.yaml.example`
- [x] Перенести `ecosystem.config.cjs` (порт 8722)
- [x] Перенести `pm2-agents.sh`
- [x] Перенести `pyproject.toml`
- [x] Перенести `docker-compose.yaml` (Jaeger tracing)
- [x] Добавить agents в `.gitignore`

### Main Entry Point
- [x] Обновить `backend/src/index.ts`:
  - [x] Подключить voicebot роутер
  - [x] Socket.IO voicebot namespace интегрирован
  - [ ] Подключить MCP Proxy (требует @modelcontextprotocol/sdk)
  - [x] roleGuard интегрирован через voicebot routes
  - [ ] Обновить graceful shutdown (MCP Proxy cleanup)
  - [x] TODO комментарии добавлены

### Зависимости
- [x] Обновить `backend/package.json`:
  - [x] Добавить: `jsonwebtoken` (для полной JWT верификации)
  - [x] Добавить: `openai` (для LLMGate)
  - [x] Добавить: `@modelcontextprotocol/sdk` (для MCP Proxy)
  - [x] Добавить: `uuid` (для MCP session IDs)
  - [x] Добавить devDependencies: `@types/jsonwebtoken`, `@types/uuid`

### Документация
- [x] Обновить `copilot/AGENTS.md` (добавлена секция VoiceBot)
- [x] Обновить `backend/.env.example` (добавлены VoiceBot env vars)
- [ ] Обновить `copilot/README.md`

### Тестирование
- [x] TypeScript build успешен
- [x] Сервер запускается и регистрирует /voicebot namespace
- [x] Зависимости установлены и импортируются корректно
- [x] Запустить backend в dev режиме (MongoDB/Redis подключены)
- [x] Проверить `/api/health` → 200 OK
- [x] Проверить authMiddleware (401 без токена, 401 с invalid token)
- [x] Проверить `/api/try_login` → 200 OK (SUPER_ADMIN логин успешен)
- [x] Проверить Socket.IO transport → работает (sid получен)
- [x] Проверить Socket.IO namespace `/voicebot` → работает (sid получен)
- [x] Проверить roleGuard → работает (SUPER_ADMIN имеет доступ к VoiceBot endpoints)
- [x] Проверить VoiceBot endpoints с авторизацией:
  - [x] `POST /api/voicebot/sessions/list` → 854 сессии получены
  - [x] `POST /api/voicebot/sessions/get` → полная сессия с messages и processors_data
  - [x] `POST /api/voicebot/persons/list` → персоны получены
  - [x] `POST /api/voicebot/permissions/users` → 14 пользователей с ролями и permissions
  - [x] `POST /api/voicebot/LLMGate/run_prompt` → работает (требует OPENAI_API_KEY)
- [ ] Проверить MCP Proxy — требует MCP server
- [ ] Проверить workers (EVENTS, NOTIFIES) — требует BullMQ jobs

---

## Env переменные (добавить в .env.example)

```bash
# VoiceBot
VOICE_BOT_IS_BETA=          # Suffix для очередей (beta/gamma/false)
VOICE_BOT_NOTIFIES_URL=     # URL для уведомлений
VOICE_BOT_NOTIFIES_BEARER_TOKEN=  # Bearer token для уведомлений

# MCP Proxy
MCP_SESSION_TIMEOUT=1800000  # 30 минут
MCP_CLEANUP_INTERVAL=300000  # 5 минут

# Auth
APP_ENCRYPTION_KEY=          # JWT secret key
```

---

## Риски и митигация

| Риск | Вероятность | Митигация |
|------|-------------|-----------|
| Ошибки при конвертации JS→TS | Высокая | Пошаговая миграция, проверка каждого route |
| Конфликт PermissionManager с существующей auth | Средняя | Сначала roleGuard, потом детальные permissions |
| Socket.IO namespace конфликты | Низкая | Тестирование обоих namespaces |
| MCP Proxy зависимости | Средняя | Проверка @modelcontextprotocol/sdk |
| Workers зависят от voicebot-tgbot | Высокая | TODO комментарии, заглушки |

---

## Статус

- [x] Анализ voicebot-backend.js
- [x] Анализ связанных модулей
- [x] Вопросы составлены
- [x] Ответы получены
- [x] ТЗ составлено
- [x] Разработка начата
- [x] Фаза 1: Инфраструктура ✅
- [x] Фаза 2: VoiceBot Routes ✅
- [x] Фаза 3: Socket.IO ✅
- [x] Фаза 4: Workers (документация и примеры) ✅
- [x] Фаза 5: Auth (one-time token) ✅
- [x] Фаза 6: Agents (полный перенос) ✅
- [x] Фаза 7: Entry Point ✅
- [x] TypeScript Build ✅
- [x] Jest тесты (118 тестов) ✅
- [ ] Production деплой

---

## Созданные файлы (5 февраля 2026)

### Permissions
- `backend/src/permissions/permission-manager.ts` — PermissionManager (TypeScript port)
- `backend/src/permissions/permissions-config.ts` — Конфигурация прав доступа
- `backend/src/permissions/types.ts` — Типы Permission, RoleConfig, Performer
- `backend/src/permissions/roles.ts` — Определения ролей

### Middleware
- `backend/src/api/middleware/auth.ts` — Auth middleware для VoiceBot (cookie + VOICEBOT_API_URL)
- `backend/src/api/middleware/roleGuard.ts` — Ограничение доступа по ролям

### VoiceBot Routes
- `backend/src/api/routes/voicebot/index.ts` — Routes hub с auth + admin guard
- `backend/src/api/routes/voicebot/sessions.ts` — Session CRUD, CRM интеграция (~650 lines)
- `backend/src/api/routes/voicebot/transcription.ts` — Транскрипция
- `backend/src/api/routes/voicebot/persons.ts` — Управление персонами
- `backend/src/api/routes/voicebot/permissions.ts` — API управления правами
- `backend/src/api/routes/voicebot/llmgate.ts` — Stub (требует openai package)
- `backend/src/api/routes/voicebot/uploads.ts` — Загрузка аудио файлов

### Socket.IO
- `backend/src/api/socket/voicebot.ts` — Namespace /voicebot для real-time updates

### MCP Proxy
- `backend/src/services/mcp/index.ts` — Stub setup
- `backend/src/services/mcp/proxyClient.ts` — Stub client
- `backend/src/services/mcp/sessionManager.ts` — Stub session manager

### Workers & Agents
- `backend/src/workers/README.md` — Документация (workers как отдельный сервис)
- `backend/src/services/queue.ts.example` — Пример BullMQ setup
- `backend/src/agents/README.md` — Документация (agents как отдельный Python сервис)

### Обновлённые файлы
- `backend/src/constants.ts` — Добавлены VOICEBOT_COLLECTIONS, VOICE_BOT_QUEUES, и др.
- `backend/src/api/socket.ts` — Интегрирован registerVoicebotSocketHandlers
- `backend/src/index.ts` — Подключен voicebotRouter
- `AGENTS.md` — Добавлена секция VoiceBot

### Agents (перенесено 6 февраля 2026)
- `agents/README.md` — Полная документация
- `agents/agent-cards/create_tasks.md` — AgentCard для извлечения задач
- `agents/agent-cards/generate_session_title.md` — AgentCard для генерации заголовков
- `agents/fastagent.config.yaml` — Конфигурация Fast-Agent + MCP серверы
- `agents/fastagent.secrets.yaml.example` — Шаблон секретов
- `agents/ecosystem.config.cjs` — PM2 конфигурация (порт 8722)
- `agents/pm2-agents.sh` — Скрипт управления PM2
- `agents/pyproject.toml` — Python проект
- `agents/docker-compose.yaml` — Jaeger tracing

### Auth с One-Time Token (6 февраля 2026)
- `backend/src/api/routes/auth.ts` — Добавлен POST /auth_token endpoint для авторизации через Telegram

### Jest тесты (6 февраля 2026)
- `backend/__tests__/voicebot/sessions.test.ts` — Тесты Sessions API
- `backend/__tests__/voicebot/permissions.test.ts` — Тесты Permissions API
- `backend/__tests__/voicebot/persons.test.ts` — Тесты Persons API
- `backend/__tests__/voicebot/transcription.test.ts` — Тесты Transcription API
- `backend/__tests__/voicebot/llmgate.test.ts` — Тесты LLMGate API
- `backend/__tests__/api/health.test.ts` — Тесты Health endpoint
- `backend/__tests__/api/auth.test.ts` — Тесты Auth middleware + One-Time Token (8 новых тестов)

---

## Следующие шаги

### Для полной функциональности необходимо:

1. ~~**Установить зависимости:**~~ ✅ Выполнено
   ```bash
   npm install jsonwebtoken openai @modelcontextprotocol/sdk uuid
   npm install -D @types/jsonwebtoken @types/uuid
   ```

2. **Настроить environment:**
   ```bash
   # .env
   VOICEBOT_API_URL=https://voice.stratospace.fun
   APP_ENCRYPTION_KEY=your-secret-key
   MCP_SERVER_URL=http://localhost:3001
   ```

3. ~~**Протестировать endpoints:**~~ ✅ Выполнено
   - `POST /api/voicebot/sessions/list` — список сессий
   - `POST /api/voicebot/sessions/get` — детали сессии
   - `POST /api/voicebot/LLMGate/run_prompt` — запуск промптов

4. **Развернуть workers (если нужно):**
   - Переименовать `queue.ts.example` → `queue.ts`
   - Создать workers entry point
   - Запустить как отдельный PM2 сервис

5. **Развернуть agents:**
   ```bash
   cd agents
   uv venv && uv pip install -e .
   cp fastagent.secrets.yaml.example fastagent.secrets.yaml
   # Настроить API ключи в fastagent.secrets.yaml
   ./pm2-agents.sh start
   ```
