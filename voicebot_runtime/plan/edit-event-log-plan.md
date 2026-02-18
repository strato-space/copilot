# Спека v5.2: Single Stored ID (`_id`) + Virtual Prefixed `oid`

## Summary
Фиксируем архитектуру для `/home/strato-space/voicebot`:
- для top-level документов единственный хранимый идентификатор: `_id: ObjectId`;
- `oid` используется только как внешний alias на API-границе и вычисляется детерминированно;
- top-level поля `oid` в БД не храним;
- для embedded-сегментов `transcription.segments[]`, у которых нет собственного top-level `_id`, используем `segment_oid` (`ch_*`) и `object_locator`.

Это соответствует требованию "один id в базе" и сохраняет удобство префиксов для внешних интерфейсов.

Каноническая цепочка хранения транскрипции:
- `transcription_raw -> transcription (model-agnostic, стабильная)`.

## Product decisions (locked 2026-02-12)
- Приоритет релиза: сначала блок event-log + edit/delete/rollback, затем миграция diarization.
- Права на edit/delete: все авторизованные пользователи, у которых есть доступ к сессии.
- Семантика delete: из актуального представления сегмент удаляется, но полная история сохраняется в event log.
- После edit сегмента автоматически ставится retry категоризации для этого же `segment_oid` (`chunk_oid` legacy).
- UI v1: минимальная вкладка `Log` (хронология, diff, rollback/resend/retry + edit/delete сегментов).
- Поле `reason` опционально для user-инициированных действий: edit/delete/rollback/resend/retry (рекомендуется для аудита).
- Версии транскрипта хранятся на уровне объекта сессии; API сессии отдает конечный эффективный вариант со всеми примененными редактированиями.
- Миграция охватывает все исторические сообщения (полный backfill `segment_oid` и locator).
- Допускается maintenance окно с read-only режимом на время миграции.
- Критерий готовности к выпуску: все тесты green + dev smoke.

## Engineering principles (Marz-style)
- Immutable facts: исходные результаты pipeline-этапов не переписываются.
- Append-only journal: система записывает события, а не "стирает историю".
- Rebuildability: текущие представления должны пересчитываться из фактов + событий.
- Idempotency by design: повторы воркеров/хуков безопасны (idempotency key).
- Stage isolation: каждый этап пишет свой артефакт, не мутируя артефакт предыдущего.
- Audit and rollback: любые деструктивные UX-действия идут через журнал и компенсирующие события.

## Scope
- Репозиторий: `/home/strato-space/voicebot` только.
- Документ согласован по staged-подходу с `plan/gpt-4o-transcribe-diarize-plan.md`.
- Цели:
  - event log по сессиям;
  - edit/delete/rollback для `transcription.segments`;
  - графовая навигация между объектами;
  - единый id-источник истины в БД.

## ID Contract
### Stored identity (DB)
- Top-level объекты: только `_id: ObjectId`.
- Никаких дополнительных persistent `oid` на top-level.

### External identity (API/UI/links)
- `oid` вычисляется как: `prefix + "_" + _id.toHexString()`.
- При входе в API:
  - если передан `oid`, он парсится в `prefix` и `hex24`,
  - `hex24` преобразуется в `ObjectId` и используется для DB-запроса по `_id`.

### Real examples from prod
- Session `_id`: `698c6bc84d8af0e866f832e3` -> `se_698c6bc84d8af0e866f832e3`
- Message `_id`: `698c6c494d8af0e866f832e5` -> `msg_698c6c494d8af0e866f832e5`
- User `_id`: `6863eab6a6d7b324e2df310a` -> `usr_6863eab6a6d7b324e2df310a`
- Project `_id`: `6729d23834e1aad47395f941` -> `prj_6729d23834e1aad47395f941`

## Prefix dictionary (initial)
- `se` -> session
- `msg` -> message
- `ch` -> transcript_segment (embedded object id in `transcription.segments[]`)
- `evt` -> event_log entry (derived in API output from event `_id`)
- `usr` -> user
- `prj` -> project
- `ntf` -> notify delivery
- `wh` -> webhook delivery
- `run` -> pipeline run

## Object Types Registry
Коллекция: `automation_object_types`.

Назначение: типизация и lookup-strategy, не хранение object-идентичности.

Поля:
- `prefix`
- `entity_type`
- `collection`
- `lookup_strategy`
- `path_template`

