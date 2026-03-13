# Спецификация: нормализация task surfaces Voice и OperOps по статусам

## Status
- Ticket line: ⚪Open 0  🟡In Progress 0  💤Deferred 0  ⛔Blocked 0  Closed 4
- Plan status: specification completed and internally verified.
- Canonical epic: `copilot-cux2`

**Статус документа**: proposal  
**Дата**: 2026-03-13  
**Основание**: текущий runtime-контракт `DRAFT_10 / BACKLOG_10`, существующие routes `voicebot/possible_tasks`, `voicebot/session_tab_counts`, `voice.crm_tickets(session_id=...)`, `voice.session_possible_tasks(session_id)`, и текущая OperOps CRM surface.

## Кратко

Эта спецификация описывает, как привести Voice и OperOps к одной статусно-ориентированной модели задач.

Базовый тезис:
- `Возможные задачи` не являются отдельной сущностью и не требуют отдельной target-surface semantics;
- все surfaces работают поверх одной коллекции `automation_tasks`;
- различие между draft и accepted rows задается только `task_status`;
- `source_kind` — вспомогательный provenance/runtime marker;
- `codex_task` — отдельный тип taskflow, а не атрибут различения между draft и accepted rows.

Текущий runtime уже близок к этой модели:
- draft Voice rows = `DRAFT_10`
- accepted Voice rows = `BACKLOG_10`
- `source_kind` сейчас помогает различать origin/runtime-path, но не должен считаться главным semantic discriminator;
- `Codex` — отдельный тип taskflow/view по `codex_task = true`.

Новая цель:
- зафиксировать одну ментальную модель в спеках, MCP и UI;
- сделать OperOps полностью status-first;
- трактовать draft как обычный status filter `DRAFT_10` внутри общей task surface.

## 1. Единая модель задач

### 1.1 Канонический storage model

Все Voice-derived rows — это документы в `automation_tasks`.

Нормализация:

| Вид строки | Статус | Что означает |
|---|---|---|
| Draft Voice row | `DRAFT_10` | Черновик из `Возможных задач` |
| Accepted Voice task (initial) | `BACKLOG_10` | Начальный accepted status сразу после materialization |
| Codex task | свой lifecycle | Отдельный Codex taskflow |

Дополнительно:
- accepted rows дальше живут обычным CRM lifecycle:
  - `READY_10`
  - `PROGRESS_*`
  - `REVIEW_*`
  - `DONE_*`
  - `ARCHIVE`
  - `PERIODIC`

### 1.1.1 Справка по `source_kind`

`source_kind` не является главным semantic discriminator для draft vs accepted.

Его роль:
- provenance
- runtime lineage
- compatibility / legacy guards

Текущие practically important значения:

| `source_kind` | Роль |
|---|---|
| `voice_possible_task` | Draft-origin marker для строк, пришедших из Voice task extraction |
| `voice_session` | Accepted Voice task / session-linked task marker |
| другие значения | Не относятся к этому draft/accepted split и не должны участвовать в его главной нормализации |

### 1.1.2 Задействованные ontology objects и relations

Новая нормализация должна опираться на уже существующую ontology, а не придумывать отдельный vocabulary только для UI.

#### AS-IS entities

Задействованные объекты:
- `project`
- `project_group`
- `person`
- `performer_profile`
- `oper_task`
- `voice_session`
- `voice_message`
- `status_dict`
- `priority_dict`

Практический смысл:
- `oper_task` — canonical storage object для draft и accepted task rows
- `voice_session` — canonical session object
- `voice_message` — evidence/event layer, но не отдельная task сущность
- `person` и `performer_profile` — не одно и то же; assignment идет через performer profile
- `status_dict` и `priority_dict` — словарные сущности, а не просто строки

#### AS-IS relations

Ключевые связи:
- `project_has_oper_task`
- `voice_session_sources_oper_task`
- `oper_task_has_status`
- `oper_task_has_priority`
- `oper_task_assigned_to_performer_profile`
- `voice_session_has_message`
- `project_has_voice_session`
- `transcript_segment_spoken_by_person`
- `person_has_performer_profile`

Практический смысл:
- `voice_session_sources_oper_task` связывает voice session и task lineage
- `oper_task_has_status` и `oper_task_has_priority` — dictionary-backed semantics
- `oper_task_assigned_to_performer_profile` — assignment должен мыслиться через performer profile, а не через generic person

