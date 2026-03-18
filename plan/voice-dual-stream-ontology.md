# Voice Dual-Stream Ontology For Voice Sessions

## Status ⚪Open

- Task-surface ticket line: ⚪Open 1  🟡In Progress 0  💤Deferred 0  ⛔Blocked 0  ✅Closed 0
- Plan status: ontology draft rewritten to cover OperOps sandbox and current copilot ontology; downstream specs still need alignment.
- Canonical ontology ticket: `copilot-ua6e`

**Статус документа**: rewritten ontology draft open; downstream spec alignment pending
**Дата**: 2026-03-18  
**Основание**: three-way reconciliation across `/home/strato-space/y-tasks-sandbox/OperOps`, current voice/task specs in `copilot/plan`, and the current semantic kernel under `copilot/ontology`.

## Purpose
Зафиксировать каноническую ontology для voice sessions / voice dialogs в заказной разработке так, чтобы один документ одновременно покрывал:
- conceptual model из `OperOps` sandbox;
- semantic kernel и relation model из `copilot/ontology`;
- current voice/task runtime decisions в `copilot`.

Документ должен ответить на три вопроса:
1. Что существует в разговоре и в системе как сущности разных родов?
2. Как эти сущности связаны между собой?
3. Какие слои нельзя смешивать без category mistake?

## Greek-Scholastic Normalization

### Terms
- **Voice session / voice dialog**: bounded communication event, из которого извлекаются смысловые объекты и operational outputs.
- **Runtime/process ontology**: сущности записи, обработки, сегментации, маршрутизации и аудита.
- **Management ontology**: сущности проектного управления и продуктового определения.
- **Entity kind**: вид сущности.
- **Action kind**: операция над сущностью.
- **Topic**: тематическая классификация; не task, не requirement и не lifecycle status.
- **Necessity**: модальность обязательности результата для успеха проекта.
- **Knowledge state**: модальность знания о результате и способе его достижения.

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

## Layered Ontology

### Layer 1. Conversation Runtime / Process Ontology
Это слой того, **как** разговор существует в системе.

Canonical entities:
- `voice_session`
- `voice_message`
- `transcript_segment`
- `chunk`
- `mode`
- `mode_segment`
- `processing_run`
- `marker`
- `command`

Role in OperOps sandbox:
- `VoiceSession`, `Chunk`, `Mode`, `Processing Run`, `Mode Segment`, `Marker`, `Command`

Role in current `copilot/ontology`:
- `voice_session`
- `voice_message`
- `voice_transcription`
- `voice_categorization_entry`
- `voice_topic`
- `processing_run`
- `plan_item`
- `mode_segment`
- `interaction_scope`
- `aggregation_window`
- `processor_definition`

Historical note:
- legacy runtime/docs may still mention `task_draft`,
- but canonical ontology treats it as `task` with `task_lifecycle_state = DRAFT_10`,
- not as a separate entity kind.

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
- commands and markers operate on outputs of a run

### Layer 2. Evidence / Trace Ontology
Это слой того, **чем обосновывается извлечённый смысл**.

Canonical entities:
- `dialogue_reference`
- `voice_message`
- `transcript_segment`
- `evidence_link`

Role in OperOps sandbox:
- chunk/timecode provenance
- traceability `VoiceSession -> Processing Run -> Task[DRAFT_10|...] -> Project Context`

Role in current `copilot/ontology`:
- `voice_message`
- `voice_transcription`
- `voice_transcription_has_transcript_segment`
- `as_is_voice_message_maps_to_object_event`

Minimal relations:
- execution/product entities may be evidenced by message/segment
- any durable mutation should retain at least one evidence link back to a session/message/segment

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

### Layer 4. Context / Memory Ontology
Это слой того, **откуда берётся знание** для анализа и решений.

Canonical entities:
- `project`
- `project_card`
- `context_pack`
- `working_memory`
- `session_memory`
- `project_memory`
- `shared_memory`

Role in OperOps sandbox / mode engine:
- `Project`
- `Project Card`
- `Context Packs`
- `WM / SM / PM`

Role in current `copilot/ontology`:
- `project_context_card`
- `context_pack`
- `working_memory`
- `session_memory`
- `project_memory`
- `shared_memory`

Minimal relations:
- project owns project card
- project binds context packs
- mode/segment may use context packs
- session updates session memory
- project aggregates project memory

### Layer 5. Artifact / Audit Ontology
Это слой того, **как фиксируются результаты и изменения**.

Canonical entities:
- `artifact`
- `patch`
- `history_step`
- `object_note`
- `object_conclusion`
- `object_manifest`
- `writeback_decision`
- `review_annotation`

Role in OperOps sandbox:
- `Artifact`
- `Patch`
- `HistoryStep`
- Preview / Confirm / Undo discipline

Role in current `copilot/ontology`:
- `artifact_record`
- `artifact_patch`
- `object_revision`
- `object_event`
- `object_note`
- `object_conclusion`
- `object_manifest`
- `writeback_decision`
- `review_annotation`

Minimal relations:
- artifacts are patched
- history steps record mutations
- writeback decisions govern durable mutations
- notes/conclusions/manifests are object-bound, never free-floating memory

### Layer 6. Registry / Configuration Ontology
Это слой того, **какие правила и словари управляют runtime без переписывания онтологии руками**.

Canonical entities:
- `bot_command_registry`
- `skills_registry`
- `user_profile`
- `identity_map`

