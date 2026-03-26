# Voice Dual-Stream Ontology For Voice Sessions

## Status ⚪Open

- Task-surface ticket line: ⚪Open 1  🟡In Progress 0  💤Deferred 0  ⛔Blocked 0  ✅Closed 0
- Plan status: ontology draft rewritten to cover OperOps sandbox and current copilot ontology; Mongo/task-plane parity snapshot folded in; downstream persistence alignment now lives in a separate bridge spec.
- Canonical ontology ticket: `copilot-ua6e`

**Статус документа**: rewritten ontology draft open; downstream persistence alignment delegated to separate bridge spec
**Дата**: 2026-03-21
**Основание**: three-way reconciliation across `/home/strato-space/y-tasks-sandbox/OperOps`, current voice/task specs in `copilot/plan`, the current semantic kernel under `copilot/ontology`, and live Mongo recheck against `automation_tasks` / `automation_voice_bot_sessions` on 2026-03-21.

## Purpose
Роль этого файла:
- это каноническая domain ontology спека для voice/task world;
- это companion document к `OperOps - Voice2Task.md`, который описывает бизнесово-операционный и UX/process contract;
- здесь primary concern не экранный UX и не generic persistence architecture, а domain-side object model, relation vocabulary и category discipline;
- domain-specific persistence consequences этой ontology выносятся в `ontology/plan/voice-ontology-persistence-alignment-spec.md`;
- implementation-wave assumptions и rollout notes ниже считаются annex material и не должны автоматически читаться как generic persistence law.

Термин `dual-stream` в заголовке фиксируется так:
- `project-management stream` описывает producing-system side: `task`, `goal_process`, `issue`, `risk`, `constraint`, routing, execution и control;
- `product-management stream` описывает system-of-interest side: `goal_product`, `requirement`, product-facing часть `business_need` и change intent;
- `domain ontology model` в этой редакции не объявляется третьим stream в заголовке, а трактуется как orthogonal formal layer, которая связывает и дисциплинирует оба management streams;
- если в будущей редакции `domain ontology model` будет выделен в самостоятельный stream family, документ family может стать triadic without invalidating the present dual-stream naming for this wave.

Зафиксировать каноническую ontology для voice sessions / voice dialogs в заказной разработке так, чтобы один документ одновременно покрывал:
- conceptual model из `OperOps` sandbox;
- semantic kernel и relation model из `copilot/ontology`;
- current voice/task runtime decisions в `copilot`.

Документ должен ответить на три вопроса:
1. Что существует в разговоре и в системе как сущности разных родов?
2. Как эти сущности связаны между собой?
3. Какие слои нельзя смешивать без category mistake?

Production emphasis:
- `task` is the one central task-plane object;
- task/session/chunk traceability must survive materialization into DB objects;
- result and acceptance objects are mandatory parts of the production model, not optional prose add-ons.
- ближайший production loop: `voice_session -> task_intake_pool -> context_enrichment -> human_approval -> executor_routing -> task_execution_run -> outcome_record (обычно artifact_record) -> acceptance_evaluation`.

## Term Normalization / Glossary

### Нормализация терминов

#### Корневые термины

- `task` — первичная операционная сущность работы. Это действие / deliverable, связанное с контекстом, исполнителем, критериями приемки и результирующим артефактом.
- `voice_session` — bounded discussion event, из которого извлекаются задачи, evidence и контекстные обновления.
- `processing_run` — occurrence обработки одного session/message scope. Это run processing pipeline, а не запуск исполнения задачи.
- `task_execution_run` — occurrence исполнения одной задачи одним executor contour. Это не `processing_run`.
- `context_enrichment` — стадия сборки достаточного task-local `execution_context`: project/product materials, duplicate checks, `object_locator`, `evidence_link`, `acceptance_criterion`, routing basis.
- `execution_context` — не “всё знание проекта”, а минимально достаточный task-local состав: `object_locator`, `evidence_link`, `acceptance_criterion`, routing / executor hints.
- `human_approval` — санкция на то, что формулировка задачи и её `execution_context` достаточны для routing/launch.
- `person` — человеческая identity-сущность: она отвечает на вопрос, кто этот человек, но не исчерпывает его текущую роль, полномочие или исполнительный профиль.
- `actor` — участник системы, который может говорить, оценивать, согласовывать, комментировать и инициировать изменения.
- `authority_scope` — граница полномочий, внутри которой `actor` может утверждать, принимать, отклонять или санкционировать изменение.
- `executor_role` — capability-side role ось для human/machine executors.
- `performer_profile` — canonical human executor profile / performer surface, grounded in `person`, в который задача может быть маршрутизирована для исполнения.
- `coding_agent` — first-class non-human executor, задаваемый как CLI/agent surface с путём запуска, аргументами и role/pipeline refs.
- `object_locator` — ссылка на объект применения задачи: файл, компонент, экран, правило, агент, артефакт или иной target object.
- `outcome_record` — canonical DB-side типизированный результат исполнения (`artifact | decision | state_transition`).
- `settled_decision` — epistemic resolution entity, фиксирующий закрытие вопроса в разговоре или review, но не являющийся execution outcome.
- `artifact_record` — canonical DB-side produced result.
- `result_artifact` — human-facing alias для `artifact_record`, а не вторая сущность.
- `acceptance_evaluation` — отдельный акт оценки и приемки produced result against explicit acceptance conditions, выполняемый уполномоченным `actor`.
- `goal_process` — process-side целевое состояние, к которому привязаны задачи и исполнение.
- `goal_product` — product-side целевое состояние, к которому привязаны требования и изменения `system_of_interest`.
- `business_need` — корневая причина, зачем вообще нужен проект или изменение.
- `requirement` — то, что решение должно обеспечивать.
- `issue` — уже возникшая проблема.
- `risk` — будущая угроза или возможность с неопределённым исходом.
- `constraint` — ограничение решения или исполнения.
- `change_proposal` — предложенная mutation до approval.
- `kpi` — измеримый показатель.
- `kpi_observation` — конкретный факт наблюдения/измерения `kpi`.
- `codex_task` — task-plane marker Codex-oriented review/execution flow, а не отдельный entity kind.
- `system_of_interest` — объект, который продуктно описывается, меняется или оценивается.
- `producing_system` — socio-technical система, которая исполняет задачи и производит артефакты.
- `project` — управленческий/операционный контур внутри `producing_system`; проект не тождественен ни `system_of_interest`, ни самой производящей системе.

#### Пояснительные и операционные термины

- `task[DRAFT_10]` — тот же `task` в draft lifecycle state, а не отдельный kind work object.
- `ready_plus_task` — тот же `task` в `READY_10 | PROGRESS_10 | REVIEW_10 | DONE_10 | ARCHIVE`.
- `task_context_card` — имя task-local structured surface; это не вторая сущность, а сгруппированный состав внутри `task`.
- `task_type` / `task_classification` — типизация задачи (`ui`, `document`, `spec`, `research`, `audit`, ...).
- `task_family` — routing-oriented слой поверх `task_type`, используемый для сегментации между executor families.
- `task_intake_pool` — стадия, в которой входящие задачи существуют как `task[DRAFT_10]` до routing.
- `executor_routing` — durable decision object перелива задачи к `performer_profile`, `coding_agent` или mixed contour.
- `acceptance_criterion` — typed условие приемки produced result.
- `evidence_link` — нормализованный носитель цитаты / таймкода / message span, которым задача обосновывается.
- `writeback_decision` — санкция на запись / применение изменения.
- `patch` — конкретный change-set, реализующий изменение.
- `seed_context_base` — внешний bootstrap context для executor layer; в ближайшем цикле это `DevFigma / FigmaFlow` плюс project/dialogue context.
- `discussion_linkage` — relation-only many-to-many `task <-> voice_session`.

#### Особенности нормализации

- `draft_recency_horizon` — derived operational read/workqueue policy для voice-derived `task[DRAFT_10]`. Это не новая сущность и не новый lifecycle state.
- `active_draft_window` — caller-provided Draft slice; если параметр не задан, canonical Draft baseline остаётся полным.
- `discussion_window` — derived time range `[first_linked_session_at, last_linked_session_at]` over voice sessions linked to one task.
- Для global Draft workqueue главным recency anchor practically служит `last_linked_session_at`.
- Для session-local views окно должно оцениваться в обе стороны от текущей session относительно linked `discussion_window`.
- В recall-first policy Draft recency допускается определять по `task.updated_at` как mutation-anchor; риск artificial rejuvenation из recount/writeback трактуется как допустимый false positive ради строгого запрета false negatives.
- `result_artifact` нормализуется в `artifact_record`; human-facing alias допускается, в ontology second object — нет.
- Нормализованная mutation chain такова: `change_proposal -> writeback_decision -> patch -> history_step`.
- FPF-aligned split сохраняется:
  - product-side claims (`goal_product`, `requirement`, часть `business_need`) описывают прежде всего `system_of_interest`;
  - process-side claims (`task`, `goal_process`, `issue`, `risk`, `constraint`) описывают прежде всего `producing_system`;
  - `project` не должен поглощать ни `system_of_interest`, ни `producing_system`.

