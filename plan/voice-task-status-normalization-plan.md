# План: нормализация статусов Voice-задач

**Сформировано**: 2026-03-10  
**Обновлено после prod-диагностики**: 2026-03-12  
**Оценка сложности**: High

## Кратко

Сейчас в Voice-потоке смешаны три разных сущности:

1. черновики из вкладки `Возможные задачи`;
2. реальные задачи, уже принятые в работу;
3. legacy-материализация через старый путь `create_tickets`.

Главная проблема не только в словаре статусов, но и в том, что текущий runtime ведет себя как старый destructive path:

- выбранная `Possible Task` не должна удаляться как объект;
- она должна **изменить статус** и выйти из draft-представления;
- без явного delete-запроса удалять задачу из `automation_tasks` нельзя.

## Текущий инцидент, подтвержденный по production

Сессия:
- `69b26496b771d8ccdee31f98`
- `https://copilot.stratospace.fun/voice/session/69b26496b771d8ccdee31f98`

Подтверждено по логам и Mongo:

1. Пользователь выбрал `Possible Task`, назначил исполнителя и нажал `Создать выбранные`.
2. Backend действительно получил `POST /api/voicebot/process_possible_tasks`.
3. Выбранная строка была переведена в документ с:
   - `source_kind = voice_session`
   - заполненными `performer_id` и `project_id`
4. Но этот же документ сразу попал под cleanup-path и был soft-delete’нут.
5. Результат:
   - задача исчезает из `Возможных задач`;
   - во вкладке `Задачи` и в CRM не появляется;
   - оператор видит «пропажу», а не создание.

### Точный root cause инцидента

`/process_possible_tasks` сейчас передает:
- `targetTaskStatus = NEW_0`

А значит backend materialize-path создает/обновляет выбранную задачу как:
- `task_status = Backlog`
- при этом она уже `source_kind = voice_session`

После этого старый cleanup-path продолжает трактовать ее как removable possible-task row и soft-delete’ит.

То есть баг двойной:
1. неверный target status у `process_possible_tasks`;
2. legacy destructive semantics: «создание задачи = удалить источник», хотя теперь источник и задача — это один и тот же объект, меняющий статус.

## Текущее состояние словаря статусов (AS-IS)

Снимок взят из shared constants и дополнен production snapshot из `automation_tasks`.

| Ключ | Лейбл | Текущее значение / target-оценка | Роль / наблюдение |
|---|---|---:|---|
| `NEW_0` | `Backlog` | 172 | Перегруженный бакет: в нем сейчас смешаны и draft Voice rows, и backlog-семаника |
| `NEW_10` | `New / Request` | 0 | Первичный входящий запрос |
| `NEW_20` | `New / Clientask` | 0 | Клиентский запрос до нормализации |
| `NEW_30` | `New / Detail` | 0 | Требует уточнения |
| `NEW_40` | `New / Readyforplan` | 0 | Готово к планированию |
| `PLANNED_10` | `Plan / Approval` | 0 | План на согласовании |
| `PLANNED_20` | `Plan / Performer` | 0 | План на стороне исполнителя |
| `READY_10` | `Ready` | 37 | Реальная принятая задача, готовая к исполнению |
| `PROGRESS_0` | `Rejected` | 0 | Явный reject |
| `PROGRESS_10` | `Progress 10` | 6 | Работа начата |
| `PROGRESS_20` | `Progress 25` | 0 | Промежуточный чекпоинт |
| `PROGRESS_30` | `Progress 50` | 0 | Mid-state |
| `PROGRESS_40` | `Progress 90` | 0 | Почти завершено |
| `REVIEW_10` | `Review / Ready` | 54 | Готово к ревью |
| `REVIEW_20` | `Review / Implement` | 0 | Возврат из ревью |
| `AGREEMENT_10` | `Upload / Deadline` | 0 | Подготовка к дедлайну |
| `AGREEMENT_20` | `Upload / Delivery` | 0 | Delivery / handoff |
| `DONE_10` | `Done` | 79 | Выполнено |
| `DONE_20` | `Complete` | 210 | Полностью завершено |
| `DONE_30` | `PostWork` | 0 | Пост-работа |
| `ARCHIVE` | `Archive` | 2997 | Исторический хвост |
| `PERIODIC` | `Periodic` | 10 | Периодические задачи |

Дополнительно:
- есть `4` активных rows с `task_status = null`;
- это отдельный legacy cleanup и не должно смешиваться с этим планом.

## Срез именно Voice-слоя (production snapshot)