#### TO-BE / bridge layer, already relevant

Если normalization в будущем углубляется, уже существующие TO-BE/bridge объекты и связи остаются релевантны:
- `target_task_view`
- `as_is_oper_task_maps_to_target_task_view`
- `as_is_voice_session_maps_to_mode_segment`
- `as_is_voice_message_maps_to_object_event`

Но текущая спека не требует немедленного переключения UI на TO-BE projection.  
Она фиксирует status-first semantics поверх текущего AS-IS storage model.

### 1.2 Следствие для backend semantics

Отсюда следует:
- `possible_tasks` не является отдельной сущностью;
- это draft-only view над `automation_tasks`;
- `crm_tickets(session_id=...)` — accepted-task view над той же коллекцией;
- `codex_tasks` — отдельный codex-only view над той же коллекцией, но это уже отдельный task type, а не часть draft/accepted split.

## 2. Label-only contract

### 2.1 Принцип

Во всех user-facing surfaces должны показываться только **лейблы**, а не внутренние keys.

Примеры:

| Key | Label |
|---|---|
| `DRAFT_10` | `Draft` |
| `BACKLOG_10` | `Backlog` |
| `READY_10` | `Ready` |
| `REVIEW_10` | `Review / Ready` |
| `DONE_10` | `Done` |

### 2.2 Диагностические исключения

Строки вида:
- `Draft (voice_possible_task)`
- `Backlog (voice_session)`

допустимы только в:
- diagnostic logs
- product/debug explanations
- migration/repair notes

В обычном UI и обычных отчетах preferred form:
- `Draft`
- `Backlog`
- `Ready`

## 2.2.1 Таблица текущих статусов CRM (As Is)

Для полноты этот документ дублирует текущий словарь статусов из runtime-контракта.

Столбец `Исполнительский surface` использует легенду:
- `✏️` — исполнитель видит и может менять статус;
- `👁` — исполнитель видит, но не может менять статус;
- `—` — статус не входит в текущий performer-facing miniapp surface.

Текущее количество ниже — это live active count из Mongo (`automation_tasks`, `is_deleted != true`) на момент последней проверки.

| Лейбл | Ключ | Текущее кол-во | Текущий runtime смысл | Исполнительский surface |
|---|---|---:|---|---|
| `Legacy / Backlog` | `NEW_0` | `0` | Legacy-only alias; не должен использоваться новым write-path | `—` |
| `Draft` | `DRAFT_10` | `243` | Текущий storage bucket для `voice_possible_task`; draft-only rows | `—` |
| `Backlog` | `BACKLOG_10` | `111` | Текущий accepted-task bucket для Voice materialization | `✏️` |
| `New / Request` | `NEW_10` | `0` | Первичный входящий запрос | `—` |
| `New / Clientask` | `NEW_20` | `0` | Клиентский запрос до нормализации | `—` |
| `New / Detail` | `NEW_30` | `0` | Требует уточнения | `—` |
| `New / Readyforplan` | `NEW_40` | `0` | Готово к планированию | `—` |
| `Plan / Approval` | `PLANNED_10` | `0` | План на согласовании | `—` |
| `Plan / Performer` | `PLANNED_20` | `0` | План на стороне исполнителя | `—` |
| `Ready` | `READY_10` | `18` | Общий ready-state после backlog | `✏️` |
| `Progress 0` | `PROGRESS_0` | `0` | Готово к старту | `✏️` |
| `In Progress` | `PROGRESS_10` | `6` | Работа начата | `✏️` |
| `Progress 25` | `PROGRESS_20` | `0` | Промежуточный чекпоинт | `✏️` |
| `Progress 50` | `PROGRESS_30` | `0` | Mid-state | `✏️` |
| `Progress 90` | `PROGRESS_40` | `0` | Почти завершено | `✏️` |
| `Review` | `REVIEW_10` | `54` | Готово к ревью | `✏️` |
| `Review / Implement` | `REVIEW_20` | `0` | Возврат из ревью | `👁` |
| `Upload / Deadline` | `AGREEMENT_10` | `0` | Подготовка к дедлайну | `—` |
| `Upload / Delivery` | `AGREEMENT_20` | `0` | Delivery / handoff | `—` |
| `Done` | `DONE_10` | `79` | Выполнено | `—` |
| `Complete` | `DONE_20` | `209` | Полностью завершено | `—` |
| `PostWork` | `DONE_30` | `0` | Пост-работа | `—` |
| `Archive` | `ARCHIVE` | `3002` | Исторический хвост | `—` |
| `Periodic` | `PERIODIC` | `10` | Периодические задачи | `👁` |