## Annex A. First-Wave Domain Consequences

### Goal
Ближайшая цель этой волны не в том, чтобы “ещё лучше извлекать backlog items”, а в том, чтобы:
- система materialize из `voice_session` execution-ready `task[DRAFT_10]`;
- система обогащает их до minimum launch `execution_context`;
- уполномоченный `actor` проводит `human_approval`;
- исполнительный контур через `performer_profile` или `coding_agent` доводит часть задач до `outcome_record` (в первом приближении обычно `artifact_record`), после чего уполномоченный `actor` выполняет `acceptance_evaluation`.

Если этот цикл не доходит до produced-and-reviewed result, то ontology тривиализируется до “ещё одного канала генерации задач”, а это уже не тот предмет.

### Ontological repair
Чатовая формулировка “`processing_run = запуск`” онтологически неверна.

Это **categorical failure**, а не просто неудачное имя:
- `processing_run` относится к processing/extraction layer над `voice_session` / `voice_message`;
- `task_execution_run` относится к execution layer над `task`.

Concrete counterexample:
- один `processing_run` может породить несколько `task[DRAFT_10]`;
- каждая из этих задач может получить свой собственный `task_execution_run`;
- следовательно, “запуск обработки” и “запуск исполнения задачи” не один и тот же род объекта.

### Целевая механика

Пояснительно, в рабочем языке этот цикл выглядит так:
1. из `voice_session` система выделяет `task[DRAFT_10]`;
2. система проходит `context_enrichment`: подтягивает материалы проекта/продукта, проверяет дубли, формирует `object_locator`, `acceptance_criterion` и другой минимально достаточный `execution_context`;
3. уполномоченный `actor` быстро просматривает эти `task[DRAFT_10]` и через `human_approval` утверждает только нужные;
4. после `human_approval` задача не “получает контекст из ниоткуда”, а входит в launch-ready состояние с уже собранным `execution_context`: что менять, почему это вообще появилось, по каким критериям принимать и кому это разумно маршрутизировать;
5. дальше `executor_routing` маршрутизирует задачу либо в `performer_profile`, либо в `coding_agent`, либо в mixed contour;
6. затем выбранный исполнительный контур запускает `task_execution_run`, а не `processing_run`;
7. на выходе `task_execution_run` производит не просто “как-то закрытую задачу”, а конкретный `outcome_record` (в первом приближении обычно `artifact_record`);
8. затем уполномоченный `actor` проводит `acceptance_evaluation`: результат либо принимается, либо уточняется и уходит в следующий цикл.

Операционная оговорка:
- caller может опционально задать `draft_recency_horizon`, чтобы ограничить active Draft workqueue; если параметр не задан, canonical Draft baseline остаётся полным.

Практический смысл цикла:
- не производить бесконечный backlog;
- как можно быстрее переводить разговор в executor-ready task;
- и дальше в `outcome_record` (обычно `artifact_record`) с явным `acceptance_evaluation`, а не в ещё одну невалидированную запись.

### Storage-preserving enrichment contract

Граница этой волны намеренно жёсткая:
- в этой волне не меняются Mongo collections;
- не меняются Codex issue structures;
- не вводятся новые stored objects, collection families или дополнительные persistence surfaces;
- не выполняется реализация UI/agent/runtime;
- цель волны — decision-complete semantic/spec contract для downstream implementation.

Следовательно, enrichment в этой волне нормализуется как storage-preserving:
- поверх уже существующих `task.description`;
- поверх existing comments;
- поверх existing linkage/session/task metadata;
- без требования сначала перестраивать MongoDB или Codex storage.

Ниже фиксируются два разных enrichment surface:
- `Draft enrichment surface`;
- `Ready+ enrichment surface`.

#### `Draft enrichment surface`

Для `task[DRAFT_10]` canonical mutable enrichment surface живёт в `task.description` как Markdown.

Нормализация `task[DRAFT_10].description`:
1. первым содержательным разделом всегда идёт `## description`;
2. далее идут секции Markdown в фиксированном порядке;
3. именно эти секции считаются canonical review/enrichment surface, а не comments.

Обязательный spec-template для `task[DRAFT_10]`:
- `## description`
- `## object_locators`
- `## expected_results`
- `## acceptance_criteria`
- `## evidence_links`
- `## executor_routing_hints`
- `## open_questions`

Нормативные правила:
- отдельными UI-полями остаются только `name`, `priority`, `project`, `task_type`, `performer` (runtime-поля: `name/priority/project_id/task_type_id/performer_id`);
- всё остальное содержательное наполнение задачи живёт в едином Markdown surface `task.description`;
- секции могут быть частично пустыми на раннем этапе intake;
- enrichment обновляет тот же `task[DRAFT_10]`, а не создаёт новый row;
- comments не являются primary enrichment surface для `Draft`;
- UI должен интерпретировать неполноту секций как incomplete draft, а не как storage error;
- `context_enrichment` practically materializes именно этот Markdown surface;
- `human_approval` проверяет не “красоту текста”, а достаточность заполнения surface для launch/routing.
- Внутри `## open_questions` используется явный chunk convention:
  - `Question:` — формулировка открытого вопроса;
  - `Answer:` — подтверждённый ответ или `TBD` до подтверждения.

То есть в этой модели:
- `Draft -> description-first enrichment`
- `task[DRAFT_10]` остаётся mutable intake object до `human_approval`.

#### `Ready+ enrichment surface`

После `human_approval` и materialization в `Ready+`:
- `title` и `description` считаются launch snapshot;
- они не должны автоматически переписываться каждым новым discussion pass;
- новое содержательное уточнение для `Ready+` добавляется через comments, а не через rewrite description.

Нормализация policy:
- comments создаются `on demand`, когда появляется materially new clarification;
- comments могут быть session-aware и discussion-aware, если runtime это умеет;
- comments — append-only enrichment artifact для `Ready+`;
- `Ready+ description` остаётся stable execution brief, а не mutable enrichment notebook.

То есть в этой модели:
- `Ready+ -> comment-first enrichment`
- comment creation is clarification artifact, not a trigger to rewrite launch snapshot.

### `Draft review workspace`

Новая canonical visualization target для `task[DRAFT_10]` фиксируется как `review workspace`, а не как legacy table with short title/description.

Границы shape:
- это не отдельная верхняя вкладка вне `Задачи`;
- это richer surface внутри существующего `Задачи -> Draft`;
- layout — `master-detail review workspace`.

Фиксированный shape:
- слева: список `task[DRAFT_10]`;
- справа: богатая review card выбранной задачи.

Левый список должен показывать не только:
- `name`;
- короткий synopsis;

но и derived review signals:
- completeness chips по ключевым секциям;
- наличие/отсутствие `object_locators`;
- наличие/отсутствие `expected_results`;
- наличие/отсутствие `acceptance_criteria`;
- наличие/отсутствие `evidence_links`;
- linked session count / discussion signal;
- routing hint state.

Правая панель должна рендерить parsed Markdown surface:
- synopsis;
- `object_locators`;
- `expected_results`;
- `acceptance_criteria`;
- `evidence_links`;
- `executor_routing_hints`;
- `open_questions`.

Следствие для implementation:
- richer Draft UX строится как derived render уже существующего Markdown-bearing `task.description`;
- richer Draft UX не требует сначала вводить новый Mongo object kind.

### Historical prior art
Ближайший historical analogue этой механики — агент `PM-03-RequestsTask`:
`request -> formulation/decomposition -> duplicate check -> verification -> assignment`.

Текущая ontology обобщает этот паттерн:
- от CRM-only task creation
- к `task -> executor_routing -> task_execution_run -> outcome_record -> acceptance_evaluation`.

## Ontological Discipline

Определения терминов вынесены в `Term normalization / Glossary` выше.
Ниже фиксируются не новые определения, а правила онтологической дисциплины:
- не смешивать сущность, её состояние, её описание и её носитель;
- не смешивать объект изменения, решение на изменение, исполнение изменения и след изменения;
- не смешивать процессную цель, продуктную цель, требование, ограничение, риск и уже возникшую проблему;
- не смешивать `artifact_record`, `acceptance_criterion` и `kpi_observation`.

