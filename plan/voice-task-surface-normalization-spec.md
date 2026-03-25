# Спецификация: нормализация task surfaces Voice и OperOps по статусам

## Status ✅Closed

- Task-surface ticket line: ⚪Open 0  🟡In Progress 0  💤Deferred 0  ⛔Blocked 0  ✅Closed 20
- Plan status: implemented contract; production data aligned; live Mongo rechecked and legacy CREATE_TASKS payload migration applied on 2026-03-21.
- Canonical design epic: `copilot-cux2`
- Completed execution epics: `copilot-ojxy`, `copilot-kdqs`
- Known follow-up bug: `copilot-f6z4` (`session_tasks(bucket='Ready+')` leaking `DRAFT_10` rows on session-scoped path is a contract violation, not accepted behavior)
- Mongo re-check (2026-03-21): live `automation_tasks` still stores status labels (`Draft`, `Ready`, `Progress 10`, `Review / Ready`, `Done`, `Archive`); key-first semantics are restored in runtime via `TASK_STATUSES` and `resolveTaskStatusKey`, not by raw key persistence in Mongo.

**Статус документа**: implemented contract; production data aligned; prod verified
**Дата**: 2026-03-21
**Основание**: текущий strict runtime-контракт, существующие routes `voicebot/session_tasks`, `voicebot/session_tab_counts`, `voice.crm_tickets(session_id=...)`, текущая OperOps CRM surface, live Mongo recheck against `automation_tasks` on 2026-03-21 и закрепленные product notes в [AGENTS.md](/home/strato-space/copilot/AGENTS.md).

## Кратко

Эта спецификация утверждает **целевой replacement contract** по task surfaces Voice и OperOps.

Главный смысл документа:
- он фиксирует replacement UX/status-surface semantics, которые были утверждены и уже легли в основную status model;
- он остается главным semantic contract для текущего runtime;
- для legacy/migration context дополнительно сохраняется [voice-task-status-normalization-plan.legacy.md](/home/strato-space/copilot/plan/archive/voice-task-status-normalization-plan.legacy.md);
- текущая production truth должна читаться через этот документ, deployed code и rollout notes in `bd`;
- completed cutover/deprecation waves зафиксированы в `bd` и changelog.

Базовый тезис:
- `Возможные задачи` не являются отдельной storage-сущностью;
- все task surfaces работают поверх одной коллекции `automation_tasks`;
- различие между draft и accepted rows задается главным образом `task_status`;
- `voice.session_tasks(session_id, bucket="Draft")` — это canonical draft read path и он должен читать только strict `DRAFT_10` rows;
- `source_kind` — вспомогательный provenance/runtime marker, а не главный semantic discriminator;
- `codex_task` — отдельный тип taskflow, а не атрибут различения между draft и accepted rows;
- `PERIODIC` в target ontology выводится из lifecycle dictionary и переносится в отдельную recurrence dimension.

## 0. Mongo Re-Verification (2026-03-21)

Этот раздел фиксирует свежую live-проверку Mongo поверх уже закрытой normalization wave. Он не переписывает исторический migration narrative ниже, а уточняет текущую production truth.

Проверенные live коллекции:
- `automation_tasks` = `5573` docs
- `automation_voice_bot_sessions` = `2060` docs
- `automation_voice_bot_messages` = `13230` docs
- `automation_comments` = `2229` docs

Текущий live `task_status` в `automation_tasks`:
- stored values остаются label-значениями, а не raw status keys
- current distribution: `Archive=3002`, `Draft=1616`, `Done=288`, `Ready=127`, `Review / Ready=62`, `Progress 10=11`
- contract ниже продолжает использовать status keys (`DRAFT_10`, `READY_10`, ...) как semantic/runtime axis; storage reality нужно читать через runtime normalization layer, а не как отсутствие key-first semantics

Текущий live voice-derived slice:
- `source_kind=voice_possible_task` -> `1611` live rows, все со stored `task_status = Draft`
- `5` additional Draft rows currently have no `source_kind`, so `source_kind` remains metadata rather than semantic gate
- `source_kind=voice_session` -> `33` live rows: `Ready=25`, `Progress 10=4`, `Review / Ready=4`
- direct `discussion_sessions[]` materialized only on части current draft docs (`1211/1616`); compatibility mirror `source_data.voice_sessions[]` остается важной частью live read semantics
- current accepted `source_kind=voice_session` rows практически не materialize direct `discussion_sessions[]`; accepted session linkage сейчас живет через `source_ref` / `external_ref` / `source_data.voice_sessions[]` и lineage fields `accepted_from_possible_task` / `accepted_from_row_id`
- `source_data.refresh_state = "stale"` больше не встречается на live Draft rows, но сохраняется как legacy payload residue на `5` accepted `voice_session` rows (`Ready=3`, `Review / Ready=2`) и не является semantic gate
- after payload-to-draft migration `0` active `automation_voice_bot_sessions` still retain `processors_data.CREATE_TASKS.data`; residual payload remains only on `78` non-active / historical sessions and no longer participates in normal runtime draft semantics
- `automation_comments` содержит live данные (`2229` docs), но current Mongo не показывает populated voice-linkage fields (`source_session_id`, `discussion_session_id`, `dialogue_reference` all `0` non-empty rows); comment linkage нужно трактовать как supported contract surface, а не уже-populated storage truth
- repo code check: `backend/src` no longer contains runtime reads of `processors_data.CREATE_TASKS.data` or `agent_results.create_tasks`

## 1. Нормативная рамка документа

### 1.1 Что документ делает

Этот документ:
- фиксирует `As Is` runtime/storage/UI semantics;
- фиксирует `To Be` replacement contract;
- фиксирует уже-landed replacement outcome и его current runtime shape;
- отделяет текущий contract от historical migration context.

### 1.2 Что документ не делает

Этот документ:
- не отменяет текущий продовый as-built contract;
- не запускает кодовые изменения в этой волне;
- не заменяет текущие smoke/recovery/runbook документы.

### 1.3 Источники истины по слоям

В текущей переходной модели:
- `Current runtime truth`:
  - этот файл
  - текущий код в `app/`, `backend/`, `miniapp/`
  - rollout notes in `bd` (`copilot-sc1b`, `copilot-ds1z`, `copilot-ojxy`)