## 2.3 Полное непересекающееся разбиение статусов (As Is)

Для status-first модели главным должен быть один полный partition по status groups.

| Status group | Статусы | Лейбл группы |
|---|---|---|
| `Draft` | `DRAFT_10` | `Draft` |
| `New` | `NEW_0`, `NEW_10`, `NEW_20`, `NEW_30`, `NEW_40` | `New` |
| `Plan` | `PLANNED_10`, `PLANNED_20` | `Plan` |
| `Backlog` | `BACKLOG_10` | `Backlog` |
| `Ready` | `READY_10` | `Ready` |
| `In Progress` | `PROGRESS_0`, `PROGRESS_10`, `PROGRESS_20`, `PROGRESS_30`, `PROGRESS_40` | `In Progress` |
| `Review` | `REVIEW_10`, `REVIEW_20` | `Review` |
| `Upload` | `AGREEMENT_10`, `AGREEMENT_20` | `Upload` |
| `Done` | `DONE_10`, `DONE_20`, `DONE_30` | `Done` |
| `Archive` | `ARCHIVE` | `Archive` |
| `Periodic` | `PERIODIC` | `Periodic` |

Это разбиение:
- полное относительно `TASK_STATUSES`
- непересекающееся
- пригодное как для UI, так и для отчетов

`source_kind` и `codex_task` в это разбиение не входят; это orthogonal dimensions.

Важно:
- `Periodic` пока intentionally не переразбирается в этой спеke;
- в `As Is` и в текущих UI surfaces он остается отдельным stored status, даже если онтологически ближе к orthogonal mode.

## 2.4 Целевое разбиение статусов (To Be)

Ниже зафиксирована целевая нормализация, вытекающая из product reasoning:

- `DRAFT_10` и `NEW_*` принадлежат одному семейству draft/new work-in-definition;
- `BACKLOG_10` и `READY_10` принадлежат одному семейству accepted ready work;
- `NEW_0` по смыслу совпадает с draft-низшим уровнем и должен схлопнуться в `DRAFT_10`;
- `PROGRESS_0` в целевой модели считается legacy-статусом и подлежит удалению из словаря;
- `PROGRESS_20`, `PROGRESS_30`, `PROGRESS_40` в целевой модели считаются избыточными промежуточными чекпоинтами и подлежат удалению;
- ключи и labels должны быть приведены к более общепринятой task-tracker semantics.

### 2.4.1 Целевая цепочка схлопывания

| As Is | To Be |
|---|---|
| `NEW_0` + `DRAFT_10` | `DRAFT_10` |
| `NEW_10` | `DRAFT_10` |
| `NEW_20` | `DRAFT_10` |
| `NEW_30` | `DRAFT_10` |
| `NEW_40` | `DRAFT_10` |
| `DRAFT_20` | `DRAFT_10` |
| `DRAFT_30` | `DRAFT_10` |
| `DRAFT_40` | `DRAFT_10` |
| `BACKLOG_10` + `READY_10` | `READY_10` |
| `PROGRESS_0` | `<remove>` |
| `PROGRESS_20` | `<remove>` |
| `PROGRESS_30` | `<remove>` |
| `PROGRESS_40` | `<remove>` |

### 2.4.2 Целевой смысл

В целевой модели:
- `Draft` включает и LLM-derived candidates, и любые новые задачи в разной степени проработки;
- `Ready` становится первым accepted bucket для обычной рабочей задачи;
- отдельная группа `New` исчезает как самостоятельная status family и встраивается в `Draft`;
- label `Backlog` в целевой модели не используется как top-level status family;
- `Work` переименовывается в `In Progress`;
- `PROGRESS_0` не сохраняется в целевом словаре и должен быть элиминирован при миграции.
- `NEW_0`, `NEW_*`, `DRAFT_20`, `DRAFT_30`, `DRAFT_40` не сохраняются как отдельные target-статусы и должны быть схлопнуты в `DRAFT_10`;
- `PROGRESS_20`, `PROGRESS_30`, `PROGRESS_40` не сохраняются в целевом словаре и должны быть элиминированы при миграции.