### Core ontological claim
Разговор в заказной разработке нельзя редуцировать ни:
- к одному линейному списку задач,
ни
- к одному линейному списку требований.

Почему:
- часть содержания относится к исполнению,
- часть — к продукту,
- часть — к самому процессу обсуждения и обработки,
- часть — к памяти/контексту,
- часть — к артефактам и истории решений.

Попытка всё свести к `Task[]` — category mistake.
Попытка всё свести к `Requirement[]` — category mistake.

## Entity Coverage Markers

- `[mom]` - есть в MongoDB, есть в `ontology/typedb/schema/fragments/10-as-is`, есть в `ontology/typedb/mappings/mongodb_to_typedb_v1.yaml`
- `[-o-]` - есть только в ontology (`ontology/`)
- `[ ]` - новая сущность, пока нигде нет

Пометки ставятся только для object/table families. Поля, relation names и прочие non-entity identifiers не размечаются.

## Доменные commitments, засвидетельствованные в истории сессий

Этот документ явно следует domain-side commitments, которые Валерий Павлович сформулировал в session history от 2026-03-19:
- `task` — центральный operational object; `task` существует ради типизированного `outcome_record` (в первом приближении обычно `artifact_record`), а не как самоценный backlog item;
- `task[DRAFT_10]` остаётся мутабельным, а `ready_plus_task` тяготеет к execution-ready immutability с `acceptance_criterion` и `artifact_record` traceability;
- один `task` может обсуждаться во многих `voice_session`, поэтому `discussion_linkage` должен быть many-to-many, а не навсегда single-primary;
- трассируемость должна оставаться непрерывной: `voice_session -> processing_run -> task[DRAFT_10|...] -> execution_context -> outcome_record`;
- destructive и bulk mutations остаются human-in-the-loop через `change_proposal -> human_approval -> writeback_decision -> patch -> history_step / UNDO`;
- process/product decomposition должна оставаться явной, чтобы `task` и `task_execution_run` не схлопывались в `requirement`;
- `acceptance_criterion`, `acceptance_evaluation`, `kpi` и `kpi_observation` должны оставаться достаточно first-class, иначе `artifact_record` и сам акт принятия результата схлопываются в одно vague notion;
- `project` не равен `system_of_interest`, а `system_of_interest` не равен `producing_system`;
- `task_intake_pool` и `executor_routing` должны возникать поверх `task` plane: входящие `task[DRAFT_10]` сначала попадают в intake surface, а затем `executor_routing` маршрутизирует их по `executor_role` к `performer_profile`, `coding_agent` или в mixed contour;
- ширина active `task[DRAFT_10]` queue может ограничиваться через caller-provided `draft_recency_horizon` без изменения ontology самого `task`; если policy не задана, Draft baseline остаётся полным;
- В recall-first policy Draft recency допускается определять по `task.updated_at` как mutation-anchor; риск artificial rejuvenation из recount/writeback трактуется как допустимый false positive ради строгого запрета false negatives; linked `discussion_window` остаётся корректным anchor для linkage-focused срезов;
- task routing должен использовать явную сегментацию между `task_family` и `executor_role`, а не один плоский undifferentiated queue;
- `DevFigma / FigmaFlow` должен служить ближайшим `seed_context_base` для `executor_role`, process templates, skills и `artifact_record` families при bootstrap executor layer;
- ближайший validation path должен быть practical, а не abstract: текущий `FigmaFlow lowres` и два реальных microprojects (`mriya2` hotels и real estate) — это ожидаемый полигон для проверки `task` connection, `executor_routing` и `task_execution_run`.

## Layered Ontology

### Layer 1. Conversation Runtime / Process Ontology
Это слой того, **как** разговор существует в системе.

Canonical entities:
- `[mom]` `voice_message`
- `[mom]` `voice_session`
- `[-o-]` `mode_segment`
- `[-o-]` `processing_run`
- `[-o-]` `transcript_segment`
- `[ ]` `chunk`
- `[ ]` `marker`
- `[ ]` `mode`

Role in OperOps sandbox:
- `VoiceSession`, `Chunk`, `Mode`, `Processing Run`, `Mode Segment`, `Marker`, review/apply actions

Role in current `copilot/ontology`:
- `[mom]` `voice_message`
- `[mom]` `voice_session`
- `[mom]` `voice_topic`
- `[-o-]` `aggregation_window`
- `[-o-]` `interaction_scope`
- `[-o-]` `mode_segment`
- `[-o-]` `processing_run`
- `[-o-]` `processor_definition`
- `[-o-]` `voice_transcription`
- `[-o-]` `voice_categorization_entry`

Exact task-plane support already present in current ontology:
- `[mom]` `task`

Direct AS-IS task definition:
- current TQL definition lives in [`ontology/typedb/schema/fragments/10-as-is/10-entities-core.tql`](../ontology/typedb/schema/fragments/10-as-is/10-entities-core.tql)
- canonical in-document snippet is defined once in `TQL-Oriented Canonical Contract -> AS-IS canonical excerpt: task` below (single source, no duplicated snippets).

`codex_task` linkage semantics:
- ontologically it is an attribute of `task`, not a second task entity;
- semantically it marks that the task belongs to Codex-oriented taskflow/review handling;
- it remains orthogonal to draft-vs-accepted lifecycle: a task can be `codex_task=true` without changing the essence of being `task`.

Historical note:
- legacy runtime/docs may still mention retired draft/projection labels,
- but canonical ontology treats draftness as `task` with `task_lifecycle_state = DRAFT_10`,
- and does not preserve those labels as first-class entity kinds.

Canonical state rule:
- `task_lifecycle_state` is the persisted/canonical task-state axis.
- `task_review_state` is a UI-local overlay for review workflow and must not be treated as a second canonical task axis.

Minimal relations:
- session has chunks/messages
- message yields transcript segments
- session runs in mode / mode segments
- processing run processes session/messages
- processing run may create `task` rows in `DRAFT_10`
- processing run may update existing `task` rows in `DRAFT_10`
- processing run may reuse existing `DRAFT_10` tasks and link them to the current session when reused
- that same task may later transition into `READY_10` and later lifecycle states
- markers annotate outputs of a run
- task mutations are normalized through `change_proposal`, `writeback_decision`, and `patch`, not through a separate command-entity kind.

### Layer 2. Evidence / Trace Ontology
Это слой того, **чем обосновывается извлечённый смысл**.

Canonical entities:
- `[-o-]` `evidence_observation`
- `[-o-]` `visual_observation`
- `[mom]` `voice_message`
- `[-o-]` `transcript_segment`
- `[-o-]` `evidence_link`

Support field:
- `dialogue_reference` — current field-level evidence carrier, not a first-class evidence entity

Role in OperOps sandbox:
- chunk/timecode provenance
- traceability `VoiceSession -> Processing Run -> Task[DRAFT_10|...] -> Project Context`

Role in current `copilot/ontology`:
- `[mom]` `voice_message`
- `[-o-]` `voice_transcription`
- `voice_transcription_has_transcript_segment`
- `as_is_voice_message_maps_to_object_event`

Minimal relations:
- execution/product entities may be evidenced by message/segment
- any durable mutation should retain at least one evidence link back to a session/message/segment

Current parity note:
- `dialogue_reference` is still a field, not a first-class evidence entity;
- session `discussion_linkage` is not yet a first-class ontology relation in AS-IS and is currently carried operationally by `source_ref` / `external_ref` / `source_data.voice_sessions[]` plus partial `discussion_sessions[]`.

### Layer 3. Status Domain Ontology
Это слой того, **какие статусы допустимы и в каком домене они живут**.

Canonical domains:
- `session_processing_state`
- `task_lifecycle_state`
- `event_status`

Key rule:
- there is no one universal status alphabet.
- `task_review_state` is a UI-local overlay, not a canonical persisted task domain.
- `task_lifecycle_state` is canonical for persisted task state.
- generic `status` in TO-BE snippets is a shared storage slot name, not a claim that all entities use one common status dictionary.

Examples from OperOps / copilot:
- session processing states:
  - `draft`
  - `sent`
  - `processing`
  - `needs_review`
  - `planned`
  - `error`
- task lifecycle states in current copilot runtime:
  - `DRAFT_10`
  - `READY_10`
  - `PROGRESS_10`
  - ...
- historical sandbox review labels:
  - `new` maps conceptually to `DRAFT_10`
  - `plan` maps conceptually to accepted execution-ready task state, canonically `READY_10`

AS-IS dictionary note:
- current runtime already has `status_dict` with `module_scope`, but this is an AS-IS operational dictionary rather than a fully normalized TO-BE status-domain model.
- therefore `status_dict` is evidence that statuses are already scoped, not evidence for one universal alphabet.