- `Legacy / migration reference`:
  - [voice-task-status-normalization-plan.legacy.md](/home/strato-space/copilot/plan/archive/voice-task-status-normalization-plan.legacy.md)
  - historical repo product notes where not yet updated

## 2. Единая модель задач

### 2.1 Канонический storage model

Все Voice-derived rows — это документы в `automation_tasks`.

Нормализация:

| Вид строки | Статус | Что означает |
|---|---|---|
| Draft Voice row | `DRAFT_10` | Черновик из `Возможных задач` |
| Accepted Voice task (initial) | `READY_10` | Текущий accepted bucket сразу после materialization |
| Codex task | свой lifecycle | Отдельный Codex taskflow |

Дополнительно:
- accepted rows дальше живут обычным CRM lifecycle;
- draft и accepted rows разделены storage-wise статусом;
- `source_kind` и `codex_task` остаются orthogonal dimensions.
- current Mongo stores status values as labels (`Draft`, `Ready`, ...); этот документ использует status keys как canonical contract vocabulary и предполагает runtime normalization back to keys.

### 2.1.1 Справка по `source_kind`

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

### 2.1.1a Verified live Mongo snapshot (2026-03-21)

Проверка `automation_tasks` подтверждает:
- raw Mongo хранит status labels (`Draft`, `Ready`, `Progress 10`, `Review / Ready`, `Done`, `Archive`), а key-semantics (`DRAFT_10`, `READY_10`, ...) живут на API/spec уровне;
- live Draft rows включают `1611` документов с `source_kind=voice_possible_task` и `5` Draft rows без `source_kind`, поэтому `source_kind` не может быть semantic gate;
- no live draft rows remain with `source_data.refresh_state="stale"`;
- session linkage в raw storage универсально восстанавливается из `source_ref` / `external_ref` / `source_data.voice_sessions[]`;
- direct `discussion_sessions[]` в raw Mongo пока неполон, а `discussion_count` является derived read-field, а не отдельным stored field.

### 2.1.2 Задействованные ontology objects и relations

Новая нормализация должна опираться на уже существующую ontology, а не придумывать отдельный vocabulary только для UI.

#### AS-IS entities

Задействованные объекты:
- `project`
- `project_group`
- `person`
- `performer_profile`
- `task`
- `voice_session`
- `voice_message`
- `status_dict`
- `priority_dict`

Практический смысл:
- `task` — canonical storage object для draft и accepted task rows
- `voice_session` — canonical session object
- `voice_message` — evidence/event layer, но не отдельная task сущность
- `person` и `performer_profile` — не одно и то же; assignment идет через performer profile
- `status_dict` и `priority_dict` — словарные сущности, а не просто строки

#### AS-IS relations

Ключевые связи:
- `project_has_task`
- `voice_session_sources_task`
- `task_has_status`
- `task_has_priority`
- `task_assigned_to_performer_profile`
- `voice_session_has_message`
- `project_has_voice_session`
- `transcript_segment_spoken_by_person`
- `person_has_performer_profile`

Практический смысл:
- `voice_session_sources_task` связывает voice session и task lineage
- `task_has_status` и `task_has_priority` — dictionary-backed semantics
- `task_assigned_to_performer_profile` — assignment должен мыслиться через performer profile, а не через generic person

#### TO-BE / bridge layer, already relevant

Если normalization в будущем углубляется, уже существующие TO-BE объекты и связи остаются релевантны:
- `task` as single semantic carrier
- `as_is_voice_session_maps_to_mode_segment`
- `as_is_voice_message_maps_to_object_event`

Но текущая спецификация не требует немедленного переключения UI на отдельную TO-BE сущность поверх `task`.  
Она фиксирует status-first semantics поверх текущего AS-IS storage model и задает следующий replacement contract.
Иными словами: current ontology и Mongo теперь сходятся в одном primary entity name `task`; исторические draft/projection labels больше не должны читаться как отдельные entity kinds.

### 2.1.1b AS IS / TO BE session linkage

AS IS:
- session linkage в raw storage живет через `source_ref`, `external_ref`, `source_data.session_id` и `source_data.voice_sessions[]`;
- top-level `discussion_sessions[]` materialized only partially;
- `discussion_count` остается derived read-field.

TO BE:
- один `task` должен first-class ссылаться на множество `voice_session`, где он обсуждался;
- `discussion_sessions[]` должен стать canonical normalized task/session linkage field for read/write surfaces;
- evidence до чанка/сообщения остается отдельным trace layer, а не смешивается с task storage.

Migration implication:
- historical `processors_data.CREATE_TASKS.data` must be materialized into `DRAFT_10` task docs;
- after the 2026-03-21 migration wave only an ambiguous residual tail remains; session payload `.data` is no longer part of runtime semantics and should be fully cleared as residual cases are resolved.

### 2.2 Следствие для backend semantics

Отсюда следует:
- `possible_tasks` не является отдельной storage-сущностью;
- `crm_tickets(session_id=...)` — accepted-task view над той же коллекцией;
- `session_tasks(session_id, bucket="Ready+")` — session-scoped accepted-only task view над той же коллекцией;
- `voicebot/codex_tasks` — codex-only **session-scoped** view над той же коллекцией;
- OperOps `Codex` в целом не должен в этой спеke описываться как Mongo-only view над `automation_tasks`, потому что current product surface там backed by `bd` CLI / issue tracker, а не только общей task collection;
- `session_tasks(session_id, bucket="Draft")` нельзя сводить к session payload fallback; он должен читаться только из canonical draft rows по `task_status = DRAFT_10`.
- `session_tasks(session_id, bucket="Ready+")` не должен возвращать `DRAFT_10`;
- если accepted rows для session отсутствуют, `session_tasks(session_id, bucket="Ready+")` должен возвращать пустой список, а не fallback to draft rows.
- raw storage linkage к voice session сегодня может идти через `source_ref`, `external_ref`, `source_data.session_id` и `source_data.voice_sessions[]`; normalized `discussion_sessions[]` useful for reads, но не является единственным storage predicate.

### 2.3 Контракт `voice.session_tasks(session_id, bucket="Draft")`

#### Storage semantics

Storage-wise:
- это draft-only view над `automation_tasks`;
- в текущем runtime этот draft layer выражается прежде всего через `task_status = DRAFT_10`.

#### Behavioral semantics

