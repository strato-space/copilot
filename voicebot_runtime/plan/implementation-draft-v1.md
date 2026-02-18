# Draft Plan v1: запуск в реализацию (event-log -> diarization)

## Scope
- Репозиторий: `/home/strato-space/voicebot`.
- Базовые спецификации:
  - `plan/edit-event-log-plan.md`
  - `plan/gpt-4o-transcribe-diarize-plan.md`
  - `plan/edit-event-log-req.md`
  - `plan/spec-task-breakdown-v1.md` (deep WBS / executable task breakdown)

## Locked решения (2026-02-12)
- Сначала делаем event-log + edit/delete/rollback (приоритет 1), потом diarization (приоритет 2).
- Edit/delete доступны всем авторизованным пользователям с доступом к сессии.
- Delete удаляет сегмент из текущего состояния, но событие и diff остаются в логе.
- После edit запускается retry категоризации для конкретного `segment_oid`.
- UI v1: минимальный `Log` + in-place edit/delete + кнопки `Rollback`/`Resend`/`Retry`.
- Для edit/delete/rollback/resend/retry `reason` опционален (рекомендуется для аудита).
- Backfill делаем по всей истории.
- Допускается maintenance окно с read-only режимом.
- Готовность к dev rollout: тесты green + dev smoke.
- Default speaker display: `Спикер 1`, `Спикер 2`, ... для технических raw-лейблов.
- Transcript mutation strategy: только `copy-on-write` в v1 (без overlay materializer).
- Chunk-categorization retry: целевой режим chunk-only; временно допускается internal fallback на full-message recategorization.
- Transcript versions are stored on the session object; the session object returns the final effective transcript with all applied edits.

## План по этапам

### Этап 0. Фиксация контрактов (короткий)
**Цель:** перестать двигать требования в ходе кодинга.

Что делаем:
- Закрываем структуру event log (payload, actor, target, diff, action, reason).
- Закрываем API input/output для edit/delete/rollback/resend/retry.
- Закрываем policy для speaker display.

Критерий выхода:
- Спеки синхронизированы и не противоречат друг другу.

### Этап 1. Backend event-log + операции над чанками
**Цель:** получить рабочий серверный контур без UI-зависимости.

Что делаем:
- Коллекция `automation_voice_bot_session_log`.
- API:
  - `POST /voicebot/session_log`
  - `POST /voicebot/edit_transcript_chunk`
  - `POST /voicebot/delete_transcript_chunk`
  - `POST /voicebot/rollback_event`
- `POST /voicebot/resend_notify_event`
- `POST /voicebot/retry_categorization_event`
- `POST /voicebot/retry_categorization_chunk`
- `reason` опционален для mutating/action endpoint (если присутствует, сохраняем в журнал).
- Запись `actor` и `target.path` в id-based формате.
- После edit: автоматический enqueue retry категоризации по конкретному `segment_oid`.

Критерий выхода:
- API работает стабильно, все операции пишут события в log.

### Этап 2. UI v1 (минимальный)
**Цель:** дать оператору рабочие кнопки и прозрачную историю.

Что делаем:
- Вкладка `Log` (хронология, компактное отображение).
- Для edit/delete: diff + `Rollback`.
- Для notify/webhook: `Resend`.
- Для categorization: `Retry`.
- In-place edit/delete чанков (reason опционален).

Критерий выхода:
- Полный пользовательский сценарий проходит из UI без ручных DB-операций.

### Этап 3. Миграция и backfill (вся история)
**Цель:** привести старые данные к новому контракту.

Что делаем:
- Full backfill `segment_oid (ch_*)` для всех исторических `transcription.segments[]`.
- Заполнение `automation_object_locator`.
- Индексы для `session_log` и `object_locator`.
- Верификация explain plan и consistency checks.

Критерий выхода:
- Исторические и новые данные читаются единообразно через новые API.

### Этап 4. Доработка транскрибации (diarization)
**Цель:** включить `gpt-4o-transcribe-diarize` после готовности event-log.

Что делаем:
- `transcription_raw -> transcription` как immutable chain.
- Fallback на `whisper-1`.
- Speaker display policy в UI:
  - raw метка хранится,
  - отображение нормализуется в `Спикер N` для технических labels.

Критерий выхода:
- Данные diarization стабильно пишутся и корректно отображаются в UI.

### Этап 5. Тесты и dev smoke
**Цель:** подтвердить, что можно безопасно двигаться дальше.

Что делаем:
- Unit тесты: `oid` parser, diff/rollback logic, speaker mapping.
- Integration: edit/delete/rollback/resend/retry + chunk-level categorization retry.
- Dev smoke: реальный аудио-кейс + проверка UI `Log`.

Критерий выхода:
- Все тесты green, smoke green.

## Go/No-Go перед реализацией в prod
- `YES`, если:
  - тесты green;
  - dev smoke green;
  - миграция проверена на полном historical sample.
- `NO`, если:
  - есть расхождение между event-log и transcription view;
  - rollback не восстанавливает состояние детерминированно;
  - retry/resend не идемпотентны.

## Риски и простой контроль
- Риск: рост сложности из-за двух параллельных блоков.
  - Контроль: строгий порядок этапов (сначала event-log, потом diarization).
- Риск: долгий backfill.
  - Контроль: maintenance окно + поэтапная валидация индексов.
- Риск: путаница speaker labels.
  - Контроль: единый deterministic mapping на UI.