Minimal TO-BE interpretation rule:
- `task`: interpret `status` as `task_lifecycle_state`
- `voice_session`: interpret `status` as `session_processing_state`
- `processing_run`, `change_proposal`, `writeback_decision`, `acceptance_evaluation`, `review_annotation`, `object_event`: interpret `status` as `event_status` or review/proposal event state
- `coding_agent`: interpret `status` as availability/activity state of the executable agent surface
- `goal_process`, `goal_product`, `business_need`, `requirement`, `issue`, `risk`, `constraint`: interpret `status` as local domain state, not as task lifecycle

Minimal-schema enforcement choice:
- for direct LLM/coding-agent writes into TypeDB, TO-BE entities use owner-level `@values(...)` constraints on `owns status`;
- this keeps one string carrier while still enforcing per-entity allowed status lists at DB level;
- `task` now normalizes raw Mongo labels directly into canonical lifecycle keys and is constrained in TypeDB via owner-level `@values(...)` on those keys plus `UNKNOWN` fallback.

### Layer 4. Context Ontology
Это слой того, **какой typed context доступен для анализа и решений**.

Canonical entities:
- `[mom]` `project`
- `[-o-]` `context_pack`
- `[ ]` `producing_system`
- `[ ]` `system_of_interest`
- `[ ]` `project_card`

Role in OperOps sandbox / mode engine:
- `Project`
- `Project Card`
- `Context Packs`

Role in current `copilot/ontology`:
- `[-o-]` `project_context_card`
- `[-o-]` `context_pack`

Minimal relations:
- project owns project card
- project binds context packs
- mode/segment may use context packs
- project frames work inside the producing system
- product-side descriptions should point to the system of interest, not to the project by default

Greek-scholastic correction:
- if `working_memory` / `session_memory` / `project_memory` / `shared_memory` are only untyped notes, treating them as first-class ontology entities is a categorical failure;
- minimal repair is to demote them to implementation/index containers unless and until their contents are typed into canonical classes such as `task`, `business_need`, `issue`, `risk`, `constraint`, `goal_process`, `goal_product`, `requirement`.

Greek-scholastic repair:
- `working_memory`, `session_memory`, `project_memory`, `shared_memory` are not retained as first-class ontology entities;
- they were category mistakes insofar as they named note buckets / storage containers rather than typed objects;
- if implementation still needs retrieval scope, cache, or prompt assembly containers, those belong to implementation or index layer, not to first-class domain ontology.

### Layer 5. Artifact / Audit Ontology
Это слой того, **как фиксируются результаты и изменения**.

Canonical entities:
- `[mom]` `history_step`
- `[-o-]` `object_conclusion`
- `[-o-]` `object_manifest`
- `[-o-]` `object_note`
- `[-o-]` `patch`
- `[-o-]` `writeback_decision`
- `[-o-]` `review_annotation`
- `[ ]` `artifact`

Role in OperOps sandbox:
- `Artifact`
- `Patch`
- `HistoryStep`
- Preview / Confirm / Undo discipline

Role in current `copilot/ontology`:
- `[-o-]` `artifact_record`
- `[-o-]` `artifact_patch`
- `[-o-]` `object_revision`
- `[-o-]` `object_event`
- `[-o-]` `object_note`
- `[-o-]` `object_conclusion`
- `[-o-]` `object_manifest`
- `[-o-]` `writeback_decision`
- `[-o-]` `review_annotation`

Minimal relations:
- artifacts are patched
- history steps record mutations
- writeback decisions govern durable mutations
- notes/conclusions/manifests are object-bound, never free-floating memory

### Layer 6. Outcome / Acceptance / Measurement Ontology
Это слой того, **какой результат произведён, по каким критериям уполномоченный `actor` его принимает и как этот результат измеряется**.

Canonical entities:
- `[-o-]` `outcome_record`
- `[-o-]` `acceptance_evaluation`
- `[-o-]` `artifact_record`
- `[-o-]` `kpi`
- `[-o-]` `kpi_observation`
- `[-o-]` `kpi_trigger_event`
- `[-o-]` `acceptance_criterion`

Role in current `copilot/ontology`:
- `[-o-]` `artifact_record`
- `[-o-]` `kpi`
- `[-o-]` `kpi_observation`
- `[-o-]` `kpi_trigger_event`

Greek-scholastic note:
- this layer is needed because `task`, `result`, `acceptance`, and `measurement` are not the same kind of thing;
- otherwise the model collapses “do work”, “produce artifact”, “pass acceptance”, and “improve KPI” into one undifferentiated task blob.

Minimal relations:
- `task -> produces -> outcome_record`
- `artifact_record -> subtype_of -> outcome_record`
- `task -> must_satisfy -> acceptance_criterion`
- `acceptance_evaluation -> checks -> acceptance_criterion`
- `acceptance_evaluation -> evaluates -> outcome_record`
- `actor -> performs -> acceptance_evaluation`
- `goal_process | goal_product -> measured_by -> kpi`
- `kpi -> observed_as -> kpi_observation`

### Layer 7. Registry / Configuration Ontology
Это слой того, **какие правила и словари управляют runtime без переписывания онтологии руками**.

Canonical entities:
- `[ ]` `bot_command_registry`
- `[ ]` `skills_registry`
- `[ ]` `user_profile`
- `[ ]` `identity_map`

Role in OperOps sandbox:
- `bot_commands`
- `skills_registry`
- `user_profiles`
- `identity_map`

Minimal relations:
- `user_profile` conditions command interpretation
- `skills_registry` governs agent behavior by user/chat/project scope
- `bot_command_registry` governs available commands and aliases
- `seed_context_base` is materialized into context packs, role/skill registries, and `executor_routing` defaults rather than kept as one free-form blob

### Layer 8. Actor / Authority Ontology
Это слой того, **кто говорит, кто принимает решения и кто исполняет**.

Canonical entities:
- `[ ]` `actor`
- `[ ]` `coding_agent`
- `[ ]` `executor_role`
- `[ ]` `role`
- `[ ]` `authority_scope`

Role in OperOps sandbox:
- `Admin`
- `Operator/Planner`
- `Participant`
- `Viewer`
- agent roles

Role in current `copilot/ontology`:
- `[mom]` `person`
- `[mom]` `performer_profile`
- `[-o-]` `agent_role`
- `[-o-]` `access_policy`

Minimal relations:
- `actor` participates in `voice_session`
- human `actor` is grounded in `person`
- `person` may have one or more `performer_profile`
- `actor` may enact one or more `role`
- `actor` is bounded by `authority_scope`
- `actor` may own/approve/comment/update entities
- conceptually, `coding_agent` is a non-human performer/executor
- exact TQL currently keeps coding_agent separate from AS-IS `performer_profile`, because `performer_profile` already carries human HR/auth/payroll semantics
- on the human side, `actor` and `performer_profile` are not identical: they share the same underlying `person`, but answer different ontological questions
- executor capability matching runs on `task_family x executor_role`, not on one overloaded mixed field
- `coding_agent` enacts `agent_role` and uses `prompt_pipeline`
- `coding_agent` and `performer_profile` may each enact one or more `executor_role`
- `task[DRAFT_10]` functions as intake pool object before executor routing
- `executor_routing` uses task segmentation by role/task family plus available executor capabilities
- `executor_routing` may route one task either to `performer_profile` or to `coding_agent`, with `human_approval` before launch
- `execution_context` may recommend one or more `coding_agent`
- performer/assignee semantics must stay distinct from generic participant semantics

### Layer 8.5. Executor / Launch Ontology
Это слой того, **как задача переходит от intake к конкретному исполнению**.

Numbering note:
- `Layer 8.5` is a sublayer of Actor / Authority Ontology focused on the execution contour, not a separate peer order alongside Layers 8, 9, 10 and 12.

Canonical entities:
- `[ ]` `task_family`
- `[ ]` `executor_routing`
- `[ ]` `task_execution_run`

Meaning:
- `task_family`: practical routing classification for tasks
- `executor_routing`: durable decision object routing one task toward one executor contour
- `task_execution_run`: one concrete run of task execution by one executor contour

Minimal relations:
- `task -> classified_as -> task_family`
- `executor_routing -> targets -> task`
- `executor_routing -> classifies -> task_family`
- `executor_routing -> launches -> task_execution_run`
- `task_execution_run -> executes -> task`
- `task_execution_run -> produces -> outcome_record`

Key discipline:
- `executor_routing` is not a UI-only suggestion and not the execution run itself;
- `task_execution_run` is not `processing_run`;
- `task_family` is not `executor_role`.

### Layer 9. Management Ontology: Process / Delivery Stream
Это PMBOK/SWEBOK-совместимый слой **кто что делает, что мешает, и какого process outcome мы добиваемся**.