Behavior-wise:
- это strict canonical draft route для текущей voice session;
- route возвращает не immutable snapshot, а текущий канонический набор draft rows для этой сессии;
- допускается in-place update существующих draft rows;
- при совпадении scope должен переиспользоваться тот же `row_id/id`;
- route участвует в dedupe semantics относительно уже materialized accepted tasks;
- route не должен подмешивать session-local compatibility payload (`processors_data.CREATE_TASKS.data`, `agent_results.create_tasks`) когда canonical draft rows отсутствуют;
- write-side compatibility projection в `processors_data.CREATE_TASKS.data` не является допустимой operational model и подлежит удалению;
- это не mere reporting route и не should-be-treated-as “just another filtered list”.

#### Split against accepted tasks

В этой нормализации:
- `voice.crm_tickets(session_id)` = accepted-only session task view
- `voice.session_tasks(session_id, bucket="Draft")` = strict canonical draft baseline

### 2.4 Контракт `voice.session_tasks(session_id, bucket="Ready+")`

#### Storage semantics

Storage-wise:
- это accepted-only session-scoped view над `automation_tasks`;
- bucket читает только non-draft lifecycle rows, уже принятые вне mutable draft baseline.

#### Behavioral semantics

Behavior-wise:
- это strict canonical accepted bucket для текущей voice session;
- route может возвращать только accepted lifecycle rows, связанных с данной session;
- bucket не должен fallback’иться в draft rows, session payload compatibility data или другие provenance-based substitutes;
- если accepted rows отсутствуют, route должен возвращать `[]`;
- bucket не должен дублировать `bucket="Draft"` ни по составу rows, ни по lifecycle semantics.

#### Allowed status keys

Для `bucket="Ready+"` допустимы только:
- `READY_10`
- `PROGRESS_10`
- `REVIEW_10`
- `DONE_10`
- `ARCHIVE`

#### Forbidden status keys

Для `bucket="Ready+"` недопустимы:
- `DRAFT_10`
- любые legacy draft/new aliases, нормализуемые в `DRAFT_10`

#### Known contract violation

Observed runtime bug:
- `copilot-f6z4`
- symptom: `session_tasks(bucket="Ready+")` on session-scoped path may leak `DRAFT_10` rows
- classification: implementation bug / contract violation
- status: must be fixed in backend/client path; spec does not permit this behavior

## 3. Ключи, stored values и labels

Текущий runtime словарь статусов encoded как:
- `status key -> stored/user-facing string value`

Практически это значит:
- часть кода оперирует status keys (`DRAFT_10`, `READY_10`, ...)
- часть current surfaces фактически живет через stored labels (`Draft`, `Backlog`, ...)
- отдельные current UI flows still reverse-resolve keys from labels

Поэтому в этом документе нужно различать:
- `status key`
- `current stored/runtime value`
- `user-facing label`

Target-wave contract хочет key-first filters и API semantics, но нельзя писать так, как будто это уже универсально true в текущем runtime.

## 4. As Is status dictionary

### 4.1 Таблица текущих статусов CRM (As Is)

Для полноты этот документ дублирует текущий словарь статусов из runtime-контракта.

Столбец `Исполнительский surface` использует легенду:
- `✏️` — исполнитель видит и может менять статус;
- `👁` — исполнитель видит, но не может менять статус;
- `—` — статус не входит в текущий performer-facing miniapp surface.

Числа ниже отражают current live Mongo re-check from `2026-03-21` (`automation_tasks`, `is_deleted != true`).

| Live label | Key | Текущее кол-во | Текущий runtime смысл | Исполнительский surface |
|---|---|---:|---|---|
| `Legacy / Backlog` | `NEW_0` | `0` | Legacy-only alias; не должен использоваться новым write-path | `—` |
| `Draft` | `DRAFT_10` | `1616` | Текущий storage bucket для `voice_possible_task`; draft-only rows | `—` |
| `Backlog` | `BACKLOG_10` | `0` | Legacy accepted-task bucket kept only for compatibility / migration input | `✏️` |
| `New / Request` | `NEW_10` | `0` | Первичный входящий запрос | `—` |
| `New / Clientask` | `NEW_20` | `0` | Клиентский запрос до нормализации | `—` |
| `New / Detail` | `NEW_30` | `0` | Требует уточнения | `—` |
| `New / Readyforplan` | `NEW_40` | `0` | Готово к планированию | `—` |
| `Plan / Approval` | `PLANNED_10` | `0` | План на согласовании | `—` |
| `Plan / Performer` | `PLANNED_20` | `0` | План на стороне исполнителя | `—` |
| `Ready` | `READY_10` | `127` | Текущий accepted working bucket, including materialized Voice tasks after normalization | `✏️` |
| `Rejected` | `PROGRESS_0` | `0` | Legacy drift status; current live label is `Rejected` и не найдено следов использования статуса | `✏️` |
| `Progress 10` | `PROGRESS_10` | `11` | Работа начата | `✏️` |
| `Progress 25` | `PROGRESS_20` | `0` | Промежуточный чекпоинт | `✏️` |
| `Progress 50` | `PROGRESS_30` | `0` | Mid-state | `✏️` |
| `Progress 90` | `PROGRESS_40` | `0` | Почти завершено | `✏️` |
| `Review / Ready` | `REVIEW_10` | `62` | Готово к ревью / приемке | `✏️` |
| `Review / Implement` | `REVIEW_20` | `0` | Возврат из ревью | `👁` |
| `Upload / Deadline` | `AGREEMENT_10` | `0` | Подготовка к дедлайну | `—` |
| `Upload / Delivery` | `AGREEMENT_20` | `0` | Delivery / handoff | `—` |
| `Done` | `DONE_10` | `288` | Выполнено | `—` |
| `Complete` | `DONE_20` | `0` | Полностью завершено | `—` |
| `PostWork` | `DONE_30` | `0` | Пост-работа | `—` |
| `Archive` | `ARCHIVE` | `3002` | Исторический хвост | `—` |
| `Periodic` | `PERIODIC` | `0` | Legacy recurring runtime bucket | `👁` |

### 4.2 As Is note: `PROGRESS_0`

`PROGRESS_0` требует отдельного пояснения, потому что это current semantic drift point.