Voice non-codex tasks (`source = VOICE_BOT`, `codex_task != true`, active non-deleted):

| task_status | source_kind | Count | Смысл |
|---|---|---:|---|
| `Backlog` | `voice_possible_task` | 94 | Черновики `Possible Tasks` |
| `Ready` | `voice_session` | 13 | Нормально материализованные Voice-задачи |
| `Ready` | `(missing)` | 12 | Legacy accepted Voice tasks без нормализованного `source_kind` |
| `Review / Ready` | `(missing)` | 9 | Legacy review rows |
| `Progress 10` | `(missing)` | 1 | Legacy execution row |
| `Archive` | `(missing)` | 32 | Исторические архивные Voice rows |

Ключевое наблюдение:
- в проде уже есть нормальные `voice_session + Ready` rows,
- но runtime path `process_possible_tasks` по-прежнему умеет производить неправильный destructive сценарий.

## Главная модельная ошибка

Один и тот же `NEW_0 / Backlog` сейчас значит сразу две разные вещи:

1. draft-row из `Возможных задач`;
2. реальная backlog-задача.

Это недопустимо.

Кроме того, старый destructive cleanup предполагает, что:
- possible task — это временный объект,
- а реальная задача — новый отдельный объект.

Но фактическая целевая модель уже другая:
- possible task и принятая задача — это **один объект**, который меняет статус и представление.

## Целевая семаника

### Нормализация терминов

В этом плане используются три разных модальности, и их нужно не смешивать:

- **стратегическая целевая модель**:
  - accepted Voice task = `BACKLOG_10`
- **безопасный немедленный hotfix**:
  - accepted Voice task временно можно materialize в `READY_10`, если это снижает риск и объем правок
- **legacy input model**:
  - draft possible-task rows все еще живут в `NEW_0`, пока миграция не завершена

То есть:
- `BACKLOG_10` — это **целевая норма**,
- `READY_10` — это **временный operational hotfix target**,
- `NEW_0` — это **устаревший перегруженный статус**, который подлежит элиминации.

### Базовые правила

1. `Possible Tasks` — это только draft-срез.
2. Принятие задачи из `Possible Tasks` означает **переход объекта в рабочий статус**, а не удаление объекта.
3. Без явного delete-запроса backend не должен soft-delete’ить задачу после materialization.
4. Вкладка `Задачи` должна показывать только принятые рабочие задачи.
5. Вкладка `Возможные задачи` должна показывать только draft-строки.
6. UI counts не должны смешивать draft и accepted rows.

### Рекомендуемая целевая модель

| Ключ | Лейбл | Активных | Роль / наблюдение |
|---|---|---:|---|
| `DRAFT_10` | `Draft` | target: вместо текущих `94` draft rows | Только черновики из `Возможных задач`; не считаются рабочими задачами и не должны попадать в CRM/вкладку `Задачи` |
| `BACKLOG_10` | `Backlog` | target: вместо реальных backlog rows, сейчас частично смешано в `NEW_0` | Реальная принятая задача, уже вышедшая из draft-flow; может иметь проект, исполнителя, связи и участвует в обычном lifecycle |
| `READY_10` | `Ready` | 37 + часть voice rows после immediate fix | Безопасный промежуточный target для hotfix, если пока не вводим новый ключ `BACKLOG_10`; accepted Voice task можно временно materialize’ить сюда |
| `NEW_0` | `Backlog` | legacy-only, после миграции должно стать `0` | Устаревший перегруженный статус; сейчас смешивает draft и backlog semantics, должен исчезнуть из runtime write-paths |
| `REVIEW_10` | `Review / Ready` | 54 | Обычный следующий этап после выполнения; не draft и не backlog |
| `PROGRESS_10` | `Progress 10` | 6 | Обычное исполнение; не требует специальных voice-оговорок |
| `DONE_10` | `Done` | 79 | Выполнено |
| `DONE_20` | `Complete` | 210 | Полностью завершено |
| `ARCHIVE` | `Archive` | 2997 | Архивный хвост |

И отдельно для voice-originated rows:

| source_kind | Целевой статус | Где видна | Роль / наблюдение |
|---|---|---|---|
| `voice_possible_task` | `DRAFT_10` | `Возможные задачи` | Draft-only |
| `voice_session` | `BACKLOG_10` | `Задачи`, CRM | Принятая реальная задача |
| `voice_session` | `READY_10` | `Задачи`, CRM | Допустимый временный hotfix target до полной миграции на `BACKLOG_10` |

### Промежуточный pragmatic rule до полной миграции статусов