Canonical entities:
- `[mom]` `task`
- `[ ]` `constraint`
- `[ ]` `issue`
- `[ ]` `risk`
- `[ ]` `goal_process`

Meaning:
- `task`: действие / deliverable
- `issue`: уже возникшая проблема
- `risk`: будущая неопределённая угроза/возможность
- `constraint`: ограничение исполнения
- `goal_process`: целевое состояние выполнения / delivery process / execution outcome

Role in current `copilot/ontology` / task bridge:
- `[mom]` `task`

Exact current-state note:
- one primary storage entity now exists: `automation_tasks -> task`,
- historical draft/projection labels are legacy bridge/support vocabulary, not a second task storage family,
- this matches the architectural choice that task semantics should converge to one first-class operational entity.

### Layer 10. Management Ontology: Product Stream
Это PMBOK/SWEBOK-совместимый слой **что должно быть изготовлено и какими продуктными свойствами / business drivers оно обусловлено**.

Canonical entities:
- `[ ]` `business_need`
- `[ ]` `constraint`
- `[ ]` `goal_product`
- `[ ]` `requirement`

Meaning:
- `business_need`: почему вообще нужен проект/изменение
- `constraint`: ограничение решения или исполнения; это shared entity across process/product, а не две разные сущности
- `goal_product`: целевое состояние продукта/решения
- `requirement`: что решение должно обеспечивать

### Layer 11. Cross-Cutting Classification
Это не отдельные management objects, а classification layer.

Canonical entities/fields:
- `topics[]`
- `discussion_sessions[]`
- `discussion_count`

Meaning:
- `topics[]` = thematic domain labels
- `discussion_sessions[]` = relation between entity and voice sessions where it was discussed
- `discussion_count` = derived property from `discussion_sessions[]`

Current parity note:
- in live Mongo/API this classification family is currently hybrid;
- `discussion_sessions[]` is a normalized read/output field,
- raw storage still relies universally on `source_data.voice_sessions[]`,
- `discussion_count` is derived on read and is not a first-class stored ontology object today.

AS IS / TO BE linkage rule:
- AS IS: one primary session carrier still lives in `source_ref` / `external_ref`, with multi-session compatibility carried in `source_data.voice_sessions[]` and partial top-level `discussion_sessions[]`;
- TO BE: `task -> discussed_in -> voice_session` becomes the first-class many-to-many task/session linkage, with message/chunk evidence attached separately;
- decision: `discussion_linkage` itself is not promoted to a first-class entity at this stage, because the link currently has no independent lifecycle/approval/state semantics of its own;
- migration implication: historical session payloads in `processors_data.CREATE_TASKS.data` must be materialized into canonical `DRAFT_10` task docs, after which the payload is legacy history only.

### Layer 12. Settled Decision / Assumption Ontology
Это слой того, **какие решения уже приняты и какие предпосылки приняты временно**.

Canonical entities:
- `[-o-]` `settled_decision`
- `[-o-]` `reasoning_item`
- `[-o-]` `assumption`
- `[-o-]` `open_question`

Rationale:
- в OperOps sandbox есть сильный акцент на review, ambiguity gates, open questions, project-card decisions;
- без этих сущностей часть voice-discussion смысла снова будет насильно сведена к task/requirement.

Grouping principle:
- this layer groups epistemic-resolution objects only: open question, defeasible assumption, reasoning trace, and settled discussion decision;
- execution outcomes stay in the outcome hierarchy and are not grouped here merely because ordinary language also calls some of them "decision".

Negative delimitation:
- `settled_decision` != `assumption` != `open_question` != `reasoning_item` по epistemic status;
- `settled_decision` != `decision sub outcome_record`; the former closes a conversational/review question, the latter is an execution-produced governance verdict;
- they must not collapse into one untyped `knowledge_item`.

## TQL-Oriented Canonical Contract

Этот раздел фиксирует сущности в максимально структурном виде, близком к аннотированному TQL.
Цель: чтобы было понятно не только *что существует*, но и *какие атрибуты и связи мы обязуемся определять*.

Canonical bearer rule for invariants:
- write-side domain invariants anchor on `task`;
- there is no second semantic task carrier parallel to `task`.

### AS-IS canonical excerpt: `task`

```tql
# NOTE: simplified excerpt; full definition in `ontology/typedb/schema/fragments/10-as-is/10-entities-core.tql`
# what: primary operational work object
# scope: BC.TaskWorld
entity task,
  owns task_id @key,
  owns project_id,
  owns row_id,
  owns title,
  owns description,
  owns status @values("DRAFT_10", "READY_10", "PROGRESS_10", "REVIEW_10", "DONE_10", "ARCHIVE", "UNKNOWN"),
  owns priority @values("P1", "P2", "P3", "P4", "P5", "P6", "P7", "UNKNOWN"),
  owns task_type_name,
  owns task_type_id,
  owns issue_type,
  owns performer_id,
  owns source_kind,
  owns source_ref,
  owns external_ref,
  owns source_data,
  owns dialogue_reference,
  owns dialogue_tag,
  owns task_id_from_ai,
  owns priority_reason,
  owns codex_task,
  owns is_deleted,
  owns created_at,
  owns updated_at,
  plays project_has_task:task,
  plays voice_session_sources_task:sourced_task,
  plays task_classified_as_task_type:task;
```

### AS-IS canonical excerpt: `voice_session`

```tql
# NOTE: simplified excerpt; full definition in `ontology/typedb/schema/fragments/10-as-is/30-entities-voice-operops.tql`
# what: bounded discussion event
# scope: BC.VoiceWorld
entity voice_session,
  owns voice_session_id @key,
  owns project_id,
  owns session_name,
  owns session_type,
  owns access_level,
  owns participants,
  owns processors,
  owns session_processors,
  owns processors_data,
  owns last_voice_timestamp,
  owns done_at,
  owns summary_md_text,
  owns created_at,
  owns updated_at,
  plays project_has_voice_session:voice_session,
  plays voice_session_has_message:voice_session,
  plays voice_session_processed_by_run:voice_session,
  plays voice_session_sources_task:source_voice_session;
```

### AS-IS canonical excerpt: `processing_run`

```tql
# NOTE: simplified excerpt; full definition in `ontology/typedb/schema/fragments/10-as-is/30-entities-voice-operops.tql`
# what: one execution occurrence of one processor over one session/message scope
# scope: BC.VoiceWorld
entity processing_run,
  owns processing_run_id @key,
  owns source_ref,
  owns processor_name,
  owns processor_scope,
  owns status,
  owns started_at,
  owns ended_at,
  plays voice_session_processed_by_run:processing_run,
  plays voice_message_processed_by_run:processing_run,
  plays processing_run_uses_processor_definition:processing_run;
```

### TO-BE first-class process/product referents