Наблюдаемое по живому коду и текущим документам:
- live backend/app/miniapp constants задают `PROGRESS_0 = Rejected`;
- старые planning материалы описывали этот же key как `Progress 0 / Готово к старту`;
- current OperOps grouping все еще включает `PROGRESS_0` в `Work`;
- active live count = `0`, что снижает migration risk.

Следствие:
- текущий runtime label и старое плановое объяснение расходятся;
- это нужно считать legacy drift, а не нормальным устойчивым semantics;
- в `As Is` этот статус должен нормализоваться как отдельный `Rejected` status group, а не как подвид `In Progress`;
- именно поэтому `PROGRESS_0` в target model подлежит удалению, а не сохранению.

Краткий результат обследования live usage:
- текущих задач со `status = Rejected / PROGRESS_0` не найдено;
- inline `task_status_history` в `automation_tasks` не содержит переходов через `Rejected / PROGRESS_0`;
- audit-коллекция `automation_tasks_histrory` не содержит переходов с `old_value/new_value = Rejected / PROGRESS_0`.

Как выполнялась проверка:
- проверялся current `task_status` в `automation_tasks`;
- отдельно проверялись массивы `task_status_history` в самих задачах;
- отдельно проверялась audit-коллекция `automation_tasks_histrory` по полю `property = task_status`.

### 4.3 Полное непересекающееся разбиение статусов (As Is)

Для current status-first анализа главным должен быть один полный partition по status groups.

| Status group | Статусы | Лейбл группы |
|---|---|---|
| `Draft` | `DRAFT_10` | `Draft` |
| `New` | `NEW_0`, `NEW_10`, `NEW_20`, `NEW_30`, `NEW_40` | `New` |
| `Plan` | `PLANNED_10`, `PLANNED_20` | `Plan` |
| `Backlog` | `BACKLOG_10` | `Backlog` |
| `Ready` | `READY_10` | `Ready` |
| `Rejected` | `PROGRESS_0` | `Rejected` |
| `In Progress` | `PROGRESS_10`, `PROGRESS_20`, `PROGRESS_30`, `PROGRESS_40` | `In Progress` |
| `Review` | `REVIEW_10`, `REVIEW_20` | `Review` |
| `Upload` | `AGREEMENT_10`, `AGREEMENT_20` | `Upload` |
| `Done` | `DONE_10`, `DONE_20`, `DONE_30` | `Done` |
| `Archive` | `ARCHIVE` | `Archive` |
| `Periodic` | `PERIODIC` | `Periodic` |

Это разбиение:
- полное относительно текущего `TASK_STATUSES`;
- непересекающееся;
- пригодное как для текущего UI mismatch analysis, так и для migration reasoning.

`source_kind` и `codex_task` в это разбиение не входят; это orthogonal dimensions.

## 5. Historical As Is overview: recurring tasks (`PERIODIC`) on 2026-03-14

### 5.1 Почему этот срез tractable

Этот раздел сохраняется как historical snapshot migration wave.

На момент среза `2026-03-14` активных `PERIODIC` rows было `10`.

Fresh live re-check `2026-03-21` больше не показывает active `PERIODIC` rows в `automation_tasks`, поэтому этот inventory нельзя читать как current runtime distribution.

Это достаточно маленький объем, чтобы:
- показать полный inventory прямо в спеke;
- вручную провалидировать recurring slice;
- выполнить explicit migration в separate recurrence dimension без mass heuristics.

### 5.2 Полный текущий список

1. `Ресёрч ComfyUI-схем для локальной генерации + Server run` — project `MediaGen` — performer `Марат Кабиров` — priority `P4`
2. `Планирование, коммуникации по проекту, сбор обратной связи Ural БП` — project `Ural BortProvodnik` — performer `Valentin Gatitulin` — priority `P7`
3. `Планирование, коммуникации по проекту, сбор обратной связи Metro Spot` — project `Metro Spot` — performer `Valentin Gatitulin` — priority `P7`
4. `Планирование, коммуникации по проекту, сбор обратной связи Ural RMS` — project `Ural` — performer `Valentin Gatitulin` — priority `P7`
5. `Отчетность Jira` — project `Andrey Q2 OKR` — performer `Андрей Сергеев` — priority `P1`
6. `Постановка задач в CRM: Заведение и актуализация задач` — project `Andrey Q2 OKR` — performer `Андрей Сергеев` — priority `P1`
7. `Metro: Исследование, стратегия, дизайн надзор.` — project `Metro Spot` — performer `Nikita Renye` — priority `P7`
8. `Ural: Исследование, стратегия, дизайн надзор.` — project `Ural` — performer `Nikita Renye` — priority `P7`
9. `Саппорт входящих запросов (быстрые генерация для команды)` — project `PMO` — performer `Марат Кабиров` — priority `P1`
10. `Адаптация креативов под форматы` — project `RockStar` — performer `Ербол Тастанбеков` — priority `P3`

### 5.3 Минимальная аналитика

- total active `PERIODIC` rows: `10`
- projects covered: `7`
- performers covered: `5`
- `source` / `source_kind` distribution: у всех `10` строк explicit source markers отсутствуют

#### Концентрация по проектам

- `Metro Spot` = `2`
- `Ural` = `2`
- `Andrey Q2 OKR` = `2`
- `MediaGen` = `1`
- `Ural BortProvodnik` = `1`
- `PMO` = `1`
- `RockStar` = `1`

#### Концентрация по исполнителям

- `Valentin Gatitulin` = `3`
- `Марат Кабиров` = `2`
- `Андрей Сергеев` = `2`
- `Nikita Renye` = `2`
- `Ербол Тастанбеков` = `1`

#### Распределение по приоритетам

- `P1` = `3`
- `P3` = `1`
- `P4` = `1`
- `P7` = `5`

### 5.4 Интерпретация

Текущие periodic rows:
- достаточно малочисленны, чтобы мигрировать их explicit-way;
- по содержанию больше похожи на recurring operating commitments, чем на lifecycle states;
- тем самым поддерживают target decision: recurrence должна жить вне lifecycle status dictionary.

## 6. To Be: next-wave target status dictionary

### 6.1 Базовое target-решение

Следующая implementation wave должна перейти к следующей целевой модели:

- `DRAFT_10` и `NEW_*` принадлежат одному семейству draft/new work-in-definition;
- `BACKLOG_10` и `READY_10` принадлежат одному семейству accepted ready work;
- `NEW_0` по смыслу совпадает с draft-низшим уровнем и должен схлопнуться в `DRAFT_10`;
- `PROGRESS_0` в целевой модели считается legacy-статусом и подлежит удалению из словаря;
- `PROGRESS_20`, `PROGRESS_30`, `PROGRESS_40` в целевой модели считаются избыточными промежуточными чекпоинтами и подлежат удалению;
- `PERIODIC` в целевой модели не является lifecycle status и уходит в отдельную recurrence dimension;
- ключи и labels должны быть приведены к более общепринятой task-tracker semantics.

### 6.2 Целевая цепочка схлопывания

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
| `REVIEW_20` | `<remove or merge to PROGRESS_10>` |
| `AGREEMENT_10` | `<remove>` |
| `AGREEMENT_20` | `<remove>` |
| `DONE_20` | `DONE_10` |
| `DONE_30` | `DONE_10` |
| `PERIODIC` | `<move to recurrence flag>` |

### 6.3 Целевой смысл

В целевой модели:
- `Draft` включает LLM-derived candidates и любые новые задачи в разной степени проработки;
- `Ready` становится первым accepted bucket для обычной рабочей задачи;
- отдельная группа `New` исчезает как самостоятельная status family и встраивается в `Draft`;
- label `Backlog` в целевой модели не используется как top-level status family;
- `Work` переименовывается в `In Progress`;
- `PERIODIC` больше не считается task lifecycle status.

### 6.4 Таблица целевых статусов CRM (To Be)

Числа ниже отражают current live Mongo inventory after payload-to-draft migration (`2026-03-21`).
Практически важно то, что current active runtime уже почти полностью сидит на target six-status axis.

| Target label | Key | Текущее кол-во (As Is) | Целевой смысл | Исполнительский surface |
|---|---|---:|---|---|
| `Draft` | `DRAFT_10` | `1616` | Задача существует как черновик: её можно уточнять, дополнять, объединять или отклонять до принятия в рабочий контур. | `—` |
| `Ready` | `READY_10` | `127` | Задача принята в работу, назначена и полностью готова к началу исполнения, но исполнитель еще не перевел её в активное выполнение. | `✏️` |
| `In Progress` | `PROGRESS_10` | `11` | Исполнитель уже начал работу над задачей, и задача находится в активной фазе исполнения. | `✏️` |
| `Review` | `REVIEW_10` | `62` | Исполнитель завершил основной объем работы и передал задачу на проверку, согласование или приемку. | `✏️` |
| `Done` | `DONE_10` | `288` | Работа по задаче завершена и результат принят как достаточный; дополнительных рабочих шагов внутри обычного цикла больше не требуется. | `—` |
| `Archive` | `ARCHIVE` | `3002` | Задача выведена из активного контура и хранится только как историческая запись. | `—` |

Важно:
- это approved target dictionary следующей волны;
- это **не** уже развернутый runtime словарь.

### 6.5 Таблица статусов CRM к удалению / переносу (To Be)

Числа ниже также привязаны к current live Mongo inventory `2026-03-21`.

| Ключ | Текущее кол-во (As Is) | Live label | Текущий runtime смысл | Причина удаления / переноса | Целевое действие |
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
| `BACKLOG_10` | `0` | `Backlog` | Текущий accepted-task bucket для Voice materialization. | Accepted flow должен начинаться сразу с `Ready`. | `merge -> READY_10` |
| `PROGRESS_0` | `0` | `Rejected` | Legacy semantic drift status. | Не должен жить внутри target work axis. | `remove` |
| `PROGRESS_20` | `0` | `Progress 25` | Промежуточный чекпоинт. | Избыточный промежуточный чекпоинт. | `remove` |
| `PROGRESS_30` | `0` | `Progress 50` | Mid-state. | Избыточный промежуточный чекпоинт. | `remove` |
| `PROGRESS_40` | `0` | `Progress 90` | Почти завершено. | Избыточный промежуточный чекпоинт. | `remove` |
| `REVIEW_20` | `0` | `Review / Implement` | Возврат из ревью. | Не отдельный целевой top-level status. | `remove or merge to PROGRESS_10` |
| `AGREEMENT_10` | `0` | `Upload / Deadline` | Подготовка к дедлайну. | Отдельный upload bucket не нужен в целевой модели. | `remove` |
| `AGREEMENT_20` | `0` | `Upload / Delivery` | Delivery / handoff. | Отдельный upload bucket не нужен в целевой модели. | `remove` |
| `DONE_20` | `0` | `Complete` | Полностью завершено. | Избыточный финальный статус. | `merge -> DONE_10` |
| `DONE_30` | `0` | `PostWork` | Пост-работа. | Post-work не отдельный целевой top-level status. | `merge -> DONE_10` |
| `PERIODIC` | `0` | `Periodic` | Legacy recurring runtime bucket. | Recurrence mode, а не lifecycle status. | `move -> recurrence flag` |

### 6.6 Итоговая целевая статусная ось

В target model у каждой целевой группы остается ровно один канонический lifecycle status key:

- `Draft` -> `DRAFT_10`
- `Ready` -> `READY_10`
- `In Progress` -> `PROGRESS_10`
- `Review` -> `REVIEW_10`
- `Done` -> `DONE_10`
- `Archive` -> `ARCHIVE`

И отдельно:
- `Recurrence` -> orthogonal recurrence dimension, без отдельного lifecycle status key

Важно:
- user-facing surfaces показывают **лейбл**
- filters, API и code paths в target wave должны опираться на **ключ статуса**, а не на лейбл

## 7. Voice session surfaces

### 7.1 Historical As Is product contract

До status-first convergence product contract выглядел так:
- OperOps `Voice` tab является possible-task-centric;
- orphan `DRAFT_10` tasks без voice linkage рендерятся первыми;
- session-linked groups идут newest-first;
- processed tasks, связанные с той же session, остаются collapsed for reference.

Этот блок сохраняется как historical reference и не должен описываться так, будто это и есть целевой/current replacement contract.

### 7.2 Approved replacement contract

Новая status-first surface model для Voice session утверждена и должна читаться как authoritative replacement contract для текущей execution wave:

Target surfaces:
- `Задачи`
- `Codex`