Role in OperOps sandbox:
- `bot_commands`
- `skills_registry`
- `user_profiles`
- `identity_map`

Minimal relations:
- user profile conditions command interpretation
- skills registry governs agent behavior by user/chat/project scope
- command registry governs available commands and aliases

### Layer 7. Actor / Authority Ontology
Это слой того, **кто говорит, кто принимает решения и кто исполняет**.

Canonical entities:
- `actor`
- `role`
- `authority_scope`

Role in OperOps sandbox:
- `Admin`
- `Operator/Planner`
- `Participant`
- `Viewer`
- agent roles

Role in current `copilot/ontology`:
- `person`
- `performer_profile`
- `agent_role`
- `access_policy`

Minimal relations:
- actor participates in session
- actor may own/approve/comment/update entities
- performer/assignee semantics must stay distinct from generic participant semantics

### Layer 8. Management Ontology: Execution Stream
Это слой **кто что делает и что мешает**.

Canonical entities:
- `task`
- `issue`
- `risk`
- `constraint`
- `goal_execution`

Meaning:
- `task`: действие / deliverable
- `issue`: уже возникшая проблема
- `risk`: будущая неопределённая угроза/возможность
- `constraint`: ограничение исполнения
- `goal_execution`: целевое состояние исполнения/проекта

### Layer 9. Management Ontology: Product / Requirement Stream
Это слой **что должно быть изготовлено и какими свойствами**.

Canonical entities:
- `business_need`
- `goal_product`
- `requirement`
- `constraint`

Meaning:
- `business_need`: почему вообще нужен проект/изменение
- `goal_product`: целевое состояние продукта/решения
- `requirement`: что решение должно обеспечивать
- `constraint`: ограничение решения

### Layer 10. Cross-Cutting Classification
Это не отдельные management objects, а classification layer.

Canonical entities/fields:
- `topics[]`
- `discussion_sessions[]`
- `discussion_count`

Meaning:
- `topics[]` = thematic domain labels
- `discussion_sessions[]` = relation between entity and voice sessions where it was discussed
- `discussion_count` = derived property from `discussion_sessions[]`

### Layer 11. Decision / Assumption Ontology
Это слой того, **какие решения уже приняты и какие предпосылки приняты временно**.

Canonical entities:
- `decision`
- `assumption`
- `open_question`

Rationale:
- в OperOps sandbox есть сильный акцент на review, ambiguity gates, open questions, project-card decisions;
- без этих сущностей часть voice-discussion смысла снова будет насильно сведена к task/requirement.

## Why `pain_point` is not canonical
`pain_point` не является canonical class в этой ontology.

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

Applies to:
- `task`
- `business_need`
- optionally later to `requirement`, `issue`, `risk`

### `necessity`
Binary canonical scale:
- `necessary` (`□p`)
- `possible` (`◇p`)

### `knowledge_state`
Binary canonical scale:
- `dont_know` (`¬Kp`)
- `know` (`Kp`)

### `null` semantics
Если у верхнеуровневой сущности внутри неё смешаны части с разными модальными значениями:
- `necessity = null`
- и/или `knowledge_state = null`

Это не третий статус.
Это сигнал на WBS decomposition.

Rule:
- mixed modal state means the entity is too coarse and must be decomposed until necessity/knowledge become unambiguous.

## Unified Action Grammar
Unification happens at the level of **operations**, not at the level of entity kinds.

### Entity kinds
- `task`
- `issue`
- `risk`
- `constraint`
- `goal_execution`
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
- `goal_execution -> decomposes_to -> task`
- `issue -> blocks -> task`
- `risk -> threatens -> goal_execution`
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
- memory/context layer
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
  - `voice_session`
  - `processing_run`
  - `mode_segment`
  - `project_context_card`
  - `context_pack`
  - `artifact_record`
  - `artifact_patch`
  - object-bound history/note/conclusion/manifest semantics

This ontology doc now explicitly reflects those layers instead of staying task-only.

## Structural consequences for current specs

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

## Minimal Repair to Current Architecture
1. Preserve the current task-plane and status-first semantics.
2. Do not overload `create_tasks` with product or non-task semantics unless analyzer output becomes typed beyond `Task[]`.
3. Treat discussion linkage as an orthogonal relation layer.
4. Introduce product entities only after the task-plane remains stable.
5. Add actor/authority, registry/configuration, and evidence/trace semantics before attempting broad product-plane automation.

## Proposed Execution Plan

### Phase 0. Ontology Freeze
- accept this document as conceptual source for voice-dialog analysis;
- rebind follow-up specs to this doc.

### Phase 1. Task-plane Stability
- finish task discussion linkage implementation;
- keep `DRAFT_10` baseline stable;
- normalize comments and linkage before product-plane persistence.

### Phase 2. Runtime/Registry Alignment
- make explicit use of:
  - `task` in `DRAFT_10`
  - status domains
  - command/skills registries
  in any future analyzer/runtime contracts

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
- add binary `necessity` and `knowledge_state` to analyzer output for `task` and `business_need` first;
- allow `null` until WBS decomposition makes state unambiguous;
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
- memory/context entities,
- artifact/audit entities,
- registry/configuration entities,
- actor/authority entities,
- execution management entities,
- product/requirement entities,
- decision/assumption entities,
- cross-cutting classification and relation layers,
- and binary modal management fields.

Anything flatter will either collapse product into tasks, or collapse runtime into management, and both are category mistakes.