### 2.4.4 Таблица целевых статусов CRM (To Be)

Текущее количество ниже — это live active count из Mongo (`automation_tasks`, `is_deleted != true`) на момент последней проверки.  
Если целевой статус схлопывает несколько `As Is` статусов, в колонке показана агрегированная текущая сумма.

| Лейбл | Ключ | Текущее кол-во (As Is) | Целевой смысл | Исполнительский surface |
|---|---|---:|---|---|
| `Draft` | `DRAFT_10` | `243` | Задача существует как черновик: её можно уточнять, дополнять, объединять или отклонять до принятия в рабочий контур. | `—` |
| `Ready` | `READY_10` | `129` | Задача принята в работу, назначена и полностью готова к началу исполнения, но исполнитель еще не перевел её в активное выполнение. | `✏️` |
| `In_Progress` | `PROGRESS_10` | `6` | Исполнитель уже начал работу над задачей, и задача находится в активной фазе исполнения. | `✏️` |
| `Review` | `REVIEW_10` | `54` | Исполнитель завершил основной объем работы и передал задачу на проверку, согласование или приемку. | `✏️` |
| `Done` | `DONE_10` | `288` | Работа по задаче завершена и результат принят как достаточный; дополнительных рабочих шагов внутри обычного цикла больше не требуется. | `—` |
| `Archive` | `ARCHIVE` | `3002` | Задача выведена из активного контура и хранится только как историческая запись. | `—` |

### 2.4.5 Таблица статусов CRM к удалению (To Be)

| Ключ | Текущее кол-во (As Is) | Текущий лейбл | Текущий runtime смысл | Причина удаления / схлопывания | Целевое действие |
|---|---:|---|---|---|---|
| `NEW_0` | `0` | `Legacy / Backlog` | Legacy alias для раннего чернового bucket. | Дублирует ранний draft bucket. | `merge -> DRAFT_10` |
| `NEW_10` | `0` | `New / Request` | Первичный входящий запрос. | `New` family схлопывается в единый Draft. | `merge -> DRAFT_10` |
| `NEW_20` | `0` | `New / Clientask` | Клиентский запрос до нормализации. | `New` family схлопывается в единый Draft. | `merge -> DRAFT_10` |
| `NEW_30` | `0` | `New / Detail` | Требует уточнения. | `New` family схлопывается в единый Draft. | `merge -> DRAFT_10` |
| `NEW_40` | `0` | `New / Readyforplan` | Готово к планированию. | `New` family схлопывается в единый Draft. | `merge -> DRAFT_10` |
| `DRAFT_20` | `0` | `Draft / Clientask` | Draft, сформулированный как клиентский запрос. | Промежуточный draft status не нужен в целевом словаре. | `merge -> DRAFT_10` |
| `DRAFT_30` | `0` | `Draft / Detail` | Draft, требующий уточнения деталей. | Промежуточный draft status не нужен в целевом словаре. | `merge -> DRAFT_10` |
| `DRAFT_40` | `0` | `Draft / Readyforplan` | Draft, готовый к переходу в планирование. | Промежуточный draft status не нужен в целевом словаре. | `merge -> DRAFT_10` |
| `PLANNED_10` | `0` | `Plan / Approval` | План на согласовании. | Отдельный plan bucket не нужен в целевой модели. | `remove` |
| `PLANNED_20` | `0` | `Plan / Performer` | План на стороне исполнителя. | Отдельный plan bucket не нужен в целевой модели. | `remove` |
| `BACKLOG_10` | `111` | `Backlog` | Текущий accepted-task bucket для Voice materialization. | Accepted flow должен начинаться сразу с `Ready`. | `merge -> READY_10` |
| `PROGRESS_0` | `0` | `Progress 0` | Готово к старту. | Legacy status, не нужен в целевом словаре. | `remove` |
| `PROGRESS_20` | `0` | `Progress 25` | Промежуточный чекпоинт. | Избыточный промежуточный чекпоинт. | `remove` |
| `PROGRESS_30` | `0` | `Progress 50` | Mid-state. | Избыточный промежуточный чекпоинт. | `remove` |
| `PROGRESS_40` | `0` | `Progress 90` | Почти завершено. | Избыточный промежуточный чекпоинт. | `remove` |
| `REVIEW_20` | `0` | `Review / Implement` | Возврат из ревью. | Не отдельный целевой top-level status. | `remove or merge to In Progress` |
| `AGREEMENT_10` | `0` | `Upload / Deadline` | Подготовка к дедлайну. | Отдельный upload bucket не нужен в целевой модели. | `remove` |
| `AGREEMENT_20` | `0` | `Upload / Delivery` | Delivery / handoff. | Отдельный upload bucket не нужен в целевой модели. | `remove` |
| `DONE_20` | `209` | `Complete` | Полностью завершено. | Избыточный финальный статус. | `merge -> DONE_10` |
| `DONE_30` | `0` | `PostWork` | Пост-работа. | Post-work не отдельный целевой top-level status. | `merge -> DONE_10` |
| `PERIODIC` | `10` | `Periodic` | Периодические задачи. | Recurrence mode, а не lifecycle status. | `remove or move to separate recurrence flag` |

