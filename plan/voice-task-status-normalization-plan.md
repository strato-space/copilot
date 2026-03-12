# Контракт статусов Voice-задач: текущая реализованная схема

**Исходный инцидент**: 2026-03-12  
**Приведено к текущему runtime-контракту**: 2026-03-12  
**Статус документа**: as-built contract

## Кратко

Этот документ описывает текущее продовое поведение.

Сейчас в системе реализовано следующее:
- строки во вкладке `Возможные задачи` живут как draft-задачи;
- принятие строки из `Возможных задач` materialize'ит её в обычную задачу;
- materialized задача не удаляется cleanup-path'ом;
- вкладка `Задачи` и CRM показывают только принятые задачи, а не draft-строки.

Текущий словарь Voice-статусов:
- draft Voice rows -> `DRAFT_10`
- accepted Voice rows -> `BACKLOG_10`

## Production incident, который зафиксировал баг

Каноническая сессия:
- `69b26496b771d8ccdee31f98`
- `https://copilot.stratospace.fun/voice/session/69b26496b771d8ccdee31f98`

До исправления происходило следующее:
1. пользователь выбирал строки в `Возможных задачах`;
2. назначал исполнителя;
3. нажимал `Создать выбранные`;
4. backend materialize'ил строку;
5. затем эта же строка soft-delete'илась historical cleanup path.

Итог до фикса:
- строка исчезала из `Возможных задач`;
- не появлялась во вкладке `Задачи`;
- не появлялась в CRM.

## Root cause

Исторический баг был двойной:
1. accepted row materialize'илась в неправильный runtime bucket;
2. cleanup path продолжал считать уже принятую задачу removable draft-row и soft-delete'ил её.

Исправленный runtime-контракт:
- draft rows живут отдельно от accepted rows;
- accepted rows больше не проходят destructive cleanup;
- session task counts не включают draft rows в `Задачи`.

## Таблица текущих статусов CRM

| Ключ | Лейбл | Текущий runtime смысл |
|---|---|---|
| `DRAFT_10` | `Draft` | Текущий storage bucket для `voice_possible_task`; draft-only rows |
| `BACKLOG_10` | `Backlog` | Текущий accepted-task bucket для Voice materialization |
| `NEW_0` | `Legacy / Backlog` | Legacy-only alias; не должен использоваться новым write-path |
| `NEW_10` | `New / Request` | Первичный входящий запрос |
| `NEW_20` | `New / Clientask` | Клиентский запрос до нормализации |
| `NEW_30` | `New / Detail` | Требует уточнения |
| `NEW_40` | `New / Readyforplan` | Готово к планированию |
| `PLANNED_10` | `Plan / Approval` | План на согласовании |
| `PLANNED_20` | `Plan / Performer` | План на стороне исполнителя |
| `READY_10` | `Ready` | Общий non-voice ready-state; Voice accepted rows сюда больше не materialize'ятся |
| `PROGRESS_0` | `Rejected` | Явный reject |
| `PROGRESS_10` | `Progress 10` | Работа начата |
| `PROGRESS_20` | `Progress 25` | Промежуточный чекпоинт |
| `PROGRESS_30` | `Progress 50` | Mid-state |
| `PROGRESS_40` | `Progress 90` | Почти завершено |
| `REVIEW_10` | `Review / Ready` | Готово к ревью |
| `REVIEW_20` | `Review / Implement` | Возврат из ревью |
| `AGREEMENT_10` | `Upload / Deadline` | Подготовка к дедлайну |
| `AGREEMENT_20` | `Upload / Delivery` | Delivery / handoff |
| `DONE_10` | `Done` | Выполнено |
| `DONE_20` | `Complete` | Полностью завершено |
| `DONE_30` | `PostWork` | Пост-работа |
| `ARCHIVE` | `Archive` | Исторический хвост |
| `PERIODIC` | `Periodic` | Периодические задачи |

## Текущий runtime-контракт

### Draft rows

Draft-строки из `Возможных задач` живут так:
- `source = VOICE_BOT`
- `source_kind = voice_possible_task`
- `task_status = DRAFT_10`

### Accepted rows

Принятые строки из `process_possible_tasks` и `create_tickets` materialize'ятся так:
- `source = VOICE_BOT`
- `source_kind = voice_session`
- `task_status = BACKLOG_10`

### Truth table для Voice-originated rows

| Вид строки | `source_kind` | Текущий runtime status | Где видна | Что это означает |
|---|---|---|---|---|
| Draft possible task | `voice_possible_task` | `DRAFT_10` | `Возможные задачи`, OperOps Voice draft groups | Черновик |
| Accepted voice task | `voice_session` | `BACKLOG_10` | `Задачи`, CRM | Materialized принятая задача |
| Codex-linked task | `voice_session` + `codex_task=true` | отдельный путь | `Codex` | Отдельный taskflow |

## Что уже реализовано

### 1. Materialization больше не destructive

`process_possible_tasks` и `create_tickets` теперь:
- выводят выбранную строку из draft-view;
- сохраняют её как обычный task document в `automation_tasks`;
- не дают cleanup path soft-delete'ить materialized row.

### 2. Принятые строки получают acceptance metadata

Для materialized rows ставятся:
- `accepted_from_possible_task = true`
- `accepted_from_row_id`
- `accepted_at`
- `accepted_by`
- `accepted_by_name` при наличии