Пример:
```json
{
  "_id": "<generated>",
  "prefix": "msg",
  "entity_type": "voice_message",
  "collection": "automation_voice_bot_messages",
  "lookup_strategy": "direct_by_objectid",
  "path_template": "/messages/{oid}"
}
```

## `object_locator` (only for embedded/non-top-level objects)
Коллекция: `automation_object_locator`.

Используется только там, где объект не имеет собственного top-level `_id`:
- `transcription.segments[]` в message-документах;
- потенциально другие embedded узлы.

Важно: в embedded-объекте внутри родительского массива поле идентичности называется `id`
и имеет значение вида `ch_<hex24>`. `object_locator.oid` хранит то же значение.

Поля:
- `_id: ObjectId`
- `oid: string` (unique) — например, `ch_<hex24>`
- `entity_type`
- `parent_collection`
- `parent_id: ObjectId`
- `parent_prefix`
- `path` (id-based path inside parent)
- `created_at`

Пример:
```json
{
  "_id": "<generated>",
  "oid": "ch_<generated_hex24>",
  "entity_type": "transcript_segment",
  "parent_collection": "automation_voice_bot_messages",
  "parent_id": "698c6c494d8af0e866f832e5",
  "parent_prefix": "msg",
  "path": "/transcription/segments[id=ch_<generated_hex24>]",
  "created_at": "2026-02-12T00:00:00.000Z"
}
```

## Performance model
- Top-level lookup by `oid`:
  1. parse `oid` -> `ObjectId`,
  2. query by `_id`.
  Это использует встроенный индекс `_id` и дает самый быстрый путь.

- Embedded lookup by `segment_oid` (legacy alias: `chunk_oid`):
  - сначала `automation_object_locator` (`IXSCAN` по `oid`),
  - затем точечный fetch parent по `_id`.

## Event Log model (updated)
Коллекция: `automation_voice_bot_session_log`.

Храним top-level ссылки только в `ObjectId`:
- `session_id: ObjectId`
- `message_id: ObjectId|null`
- `project_id: ObjectId|null`

`session_oid`, `message_oid`, `project_oid` вычисляются в API output (не хранятся).

### Fact vs view boundaries
- Fact layer (immutable):
  - `transcription_raw` (полный ответ ASR/diarize API),
  - `transcription` (model-agnostic canonical transcript, стабильный между моделями),
  - неизменяемые версии артефактов этапов (`transcript_version`, `categorization_version`).
- Event layer (append-only):
  - `automation_voice_bot_session_log` как журнал изменений/команд/результатов.
- View layer (rebuildable):
  - UI-поля (`transcription`, текущая категоризация, quick summaries) — материализованные представления.
- Правило: `categorization` не изменяет `transcription_raw` и не правит in-place исходную транскрипцию.
  Основной контракт для downstream-процессов — `transcription`; `transcription_raw` хранится для полной трассировки/диагностики.
- `transcription_chunks` не является каноническим хранилищем; допустим только как legacy read-adapter.

### Log document shape
```json
{
  "_id": "<generated>",
  "session_id": "698c6bc84d8af0e866f832e3",
  "message_id": "698c6c494d8af0e866f832e5",
  "project_id": "6729d23834e1aad47395f941",
  "event_name": "transcript_segment_edited",
  "event_group": "transcript",
  "status": "done",
  "event_time": "2026-02-12T05:31:00.000Z",
  "actor": {
    "kind": "user|service|worker|agent",
    "id": "usr_6863eab6a6d7b324e2df310a",
    "subid": null,
    "name": null,
    "subname": null
  },
  "target": {
    "entity_type": "transcript_segment",
    "entity_oid": "ch_<generated_hex24>",
    "path": "/messages/msg_698c6c494d8af0e866f832e5/transcription/segments[id=ch_<generated_hex24>]/text",
    "stage": "transcript"
  },
  "diff": {
    "op": "replace",
    "old_value": "text",
    "new_value": "text"
  },
  "source": {
    "channel": "web|telegram|api|drive|system",
    "transport": "web_ui|web_upload|telegram_bot_api|http_api|google_drive|internal_queue",
    "origin_ref": "string|null"
  },
  "action": {
    "type": "none|rollback|retry|resend",
    "available": true,
    "handler": "rollback_transcript_segment",
    "args": {},
    "idempotency_key": "string"
  },
  "reason": "string|null (optional; recommended for user-initiated mutations/actions)",
  "correlation_id": "string|null",
  "source_event_id": null,
  "is_replay": false,
  "event_version": 1,
  "metadata": {}
}
```