В target model:
- `Draft` не имеет отдельной tab semantics;
- drafts выражаются как обычный status filter внутри общей task surface `Задачи`;
- внутри `Задачи` lifecycle filters повторяют ту же ось, что и в OperOps:
  - `Draft`
  - `Ready`
  - `In Progress`
  - `Review`
  - `Done`
  - `Archive`
- count по каждому lifecycle bucket показывается прямо в label соответствующего filter/tab справа;
- `Codex` остается отдельным codex-only surface.

Это не cosmetic cleanup, а **прямая замена текущего Voice surface contract**.

### 7.3 Target filters

Все filters ниже должны задаваться по **ключам статусов**, а не по пользовательским лейблам.

#### `Задачи`

Filter:
- session scope
- `codex_task != true`
- верхние lifecycle filters по status key:
  - `DRAFT_10`
  - `READY_10`
  - `PROGRESS_10`
  - `REVIEW_10`
  - `DONE_10`
  - `ARCHIVE`
- label filter’а показывает count справа для соответствующего bucket;
- parent counter у верхней вкладки `Задачи` равен сумме всех lifecycle buckets внутри неё, включая `Draft`;
- `Draft` count и parent `Задачи` count должны вычисляться только по canonical exact-key buckets;
- fixed lifecycle axis inside `Задачи` должна рендериться и при zero-state; empty state допустим только внутри выбранного lifecycle filter, а не вместо filter row;
- filters должны ориентироваться строго на one field: canonical `task_status` / resolved status key; `source_kind` не должен использоваться как substitute filter for lifecycle state

#### `Codex`

Filter:
- session scope
- `codex_task = true`

### 7.4 Вывод

Из этого следует:
- `voicebot/session_tasks(bucket="Draft")` / `voice.session_tasks(session_id, bucket="Draft")` остаётся canonical draft read path;
- `voicebot/session_tasks(bucket="Ready+")` / `voice.session_tasks(session_id, bucket="Ready+")` — canonical accepted-only session task bucket;
- появление `DRAFT_10` inside `bucket="Ready+"` является contract violation, а не допустимым compatibility mode;
- draft и accepted surfaces должны различаться exact status/filter semantics, а не session-payload fallback, provenance hints или разной target-онтологией вкладок.

## 8. OperOps tab normalization

### 8.1 Target contract

Основные lifecycle tabs в OperOps должны быть status-first; auxiliary views вроде `Codex` допускаются отдельно.

Дополнительно:
- count по каждому lifecycle bucket показывается прямо в label tab’а справа;
- отдельная верхняя строка summary widgets с теми же lifecycle labels и count’ами считается избыточной и должна быть удалена;
- если count уже присутствует в tab/filter label, этот же count не должен дублироваться рядом отдельным pill/widget с тем же статусом.

| Tab | Filter contract |
|---|---|
| `Draft` | все `DRAFT_10` |
| `Ready` | все `READY_10`, включая accepted Voice tasks |
| `In Progress` | `PROGRESS_10` |
| `Review` | `REVIEW_10` |
| `Done` | `DONE_10` |
| `Archive` | `ARCHIVE` |
| `Codex` | `codex_task = true` |

### 8.2 Важное ограничение

Special grouping допустима только как presentation layer:
- например current `voiceTabGrouping` для possible-task-centric `Voice`

Но она не должна считаться отдельной semantic model.

Иначе говоря:
- tab contract определяется lifecycle/relevance semantics;
- grouping contract определяется presentation need.

### 8.3 Historical pre-normalization grouping in OperOps (Legacy reference)

Ниже зафиксировано pre-normalization поведение `CRMPage.tsx`, чтобы документ был самодостаточным.

Важно:
- этот блок нужен как legacy reference и migration explanation;
- его нельзя читать как актуальный target contract;
- runtime convergence wave должна убирать именно эти дублирующиеся widgets/presentation splits.

#### 8.3.1 Верхние summary widgets

| Виджет | Фактические статусы |
|---|---|
| `Total` | `DRAFT_10`, `NEW_*`, `PLANNED_*`, `BACKLOG_10`, `READY_10`, `PROGRESS_0`, `PROGRESS_*`, `REVIEW_*`, `AGREEMENT_*`, `DONE_*`, `ARCHIVE`, `PERIODIC` |
| `Draft` | `DRAFT_10`, `NEW_*`, `PLANNED_*` |
| `Ready` | `BACKLOG_10`, `READY_10`, `PERIODIC` |
| `In Progress` | `PROGRESS_10`, `PROGRESS_20`, `PROGRESS_30`, `PROGRESS_40` |
| `Review` | `REVIEW_10`, `REVIEW_20` |
| `Done` | `AGREEMENT_10`, `AGREEMENT_20`, `DONE_10`, `DONE_20`, `DONE_30` |
| `Archive` | `ARCHIVE` |

#### 8.3.2 Нижние main tabs и subtabs

| Surface | Фактические статусы / правило |
|---|---|
| `Draft` | `DRAFT_10`, `NEW_*`, `PLANNED_*`; дополнительно рендерит possible-task-centric Voice backlog/groups above CRM table |
| `Ready` | `BACKLOG_10`, `READY_10`, `PERIODIC` |
| `In Progress` | `PROGRESS_10`, `PROGRESS_20`, `PROGRESS_30`, `PROGRESS_40` |
| `Review` | `REVIEW_10`, `REVIEW_20` |
| `Done` | `AGREEMENT_10`, `AGREEMENT_20`, `DONE_10`, `DONE_20`, `DONE_30`, плюс `null` |
| `Archive` | `ARCHIVE` |
| `Codex` | `codex_task = true`, без CRM status filter |

#### 8.3.3 Текущий mismatch

| Проблема | Наблюдение |
|---|---|
| Неполное покрытие верхних виджетов | `DRAFT_10`, `ARCHIVE`, `PERIODIC`, `DONE_20` и часть legacy state не попадают в верхнюю строку |
| Перекрытие навигации | `Backlog > Work` и main tab `Work` используют одни и те же статусы; то же для `Review` |
| `Voice` не status-first | вкладка `Voice` использует possible-task-centric grouping поверх неархивных rows, а не чистый status partition |
| `Done`/`Archive` split неочевиден | `DONE_20` живет в `Archive`, а `DONE_10`/`DONE_30` — в `Done` |
| `Upload` есть в статусах, но отсутствует как main tab | есть widget и subtab config, но нет main tab |
| `PROGRESS_0` semantic drift | live label = `Rejected`, но current widget/tab grouping still treats it as part of work |