```tql
# what: system being changed / described / evaluated
entity system_of_interest,
  owns system_of_interest_id @key,
  owns name,
  owns summary,
  owns status @values("identified", "active", "superseded", "retired");

# what: socio-technical system that performs tasks and produces artifacts
entity producing_system,
  owns producing_system_id @key,
  owns name,
  owns summary,
  owns status @values("identified", "active", "degraded", "retired");

# what: desired delivery/process outcome
entity goal_process,
  owns goal_process_id @key,
  owns title,
  owns summary,
  owns status @values("draft", "active", "satisfied", "superseded", "cancelled");

# what: desired product outcome for the system of interest
entity goal_product,
  owns goal_product_id @key,
  owns title,
  owns summary,
  owns status @values("draft", "active", "satisfied", "superseded", "cancelled");

# what: initiating problem/opportunity that justifies the work
entity business_need,
  owns business_need_id @key,
  owns title,
  owns summary,
  owns status @values("identified", "active", "satisfied", "superseded", "cancelled");

# what: condition/property the product must satisfy
entity requirement,
  owns requirement_id @key,
  owns title,
  owns summary,
  owns status @values("draft", "approved", "satisfied", "superseded", "cancelled");

# what: unified participant with authority semantics (human or machine)
entity actor,
  owns actor_id @key,
  owns actor_kind @values("human", "machine"),
  owns name,
  owns summary,
  owns status @values("active", "disabled", "degraded", "retired");

# what: executable CLI/agent surface used for coding work; conceptually a non-human performer/executor
entity coding_agent sub actor,
  owns executable_path,
  owns cli_arguments,
  owns working_directory,
  owns source_ref,
  owns created_at,
  owns updated_at;

# what: generalized role type for authority and execution semantics
entity role,
  owns role_id @key,
  owns name,
  owns summary,
  owns status @values("draft", "active", "superseded", "retired");

# what: capability-side executor role for routing humans and agents
entity executor_role sub role,
  owns created_at,
  owns updated_at;

# what: scope boundary of what actor may approve/reject/apply
entity authority_scope,
  owns authority_scope_id @key,
  owns name,
  owns summary,
  owns status @values("active", "superseded", "retired");

# what: practical task routing family used for segmentation and capability matching
entity task_family,
  owns task_family_id @key,
  owns name,
  owns summary,
  owns status @values("draft", "active", "superseded", "retired"),
  owns created_at,
  owns updated_at;

# what: durable routing decision from one task to one executor contour
entity executor_routing,
  owns executor_routing_id @key,
  owns selected_executor_kind @values("human", "coding_agent", "mixed"),
  owns selected_executor_ref,
  owns routing_basis,
  owns approval_state @values("pending", "approved", "rejected", "superseded"),
  owns launch_state @values("not_ready", "ready", "launched", "failed", "cancelled"),
  owns summary,
  owns status @values("proposed", "approved", "rejected", "launched", "superseded"),
  owns created_at,
  owns updated_at;

# what: one execution occurrence of one task by one executor contour
entity task_execution_run,
  owns task_execution_run_id @key,
  owns executor_kind @values("human", "coding_agent", "mixed"),
  owns executor_ref,
  owns result_ref,
  owns source_ref,
  owns summary,
  owns status @values("queued", "running", "succeeded", "failed", "cancelled"),
  owns started_at,
  owns ended_at,
  owns created_at,
  owns updated_at;

# what: current problem already affecting delivery or product
entity issue,
  owns issue_id @key,
  owns title,
  owns summary,
  owns status @values("identified", "active", "resolved", "superseded", "cancelled");

# what: future uncertainty threatening or enabling outcomes
entity risk,
  owns risk_id @key,
  owns title,
  owns summary,
  owns status @values("identified", "active", "mitigated", "realized", "superseded", "cancelled");

# what: already-given limitation on delivery or solution
entity constraint,
  owns constraint_id @key,
  owns title,
  owns summary,
  owns status @values("identified", "active", "relaxed", "superseded", "retired");
```

### TO-BE first-class acceptance / outcome entities

Schema-lag note:
- this canonical TO-BE block is the semantic target model for the outcome / acceptance family;
- the currently applied `ontology/typedb/schema/fragments/20-to-be/10-semantic-core.tql` already materializes `acceptance_criterion` and `acceptance_evaluation`, but still lags the full `outcome_record` hierarchy;
- until that schema sync lands, `outcome_record`, `decision`, and `state_transition_outcome` should be read here as target-contract types rather than already-applied schema facts.

```tql
# what: generic typed result of task execution / governance transition
entity outcome_record,
  owns outcome_record_id @key,
  owns outcome_kind @values("artifact", "decision", "state_transition"),
  owns title,
  owns summary,
  owns status @values("draft", "active", "superseded", "retired"),
  owns created_at;

# what: typed pass/fail/graded criterion for accepting a task result
entity acceptance_criterion,
  owns acceptance_criterion_id @key,
  owns title,
  owns summary,
  owns status @values("draft", "active", "superseded", "retired");

# what: one acceptance verdict over one produced result
entity acceptance_evaluation,
  owns acceptance_evaluation_id @key,
  owns summary,
  owns status @values("pending", "passed", "failed", "waived"),
  owns created_at;

# what: normalized evidence carrier for quote/span/source used to justify a task
entity evidence_link,
  owns evidence_link_id @key,
  owns source_ref,
  owns summary,
  owns status @values("active", "superseded", "retired"),
  owns created_at;

# what: object locator for what exactly task changes
entity object_locator,
  owns object_locator_id @key,
  owns locator_kind @values("file", "component", "screen", "rule", "agent", "artifact", "other"),
  owns source_ref,
  owns summary,
  owns status @values("active", "superseded", "retired"),
  owns created_at;

# what: canonical DB-side produced artifact bound to execution
entity artifact_record sub outcome_record,
  owns artifact_kind @values("code", "document", "design", "config", "data", "other");

# what: governance/product decision as first-class execution outcome
entity decision sub outcome_record,
  owns decision_kind @values("accept", "reject", "defer", "change");

# what: explicit state transition outcome (without external artifact payload)
entity state_transition_outcome sub outcome_record,
  owns transition_kind @values("status_change", "routing_change", "scope_change", "other");

# what: measured indicator for process or product outcomes
entity kpi,
  owns kpi_id @key,
  owns title,
  owns summary,
  owns status @values("draft", "active", "retired");

# what: one measured observation of a KPI
entity kpi_observation,
  owns kpi_observation_id @key,
  owns summary,
  owns status @values("recorded", "superseded"),
  owns created_at;
```

### TO-BE first-class proposal / approval entities

```tql
# what: proposed mutation to a target object before approval
entity change_proposal,
  owns change_proposal_id @key,
  owns source_ref,
  owns summary,
  owns description,
  owns status @values("proposed", "accepted", "rejected", "superseded"),
  owns created_at,
  owns updated_at;

# what: approved writeback order over a proposal
entity writeback_decision,
  owns writeback_decision_id @key,
  owns source_ref,
  owns summary,
  owns status @values("pending", "approved", "rejected", "executed", "superseded"),
  owns created_at,
  owns updated_at;
```

Coverage note:
- `patch` and `history_step` remain canonical members of the mutation chain,
- but in this wave their structured contract is still inherited from existing AS-IS schema plus Layer 5 markers; dedicated TO-BE card blocks for them are deferred.

### TO-BE first-class reasoning / registry entities (TypeDB extension)

```tql
# what: shared base for temporary/defeasible reasoning records
entity reasoning_item,
  owns reasoning_item_id @key,
  owns summary,
  owns status @values("open", "closed", "superseded");

entity settled_decision sub reasoning_item;

entity assumption sub reasoning_item,
  owns confidence @values("low", "medium", "high");

entity open_question sub reasoning_item,
  owns question_kind @values("scope", "risk", "requirement", "execution", "other");

# what: registry-layer configurable entry
entity registry_entry,
  owns registry_entry_id @key,
  owns name,
  owns summary,
  owns status @values("active", "disabled", "retired");

entity bot_command_registry sub registry_entry,
  owns command_prefix,
  owns alias_set;

entity skills_registry sub registry_entry,
  owns skill_scope,
  owns skill_version;

entity identity_map sub registry_entry,
  owns source_system,
  owns external_identity_ref;

entity user_profile,
  owns user_profile_id @key,
  owns source_ref,
  owns summary,
  owns status @values("active", "disabled", "retired");
```

Task normalization note:
- `task.status` is constrained to `DRAFT_10 | READY_10 | PROGRESS_10 | REVIEW_10 | DONE_10 | ARCHIVE | UNKNOWN`
- `task.priority` is constrained to `P1 | P2 | P3 | P4 | P5 | P6 | P7 | UNKNOWN`
- current ingest normalizes raw Mongo labels into those canonical values before writing `task`

Task type dictionary split note:
- UI label `Тип` (legacy CRM surface) and UI label `Тип задачи` (voice draft surface) are storage-distinct but ontology-close fields.
- legacy `Тип` carrier in task rows is `task_type` (mapped into `task_type_name`); in live rows it is often an ObjectId-like reference, not a stable human label.
- voice/intake `Тип задачи` carrier is `task_type_id`.
- `automation_task_types_tree` (`task_type_tree`) is the practical taxonomy source for both UI selectors; leaf nodes with `type_class=TASK` are the classification target for task rows.
- `automation_task_types` (`task_type`) remains a flat legacy dictionary surface; keep as compatibility dictionary, not as the only canonical taxonomy for current routing/enrichment flow.
- `issue_type` (with runtime coalesce `issue_type | type`) is a separate issue/codex subtype axis and must not be mixed with `task_type_id`.
- write-side normalization rule for new taskflow writes: prefer `task_type_id`; keep legacy `task_type`/`task_type_name` as compatibility mirror when required.

Operational migration contract (staged):
- Phase 1 target: operational `Тип задачи` (`task_type_id`) becomes the default and canonical classifier for all new/edited task rows.
- authoritative read path for task classification: read `task_type_id` when present; if absent, resolve `task_type` / `task_type_name` through the compatibility bridge into `task_type_id`, and do not treat legacy carriers as co-equal canonical reads.
- canonical source for Phase 1 writes: `automation_task_types_tree` with `type_class=TASK` leaves.
- compatibility read-path for historical rows: keep reading `task_type`/`task_type_name`, then resolve via mapping bridge into `task_type_id` when possible.
- do not block migration on full orthogonal decomposition; decomposition of unified type into `issue_type`, `role`, and other axes is Phase 2+ work.

