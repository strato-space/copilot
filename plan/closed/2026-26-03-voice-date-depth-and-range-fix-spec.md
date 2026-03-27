# Спецификация: глубина в днях и date-range фильтрация Voice/CRM

## Status ✅Closed

- Epic ticket (`copilot-xmcm`): ⚪Open 0  🟡In Progress 0  💤Deferred 0  ⛔Blocked 0  ✅Closed 1
- Task-surface ticket line (`copilot-xmcm.*`): ⚪Open 0  🟡In Progress 0  💤Deferred 0  ⛔Blocked 0  ✅Closed 12
- Plan status: implemented contract; task-surface and epic line closed; dependency chain fully closed in `bd`.
- Related epic: `copilot-xmcm`
- Companion execution DAG: [2026-26-03-copilot-xmcm-swarm-plan.md](/home/strato-space/copilot/plan/closed/2026-26-03-copilot-xmcm-swarm-plan.md)
- Postreview hardening follow-ups: `copilot-xmcm.11`, `copilot-xmcm.12` (closed).
- Verification snapshot (2026-03-27): backend full package `135 suites / 676 tests` PASS, app full package `108 suites / 340 tests` PASS, targeted `/home/tools/voice` compatibility tests PASS.
- Snapshot date: 2026-03-27

## Контекст
В текущем контуре есть два разных механизма отбора задач по времени:
1. `draft_horizon_days` / `include_older_drafts` — политика видимости Draft/Archive.
2. `from_date` / `to_date` — ожидаемый диапазон для project CRM enrichment в `create_tasks`.

Проблема: в prompt/doc contract date-range задекларирован, но в текущем runtime `copilot` не применяет `from_date/to_date` в `/api/crm/tickets`, а клиент `tools/voice` шлет legacy-ключи.  
Дополнительно, критерий "задача актуальна вокруг точки времени" должен опираться на единый, предсказуемый набор дат в самой сущности `task`, без runtime-обхода смежных коллекций при выборке.

## Цель
1. Зафиксировать единую семантику “что считается задачей, попадающей в диапазон”.
2. Устранить contract mismatch между `tools/voice` и `copilot/backend`.
3. Ввести entity-level temporal matcher для `from_date/to_date` и `draft_horizon_days`.
4. Формализовать, относительно какой осевой даты считается `draft_horizon_days`.
5. Ввести инвариант `task.updated_at`: любая записанная мутация task row двигает timestamp.
6. Сохранить deprecation-курс на `include_older_drafts`.
7. Явно зафиксировать цель range-анализа: задача считается актуальной, если `Normalized interval` пересекается с `Mutation actuality interval` или `Linkage actuality interval`.

## Определения