## 9. Telegram miniapp: performer-facing status surface

### 9.1 As Is

Текущий miniapp backend задаёт отдельный performer-facing status surface.

Сейчас нужно различать два слоя:

1. Backend performer-facing canonical set:

| Группа | Статусы |
|---|---|
| `Draft` | `DRAFT_10` |
| `Ready` | `READY_10` |
| `In Progress` | `PROGRESS_10` |
| `Review` | `REVIEW_10` |
| `Done` | `DONE_10` |
| `Archive` | `ARCHIVE` |

2. Текущая miniapp UI tab surface:

| Группа | Статусы |
|---|---|
| `Draft` | `DRAFT_10` |
| `Ready` | `READY_10` |
| `In Progress` | `PROGRESS_10` |
| `Review` | `REVIEW_10` |
| `Done` | `DONE_10` |
| `Archive` | `ARCHIVE` |

То есть:
- backend performer-facing status contract уже canonical and strict;
- текущий miniapp UI tab surface теперь выровнен к тому же six-status set.

`/miniapp/tickets/set-status` сейчас принимает только canonical performer-facing keys:
- `DRAFT_10`
- `READY_10`
- `PROGRESS_10`
- `REVIEW_10`
- `DONE_10`
- `ARCHIVE`

### 9.2 Target-wave interpretation

В рамках этой спеки miniapp нужно трактовать как:
- `Performer Work Surface`
- а не как “полный status-first CRM surface”

Это означает:
- current miniapp behavior уже выровнен к canonical six-status performer surface;
- target decision про lifecycle normalization не делает miniapp автоматически полным окном во весь словарь;
- после выноса recurrence в отдельную dimension miniapp performer-work contract должен быть приведен в соответствие новой recurrence semantics.

## 10. MCP / API normalization

### 10.1 Текущий фактический контракт

Сейчас по коду и MCP:

- `voice.project(project_id)` / `voice.projects()`
  - project context
- `voice.fetch(session_id, mode="transcript")`
  - transcript + metadata
- `voice.crm_tickets(session_id=...)`
  - broader accepted/session-linked reporting surface
- `voice.session_tasks(session_id, bucket="Draft")`
  - strict canonical draft route for a session
- `voice.session_tasks(session_id, bucket="Ready+")`
  - strict canonical accepted-only session task bucket

### 10.2 Нормализация mental model

Новая спека закрепляет:

- `voice.session_tasks(session_id, bucket="Draft")` = strict canonical draft route
- `voice.session_tasks(session_id, bucket="Ready+")` = strict canonical accepted-only session task bucket
- `voice.crm_tickets(session_id)` = secondary accepted/session-linked reporting surface

### 10.3 Current strict contract

Сейчас:
- `voice.session_tasks(session_id, bucket="Draft")` должен читать только canonical `DRAFT_10` rows;
- `voice.session_tasks(session_id, bucket="Ready+")` должен читать только accepted rows (`READY_10`, `PROGRESS_10`, `REVIEW_10`, `DONE_10`, `ARCHIVE`);
- `voice.session_tasks(session_id, bucket="Ready+")` не должен возвращать `DRAFT_10`;
- `voice.crm_tickets(session_id)` должен читать только canonical accepted/session-linked rows как reporting surface;
- fallback к `processors_data.CREATE_TASKS.data` и `agent_results.create_tasks` не является частью target contract.

## 11. Контракт project binding для voice session

### 11.1 Нормализация

- `session.project_id` = canonical project binding
- `session_name` = human-readable label only
- `routing-topic` = derived routing classification

### 11.2 Следствие

Direct voice-session reporting должен использовать:
- `session.project_id`
- а не `session_name`

Если `session_name` и `project_id` конфликтуют:
- это metadata conflict
- routing не должен переопределяться по `session_name`

### 11.3 Bucket rule

Voice session может войти в operational bucket только если:
- её `project_id` входит в whitelist `sources.project[]`

Совпадение только по времени:
- не делает session релевантной bucket автоматически

Это уже соответствует текущему patched `StratoProject` behavior.

## 12. Product decision

### Решение

Целевая модель следующей волны:
- отдельная вкладка `Возможные задачи` не нужна как самостоятельная target semantics;
- draft rows показываются как обычный status filter `DRAFT_10` внутри общей task surface `Задачи`;
- `voice.session_tasks(session_id, bucket="Draft")` при этом сохраняется как strict canonical draft route;
- `PERIODIC` уходит из target lifecycle ontology в отдельную recurrence dimension.
- lifecycle filters внутри `Задачи` и OperOps используют одну и ту же status axis:
  - `Draft`
  - `Ready`
  - `In Progress`
  - `Review`
  - `Done`
  - `Archive`
- count по lifecycle bucket показывается inline в label filter/tab;
- duplicate widgets/pills с теми же lifecycle labels и count’ами в OperOps считаются избыточными и подлежат удалению.

### Почему

Потому что:
- draft и accepted rows уже являются одной storage-сущностью;
- различие draft/accepted выражается canonical `task_status` и session scope, а не compatibility payload;
- отдельная draft tab semantics создает лишнее дублирование в target UI и API модели;
- recurring commitments и lifecycle states — это разные виды вещей и не должны жить в одной статусной оси.

## 13. Тестовые сценарии

### Contract framing
- документ явно читается как approved replacement contract с ongoing execution wave
- документ различает production-aligned pieces и еще не закрытые compatibility/convergence tails

### Session scope
- `voice.crm_tickets(session_id)` возвращает только accepted rows
- `voice.session_tasks(session_id, bucket="Draft")` описан как strict canonical draft baseline без session-payload fallback
- `voice.session_tasks(session_id, bucket="Ready+")` описан как strict accepted-only bucket и не может возвращать `DRAFT_10`
- если `bucket="Ready+"` возвращает `DRAFT_10`, это bug (`copilot-f6z4`), а не допустимый compatibility path

### Label / key / value wording
- user-facing tables и reports показывают labels
- current runtime value и status key не смешиваются в одном термине
- current reverse-resolution behavior в UI не замаскирован под key-first universal truth

### Voice / task surfaces
- legacy `Voice` / `Возможные задачи` surface зафиксирован только как historical reference
- current replacement contract описан как `Задачи` + `Codex`
- draft semantics выражен через status filter внутри `Задачи`
- count по lifecycle filter inside `Задачи` показывается в самом label