## Event naming / taxonomy
Каноника:
- только `lowercase snake_case`;
- домены: `session`, `message_ingest`, `transcript`, `categorization`, `notify_webhook`, `file_flow`, `system`.

### Event set (phase 1)
- `session_created`
- `session_renamed`
- `session_project_changed`
- `session_closed`
- `message_ingested_audio_web`
- `message_ingested_audio_telegram`
- `message_ingested_text_web`
- `message_ingested_text_api`
- `message_ingested_file_web`
- `message_ingested_file_telegram`
- `message_ingested_screenshot_web`
- `transcription_started`
- `transcription_completed`
- `transcription_failed`
- `categorization_started`
- `categorization_completed`
- `categorization_failed`
- `categorization_retried`
- `categorization_chunk_retry_enqueued`
- `categorization_chunk_retry_completed`
- `categorization_chunk_retry_failed`
- `transcript_segment_edited`
- `transcript_segment_deleted`
- `transcript_segment_restored`
- Legacy aliases for compatibility:
  - `transcript_chunk_edited`
  - `transcript_chunk_deleted`
  - `transcript_chunk_restored`
- `notify_enqueued`
- `notify_hook_started`
- `notify_http_sent`
- `notify_http_failed`
- `notify_resent`

## API contract
### Inputs (external)
- API принимает `*_oid` как внешний контракт:
  - `session_oid`
  - `message_oid`
  - `segment_oid` (legacy alias: `chunk_oid`)
  - `event_oid` (derived from event `_id`)

### Internal resolution
- Top-level `*_oid` -> `ObjectId` через parse, без отдельного lookup по полю `oid`.
- Embedded `segment_oid/chunk_oid` -> parent через `automation_object_locator`.

### Outputs
- Возвращаем оба представления:
  - `_id` (технический, ObjectId),
  - `oid` (вычисленный alias).

### Access policy (phase 1)
- Мутирующие действия (`edit/delete/rollback/resend/retry`) доступны всем авторизованным пользователям с доступом к сессии.
- В каждом таком событии обязательна запись инициатора:
  - `actor.kind=user`, `actor.id=<usr_...>` для пользователя,
  - `actor.kind=service|worker|agent`, `actor.id=<module_or_service_name>` для автоматизации.

### New routes
- `POST /voicebot/session_log`
  - input: `session_oid`, optional filters.
- `POST /voicebot/edit_transcript_chunk`
  - input: `session_oid`, `message_oid`, `segment_oid` (legacy: `chunk_oid`), `new_text`, optional `reason`.
- `POST /voicebot/delete_transcript_chunk`
  - input: `session_oid`, `message_oid`, `segment_oid` (legacy: `chunk_oid`), optional `reason`.
- `POST /voicebot/rollback_event`
  - input: `session_oid`, `event_oid`, optional `reason`.
- `POST /voicebot/resend_notify_event`
  - input: `session_oid`, `event_oid`, optional `reason`.
- `POST /voicebot/retry_categorization_event`
  - input: `session_oid`, `event_oid`, optional `reason`.
- `POST /voicebot/retry_categorization_chunk`
  - input: `session_oid`, `message_oid`, `segment_oid` (legacy: `chunk_oid`), optional `reason`.

### Mutation semantics (copy-on-write, chosen)
- `edit_transcript_chunk` и `delete_transcript_chunk` не должны destructively переписывать immutable source facts.
- Принятое решение для phase 1: только `copy-on-write` (новая версия transcript-артефакта с измененным segment).
- `overlay + materializer` в phase 1 не используется.
- Original transcription facts остаются доступными для audit/replay/rollback.
- Семантика `delete`: сегмент удаляется из effective transcript view (текущего состояния), но удаление полностью обратимо по event log.
- После успешного `edit_transcript_chunk` автоматически ставится retry категоризации для конкретного `segment_oid`.
- Внутри processor допускается fallback на full-message recategorization, если chunk-only режим временно недоступен; событие в логе все равно привязывается к конкретному `segment_oid`.