### 2.4.6 Итоговая целевая статусная ось

В целевой модели отдельная таблица `status group -> statuses` больше не нужна, потому что у каждой целевой группы остается ровно один канонический статусный ключ.

Итоговая целевая ось такова:
- `Draft` -> `DRAFT_10`
- `Ready` -> `READY_10`
- `In Progress` -> `PROGRESS_10`
- `Review` -> `REVIEW_10`
- `Done` -> `DONE_10`
- `Archive` -> `ARCHIVE`

Важно:
- user-facing surfaces показывают **лейбл**
- filters, API и код должны опираться на **ключ статуса**, а не на лейбл

## 3. Voice session surfaces

### 3.1 Рекомендованный target

Target surfaces:
- `Задачи`
- `Codex`

`Draft` не требует отдельной target tab semantics и выражается обычным status filter внутри общей task surface.

### 3.2 Target filters

Все фильтры ниже должны задаваться по **ключам статусов**, а не по пользовательским лейблам.

#### `Задачи`

Filter:
- session scope
- `codex_task != true`
- верхние фильтры по status key:
  - `DRAFT_10`
  - `READY_10`
  - `PROGRESS_10`
  - `REVIEW_10`
  - `DONE_10`
  - `ARCHIVE`
- `source_kind != voice_possible_task` можно использовать как secondary integrity guard, но не как основную норму

#### `Codex`

Filter:
- session scope
- `codex_task = true`

### 3.3 Вывод

Из этого следует:
- отдельный `voicebot/possible_tasks` route может остаться как compatibility/view facade;
- но новая спека должна считать его thin filtered view over `automation_tasks`;
- draft и accepted surfaces должны различаться только фильтрами, а не отдельной target-онтологией вкладок.

## 4. OperOps tab normalization

### 4.1 Target contract

OperOps tabs должны быть полностью status-first.

| Tab | Filter contract |
|---|---|
| `Draft` | все `DRAFT_10` |
| `Ready` | все `READY_10`, включая accepted Voice tasks |
| `In Progress` | `PROGRESS_10` |
| `Review` | `REVIEW_10` |
| `Done` | `DONE_10` |
| `Archive` | `ARCHIVE` |
| `Codex` | `codex_task = true` |

### 4.2 Важное ограничение

Special grouping допустима только как presentation layer:
- например `voiceTabGrouping` для draft Voice rows

Но она не должна считаться отдельной semantic model.

Иначе говоря:
- tab contract определяется статусом;
- grouping contract определяется presentation need.

## 4.3 Текущая фактическая группировка в OperOps

Ниже зафиксировано текущее поведение `CRMPage.tsx`, чтобы этот документ был самодостаточным.

### 4.3.1 Верхние summary widgets