### OperOps tabs
- каждый target tab определяется explicit status filter set
- count по lifecycle tab показывается в самом label
- duplicate summary widgets с теми же lifecycle labels/counts отсутствуют в target contract
- historical mismatches перечислены отдельно и не смешаны с target contract

### `PROGRESS_0`
- documented as `Rejected` in As Is
- есть короткое пояснение о legacy semantic drift
- указано, что current UI still treats it as work-like grouping

### `PERIODIC`
- нет подвешенного “maybe remove later” language
- As Is recurring inventory содержит ровно 10 строк
- target decision фиксирует move to recurrence dimension

### Metadata conflict
- direct voice session report uses `session.project_id`
- conflicting `session_name` не re-route’ит session

## 14. Assumptions

- Production data normalization for this contract has landed.
- Runtime read/filter contract for unified `Задачи` surface has landed locally and uses only canonical exact-key lifecycle filters.
- Session-payload fallback and write-side compatibility projection (`processors_data.CREATE_TASKS.data`) are no longer valid runtime semantics for draft state.
- Prod deploy and live verification for the unified `Задачи` surface and the `kdqs` deprecation wave are complete.
- [voice-task-status-normalization-plan.legacy.md](/home/strato-space/copilot/plan/archive/voice-task-status-normalization-plan.legacy.md) now serves as legacy/as-built migration reference, not as the primary surface contract.
- Инвентарь recurring tasks был собран по live `automation_tasks`, где `is_deleted != true` и `task_status = Periodic`, на момент проверки 2026-03-14; отдельная recurrence migration still remains a dedicated cleanup step.

## 15. BD

- ✅ `copilot-cux2` — [operops][voice] Normalize task widgets and tabs to complete non-overlapping status partition
- ✅ `copilot-cux2.1` — T1 Define complete non-overlapping task status partition
- ✅ `copilot-cux2.2` — T2 Document current mismatch between widgets, tabs, and status dictionary
- ✅ `copilot-cux2.3` — T3 Update voice task surface normalization spec and BD tracking
- ✅ `copilot-sc1b` — Implement next-wave Voice/OperOps task surface normalization contract
- ✅ `copilot-ds1z` — Roll out task surface normalization data migration and runtime deploy
- ✅ `copilot-ojxy` — [voice][surface] Remove separate Possible Tasks surface and converge on status-filtered Tasks tab
- ✅ `copilot-ojxy.1` — T1 Replace Voice session tabs with unified status filters inside `Задачи`
- ✅ `copilot-ojxy.2` — T4 Migrate tests, docs, and MCP contracts for unified task surface
- ✅ `copilot-ojxy.3` — T2 Remove session-payload compatibility semantics and keep a strict canonical draft route until consumer deprecation
- ✅ `copilot-ojxy.4` — T3 Normalize OperOps main tabs and remove duplicate status counters/views
- ✅ `copilot-e5cj` — [voice][tasks] Render fixed lifecycle filters inside session `Задачи` even when all counts are zero
- ✅ `copilot-7jdj` — [operops][ui] Remove duplicate lifecycle summary widgets once counts are shown inline on tabs
- ✅ `copilot-krp8` — [voice][tasks] Keep session lifecycle filter order fixed instead of sparse `status_counts`-driven ordering
- ✅ `copilot-pwok` — [voice][data] Draft session view can display rows whose Mongo task_status is already READY_10
- ✅ `copilot-kdqs` — Deprecate old draft read alias after unified session-task surface lands
- ✅ `copilot-kdqs.1` — T1 Define unified `session_tasks` / `session_task_counts` replacement contract
- ✅ `copilot-kdqs.2` — T2 Migrate `/home/tools/voice` consumers to the unified replacement surface
- ✅ `copilot-kdqs.3` — T3 Migrate copilot prompts/docs to the unified replacement surface
- ✅ `copilot-kdqs.4` — T4 Remove deprecated MCP/client method and backend `possible_tasks` route
- ✅ `copilot-oabx` — Fix pm2 agent restart path in `pm2-backend.sh` rollout

### DAG

- `copilot-cux2.1 -> copilot-cux2.3`
- `copilot-cux2.2 -> copilot-cux2.3`
- `copilot-cux2.3 -> copilot-sc1b`
- `copilot-sc1b -> copilot-ds1z`
- `copilot-ds1z -> copilot-ojxy`
- `copilot-ojxy.1 -> copilot-ojxy`
- `copilot-ojxy.2 -> copilot-ojxy`
- `copilot-ojxy.3 -> copilot-ojxy`
- `copilot-ojxy.4 -> copilot-ojxy`
- `copilot-ojxy.1 -> copilot-e5cj`
- `copilot-ojxy.1 -> copilot-krp8`
- `copilot-ojxy.4 -> copilot-7jdj`
- `copilot-ojxy -> copilot-pwok`
- `copilot-sc1b -> copilot-kdqs`
- `copilot-kdqs.1 -> copilot-kdqs`
- `copilot-kdqs.2 -> copilot-kdqs`
- `copilot-kdqs.3 -> copilot-kdqs`
- `copilot-kdqs.4 -> copilot-kdqs`

## 16. Deprecation outcome: `voice.session_possible_tasks(session_id)`

`voice.session_possible_tasks(session_id)` removed from active runtime/MCP surfaces in this wave.

Concrete removal design is tracked in:
- [voice-session-possible-tasks-deprecation-plan.md](/home/strato-space/copilot/plan/voice-session-possible-tasks-deprecation-plan.md)

Preferred replacement read surface:
- `voice.session_task_counts(session_id)`
- `voice.session_tasks(session_id, bucket, status_keys=None)`

Result:
- canonical draft reads now go through `voice.session_tasks(session_id, bucket="Draft")`
- counts go through `voice.session_task_counts(session_id)`
- `/home/tools/voice` no longer exposes `session_possible_tasks`
- copilot backend no longer exposes `POST /voicebot/possible_tasks`
- live prod verification confirms the Voice UI still renders the unified `Задачи` surface correctly after the replacement

Historical design/rollout record:
- [voice-session-possible-tasks-deprecation-plan.md](/home/strato-space/copilot/plan/voice-session-possible-tasks-deprecation-plan.md)