Даже до введения нового словаря статусов нужно сразу зафиксировать:

- `process_possible_tasks` **не имеет права** писать принятую задачу обратно в draft bucket;
- `process_possible_tasks` **не имеет права** удалять materialized row как `Possible Task`;
- accepted row должна остаться в `automation_tasks` и перейти в рабочую семантику.

### Правило восстановления уже сломанных строк

Если задача была:
- материализована из `Possible Tasks`,
- получила `performer_id` и `project_id`,
- получила `source_kind = voice_session`,
- а потом была soft-delete’нута legacy cleanup path,

то такая задача должна восстанавливаться как:
- `task_status = READY_10` в текущем hotfix phase
- `task_status = BACKLOG_10` после полной миграции словаря статусов
- `is_deleted = false`
- `deleted_at = null`

То есть восстановление должно возвращать ее не в draft bucket, а в нормальную accepted semantics.

## AS-IS и TO-BE truth table

| Сущность | source_kind | task_status | Где видна | Комментарий |
|---|---|---|---|---|
| draft possible task | `voice_possible_task` | `DRAFT_10` (target) / `NEW_0` (legacy) | `Возможные задачи` | Draft-only |
| accepted voice task | `voice_session` | `BACKLOG_10` (target) / временно `READY_10` как immediate fix | `Задачи`, CRM | Реальная задача |
| codex-linked issue | `voice_session` + `codex_task=true` | отдельный path | `Codex` | Вне этого плана |

## Немедленные продуктовые решения

Эти решения больше не считаются открытыми:

1. Принятая задача из `Possible Tasks` **не удаляется**, а меняет статус.
2. Удаление возможно только через явный delete/unlink path.
3. `session_tab_counts.tasks_count` не должен включать draft rows.
4. Если row не материализована, UI не должен создавать впечатление, что она уже находится во вкладке `Задачи`.

## Immediate bugfix track

### Bug A: `process_possible_tasks` materializes into wrong status

**Описание**
- Сейчас route пишет `targetTaskStatus = NEW_0`.
- Это и есть непосредственная причина self-deletion после materialization.

**Целевой контракт**
- `process_possible_tasks` должен materialize selected rows в рабочий статус, а не в draft.
- До полной статусной миграции безопасный immediate fix:
  - `READY_10`
- После полной нормализации:
  - `BACKLOG_10`

**Нормализация модальности**
- `READY_10` здесь — только hotfix target;
- `BACKLOG_10` — целевой target after status dictionary migration;
- спеку нельзя трактовать так, будто оба статуса одновременно являются финальной нормой.

### Bug B: legacy cleanup удаляет materialized row

**Описание**
- Сейчас cleanup path действует по старой модели «создали задачу -> удалили possible-task объект».
- В новой модели это неверно.

**Целевой контракт**
- `remove_from_possible_tasks` означает только:
  - убрать строку из draft-представления,
  - убрать из session compatibility projection,
  - убрать из local UI list,
  - **но не soft-delete’ить сам materialized task document**.

Если destructive bug уже сработал, repair-path должен:
- найти такие soft-delete’нутые rows,
- восстановить их,
- в hotfix phase вернуть им `READY_10`,
- после полной миграции вернуть им `BACKLOG_10`,
- сохранить audit trail восстановления.

### Bug C: вкладка `Задачи` врет счетчиком

**Описание**
- `session_tab_counts` считает session-linked non-codex rows, включая draft `Backlog`.
- Из-за этого пользователь видит число в `Задачи`, хотя реальных рабочих задач нет.

**Целевой контракт**
- `tasks_count` считает только accepted task rows.
- Draft rows учитываются только в `possible_tasks`.

### Bug D: недостаточная диагностика фронта

**Описание**
- В `PossibleTasks` почти нет submit-path logging.
- Невозможно локализовать, что именно произошло:
  - какие row ids были выбраны,
  - какие `performer_id` были назначены,
  - какой payload ушел,
  - какой response вернулся,
  - по какой причине submit был aborted.

**Требование**
- Это не обязательная часть текущего hotfix, но должно быть отдельным `bd` issue.
- Issue уже заведен:
  - `copilot-22j9` — `[voice][ui] Add actionable submit-path logging for Possible Tasks materialization`

## Sprint 1: Freeze canonical status policy

### Task 1.1: Зафиксировать truth table
- где: этот план, `AGENTS.md`, `README.md`
- acceptance:
  - draft vs accepted различаются явно;
  - `voice_possible_task` и `voice_session` не смешиваются;
  - `NEW_0` зафиксирован как legacy-only.