### UI scope (phase 1 / minimal)
- Вкладка `Log`: компактная хронология по `session_oid` с сортировкой по времени (ASC на сервере, reverse на клиенте допустим).
- Для событий edit/delete показываем diff (`old_value -> new_value`) и кнопку `Rollback`.
- Для webhook-событий показываем кнопку `Resend`.
- Для categorization-событий показываем кнопку `Retry`.
- In-place edit/delete сегментов доступны в UI и создают события (reason опционален).

## Real example (external payload format)
```json
{
  "event_name": "transcript_segment_edited",
  "session_oid": "se_698c6bc84d8af0e866f832e3",
  "message_oid": "msg_698c6c494d8af0e866f832e5",
  "project_oid": "prj_6729d23834e1aad47395f941",
  "actor": {
    "kind": "user",
    "id": "usr_6863eab6a6d7b324e2df310a",
    "subid": null,
    "name": null,
    "subname": null
  },
  "target": {
    "entity_type": "transcript_segment",
    "entity_oid": "ch_<generated_hex24>",
    "path": "/messages/msg_698c6c494d8af0e866f832e5/transcription/segments[id=ch_<generated_hex24>]/text",
    "stage": "transcript"
  },
  "reason": "fix_webRTC_noise"
}
```

## Migration plan (maintenance window)
1. Включить read-only режим.
2. Убедиться, что в top-level коллекциях нет persistent `oid` как обязательного контракта.
3. Добавить/обновить `automation_object_types`.
4. Для embedded segments (full backfill):
   - сгенерировать `segment_oid` (`ch_<hex24>`) для всех исторических элементов `transcription.segments[]`;
   - создать записи в `automation_object_locator`.
5. Для event log:
   - хранить `session_id/message_id/project_id` как `ObjectId`;
   - удалить/не использовать stored `session_oid/message_oid/project_oid` (если были).
6. Добавить индексы и выполнить валидацию explain-планов.
7. Снять read-only.
8. Зафиксировать baseline snapshot:
   - сохранить immutable transcription facts (`transcription_raw` + canonical `transcription`) для существующих сообщений;
   - обозначить policy, что дальнейшие stage outputs versioned и не мутируют предыдущее состояние.

## Indexes (mandatory)
### `automation_voice_bot_session_log`
- `{ session_id: 1, event_time: -1, _id: -1 }`
- `{ message_id: 1, event_time: -1 }`
- `{ event_name: 1, event_time: -1 }`
- `{ "action.available": 1, event_name: 1, event_time: -1 }`

### `automation_object_locator`
- `{ oid: 1 } unique`
- `{ parent_collection: 1, parent_id: 1 }`
- `{ entity_type: 1, parent_id: 1 }`

### Top-level collections
- Без `oid` индекса (так как top-level `oid` не хранится).

## Test cases and validation
- `oid -> _id` parser:
  - валидные/невалидные префиксы;
  - валидный/невалидный `hex24`;
  - mismatch prefix vs entity type.
- Top-level lookup:
  - `oid` резолвится в `_id`;
  - запрос идет по `_id` (проверка explain).
- Embedded segment lookup:
  - `segment_oid/chunk_oid` резолвится через `object_locator`;
  - parent message читается по `_id`.
- Edit/delete/rollback:
  - path всегда id-based, без index addressing.
  - edit/delete создают новое состояние через copy-on-write, не уничтожая baseline fact.
  - для edit/delete/rollback/resend/retry поле `reason` опционально (если передано, валидируется как string).
  - после edit создается событие retry категоризации для того же `segment_oid`.
- API responses:
  - содержат `_id` и вычисленный `oid`.
- Integrity checks:
  - отсутствие top-level persistent `oid` требований.
  - replay event log восстанавливает effective transcript view детерминированно.

## Definition of Done (phase 1)
- Unit + integration тесты green.
- Dev smoke пройден: edit/delete/rollback/resend/retry отрабатывают в UI `Log` и через API.

## Risks and mitigations
- Риск ошибки в parser `oid -> _id`:
  - mitigation: единая библиотека + unit tests + strict validation.
- Риск рассинхрона locator для embedded чанков:
  - mitigation: transactional update segment+locator, nightly consistency job.
- Риск роста locator:
  - mitigation: индекс по `oid`, архивирование для soft-deleted parents.

## Assumptions
- `_id` остается Mongo-native и не мигрируется в string.
- Для top-level объектов `oid` является вычисляемым alias, а не хранимым полем.
- Для embedded сегментов `segment_oid` (`ch_*`) хранится явно, так как у них нет собственного top-level `_id`.