| Виджет | Фактические статусы |
|---|---|
| `Total` | `BACKLOG_10`, `NEW_10`, `NEW_20`, `NEW_30`, `NEW_40`, `PLANNED_10`, `PLANNED_20`, `READY_10`, `PROGRESS_0`, `PROGRESS_10`, `PROGRESS_20`, `PROGRESS_30`, `PROGRESS_40`, `REVIEW_10`, `REVIEW_20`, `AGREEMENT_10`, `AGREEMENT_20`, `DONE_10` |
| `Backlog` | `BACKLOG_10` |
| `New` | `NEW_10`, `NEW_20`, `NEW_30`, `NEW_40` |
| `Plan` | `PLANNED_10`, `PLANNED_20` |
| `Work` | `READY_10`, `PROGRESS_0`, `PROGRESS_10`, `PROGRESS_20`, `PROGRESS_30`, `PROGRESS_40` |
| `Upload` | `AGREEMENT_10`, `AGREEMENT_20` |
| `Review` | `REVIEW_10`, `REVIEW_20` |
| `Done` | `DONE_10`, `DONE_30` |

### 4.3.2 Нижние main tabs и subtabs

| Surface | Фактические статусы / правило |
|---|---|
| `Voice` | все не-архивные voice-related rows; внутри `Voice backlog` draft определяется как `DRAFT_10`, а legacy/voice grouping дополнительно использует `source_kind` |
| `Plan > New` | `NEW_10`, `NEW_20`, `NEW_30`, `NEW_40` |
| `Plan > Plan` | `PLANNED_10`, `PLANNED_20` |
| `Backlog > Backlog` | `BACKLOG_10` |
| `Backlog > Work` | `READY_10`, `PROGRESS_0`, `PROGRESS_10`, `PROGRESS_20`, `PROGRESS_30`, `PROGRESS_40` |
| `Backlog > Review` | `REVIEW_10`, `REVIEW_20` |
| `Work` | те же `READY_10`, `PROGRESS_*` |
| `Review` | те же `REVIEW_*` |
| `Done` | `DONE_10`, `DONE_30`, плюс `null` |
| `Archive` | `DONE_20`, `ARCHIVE` |
| `Codex` | `codex_task = true`, без CRM status filter |

### 4.3.3 Текущий mismatch

| Проблема | Наблюдение |
|---|---|
| Неполное покрытие верхних виджетов | `DRAFT_10`, `ARCHIVE`, `PERIODIC`, `DONE_20` и часть legacy state не попадают в верхнюю строку |
| Перекрытие навигации | `Backlog > Work` и main tab `Work` используют одни и те же статусы; то же для `Review` |
| `Voice` не status-first | вкладка `Voice` использует special grouping поверх неархивных rows, а не чистый status partition |
| `Done`/`Archive` split неочевиден | `DONE_20` живет в `Archive`, а `DONE_10`/`DONE_30` — в `Done` |
| `Upload` есть в статусах, но отсутствует как main tab | есть widget и subtab config, но нет main tab |

## 4.4 Telegram miniapp: что доступно исполнителю по статусам

Текущий miniapp backend задаёт отдельный performer-facing status surface.

### 4.4.1 Какие задачи исполнитель вообще видит в miniapp

Сейчас miniapp отдаёт исполнителю только задачи со статусами:

| Группа | Статусы |
|---|---|
| `Backlog` | `BACKLOG_10` |
| `Work` | `READY_10`, `PROGRESS_10`, `PROGRESS_20`, `PROGRESS_30`, `PROGRESS_40` |
| `Review` | `REVIEW_10` |
| `Periodic` | `PERIODIC` |

То есть miniapp **не** является полным окном во весь словарь статусов.

Он не показывает по текущему route:
- `DRAFT_10`
- `NEW_*`
- `PLANNED_*`
- `REVIEW_20`
- `AGREEMENT_*`
- `DONE_*`
- `ARCHIVE`

### 4.4.2 Какие статусы miniapp формально может поставить

`/miniapp/tickets/set-status` сейчас принимает любой `newStatus`, если он входит в `TASK_STATUSES`.

Но есть важное исключение:
- если текущий статус задачи = `PERIODIC`,
- miniapp не позволяет менять статус этой задачи.

Следствие:
- visibility surface miniapp уже уже, чем полный словарь;
- status mutation surface backend формально шире, чем видимость;
- это нужно считать отдельным miniapp-specific contract, а не общим CRM contract.

### 4.4.3 Нормативный вывод

В дальнейшей нормализации нужно отдельно решить:

1. miniapp должен быть:
   - полным status-first surface для исполнителя
   - или ограниченным performer-work surface