### 3. Вкладка `Задачи` считает только accepted rows

`session_tab_counts` исключает:
- `source_kind = voice_possible_task`

Из-за этого:
- `Возможные задачи` = draft-only
- `Задачи` = accepted-only

### 4. Submit path логируется на фронте

В browser console есть structured logs:
- `create_selected.aborted`
- `create_selected.submit`
- `process_possible_tasks.request`
- `process_possible_tasks.response`
- `create_selected.result`
- `create_selected.validation_failed`
- `create_selected.failed`

## Recovery contract

Если row:
- была materialized из `Possible Tasks`,
- получила `source_kind = voice_session`,
- получила `performer_id` и `project_id`,
- но была soft-delete'нута historical cleanup path,

то она восстанавливается как:
- `task_status = BACKLOG_10`
- `is_deleted = false`
- `deleted_at = null`

И сохраняет acceptance metadata.

Команды recovery:
- `cd backend && npm run voice:repair:softdeleted-materialized:dry -- --session <session_id>`
- `cd backend && npm run voice:repair:softdeleted-materialized:apply -- --session <session_id>`

Команды status migration:
- `cd backend && npm run voice:migrate-task-statuses:dry [-- --session <session_id>]`
- `cd backend && npm run voice:migrate-task-statuses:apply [-- --session <session_id>]`

## Production verification

Каноническая smoke-сессия:
- `69b26496b771d8ccdee31f98`

Подтверждено после deploy и data repair/migration:
- repair apply восстановил soft-delete'нутые materialized задачи;
- create-flow успешно прошел повторно;
- observed transitions:
  - draft rows остаются в `Возможных задачах` как `DRAFT_10`
  - selected rows materialize'ятся в `BACKLOG_10`

Подтвержденное Mongo-состояние для accepted row:
- `source_kind = voice_session`
- `task_status = Backlog`
- `is_deleted = false`
- `accepted_from_possible_task = true`

## Code touchpoints

Текущий deployed behavior закреплен в:
- [backend/src/constants.ts](/home/strato-space/copilot/backend/src/constants.ts)
- [app/src/constants/crm.ts](/home/strato-space/copilot/app/src/constants/crm.ts)
- [backend/src/api/routes/voicebot/possibleTasksMasterModel.ts](/home/strato-space/copilot/backend/src/api/routes/voicebot/possibleTasksMasterModel.ts)
- [backend/src/services/voicebot/persistPossibleTasks.ts](/home/strato-space/copilot/backend/src/services/voicebot/persistPossibleTasks.ts)
- [backend/src/api/routes/voicebot/sessions.ts](/home/strato-space/copilot/backend/src/api/routes/voicebot/sessions.ts)
- [backend/src/services/voicebot/repairSoftDeletedMaterializedTasks.ts](/home/strato-space/copilot/backend/src/services/voicebot/repairSoftDeletedMaterializedTasks.ts)
- [backend/src/services/voicebot/migrateVoiceTaskStatuses.ts](/home/strato-space/copilot/backend/src/services/voicebot/migrateVoiceTaskStatuses.ts)
- [backend/scripts/voicebot-migrate-task-statuses.ts](/home/strato-space/copilot/backend/scripts/voicebot-migrate-task-statuses.ts)
- [app/src/components/voice/PossibleTasks.tsx](/home/strato-space/copilot/app/src/components/voice/PossibleTasks.tsx)
- [app/src/store/voiceBotStore.ts](/home/strato-space/copilot/app/src/store/voiceBotStore.ts)
- [app/src/pages/operops/voiceTabGrouping.ts](/home/strato-space/copilot/app/src/pages/operops/voiceTabGrouping.ts)
- [app/src/pages/operops/CRMPage.tsx](/home/strato-space/copilot/app/src/pages/operops/CRMPage.tsx)

## BD

### Реализованная wave
- ✅ `copilot-8uac` — [voice] Task status normalization: draft vs accepted session-task semantics
- ✅ `copilot-8uac.1` — T1 Freeze canonical voice task status policy and target truth table
- ✅ `copilot-pp5o` — [voice] process_possible_tasks creates Backlog tasks and immediately soft-deletes them
- ✅ `copilot-8uac.2` — T3 Exclude draft rows from session Tasks counts and accepted-task views
- ✅ `copilot-8uac.3` — T4 Add acceptance metadata and repair flow for soft-deleted materialized rows
- ✅ `copilot-8uac.4` — T5 Add regression coverage and production smoke for normalized voice task lifecycle
- ✅ `copilot-22j9` — [voice][ui] Add actionable submit-path logging for Possible Tasks materialization
- ✅ `copilot-8uac.5` — T6 Migrate runtime status dictionary from NEW_0 to DRAFT_10/BACKLOG_10

### DAG
- `copilot-8uac.1 -> copilot-pp5o`
- `copilot-8uac.1 -> copilot-8uac.2`
- `copilot-8uac.1 -> copilot-8uac.3`
- `copilot-8uac.1 -> copilot-8uac.5`
- `copilot-pp5o -> copilot-8uac.3`
- `copilot-pp5o -> copilot-8uac.4`
- `copilot-8uac.2 -> copilot-8uac.4`
- `copilot-8uac.3 -> copilot-8uac.4`
- `copilot-22j9 -> copilot-8uac.4`