### TO-BE task-local execution context

`task_context_card` остаётся только именем для task-local structured surface.
Этот surface должен materialize на стадии `context_enrichment` до routing/launch, а `human_approval` подтверждает, что minimum launch context собран.
На уровне аннотированного TQL это не отдельная сущность, а прямой task-local relation bundle вокруг `task`:
- `task -> task_family`
- `task -> object_locator`
- `task -> evidence_link`
- `task -> acceptance_criterion`
- `task -> coding_agent`
- `executor_routing -> task`
- `executor_routing -> task_family`
- `executor_routing -> task_execution_run`
- `task_execution_run -> task`
- `task_execution_run -> outcome_record`

### Minimal cross-entity relation contract

```tql
relation task_changes_system_of_interest,
  relates task,
  relates system_of_interest;

relation task_executed_by_producing_system,
  relates task,
  relates producing_system;

relation business_need_drives_goal_product,
  relates business_need,
  relates goal_product;

relation goal_product_decomposes_to_requirement,
  relates goal_product,
  relates requirement;

relation goal_process_decomposes_to_task,
  relates goal_process,
  relates task;

relation task_classified_as_task_family,
  relates task,
  relates task_family;

relation task_targets_object_locator,
  relates task,
  relates object_locator;

relation task_cites_evidence_link,
  relates task,
  relates evidence_link;

relation task_recommended_for_coding_agent,
  relates task,
  relates recommended_coding_agent;

relation task_must_satisfy_acceptance_criterion,
  relates task,
  relates acceptance_criterion;

relation task_produces_outcome_record,
  relates task,
  relates outcome_record;

relation executor_routing_targets_task,
  relates executor_routing,
  relates task;

relation executor_routing_classifies_task_family,
  relates executor_routing,
  relates task_family;

relation executor_routing_launches_task_execution_run,
  relates executor_routing,
  relates launched_task_execution_run;

relation task_execution_run_executes_task,
  relates task_execution_run,
  relates task;

relation task_execution_run_produces_outcome_record,
  relates task_execution_run,
  relates outcome_record;

relation acceptance_evaluation_checks_acceptance_criterion,
  relates acceptance_evaluation,
  relates acceptance_criterion;

relation acceptance_evaluation_evaluates_outcome_record,
  relates acceptance_evaluation,
  relates outcome_record;

relation goal_process_measured_by_kpi,
  relates goal_process,
  relates kpi;

relation goal_product_measured_by_kpi,
  relates goal_product,
  relates kpi;

relation change_proposal_targets_task,
  relates change_proposal,
  relates task;

relation writeback_decision_accepts_change_proposal,
  relates writeback_decision,
  relates change_proposal;

relation person_grounds_actor,
  relates person,
  relates actor;

relation person_has_performer_profile,
  relates person,
  relates performer_profile;

relation actor_enacts_role,
  relates actor,
  relates role;

relation actor_bounded_by_authority_scope,
  relates actor,
  relates authority_scope;

relation actor_performs_acceptance_evaluation,
  relates actor,
  relates acceptance_evaluation;

relation coding_agent_enacts_agent_role,
  relates coding_agent,
  relates agent_role;

relation coding_agent_uses_prompt_pipeline,
  relates coding_agent,
  relates prompt_pipeline;

relation coding_agent_enacts_executor_role,
  relates coding_agent,
  relates executor_role;

relation performer_profile_enacts_executor_role,
  relates performer_profile,
  relates executor_role;

relation coding_agent_supports_task_family,
  relates coding_agent,
  relates supported_task_family;

relation task_family_eligible_for_executor_role,
  relates task_family,
  relates eligible_executor_role;
```

## Why `pain_point` (`[ ]`) is not canonical
`pain_point` (`[ ]`) не является canonical class в этой ontology.

Причина:
- в OperOps / copilot runtime он не был фиксирован как first-class entity;
- в разговорной практике он распадается на:
  - `issue`
  - `constraint`
  - `business_need`
  - иногда `risk`

Следовательно:
- `pain_point` допустим как промежуточный analyzer label,
- но в durable ontology должен быть нормализован в один из более точных классов.

## Modal Management Layer
Эта layer не заменяет сущности, а модально описывает их состояние.

Frame note:
- in this document wave, `necessity` has a deontic reading (obligation / permission contour), not an alethic one;
- modal notation here should be read against a weak deontic frame `KD`, while `knowledge_state` is an independent epistemic overlay rather than the same modal axis.

Applies to:
- `task`
- `business_need`
- optionally later to `requirement`, `issue`, `risk`

### `necessity`
Canonical scale:
- `necessary` (`□p`)
- `contingent` (`◇p & ¬□p`)
- `impossible` (`¬◇p`)

### `knowledge_state`
Canonical scale:
- `known_true`
- `known_false`
- `unknown`

### `mixed_modal` semantics
Если у верхнеуровневой сущности внутри неё смешаны части с разными модальными значениями:
- `mixed_modal = true`
- модальные поля остаются типизированными (`necessity`, `knowledge_state`) и не перегружаются `null`-семантикой.

Rule:
- mixed modal state means the entity is too coarse and must be decomposed until modality becomes unambiguous.

## Unified Action Grammar
Unification happens at the level of **operations**, not at the level of entity kinds.

### Entity kinds
- `task`
- `issue`
- `risk`
- `constraint`
- `goal_process`
- `business_need`
- `goal_product`
- `requirement`

### Action kinds
- `create`
- `update`
- `link_session`
- `add_comment`
- `archive`
- `decompose`
- `relate`
- `satisfy`
- `mitigate`
- `resolve`

This is ontologically sound because:
- entity kinds remain distinct,
- but mutation grammar can be shared.

## Canonical Relation Vocabulary
Минимально нужно зафиксировать не только entity kinds, но и relation kinds.

### Product-side relations
- `business_need -> drives -> goal_product`
- `goal_product -> decomposes_to -> requirement`
- `constraint -> limits -> requirement`

### Execution-side relations
- `goal_process -> decomposes_to -> task`
- `issue -> blocks -> task`
- `risk -> threatens -> goal_process`
- `constraint -> limits -> task`

### Cross-stream relations
- `task -> satisfies -> requirement`
- `issue -> impacts -> requirement`
- `risk -> threatens -> requirement`
- `decision -> changes -> requirement | task | goal`
- `assumption -> conditions -> requirement | task`

### Trace relations
- `entity -> discussed_in -> voice_session`
- `entity -> evidenced_by -> transcript_segment | voice_message`
- `comment -> attached_to -> entity`

## Alignment against the three sources

### A. Against `OperOps - Voice2Task.md`
Strong alignment:
- traceability `VoiceSession -> Processing Run -> Task[DRAFT_10|...] -> Project Context`
- explicit runtime/process entities
- explicit history/undo discipline
- explicit module map and artifact logic

Missing in the previous ontology draft, now added:
- runtime/process layer
- evidence/trace layer
- status-domain layer
- context layer
- artifact/audit layer
- registry/configuration layer
- actor/authority layer
- task-quality structure relevance
- decision/assumption layer

### B. Against `OperOps — Task Decomposer.md`
Strong alignment:
- structured task decomposition
- command layer
- goal/context/result emphasis
- review/plan logic

Needed carry-over into this ontology:
- task is not just a title/description blob; it has decomposition quality dimensions
- commands are process entities, not tasks
- Goal/Context/Result belong to task structure, not only prose
- open questions / ambiguity gates require first-class treatment

### C. Against current `copilot/ontology`
Strong alignment:
- current kernel already models:
  - `[mom]` `task`
  - `[mom]` `voice_session`
  - `[-o-]` `artifact_record`
  - `[-o-]` `artifact_patch`
  - `[-o-]` `context_pack`
  - `[-o-]` `mode_segment`
  - `[-o-]` `processing_run`
  - `[-o-]` `project_context_card`
  - object-bound history/note/conclusion/manifest semantics

This ontology doc now explicitly reflects those layers instead of staying task-only.

Mongo/ontology parity gaps that remain explicit:
- `entity -> discussed_in -> voice_session` is semantically accepted, but exact AS-IS storage still depends on `source_ref` / `external_ref` / `source_data.voice_sessions[]` rather than one first-class ontology relation;
- `discussion_count` is a read-derived field and should not be described as if Mongo already stores it as a standalone canonical attribute.

## Appendix 1. Structural consequences for current specs

Этот appendix фиксирует downstream consequences этой ontology, но не превращает их в generic persistence law.
Domain-specific persistence binding для этой ontology живёт отдельно в `ontology/plan/voice-ontology-persistence-alignment-spec.md`.