### Task 1.2: Зафиксировать illegal combinations
- illegal examples:
  - `voice_session + DRAFT_10`
  - materialized row + destructive auto-delete without explicit request
  - draft row inside `Задачи`

## Sprint 2: Backend contract normalization

### Task 2.1: Исправить `process_possible_tasks`
- route должен materialize в рабочий status target
- route не должен re-enter draft bucket
- acceptance:
  - выбранная задача не становится `NEW_0`/`Backlog` draft-row после materialization

### Task 2.2: Убрать destructive semantics из materialization path
- remove-from-possible != delete-document
- acceptance:
  - задача исчезает из draft-view,
  - но остается в `automation_tasks` как рабочая задача

### Task 2.3: Исправить `session_tab_counts`
- `tasks_count` не включает draft rows
- acceptance:
  - вкладка `Задачи` перестает маскировать баги materialization path

### Task 2.4: Stamp acceptance metadata
- при принятии возможной задачи stamp:
  - `accepted_from_possible_task`
  - `accepted_from_row_id`
  - `accepted_at`
  - `accepted_by`

## Sprint 3: Data migration and repair

### Task 3.1: Dry-run audit
- report:
  - draft rows
  - accepted rows
  - mixed legacy rows
  - missing `source_kind`
  - rows, попавшие под destructive bug

### Task 3.2: Миграция `NEW_0`
- split into `DRAFT_10` and `BACKLOG_10`
- `NEW_0` уходит из целевого runtime model

### Task 3.3: Repair already broken rows
- кейсы вроде `69b26496...` должны repair’иться отдельно:
  - soft-deleted rows, которые были materialized,
  - но удалены legacy cleanup path
  - в hotfix phase после repair такие rows должны возвращаться в `READY_10`, а не в `NEW_0`
  - после полной миграции — в `BACKLOG_10`

## Sprint 4: Frontend alignment

### Task 4.1: Draft-only Possible Tasks UI
- accepted row после materialization не должна визуально выглядеть как draft

### Task 4.2: Accepted-only Tasks tab
- `Задачи` = только accepted task rows

### Task 4.3: Better submit diagnostics
- `bd`: `copilot-22j9`
- structured console logging:
  - selected row ids
  - assigned performers
  - payload summary
  - response summary
  - client-side abort reasons

## Sprint 5: Regression coverage and rollout

### Task 5.1: Backend regression tests
Покрыть:
- selected possible task -> materialized accepted task
- no self-soft-delete after materialization
- `tasks_count` excludes draft rows

### Task 5.2: Frontend regression tests
Покрыть:
- `Possible Tasks` create flow
- cross-tab visibility
- no false-positive `Задачи` count from draft rows

### Task 5.3: Production smoke checklist
Проверить на реальных сессиях:
- только draft rows
- draft + accepted rows
- repaired historical rows

### MCP Google Chrome smoke: canonical repro session

Базовая prod-сессия для smoke и regression reproduction:
- `69b26496b771d8ccdee31f98`
- `https://copilot.stratospace.fun/voice/session/69b26496b771d8ccdee31f98`

Цель:
- воспроизвести текущий destructive bug на старом коде;
- подтвердить corrected behavior после фикса;
- использовать один и тот же reproducible browser path через MCP Google Chrome.

#### Проверка до фикса

1. Открыть страницу сессии в браузере через MCP Google Chrome.
2. Перейти во вкладку `Возможные задачи`.
3. Выбрать одну или несколько draft-задач.
4. Назначить исполнителя из списка.
5. Нажать `Создать выбранные`.

Ожидаемое buggy behavior (AS-IS):
- задача исчезает из `Возможных задач`;
- во вкладке `Задачи` реальная рабочая строка не появляется;
- в CRM задача не появляется;
- в backend Mongo строка может оказаться:
  - `source_kind = voice_session`
  - с заполненными `performer_id` / `project_id`
  - но `is_deleted = true`

#### Проверка после фикса

1. Открыть ту же сессию через MCP Google Chrome.
2. Взять одну из оставшихся draft-задач.
3. Назначить исполнителя.
4. Нажать `Создать выбранные`.

Ожидаемое correct behavior:
- задача уходит из draft-view `Возможные задачи`;
- задача появляется во вкладке `Задачи`;
- задача появляется в CRM;
- в Mongo документ:
  - не soft-delete’нут;
  - имеет рабочий статус (`READY_10` как hotfix или `BACKLOG_10` после полной миграции);
  - сохраняет `source_kind = voice_session`;
  - сохраняет связь с voice session через `external_ref/source_ref/source_data`