### Базовые термины
- `Task temporal index` — фиксированный набор materialized temporal fields внутри `task-doc`, используемый для interval-match без join; термин `index` в этой спецификации логический и не означает обязательный physical DB index:
1. `created_at` (AS-IS ontology field),
2. `updated_at` (AS-IS ontology field),
3. `discussion_window_start_at` (TO-BE derived field),
4. `discussion_window_end_at` (TO-BE derived field).
- `Task linkage inputs` — поля, из которых вычисляются `discussion_window_start_at/discussion_window_end_at`:
1. `source_ref`,
2. `external_ref`,
3. `source_data.voice_session_id`,
4. `source_data.session_id`,
5. `source_data.session_db_id`,
6. `source_data.voice_sessions[]`,
7. `discussion_sessions[]` (если уже материализовано).
- `Mutation activity` — любая записанная мутация task row (без classification-gate для temporal inclusion), в том числе:
1. изменение `task_status`,
2. смена `performer`/ответственного,
3. редактирование task-полей,
4. добавление/редактирование трудозатрат,
5. добавление комментария,
6. изменение вложений,
7. soft-delete/restore.
- `Linkage activity` — создание/изменение linkage задачи с сессиями; операция должна материализовать/обновлять `discussion_window_start_at` и `discussion_window_end_at`.
- `last_linkage_mutated_at` — event-time последней мутации linkage; отдельная ось, не эквивалентная `discussion_window_*`.
- `Axis date` — опорная дата, относительно которой строится окно `draft_horizon_days`.
- `Normalized interval` — канонический интервал `[from_date, to_date]` после нормализации входных temporal-параметров.
- `Mutation actuality interval` (`Mutation coverage interval`) — coverage-границы задачи по mutation-оси: `[created_at, updated_at]`; defensive нормализация через `min/max` допускается для legacy/backfill rows и clock-skew edge cases, но целевой runtime-инвариант остается `created_at <= updated_at`.
- `Linkage actuality interval` (`Linkage coverage interval`) — coverage-границы задачи по linkage-оси: `[discussion_window_start_at, discussion_window_end_at]`; семантически это coverage-span по связанным `voice_session.created_at`, а не event-time самой linkage-мутации; при отсутствии linkage-интервал не участвует в матчинге.
- `Temporal coverage semantics` — overlap интервала означает покрытие периода актуальности, а не доказательство отдельного события в каждой внутренней точке интервала.
- `Recall-biased matcher` — осознанный coverage-heuristic tradeoff no-join модели: фильтр предпочитает recall и может давать false positives на long-lived tasks.
- `Interval overlap` — `overlap(A,B) := max(A.start, B.start) <= min(A.end, B.end)` для inclusive границ.
- `Temporal matcher` — единый предикат `task_in_range` с disjunctive-semantics: `overlap(Mutation actuality interval, Normalized interval) OR overlap(Linkage actuality interval, Normalized interval)`.
- `Entity-only temporal query` — правило выборки, где чтение использует только поля текущего документа `task` и не обращается к смежным сущностям в runtime фильтра.
- `Ontology alignment` — `created_at`/`updated_at` уже канонические поля `task` в ontology AS-IS; `discussion_window_start_at`/`discussion_window_end_at` вводятся как TO-BE task-plane projection relation `discussion_window`.
  - См. [voice-dual-stream-ontology.md:764](/home/strato-space/copilot/ontology/plan/voice-dual-stream-ontology.md#L764), [voice-dual-stream-ontology.md:786](/home/strato-space/copilot/ontology/plan/voice-dual-stream-ontology.md#L786), [voice-dual-stream-ontology.md:787](/home/strato-space/copilot/ontology/plan/voice-dual-stream-ontology.md#L787).
  - См. [voice-dual-stream-ontology.md:103](/home/strato-space/copilot/ontology/plan/voice-dual-stream-ontology.md#L103), [voice-dual-stream-ontology.md:418](/home/strato-space/copilot/ontology/plan/voice-dual-stream-ontology.md#L418), [voice-dual-stream-ontology.md:722](/home/strato-space/copilot/ontology/plan/voice-dual-stream-ontology.md#L722).
- `Task significant fields (для этой политики)` — согласованный подмножество task-структуры:
1. идентификация/контекст: `task_id|id`, `row_id`, `project_id`, `task_status`, `performer_id`,
2. linkage inputs: `source_ref`, `external_ref`, `source_data.voice_session_id`, `source_data.session_id`, `source_data.session_db_id`, `source_data.voice_sessions[]`, `discussion_sessions[]`,
3. temporal index: `discussion_window_start_at`, `discussion_window_end_at`, `created_at`, `updated_at`,
   - optional event-time extension: `last_linkage_mutated_at`,
4. служебные: `is_deleted`.

### Ontology Binding: AS-IS -> TO-BE projection
- `voice_session.created_at` (AS-IS canonical) — базовая дата сессии для построения `discussion_window`.
- `discussion_window_start_at` = `min(linked voice_session.created_at)`.
- `discussion_window_end_at` = `max(linked voice_session.created_at)`.
- `discussion_window_*` — это проекция relation-смысла `discussion_window` в task-doc для no-join фильтрации; это не замена первичного linkage-хранения (`source_ref`/`external_ref`/`source_data.voice_session_id`/`source_data.session_id`/`source_data.session_db_id`/`source_data.voice_sessions[]`/`discussion_sessions[]`).
- authoritative storage truth для linkage остается в linkage carriers; `discussion_window_*` — materialized derived aggregate (cache-like projection) и обязаны быть консистентны с ними в каждом write boundary и после backfill.
- `last_linkage_mutated_at` (если введен) — фиксирует именно факт изменения linkage и не участвует в критерии актуальности по coverage-интервалу, если явно не выбран отдельный `range_mode`; наличие этого поля не промотирует `discussion_linkage` в first-class entity.

### Отдельно: `include_older_drafts`
- Тип: boolean/boolish runtime flag (`true/false`, а также совместимые `1/0`, `yes/no`, `on/off`).
- Default: `false`.
- Назначение: override для Draft horizon policy.
- Семантика:
1. `include_older_drafts=false` -> `draft_horizon_days` применяется как cutoff.
2. `include_older_drafts=true` -> cutoff по `draft_horizon_days` отключается, показывается полный Draft/Archive baseline в пределах остальных фильтров запроса.
- Граница действия:
1. влияет только на Draft/Archive visibility policy,
2. не отключает `project/status/date-range` фильтры,
3. не меняет storage truth и не является lifecycle статусом.
- Статус в этой спецификации: **избыточный параметр, планируется удаление из канонического контракта**.

## Текущий фактический runtime (As Is)

### A. Draft depth (`draft_horizon_days`) реально работает
- Session-local Draft reads используют linked discussion window вокруг текущей сессии:
  - `referenceAnchor ∈ [firstLinkedSessionAnchor - horizon, lastLinkedSessionAnchor + horizon]`.
  - Реализация: [draftRecencyPolicy.ts:343](/home/strato-space/copilot/backend/src/services/draftRecencyPolicy.ts#L343), [draftRecencyPolicy.ts:350](/home/strato-space/copilot/backend/src/services/draftRecencyPolicy.ts#L350).
- Для voice-derived Draft используются все связанные session ids из `external_ref`, `source_ref`, `source_data.voice_session_id`, `source_data.session_id`, `source_data.session_db_id`, `source_data.voice_sessions[]`.
  - Реализация: [draftRecencyPolicy.ts:215](/home/strato-space/copilot/backend/src/services/draftRecencyPolicy.ts#L215), [draftRecencyPolicy.ts:237](/home/strato-space/copilot/backend/src/services/draftRecencyPolicy.ts#L237).
- Fallback для несвязанных rows: `task.updated_at || task.created_at`.
  - Реализация: [draftRecencyPolicy.ts:129](/home/strato-space/copilot/backend/src/services/draftRecencyPolicy.ts#L129).

### B. `session_tasks(bucket="Draft")` применяет depth policy
- Реализация: [sessions.ts:6162](/home/strato-space/copilot/backend/src/api/routes/voicebot/sessions.ts#L6162), [sessions.ts:5990](/home/strato-space/copilot/backend/src/api/routes/voicebot/sessions.ts#L5990).

### C. `session_tab_counts` принимает depth параметры, но не применяет их
- Входная schema содержит `draft_horizon_days/include_older_drafts`.
  - См. [sessions.ts:246](/home/strato-space/copilot/backend/src/api/routes/voicebot/sessions.ts#L246).
- В обработчике `session_tab_counts` фильтрация Draft по depth сейчас не применяется.
  - См. [sessions.ts:6027](/home/strato-space/copilot/backend/src/api/routes/voicebot/sessions.ts#L6027).

### D. `crm_tickets` date-range в текущем cutover сломан
- `tools/voice` шлет legacy-поля `task_statuses`, `project_id`, `mode`, `from`, `to`.
  - См. [core.py:1594](/home/tools/voice/src/lib/core.py#L1594), [core.py:1620](/home/tools/voice/src/lib/core.py#L1620).
- `copilot` route ожидает `statuses`, `project`, `response_mode`.
  - См. [tickets.ts:553](/home/strato-space/copilot/backend/src/api/routes/crm/tickets.ts#L553), [tickets.ts:558](/home/strato-space/copilot/backend/src/api/routes/crm/tickets.ts#L558), [tickets.ts:561](/home/strato-space/copilot/backend/src/api/routes/crm/tickets.ts#L561).
- В route отсутствует обработка `from/to/from_date/to_date`.
  - См. [tickets.ts](/home/strato-space/copilot/backend/src/api/routes/crm/tickets.ts).

### E. Несогласованность по глубине project CRM окна
- В `create_tasks` фактический lookback = `14d`.
  - См. [createTasksAgent.ts:68](/home/strato-space/copilot/backend/src/services/voicebot/createTasksAgent.ts#L68), [createTasksAgent.ts:539](/home/strato-space/copilot/backend/src/services/voicebot/createTasksAgent.ts#L539).
- В части product notes встречается формулировка про cap `30d`.
  - См. [AGENTS.md:412](/home/strato-space/copilot/AGENTS.md#L412).

### F. Инвариант `task.updated_at` сейчас нарушается на части мутаций
- `tickets/add-comment` добавляет comment, но не обновляет `task.updated_at`.
  - См. [tickets.ts:1518](/home/strato-space/copilot/backend/src/api/routes/crm/tickets.ts#L1518), [tickets.ts:1567](/home/strato-space/copilot/backend/src/api/routes/crm/tickets.ts#L1567).
- `tickets/add-work-hours` и `tickets/edit-work-hour` не двигают `task.updated_at`.
  - См. [tickets.ts:1580](/home/strato-space/copilot/backend/src/api/routes/crm/tickets.ts#L1580), [tickets.ts:1632](/home/strato-space/copilot/backend/src/api/routes/crm/tickets.ts#L1632).
- `tickets/delete` выставляет `is_deleted`, но не обновляет `updated_at`.
  - См. [tickets.ts:1658](/home/strato-space/copilot/backend/src/api/routes/crm/tickets.ts#L1658), [tickets.ts:1670](/home/strato-space/copilot/backend/src/api/routes/crm/tickets.ts#L1670).

### G. В task-модели нет materialized `discussion_window_start_at/discussion_window_end_at`
- Сейчас session-времена восстанавливаются через linkage и смежные сущности (или fallback), а не читаются как стабильные task-поля.
- Для no-join interval filter нужны явные поля `discussion_window_start_at`/`discussion_window_end_at` в `task`.

## Целевой контракт (To Be)

### 1) Единая temporal-модель
1. Любая выборка по времени строится по `Task temporal index` (4 поля даты в самой задаче).
2. `from_date/to_date` и `draft_horizon_days` используют **один и тот же** `Temporal matcher`.
3. В runtime фильтрации действует `Entity-only temporal query`: без join/traversal по comments/work_hours/sessions.
4. Relevant surfaces, где этот matcher обязателен: `/api/crm/tickets`, `/api/voicebot/session_tasks` (bucket=`Draft`), `/api/voicebot/session_tab_counts` (Draft visibility path).
5. Разница только во входной форме:
1. `from_date/to_date` задают интервал напрямую,
2. `draft_horizon_days` сначала нормализуется в `[from_date, to_date]` вокруг `Axis date`.

### 2) Канонический контракт `/api/crm/tickets`
Запрос принимает:
- `statuses: string[]` (canonical status keys),
- `project: string | string[]`,
- `response_mode: "detail" | "summary"` (совместимость с `responseMode`),
- `from_date?: ISO8601`,
- `to_date?: ISO8601`,
- `axis_date?: ISO8601` (опциональная осевая дата для horizon-нормализации),
- `range_mode?: "entity_temporal_any" | "entity_primary" | "session_linkage_only"` (default `entity_temporal_any`),
- `draft_horizon_days?: positive integer`.

Совместимость (временно, на переходный период):
- принимать legacy alias: `task_statuses`, `project_id`, `mode`, `from`, `to`;
- принимать legacy `include_older_drafts`, но трактовать его как deprecated alias для "unbounded Draft visibility";
- нормализовать в canonical поля на сервере;
- логировать legacy-использование отдельным warning-счетчиком.

#### 2.1 Time parsing / validation policy
- `from_date`/`to_date` поддерживают:
1. ISO datetime (`2026-03-26T10:15:30.000Z`)
2. ISO date (`2026-03-26`)
- `draft_horizon_days` в каноническом контракте:
1. положительное целое число дней,
2. дробные значения не допускаются,
3. `<= 0`, `NaN`, `Infinity`, non-numeric -> `400 validation_error`.
- Для `YYYY-MM-DD`:
1. `from_date` -> `YYYY-MM-DDT00:00:00.000Z`
2. `to_date` -> `YYYY-MM-DDT23:59:59.999Z`
- Если `from_date > to_date` после нормализации -> `400 validation_error`.
- Границы интервала всегда inclusive.

#### 2.2 Нормализация temporal-параметров (единое правило)
1. Если заданы `from_date`/`to_date`, они становятся `Normalized interval`.
2. Если `from_date`/`to_date` не заданы, но задан `draft_horizon_days`, сервер **первым шагом** вычисляет:
- `from_date = axis_date - draft_horizon_days`,
- `to_date = axis_date + draft_horizon_days`.
3. Если одновременно задан `draft_horizon_days` и **хотя бы один** из параметров `from_date` или `to_date` -> `400 validation_error` (`ambiguous_temporal_filter`), чтобы не было неоднозначной семантики.
4. Если не задано ничего из temporal-фильтров, выборка считается unbounded по времени.

#### 2.3 Осевая дата (`axis_date`) для `draft_horizon_days`
1. Для session-scoped API (`session_tasks`, `session_tab_counts`) ось = anchor текущей сессии:
`last_voice_timestamp || created_at || updated_at` (UTC).
2. Для CRM API:
- если передан `axis_date`, использовать его,
- иначе использовать `server_now_utc`.
3. Если `draft_horizon_days` передан, но `axis_date` неразрешима -> `400 validation_error`.
4. Практическая асимметрия:
- для CRM API этот `400` недостижим по конструкции, потому что fallback `server_now_utc` всегда разрешим;
- этот `400` относится прежде всего к session-scoped APIs, где session anchor может отсутствовать или быть неразрешимым.

#### 2.4 Entity-level temporal matcher (без обхода смежных сущностей)
1. Матч выполняется только по полям текущего `task`:
- `discussion_window_start_at`,
- `discussion_window_end_at`,
- `created_at`,
- `updated_at`.
2. Из этих полей строятся интервалы:
- `Mutation actuality interval = [created_at, updated_at]`,
- `Linkage actuality interval = [discussion_window_start_at, discussion_window_end_at]`.
3. Inclusion rule (default):
- `task_in_range = overlap(Mutation actuality interval, Normalized interval) OR overlap(Linkage actuality interval, Normalized interval)`.
4. `Temporal matcher` оценивает **актуальность**, а не факт наличия события внутри интервала.
5. Если linkage-поля отсутствуют (`null`/missing), `Linkage actuality interval` не участвует в матчинге.
6. Сценарий “задача создана 1 Jan и обновлена 1 Mar” корректно включает Feb при overlap по `Mutation actuality interval`.
7. Сценарий “задача создана позже сессии” корректен: матч может происходить по `Linkage actuality interval`, даже если `created_at` позже.
8. Сценарий “автономная задача без linkage к сессиям” корректен: матч по `Mutation actuality interval`.
9. Known tradeoff: matcher является `Recall-biased matcher`. Пример: задача `created_at=1 Jan`, `updated_at=1 Jun` попадет в выборку за `15 Mar`, даже если в марте не было отдельных mutation events.
10. Этот tradeoff принят осознанно ради no-join фильтра и семантики temporal coverage; event-presence precision для interior-point queries в эту спецификацию не входит.
11. Temporal coverage semantics ортогональна lifecycle/status relevance:
- temporal matcher сам по себе не доказывает, что задача была семантически "важна" в каждой внутренней точке интервала;
- status/lifecycle filters остаются отдельным слоем предикатов и не заменяются `Mutation actuality interval` или `Linkage actuality interval`.

#### 2.4.1 Recall-first quality policy
1. Для mutation-оси используется единый верхний anchor `updated_at` (single-field policy).
2. В целевом post-backfill режиме `False negatives` для temporal фильтра недопустимы: любая записанная task-mutation должна обновлять `updated_at` и попадать в релевантные будущие диапазоны по mutation-оси, а linkage-ось должна давать тот же no-FN guarantee после materialization `discussion_window_*`.
3. `False positives` допустимы как осознанный tradeoff recall-biased модели.
4. В рамках этой спецификации temporal relevance не зависит от дополнительной event-classification; классификация mutations по типам не используется как gate для попадания в диапазон.
5. Это намеренное упрощение контракта: меньше write-time классификаторов, меньше риск классификационных ошибок, стабильнее поведение cross-surface matcher.
6. Это осознанный override guidance из [voice-dual-stream-ontology.md:106](/home/strato-space/copilot/ontology/plan/voice-dual-stream-ontology.md#L106): риск artificial rejuvenation через `updated_at` принимается как допустимый false positive ради строгого запрета false negatives.
7. В transitional режиме до завершения backfill (`Этап 2`, п.10-11) допускаются ограниченные `false negatives` по linkage-оси для rows без `discussion_window_*`; эта деградация должна наблюдаться метрикой `discussion_window_degrade_hits_total` и обнуляться по exit gate.

#### 2.5 Инвариант `updated_at`
1. `task.updated_at` — canonical technical timestamp последней записанной мутации задачи.
2. Любая записанная мутация `task` обязана bump-ать `updated_at`.
3. Запрещены write-paths, меняющие task-содержимое/связанную task-активность без bump `updated_at`.
4. Write-side правило монотонности: `updated_at_next = max(previous_updated_at, mutation_effective_at ?? server_now_utc)`.
5. Если write-path не имеет собственного `mutation_effective_at`, используется `server_now_utc`; регресс `updated_at` запрещен даже при replay/retry/clock skew.
6. Для Draft-relevance temporal matcher использует тот же `updated_at` как единый mutation anchor без дополнительного semantic-field split.

#### 2.6 Deprecation rule: `include_older_drafts`
- Целевой контракт: параметр отсутствует.
- Способ получить unbounded Draft visibility: **не передавать `draft_horizon_days`**.
- Переходный период:
1. сервер принимает `include_older_drafts` как deprecated alias,
2. пишет warning + usage metric,
3. после нулевого usage в согласованном окне параметр удаляется (hard-fail `400`).

#### 2.7 `response_mode` compatibility matrix (legacy `mode`)
- Canonical enum: `response_mode ∈ {"detail","summary"}`.
- Принимаемые alias-поля: `responseMode`, `mode` (только переходный период).
- Precedence: если передан `response_mode`, он имеет приоритет над `responseMode` и `mode`.
- Нормализация `mode`/`responseMode` -> canonical `response_mode`:
1. `detail` -> `detail`,
2. `full` -> `detail`,
3. `summary` -> `summary`,
4. `list` -> `summary`,
5. `compact` -> `summary`,
6. `table` -> `summary`.
- Пустое значение (`""`) трактуется как отсутствие параметра и приводит к default `detail`.
- Любое иное значение -> `400 validation_error` (`invalid_response_mode`).

### 3) Что считается “задача попадает в диапазон”
Семантика зависит от `range_mode`.

#### 3.1 Интервал
- `from_date` и `to_date` трактуются как inclusive границы (`>= from`, `<= to`).
- Если передан только `from_date`: `Normalized interval = [from_date, +inf)`.
- Если передан только `to_date`: `Normalized interval = (-inf, to_date]`.

#### 3.2 Режимы диапазона
1. `entity_temporal_any` (default):
- задача попадает, если в интервале есть overlap по хотя бы одной оси актуальности.
- Критерий: `overlap([created_at,updated_at], [from,to]) OR overlap([discussion_window_start_at,discussion_window_end_at], [from,to])`.

2. `entity_primary`:
- строгий матч только по mutation-интервалу.
- Критерий: `overlap([created_at,updated_at], [from,to])`.

3. `session_linkage_only`:
- матч только по linkage-интервалу.
- Критерий: `overlap([discussion_window_start_at,discussion_window_end_at], [from,to])`.
- Автономные задачи без linkage в этом режиме намеренно исключаются.

Практическое правило:
- Для semantics "актуальные задачи вокруг точки" дефолт = `entity_temporal_any`.
- Интервалы трактуются как интервалы **актуальности**, а не как доказательство события в каждой внутренней точке интервала.
- `entity_primary` используется только как строгий fallback-режим совместимости.
- `session_linkage_only` используется для спец-срезов, где нужна только связь с сессиями.
- Для event-presence/freshness views потребуется отдельная модель; она out of scope этой спецификации.

### 4) Draft depth semantics (фиксируем как норму)
- `draft_horizon_days` не имеет отдельного matcher: он всегда сначала нормализуется в `[from_date,to_date]` вокруг `Axis date`.
- `draft_horizon_days` семантически задает **радиус** `±N days` вокруг `Axis date` (общая ширина окна = `2N` дней).
- если нужен только lookback (`-N .. axis_date` без forward half), используется явный `from_date/to_date`, а не `draft_horizon_days`.
- После нормализации применяется тот же `Temporal matcher`, что и для явного `from_date/to_date` (default `entity_temporal_any`).
- Для Draft/Archive visibility surfaces дополнительно сохраняется lifecycle scope (только Draft/Archive), но temporal-семантика единая.
- `range_mode` применяется **после** horizon-normalization и может сузить результат:
- например, `range_mode=session_linkage_only` вместе с `draft_horizon_days` намеренно исключит автономные Draft-задачи без linkage.
- Unbounded режим задается отсутствием `draft_horizon_days` и отсутствием явного `from_date/to_date`.

## Что чинить (implementation plan)

Note:
- `Этап N` в этой спецификации обозначает тематический блок работ, а не обязательный порядок исполнения; фактическая последовательность задается DAG ниже и companion-plan.

### Этап 1. Contract adapter и обратная совместимость
Файлы:
- [core.py](/home/tools/voice/src/lib/core.py)
- [tickets.ts](/home/strato-space/copilot/backend/src/api/routes/crm/tickets.ts)
- [kanbanStore.ts](/home/strato-space/copilot/app/src/store/kanbanStore.ts)

Изменения:
1. В `tools/voice` переключить отправку на canonical поля (`statuses/project/response_mode/from_date/to_date`).
2. В `copilot` добавить tolerant parser legacy полей (`task_statuses/project_id/mode/from/to`) -> canonical.
3. Добавить warning-log на legacy payload.
4. Добавить технический sunset-план:
- этап A: dual-read/write + warning metric,
- этап B: soft-fail warning при legacy-only payload,
- этап C: hard-fail (`400`) после достижения нулевого usage в течение согласованного окна (например 14 дней).
5. Для sunset-плана зафиксировать операционные артефакты:
- имя метрики и dimensions (`legacy_param`, `endpoint`, `runtime_tag`, `caller`),
- dashboard/query для контроля usage,
- gate: `zero-usage >= N days` перед включением hard-fail.
6. Для Draft visibility sunset включает отдельный deprecated alias:
- `include_older_drafts` принимается только в переходный период;
- целевой способ unbounded: omit `draft_horizon_days`.
7. Убрать эмиссию `include_older_drafts` в клиентских payload builders до hard-fail этапа.
8. Зафиксировать и имплементировать mode-normalization matrix:
- `detail|full -> response_mode=detail`,
- `summary|list|compact|table -> response_mode=summary`,
- неизвестные значения -> `400 invalid_response_mode`.

### Этап 2. Реальный date-range в `/api/crm/tickets`
Note:
- Для delivery/decomposition этот этап разбит на две child-задачи:
  - `2A` = materialized task temporal index и linkage projection (`copilot-xmcm.7`),
  - `2B` = matcher/normalization/range-mode в `/api/crm/tickets` (`copilot-xmcm.3`).

Файл:
- [tickets.ts](/home/strato-space/copilot/backend/src/api/routes/crm/tickets.ts)
- [possibleTasksMasterModel.ts](/home/strato-space/copilot/backend/src/api/routes/voicebot/possibleTasksMasterModel.ts)
- [persistPossibleTasks.ts](/home/strato-space/copilot/backend/src/services/voicebot/persistPossibleTasks.ts)

Изменения:
1. Добавить parse/validate `from_date/to_date/axis_date/draft_horizon_days`.
2. Реализовать нормализацию temporal-параметров:
- `from/to` как прямой интервал,
- `draft_horizon_days` -> `[from,to]` вокруг `axis_date`,
- любой из `from_date`/`to_date` вместе с `draft_horizon_days` -> `400 ambiguous_temporal_filter`.
3. Ввести/материализовать `task` temporal index поля:
- `discussion_window_start_at`,
- `discussion_window_end_at`,
- с источниками из `source_ref/external_ref/source_data.voice_session_id/source_data.session_id/source_data.session_db_id/source_data.voice_sessions[]/discussion_sessions[]`.
4. Добавить `range_mode` c default `entity_temporal_any`.
5. Добавить date-match по `Task temporal index` без join к смежным коллекциям:
- `entity_temporal_any` как базовый путь,
- `entity_primary/session_linkage_only` как альтернативы.
6. Зафиксировать inclusive semantics и `from>to => 400`.
7. Сохранить совместимость `summary/detail` и prefilter для draft/archive.
8. Добавить migration/backfill policy для исторических rows без `discussion_window_start_at/discussion_window_end_at`.
9. Зафиксировать unlink protocol для linkage-derived полей:
- при добавлении linkage `discussion_window_*` расширяются до `min/max` по связанным `voice_session.created_at`;
- при удалении/unlink boundary-session выполняется recompute `min/max` по оставшимся связанным сессиям;
- если после unlink связанных сессий не осталось, `discussion_window_start_at = null` и `discussion_window_end_at = null`;
- recompute `discussion_window_*` и bump `last_linkage_mutated_at` должны происходить в том же write boundary, что и сама мутация linkage.
10. Зафиксировать transitional behavior до backfill:
- для исторических rows без `discussion_window_*` режим `entity_temporal_any` временно деградирует к mutation-only match;
- для `session_linkage_only` такие pre-backfill rows исключаются целиком, даже если linkage фактически существует только в raw linkage carriers;
- этот режим должен быть прозрачно задокументирован и покрыт rollout-metric/operational warning.
11. Зафиксировать explicit exit gate для transitional режима:
- ввести метрики `discussion_window_materialization_coverage` и `discussion_window_degrade_hits_total` (dimensions: `runtime_tag`, `endpoint`, `project_id`, `range_mode`);
- считать режим завершенным при `coverage >= 99.9%` и `degrade_hits_total / total_range_evals <= 0.1%` в течение `>=14` последовательных дней;
- после gate: отключить degrade-path feature flag, считать `session_linkage_only` fully supported без оговорок, перевести предупреждения в post-rollout audit.

### Этап 3. Применение depth policy в `session_tab_counts` и `session_tasks(bucket="Draft")`
Файл:
- [sessions.ts](/home/strato-space/copilot/backend/src/api/routes/voicebot/sessions.ts)

Изменения:
1. Реально применять `draft_horizon_days` через ту же нормализацию в `[from,to]` и тот же entity-level `Temporal matcher`, что в `crm/tickets`, в обоих surfaces: `session_tab_counts` и `session_tasks(bucket="Draft")`.
2. Для `session_tasks(bucket="Draft")` заменить legacy recency path (`filterVoiceDerivedDraftsByRecency`) на shared temporal matcher по materialized `Task temporal index`; transitional degrade behavior должен совпадать с Этапом 2.
3. Явно отдать Draft count в контракте `session_tab_counts` (`draft_count` как отдельное поле; допускается также дублирование в `status_counts` с `DRAFT_10` для backward compatibility).
4. Зафиксировать поведение агрегатов `session_tab_counts`:
- `tasks_count` остается legacy-совместимым non-draft total (`sum(status_counts without DRAFT_10)`),
- `draft_count` считается отдельно по тому же normalized interval/matcher, что и `session_tasks(bucket="Draft")`,
- `no_task_decision` использует именно `draft_count` как persisted Draft basis при `tasks_count=0`.
5. Не трогать non-draft lifecycle counts.

### Этап 3.1. Удаление `include_older_drafts` (contract cleanup)
Файлы:
- [sessions.ts](/home/strato-space/copilot/backend/src/api/routes/voicebot/sessions.ts)
- [tickets.ts](/home/strato-space/copilot/backend/src/api/routes/crm/tickets.ts)
- [/home/tools/voice/src/lib/core.py](/home/tools/voice/src/lib/core.py)
- [/home/tools/voice/src/mcp_voicebot/server.py](/home/tools/voice/src/mcp_voicebot/server.py)
- [/home/tools/voice/src/actions/main.py](/home/tools/voice/src/actions/main.py)

Изменения:
1. Убрать параметр из canonical request schemas/typed payloads.
2. На переходе оставить parser alias только server-side с warning.
3. После `zero-usage` gate удалить alias-путь и вернуть `400` на использование параметра.
4. Обновить prompt/docs/examples: unbounded = omit `draft_horizon_days`.

### Этап 3.2. Инвариант `updated_at` на всех мутациях задачи
Файлы:
- [tickets.ts](/home/strato-space/copilot/backend/src/api/routes/crm/tickets.ts)
- [sessions.ts](/home/strato-space/copilot/backend/src/api/routes/voicebot/sessions.ts)
- [persistPossibleTasks.ts](/home/strato-space/copilot/backend/src/services/voicebot/persistPossibleTasks.ts)

Изменения:
1. Ввести единый helper для bump `task.updated_at`.
2. Применить helper ко всем mutation surfaces:
- status change,
- performer/assignee change,
- generic task edit,
- comment add,
- work-hour add/edit/delete,
- attachment add/delete,
- soft-delete/restore,
- linkage materialization write (`discussion_window_start_at/discussion_window_end_at` set/recompute при link/unlink).
3. Helper обязан реализовывать `updated_at_next = max(previous_updated_at, mutation_effective_at ?? server_now_utc)`.
4. Добавить guard-тесты:
- запрещающие mutation path без `updated_at` bump,
- проверяющие отсутствие false-negative regression: любой mutation path, завершившийся записью, обновляет `updated_at` и попадает в temporal выборку.

### Этап 4. Унификация lookback policy для `project_crm_window`
Файл:
- [createTasksAgent.ts](/home/strato-space/copilot/backend/src/services/voicebot/createTasksAgent.ts)

Изменения:
1. Вынести lookback в конфиг (`VOICEBOT_PROJECT_CRM_LOOKBACK_DAYS`, default `14`).
2. Добавить upper bound (`30`) и clamp на backend (`1..30`).
3. Синхронизировать AGENTS/README/docs и тесты.

### Этап 5. Timestamp hardening
Файлы:
- [sessionsSharedUtils.ts](/home/strato-space/copilot/backend/src/api/routes/voicebot/sessionsSharedUtils.ts)
- [sessions.ts](/home/strato-space/copilot/backend/src/api/routes/voicebot/sessions.ts)
- [tickets.ts](/home/strato-space/copilot/backend/src/api/routes/crm/tickets.ts)
- [draftRecencyPolicy.ts](/home/strato-space/copilot/backend/src/services/draftRecencyPolicy.ts)

Изменения:
1. Убрать `Date.parse(String(epoch_ms))` path для numeric timestamps.
2. Единый parser: number epoch(ms/sec) + ISO string + Date.
3. Использовать единый parser во всех точках расчета temporal index/date-match (CRM + Draft recency + session-scoped endpoints).

## Декомпозиция в дочерние задачи (bd)

### Зарегистрированные child issues
- `copilot-xmcm.2` — Этап 1 (`Contract adapter и обратная совместимость`, включая client typed surfaces вроде `kanbanStore.ts`).
- `copilot-xmcm.7` — Этап 2A (`Task temporal index fields и linkage projection`).
- `copilot-xmcm.3` — Этап 2B (`Реальный date-range matcher в /api/crm/tickets` поверх temporal index).
- `copilot-xmcm.4` — Этап 3 (`Применение depth policy в session_tab_counts + session_tasks(Draft)` и фиксация `tasks_count/draft_count` контракта).
- `copilot-xmcm.1` — Этап 3.1 (`Удаление include_older_drafts`).
- `copilot-xmcm.8` — Этап 3.2 (`updated_at` invariant на mutation surfaces).
- `copilot-xmcm.5` — Этап 4 (`Унификация lookback policy`).
- `copilot-xmcm.6` — Этап 5 (`Timestamp hardening`).

### DAG ребра (между child issues)
- `copilot-xmcm.2 -> copilot-xmcm.7`
- `copilot-xmcm.7 -> copilot-xmcm.3`
- `copilot-xmcm.8 -> copilot-xmcm.3`
- `copilot-xmcm.7 -> copilot-xmcm.4`
- `copilot-xmcm.3 -> copilot-xmcm.4`
- `copilot-xmcm.3 -> copilot-xmcm.1`
- `copilot-xmcm.4 -> copilot-xmcm.1`
- `copilot-xmcm.3 -> copilot-xmcm.6`
- `copilot-xmcm.5` — частично независимая ветка:
1. config plumbing можно параллельно с L0,
2. финальная runtime/docs валидация должна идти после `copilot-xmcm.2` + `copilot-xmcm.3`,
3. это coordination constraint, а не отдельное hard-edge DAG ребро.

### Параллельные слои исполнения
- `L0`: `copilot-xmcm.2`, `copilot-xmcm.5`, `copilot-xmcm.8`
- `L1`: `copilot-xmcm.7`
- `L2`: `copilot-xmcm.3`
- `L3`: `copilot-xmcm.4`, `copilot-xmcm.6`
- `L4`: `copilot-xmcm.1`

## Тест-план

### Unit
1. `crm/tickets` contract parser:
- canonical keys,
- legacy aliases,
- mixed payload precedence,
- `response_mode/responseMode/mode` precedence и mode-normalization matrix (`detail|full|summary|list|compact|table`).
2. Date-range predicate:
- inclusive boundaries,
- only-from / only-to,
- invalid ISO,
- `from > to` -> `400`.
3. Temporal normalization equivalence:
- `draft_horizon_days + axis_date` эквивалентен явно вычисленному `[from,to]`,
- `from_date + draft_horizon_days` -> `400 ambiguous_temporal_filter`,
- `to_date + draft_horizon_days` -> `400 ambiguous_temporal_filter`,
- `from_date/to_date + draft_horizon_days` одновременно -> `400 ambiguous_temporal_filter`,
- fractional `draft_horizon_days` -> `400 validation_error`,
- корректное разрешение `axis_date` (session anchor / explicit axis / server_now_utc).
4. `range_mode` behavior:
- `entity_primary`,
- `entity_temporal_any`,
- `session_linkage_only`.
5. Task temporal index behavior:
- `discussion_window_start_at` и `discussion_window_end_at` корректно вычисляются из linkage inputs (`source_ref`, `external_ref`, `source_data.voice_session_id`, `source_data.session_id`, `source_data.session_db_id`, `source_data.voice_sessions[]`, `discussion_sessions[]`),
- автономные задачи без linkage матчатся по `created_at/updated_at`,
- сценарий "task created much later than session" матчит по `discussion_window_start_at/discussion_window_end_at`,
- сценарий "task created 1 Jan, updated 1 Mar" включает Feb как интервал актуальности,
- сценарий unlink max-boundary session корректно recompute-ит `discussion_window_end_at`,
- сценарий unlink last remaining session выставляет `discussion_window_start_at/end_at = null`,
- pre-backfill row в `session_linkage_only` исключается целиком до materialization `discussion_window_*`.
6. Draft horizon semantics:
- unbounded при отсутствии `draft_horizon_days`,
- deprecated alias `include_older_drafts` (переходный период),
- alias removal (`400`) после sunset.
7. `updated_at` invariant:
- status/performer/edit/comment/work-hour/attachment/delete mutation bump-ают `task.updated_at`,
- отсутствуют mutation-paths без bump,
- `updated_at` назначается монотонно через `max(previous_updated_at, mutation_effective_at ?? server_now_utc)`.

### Integration
1. `/api/crm/tickets`:
- `from_date/to_date` реально меняют выборку,
- `entity_temporal_any` учитывает `overlap([created_at,updated_at],[from,to]) OR overlap([discussion_window_start_at,discussion_window_end_at],[from,to])`,
- `entity_primary` матчит только `overlap([created_at,updated_at],[from,to])`,
- `session_linkage_only` матчит только `overlap([discussion_window_start_at,discussion_window_end_at],[from,to])`,
- long-lived task example (`created_at=1 Jan`, `updated_at=1 Jun`) намеренно матчит внутренний мартовский интервал как coverage-based recall behavior,
- pre-backfill linked row в `session_linkage_only` не попадает до появления `discussion_window_*`.
2. `/api/voicebot/session_tab_counts`:
- Draft count меняется при `draft_horizon_days`,
- отсутствие `draft_horizon_days` возвращает full baseline,
- при одинаковом normalized interval результаты совпадают с `session_tasks(bucket=Draft)` по temporal semantics,
- `tasks_count` остается non-draft,
- `draft_count` считается отдельно по тому же matcher, что и `session_tasks(bucket=Draft)`.
3. `/api/voicebot/session_tasks` (bucket=`Draft`):
- применяет тот же temporal matcher и ту же horizon-нормализацию, что и `session_tab_counts`/`crm_tickets`,
- не использует отдельный legacy recency-algorithm.
4. Task mutation surfaces:
- `add-comment`, `add/edit-work-hour`, `delete` обновляют `task.updated_at`,
- `updated_at` монотонно растет на последовательных мутациях.
5. Transitional rollout:
- до backfill rows без `discussion_window_*` явно наблюдаемы по метрике деградации `entity_temporal_any -> entity_primary`.
- exit gate с coverage/ratio условиями переводит `session_linkage_only` в fully supported режим без transitional оговорок.

### Prompt/contract tests
1. `create_tasks` prompt contract остается bounded (`from_date/to_date`) без unbounded project CRM.
2. Проверить соответствие docs фактической конфигурации lookback days.
3. Зафиксировать в prompt/docs default `range_mode=entity_temporal_any`.
4. Зафиксировать в prompt/docs удаление `include_older_drafts` и правило unbounded через omit `draft_horizon_days`.
5. Зафиксировать в prompt/docs entity-level temporal index policy (no-join filter) и поля `discussion_window_start_at/discussion_window_end_at`.
6. Зафиксировать в prompt/docs, что matcher является recall-biased heuristic и может давать false positives на long-lived tasks.

## Критерии приемки
1. `voice.crm_tickets(project_id..., from_date..., to_date...)` детерминированно фильтрует сервером в `copilot`.
2. `draft_horizon_days` детерминированно нормализуется в `[from,to]` относительно корректно выбранной `axis_date`.
3. При эквивалентном normalized interval `from/to` и `draft_horizon_days` дают одинаковую temporal выборку.
4. Семантика попадания детерминирована по `range_mode`:
- `entity_temporal_any` — `overlap([created_at,updated_at],[from,to]) OR overlap([discussion_window_start_at,discussion_window_end_at],[from,to])`,
- `entity_primary` — `overlap([created_at,updated_at],[from,to])`,
- `session_linkage_only` — `overlap([discussion_window_start_at,discussion_window_end_at],[from,to])`.
5. В runtime фильтрации соблюдается `Entity-only temporal query`: без обхода смежных коллекций.
6. `session_tab_counts` уважает `draft_horizon_days`; unbounded достигается omission.
7. `session_tasks(bucket=Draft)` и `session_tab_counts` используют один и тот же normalized interval + matcher semantics.
8. Контракт `session_tab_counts` однозначен: `tasks_count` = non-draft total, `draft_count` = Draft total по matcher, `no_task_decision` опирается на `draft_count`.
9. Нет contract mismatch между `tools/voice` и `copilot/backend`, включая mode-normalization (`table/compact/full`).
10. `task.updated_at` bump-ается на всех mutation surfaces, которые записывают изменения в `task`.
11. Документация (AGENTS/README/VOICEBOT_API/prompt contracts) согласована с runtime.
12. Legacy alias sunset зафиксирован и покрыт метрикой usage.
13. `include_older_drafts` удален из канонического контракта и после sunset дает `400`.
14. Unlink boundary-session cases корректно recompute-ят `discussion_window_*`.
15. Переходный degrade-mode до backfill явно задокументирован, наблюдаем и имеет формальный exit gate.
16. Recall-first quality policy зафиксирован: false negatives для mutation-оси недопустимы, false positives допустимы как осознанный tradeoff.

## Out of scope
1. Полный historical backfill raw linkage carriers (например, `discussion_sessions[]`) для всех старых rows; речь не идет о derived temporal index полях `discussion_window_*`, которые описаны выше.
2. Рефакторинг всей модели lifecycle статусов за пределами данного date/filter контракта.