### 1. For `voice-task-surface-normalization-spec.md`
Still valid as task-surface canonical contract.
But it is now recognized as one layer only:
- task-plane storage/lifecycle contract
not the full ontology of voice dialogs.

### 2. For `voice-task-surface-normalization-spec-2.md`
This remains the simplification spec for draft reconcile.
It should explicitly inherit concepts from this ontology doc rather than restating ontology locally.

### 3. For `voice-task-session-discussion-linking-spec.md`
This remains the relation-layer spec for task<->session discussion.
It should explicitly remain task-plane scoped and inherit non-task concepts from this ontology doc without restating them.

## Appendix 2. Downstream contract for task enrichment agents

Этот appendix фиксирует не runtime implementation now, а normative downstream requirement для task-enrichment agents.

### For `create_tasks.md`

Будущий downstream contract для [create_tasks.md](../agents/agent-cards/create_tasks.md):
- `create_tasks` должен иметь доступ к shell;
- перед enrichment он должен читать через `read_multiple_files`:
  - [factory/harness.md](../factory/harness.md)
  - [voice-dual-stream-ontology.md](./voice-dual-stream-ontology.md)
- `harness.md` используется как operational guidance по environment/harness discipline;
- `voice-dual-stream-ontology.md` используется как semantic target model.

Нормативные следствия для output behavior:
- Draft output должен стремиться не к “1 строка `name` + 2 строки `description`”, а к Markdown-enriched `description` по canonical template этой ontology;
- Ready+ follow-up analyzers должны использовать `comment-first` policy и не переписывать execution brief автоматически;
- implementer не должен проектировать enrichment surface заново локально в agent-card, а должен следовать этому ontology contract.

### For related agent paths

Этот же downstream contract должен применяться к любым related agent paths, которые:
- enrich или reconcile `task[DRAFT_10]`;
- дообогащают `Ready+`;
- строят review/routing hints поверх discussion-derived tasks.

Boundary reminder:
- этот appendix не означает, что agent-cards меняются в этой волне;
- он означает, что следующая волна implementation не должна принимать новые product decisions заново.

## Annex B. Acceptance markers for this ontology wave

Эта спека считается готовой, если в ней явно зафиксировано следующее:
- есть отдельный `storage-preserving enrichment contract`;
- явно различены `Draft` и `Ready+` enrichment surfaces;
- для `task[DRAFT_10]` задан фиксированный Markdown template в `description`;
- для `Ready+` зафиксирован `comment-first on demand` policy;
- есть appendix с downstream contract для `create_tasks` и чтения:
  - `harness.md`
  - `voice-dual-stream-ontology.md`
- есть decision-complete описание `Draft review workspace` как `master-detail` surface;
- в тексте явно сказано, что эта волна не меняет storage structure и не является implementation wave.

## Annex C. Assumptions for this ontology wave

- `task.description` уже допустим как Markdown-bearing field и может использоваться как canonical Draft enrichment surface без storage migration;
- existing comments достаточно для `Ready+` enrichment without schema changes;
- `create_tasks.md` и UI будут меняться в следующих волнах; в этой волне они только получают normative contract через ontology-spec;
- glossary-термины (`task[DRAFT_10]`, `context_enrichment`, `human_approval`, `executor_routing`, `acceptance_criterion`) остаются в английской/латинской нормализации внутри русского текста.

## Annex D. Minimal Repair to Current Architecture
1. Preserve the current task-plane and status-first semantics.
2. Do not overload `create_tasks` with product or non-task semantics unless analyzer output becomes typed beyond `Task[]`.
3. Treat `discussion_linkage` as an orthogonal relation layer.
4. Introduce product entities only after the task-plane remains stable.
5. Add actor/authority, registry/configuration, and evidence/trace semantics before attempting broad product-plane automation.

## Annex E. Proposed Execution Plan

### Phase 0. Ontology Freeze
- accept this document as conceptual source for voice-dialog analysis;
- rebind follow-up specs to this doc.

### Phase 1. Task-plane Stability
- finish task `discussion_linkage` implementation;
- keep `DRAFT_10` baseline stable;
- switch task classification default to operational `Тип задачи` (`task_type_id`) from `task_type_tree` (`type_class=TASK`);
- require `task_type_id` for all new/edited task rows on write-side;
- keep legacy `task_type` as compatibility mirror and backfill bridge where historical rows still store only legacy type;
- normalize comments and linkage before product-plane persistence.

### Phase 2. Runtime/Registry Alignment
- make explicit use of:
  - `task` in `DRAFT_10`
  - status domains
  - command/skills registries
  in any future analyzer/runtime contracts
- start orthogonal decomposition of unified type surface into independent axes (`issue_type`, `role`, operation/object/deliverable families) without breaking Phase 1 `task_type_id` compatibility.

### Phase 3. Analyzer Output Expansion
- expand from `Task[]` to typed management result:
  - `execution_entities[]`
  - `product_entities[]`
  - `topics[]`
  - `actions[]`
- keep draft task mutations backward-compatible initially.

### Phase 4. Product-plane Persistence
- introduce durable surfaces for:
  - `business_need`
  - `goal_product`
  - `requirement`
  - `constraint`
- do not store them as fake tasks.

### Phase 5. Modal Layer Adoption
- add typed `necessity` (`necessary | contingent | impossible`) and `knowledge_state` (`known_true | known_false | unknown`) to analyzer output for `task` and `business_need` first;
- use `mixed_modal=true` as decomposition signal instead of `null`-overload semantics;
- do not use these as lifecycle statuses.

### Phase 6. Evidence / Authority / Decision Layer
- introduce durable support for:
  - `decision`
  - `assumption`
  - `open_question`
  - evidence links to transcript/message/session
  - actor/authority semantics where needed

### Phase 7. Cross-linking
- allow `task` to satisfy/implement `requirement`;
- allow `issue/risk/constraint` to reference both execution and product entities;
- keep `topics[]` orthogonal across all layers.

## Short Conclusion
A sound ontology for voice sessions / voice dialogs in custom development must be layered.

It must include:
- runtime/process entities,
- evidence/trace entities,
- status-domain entities,
- context entities,
- artifact/audit entities,
- registry/configuration entities,
- actor/authority entities,
- execution management entities,
- product/requirement entities,
- decision/assumption entities,
- cross-cutting classification and relation layers,
- and typed modal management fields (`necessity`, `knowledge_state`, `mixed_modal`).

Anything flatter will either collapse product into tasks, or collapse runtime into management, and both are category mistakes.

## Appendix 3. Verified Mongo / Ontology Parity Snapshot (2026-03-21)

- live collection counts at recheck time: `automation_tasks=5573`, `automation_voice_bot_sessions=2060`, `automation_voice_bot_messages=13230`, `automation_comments=2229`;
- current voice-origin task slice in Mongo after payload-to-draft migration: `source_kind=voice_possible_task -> 1611 Draft rows`, `source_kind missing -> 5 Draft rows`, `source_kind=voice_session -> 33 accepted rows` (`Ready=25`, `Progress 10=4`, `Review / Ready=4`);
- live task-plane rows already exist in MongoDB and the exact AS-IS ontology entity is `task`;
- historical docs/runtime may still mention retired draft/projection labels, but canonical normalization collapses them into `task` plus lifecycle/projection semantics rather than a second task family;
- raw Mongo stores compatibility status labels (`Draft`, `Ready`, `Progress 10`, `Review / Ready`, `Done`, `Archive`), while API/spec semantics continue to speak in lifecycle keys (`DRAFT_10`, `READY_10`, ...);
- raw session linkage is universally recoverable from `source_ref` / `external_ref` / `source_data.voice_sessions[]`;
- direct `discussion_sessions[]` is only partially materialized in raw Mongo today (`1211/1616` Draft rows), and `discussion_count` is read-derived rather than a separately stored field;
- current accepted voice rows do not universally persist direct `discussion_sessions[]`; accepted session lineage still rides mostly on `source_ref` / `external_ref` / `source_data.voice_sessions[]` plus acceptance lineage fields;
- `5` accepted voice rows still carry legacy `source_data.refresh_state="stale"` payload residue, while live draft rows no longer do;
- no active sessions currently retain historical `processors_data.CREATE_TASKS.data`; remaining payload residue sits on `78` non-active / historical sessions and no longer participates in normal runtime draft semantics;
- `automation_comments` has active rows, but live Mongo currently shows `0` populated voice-linkage fields (`source_session_id`, `discussion_session_id`, `dialogue_reference`), so comment linkage remains contract-level/future-populated rather than already-universal storage truth;
- no live draft rows remain with `source_data.refresh_state="stale"`, but compatibility linkage fields still exist and are still consumed by read paths.