2. если оставляем второй вариант, его нужно явно описывать как:
   - `Performer Work Surface`
   - а не как “все статусы, доступные исполнителю”

3. status mutation policy в miniapp должна быть приведена в соответствие с его visibility policy:
   - либо mutation тоже ограничивается видимыми группами,
   - либо это явно документируется как backend-level permissiveness

## 5. MCP / API normalization

### 5.1 Текущий фактический контракт

Сейчас по коду и MCP:

- `voice.project(project_id)` / `voice.projects()`
  - project context
- `voice.fetch(session_id, mode=\"transcript\")`
  - transcript + metadata
- `voice.crm_tickets(session_id=...)`
  - accepted task view for a session
- `voice.session_possible_tasks(session_id)`
  - draft task view for a session

### 5.2 Нормализация mental model

Новая спека должна закрепить:

- `voice.crm_tickets(session_id)` = accepted-only session task view
- `voice.session_possible_tasks(session_id)` = draft-only session task view

### 5.3 Future direction

В будущем можно ввести unified method, например:
- `voice.session_tasks(session_id, include_drafts=true|false, include_codex=true|false)`

Но это future simplification.  
Сейчас удалять `session_possible_tasks` не требуется.

## 6. Контракт project binding для voice session

### 6.1 Нормализация

- `session.project_id` = canonical project binding
- `session_name` = human-readable label only
- `routing-topic` = derived routing classification

### 6.2 Следствие

Direct voice-session reporting должен использовать:
- `session.project_id`
- а не `session_name`

Если `session_name` и `project_id` конфликтуют:
- это metadata conflict
- routing не должен переопределяться по `session_name`

### 6.3 Bucket rule

Voice session может войти в operational bucket только если:
- её `project_id` входит в whitelist `sources.project[]`

Совпадение только по времени:
- не делает session релевантной bucket автоматически

Это уже соответствует текущему patched `StratoProject` behavior.

## 7. Product decision

### Решение

Целевая модель:
- отдельная вкладка `Возможные задачи` не нужна;
- draft rows показываются как обычный status filter `DRAFT_10` внутри общей task surface `Задачи`.

### Почему

Потому что:
- draft и accepted rows уже являются одной сущностью;
- их различие целиком выражается статусом;
- отдельная draft tab semantics создает лишнее дублирование в UI и API модели.

## 8. Тестовые сценарии

### Session scope
- `voice.crm_tickets(session_id)` возвращает только accepted rows
- `voice.session_possible_tasks(session_id)` возвращает только draft rows

### Label-only
- в user-facing tables и reports показываются только labels
- internal keys не показываются вне diagnostic contexts

### Voice / task surfaces
- вкладка `Задачи` при фильтре `DRAFT_10` == `DRAFT_10` session-scoped count
- accepted filters внутри вкладки `Задачи` exclude `voice_possible_task`
- `Codex` count matches `codex_task = true`

### OperOps tabs
- каждый tab определяется explicit status filter set
- никаких hidden semantic shortcuts кроме draft grouping layer

### Metadata conflict
- direct voice session report uses `session.project_id`
- conflicting `session_name` не re-route’ит session

### Reporting
- draft rows не называются `Backlog`
- нет шума вида `Срок: не указан`
- используется только реальный CRM status

## Assumptions

- Это новая documentation-only spec, без кодовых изменений в этой волне.
- [voice-task-status-normalization-plan.md](/home/strato-space/copilot/plan/voice-task-status-normalization-plan.md) остается as-built runtime contract.
- Новый файл служит semantic/UX normalization spec поверх уже реализованного runtime.
- Canonical new file:
  - `/home/strato-space/copilot/plan/voice-task-surface-normalization-spec.md`

## BD

- ✅ `copilot-cux2` — [operops][voice] Normalize task widgets and tabs to complete non-overlapping status partition
- ✅ `copilot-cux2.1` — T1 Define complete non-overlapping task status partition
- ✅ `copilot-cux2.2` — T2 Document current mismatch between widgets, tabs, and status dictionary
- ✅ `copilot-cux2.3` — T3 Update voice task surface normalization spec and BD tracking

### DAG

- `copilot-cux2.1 -> copilot-cux2.3`
- `copilot-cux2.2 -> copilot-cux2.3`