#### Что дополнительно проверить в MCP Google Chrome

- console logging around submit path:
  - selected row ids
  - assigned performer ids
  - payload summary
  - backend response summary
  - client-side abort reasons
- `session_tab_counts`:
  - `Задачи` не включают draft rows
  - `Возможные задачи` показывают только draft rows
- cross-tab visibility:
  - одна и та же строка не должна одновременно выглядеть как draft и как accepted task
- повторный refresh страницы:
  - materialized задача не должна “исчезать” после reload

## Testing strategy

### Backend
- route tests for:
  - `process_possible_tasks`
  - `create_tickets`
  - `possible_tasks`
  - `session_tab_counts`
- migration dry-run/apply tests
- repair-script tests

### Frontend
- `PossibleTasks` submit flow
- `SessionPage` tab counts and visibility
- logging contract tests

### Production
- inspect Mongo documents after materialization
- inspect backend access logs for `process_possible_tasks`
- confirm no materialized row is soft-deleted unless explicit delete path runs

## Risks

- historical `NEW_0` rows with missing `source_kind` still потребуют migration heuristics;
- until the status dictionary is fully normalized, immediate fix and target model will coexist temporarily;
- if UI and backend are fixed separately, operators may still see inconsistent behavior.

## Локализация `NEW_0` в коде и точки элиминации

На текущий момент `NEW_0` все еще живет в нескольких местах. Их нужно разделить на:
- **legacy-read compatibility**
- **runtime write-paths**, которые подлежат изменению

### 1. Shared constants
- [backend/src/constants.ts](/home/strato-space/copilot/backend/src/constants.ts)
- [app/src/constants/crm.ts](/home/strato-space/copilot/app/src/constants/crm.ts)

Что сделать:
- добавить `DRAFT_10` и `BACKLOG_10`
- пометить `NEW_0` как legacy-only

### 2. Draft possible-task persistence
- [backend/src/services/voicebot/persistPossibleTasks.ts](/home/strato-space/copilot/backend/src/services/voicebot/persistPossibleTasks.ts)
- [backend/src/api/routes/voicebot/possibleTasksMasterModel.ts](/home/strato-space/copilot/backend/src/api/routes/voicebot/possibleTasksMasterModel.ts)
- [backend/src/api/routes/voicebot/sessions.ts](/home/strato-space/copilot/backend/src/api/routes/voicebot/sessions.ts)

Что сделать:
- все draft possible-task write paths перевести с `NEW_0` на `DRAFT_10`

### 3. Materialization path
- [backend/src/api/routes/voicebot/sessions.ts](/home/strato-space/copilot/backend/src/api/routes/voicebot/sessions.ts)

Текущее bug место:
- `process_possible_tasks` сейчас пишет `targetTaskStatus: TASK_STATUSES.NEW_0`

Что сделать:
- hotfix: `READY_10`
- target model: `BACKLOG_10`

### 4. Voice / OperOps UI grouping
- [app/src/pages/operops/voiceTabGrouping.ts](/home/strato-space/copilot/app/src/pages/operops/voiceTabGrouping.ts)
- [backend/src/api/routes/voicebot/sessions.ts](/home/strato-space/copilot/backend/src/api/routes/voicebot/sessions.ts)

Что сделать:
- перестать трактовать `NEW_0` как рабочий backlog bucket
- UI and counts должны группировать draft rows отдельно как `DRAFT_10`

## Rollback plan

- route-level rollback only before migration apply;
- migration must stay behind explicit operator flag;
- repair scripts must produce audit logs of touched task ids.

## BD

Текущая execution wave:

- 🟡 `copilot-8uac` — [voice] Task status normalization: draft vs accepted session-task semantics
- ✅ `copilot-8uac.1` — T1 Freeze canonical voice task status policy and target truth table
- ✅ `copilot-pp5o` — [voice] process_possible_tasks creates Backlog tasks and immediately soft-deletes them
- ✅ `copilot-8uac.2` — T3 Exclude draft rows from session Tasks counts and accepted-task views
- ✅ `copilot-8uac.3` — T4 Add acceptance metadata and repair flow for soft-deleted materialized rows
- ✅ `copilot-8uac.4` — T5 Add regression coverage and production smoke for normalized voice task lifecycle
- ✅ `copilot-22j9` — [voice][ui] Add actionable submit-path logging for Possible Tasks materialization
- ⚪ `copilot-8uac.5` — T6 Migrate runtime status dictionary from NEW_0 to DRAFT_10/BACKLOG_10

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
