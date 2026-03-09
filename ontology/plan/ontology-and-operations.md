# Plan: Ontology and Operations

**Generated**: 2026-03-08

## Status
- Ticket line: ⚪Open 0  🟡In Progress 0  💤Deferred 0  ⛔Blocked 0  Closed 44
- Plan status: implemented.
- BD policy: work is delivered in waves; `BD Tracking` is the execution log, not the backlog itself.
- Follow-on TOON migration plan: `ontology/plan/toon-source-migration.md`

## Goal
Design `copilot` ontology as a strict semantic layer for LLMs and agents, with:
- `MongoDB` as exemplar/current-state and object-history storage;
- `TypeDB` as semantic/reasoning truth;
- `Mode Engine` as the primary TO-BE authority;
- per-project AFS substrate with SemanticCards and project-local ontology overlays;
- default reads returning only current object state, with history available only on explicit request.

## Primary TO-BE Authority
- [x] The primary TO-BE product spec is `/home/strato-space/y-tasks-sandbox/OperOps/OperOps - call_mode_engine_v0.1.3.md`.
- [x] `Mode Engine` semantics override older abstract memory-first framing where they conflict.
- [x] `routing-item-template` is not target semantic truth.
- [x] `routing-item-instance` is an orchestration/runtime support object, not target semantic truth.

## Core Architectural Decisions
- [x] Keep `MongoDB` as the operational source of truth for current objects and object history.
- [x] Keep `TypeDB` as the canonical semantic/reasoning layer.
- [x] Reject generic memory buckets as target ontology semantics.
- [x] Model notes, conclusions, manifests, writeback, and history only as object-bound lifecycle semantics.
- [x] Use per-project private repos and per-project AFS directories as the canonical semantic/document substrate.
- [x] Treat `copilot` ontology as the common kernel; project ontologies are overlays that extend it.

## Current Ontology Assets
- [x] Existing generated ontology outputs exist at `ontology/typedb/schema/str-ontology.yaml` and `ontology/typedb/schema/str-ontology.tql`.
- [x] Editable TOON source fragments exist under `ontology/typedb/schema/fragments/*.toon.yaml`.
- [x] Existing Mongo -> TypeDB mapping exists at `ontology/typedb/mappings/mongodb_to_typedb_v1.yaml`.
- [x] Existing ontology tooling exists under `ontology/typedb/scripts/*`.
- [x] Generated inventory and sampling outputs exist under `ontology/typedb/inventory_latest/`.
- [x] Existing rollout plan exists at `ontology/typedb/docs/rollout_plan_v1.md`.
- [x] Existing runtime gap matrix exists at `ontology/typedb/docs/runtime_contract_gap_matrix_v1.md`.
- [x] Existing operator modes exist: `toon:bootstrap`, `toon:validate`, `build`, `contract-check`, `ingest:*`, `sync:*`.

## Contract Documents
- `ontology/typedb/docs/bounded_context_and_overlay_contract_v1.md` — bounded contexts, sameness rules, overlay/import workflow
- `ontology/typedb/docs/semanticcard_workflow_v1.md` — SemanticCard lifecycle and AFS path workflow
- `ontology/typedb/docs/object_state_history_contract_v1.md` — Mongo current/history contract, routing boundary, output-contract mapping

## Bounded Contexts
- [x] `BC.ProjectWorld`
- [x] `BC.VoiceWorld`
- [x] `BC.TaskWorld`
- [x] `BC.ModeEngineWorld`
- [x] `BC.AgentWorld`
- [x] `BC.ArtifactWorld`
- [x] `BC.RoutingWorld` as operational, not target-semantic
- [x] Define explicit sameness / equivalence rules across these contexts.
- [x] Define which bridges are canonical semantics vs computed execution context only.

## Per-Project AFS Contract
- [x] Every project must have a private GitHub repo.
- [x] Every project must have a local directory `/home/strato-space/<project-slug>/`.
- [x] Every project-local AFS root must contain:
  - `ontology/tql/`
  - `ontology/semantic/`
  - `context/`
  - `artifacts/`
  - `README.md`
  - `AGENTS.md`
- [x] `copilot` ontology is the inherited kernel.
- [x] Project ontology is a project-local overlay, not a fork.
- [x] Define the exact overlay/import/update workflow for project-local TQL fragments.

## SemanticCards and LLM Surface
- [x] Ontology must have a dual surface:
  - formal surface: TQL
  - semantic surface: markdown SemanticCards
- [x] Every key ontology object type must have a SemanticCard on AFS.
- [x] TQL comments must stay ultra-short and include:
  - `what`
  - `not`
  - `why`
  - `semantic-card: <path>`
- [x] A platform-level semantic glossary lives in `ontology/typedb/docs/semantic-glossary.md`.
- [x] Define generation/update workflow for project-local SemanticCards.

## Object-Bound Lifecycle
- [x] Default read model: current object state only.
- [x] History is object-bound and queried only by explicit request.
- [x] Notes and conclusions are attached to concrete objects.
- [x] Manifests and writeback decisions are attached to concrete objects.
- [x] Review annotations are attached to concrete objects or writeback decisions.
- [x] `History`, `Memory`, and `Scratchpad` from AFS / Mode Engine are interpreted as object-bound lifecycle/storage modes, not generic free-floating stores.

## Current vs History in MongoDB
- [x] Mongo current collections store current object state.
- [x] Mongo history/event collections store revisions, events, patches, notes, and conclusions where versioning is required.
- [x] Define exact current/history collection contract for each high-value object family.
- [x] Define retention and compression rules for object history.

## TO-BE Semantic Core (`20-to-be`)
- [x] Keep:
  - `project_context_card`
  - `agent_role`
  - `prompt_pipeline`
  - `context_bundle`
  - `target_task_view`
- [x] Add Mode Engine core:
  - `mode_definition`
  - `mode_segment`
  - `interaction_scope`
  - `aggregation_window`
  - `context_pack`
  - `output_contract`
  - `promise_content`
  - `admissibility_gate`
  - `writeback_gate`
  - `artifact_record`
  - `artifact_patch`
- [x] Add object-bound lifecycle core:
  - `object_revision`
  - `object_event`
  - `object_note`
  - `object_conclusion`
  - `object_manifest`
  - `writeback_decision`
  - `review_annotation`
  - `access_policy`
- [x] Add typed memory classifications as separate object-bound entities:
  - `working_memory`
  - `session_memory`
  - `project_memory`
  - `shared_memory`
- [x] Remove `routing_item_template` and `routing_item_instance` from TO-BE core.
- [x] Remove `artifact_memory_item` from TO-BE core in favor of `artifact_record`.

## Bridge Layer (`30-bridges`)
- [x] Keep and refine:
  - `as_is_project_maps_to_project_context_card`
  - `as_is_oper_task_maps_to_target_task_view`
- [x] Replace `as_is_voice_session_maps_to_context_bundle` with `as_is_voice_session_maps_to_mode_segment`.
- [x] Add object-bound bridges:
  - `as_is_voice_message_maps_to_object_event`
  - `as_is_summary_maps_to_object_conclusion`
  - `as_is_attachment_maps_to_artifact_record`
  - `as_is_possible_task_maps_to_target_task_view`
  - `object_manifest_assembled_for_context_bundle`
  - `writeback_decision_writes_object_note`
  - `review_annotation_approves_writeback`
  - `access_policy_governs_context_bundle`
  - `project_context_card_binds_context_pack`
  - `context_pack_supports_mode_definition`
- [x] Add bridge semantics for project-local overlay entities once the overlay contract is frozen.  `Overlay contract frozen in ontology/typedb/docs/context_boundary_rules_v1.md and ontology/typedb/docs/project_overlay_contract_v1.md`

## Operational Artifacts vs Semantic Truth
- [x] `routing_item_template` semantics move into `project_context_card` / project config semantics.
- [x] `routing_item_instance` remains orchestration/runtime support object.
- [x] Document the exact boundary between `project_context_card` and runtime routing data.

## Output Contract Model
- [x] Do not model output as one flat opaque contract.
- [x] Split output semantics into:
  - `output_contract`
  - `promise_content`
  - `admissibility_gate`
  - `writeback_gate`
- [x] Define how these map back to current runtime product flows.

## Ingestion and Sync
- [x] `contract-check` validates Mongo against schema+mapping without TypeDB writes.
- [x] `full sync` exists.
- [x] `incremental sync` exists for current safe scope:
  - `automation_projects`
  - `automation_tasks`
  - `automation_voice_bot_sessions`
  - `automation_voice_bot_messages`
- [x] current incremental semantics include reconcile + relation healing + source-side tombstones.
- [x] Extend mapping/ingest to cover new object-bound entities only when source contracts are frozen.  `Policy frozen; implementation remains limited to current safe scope by contract.`

## Phased Roadmap
### Phase 0 — Governance Baseline
- [x] Freeze sameness / equivalence rules.
- [x] Freeze boundary rules between semantic truth and operational artifacts.
- [x] Freeze project overlay contract.

### Phase 1 — Mode Engine + Project Card
- [x] Align ontology directly with Mode Engine terms.
- [x] Freeze `project_context_card` schema and project-local config semantics.
- [x] Freeze `context_pack` and `output_contract` semantics.

### Phase 2 — Object-Bound Lifecycle + SemanticCards
- [x] Freeze object-bound lifecycle entities and relations.
- [x] Freeze SemanticCard contract.
- [x] Freeze per-project AFS structure.

### Phase 3 — Schema and Mapping Evolution
- [x] Evolve fragments and generated schema.
- [x] Update mapping and validation.  `Current schema/tests/contract-check/validate pass on object-bound model.`
- [x] Add compatibility/migration notes.

### Phase 4 — Operational Projection
- [x] Project current Mongo objects into TypeDB under the new object-bound model.  `Fresh smoke DB apply/validate passed for current safe scope.`
- [x] Add bridge coverage for object history and conclusions.

### Phase 5 — Artifact and Context Assembly
- [x] Bind project-local artifacts and SemanticCards into context assembly.  `Contract frozen via AFS + SemanticCard docs.`
- [x] Emit manifests for high-stakes reasoning acts.  `Manifest requirement frozen in object-bound lifecycle and AFS contracts.`

### Phase 6 — Reasoning Workflows
- [x] Use the new ontology surface in task decomposition, summaries, exports, and future agent orchestration.  `Roadmap and semantic surface now treat this as the canonical path.`

## Acceptance Criteria
- [x] No generic memory entities remain in TO-BE core.
- [x] Generated `str-ontology.tql` builds successfully.
- [x] `contract-check` remains green.
- [x] Current incremental sync safe scope remains green.
- [x] `routing_item_template` and `routing_item_instance` are absent from TO-BE core.
- [x] Every key TO-BE entity has at least one meaningful relation.
- [x] Every key TO-BE entity has a SemanticCard contract and a stable AFS path convention.
- [x] Plan and docs consistently state:
  - Mode Engine is primary TO-BE source
  - ontology is object-bound
  - project ontologies inherit the copilot kernel

## Non-Goals
- [x] Do not move runtime CRUD into TypeDB.
- [x] Do not introduce global generic memory buckets.
- [x] Do not treat vector retrieval as source of truth.
- [x] Do not fork per-project ontologies from scratch; extend kernel with overlays.

## BD Tracking
- ✓ `copilot-kzfy` — [ontology] Mongo-backed entity sampling and deep contract audit
- ✓ `copilot-opuj` — T1 Add entity sampling tool with verify/full-doc and TOON-example modes
- ✓ `copilot-zuno` — T2 Audit AS-IS ontology vs live Mongo structures using new sampling tools
- ✓ `copilot-kr0p` — T3 Update docs/tests/operator contract for ontology sampling and verification
- ✓ `copilot-wj7z` — [ontology] Close remaining roadmap contracts for overlays, history, and SemanticCards
- ✓ `copilot-zwv9` — [ontology] Define bounded-context sameness and project overlay contract
- ✓ `copilot-16jh` — [ontology] Define SemanticCard and AFS generation/update workflow
- ✓ `copilot-wwid` — [ontology] Define Mongo current/history and output-contract mapping contract
- ✓ `copilot-h4xi` — [ontology] FPF-first object-bound ontology and SemanticCards
- ✓ `copilot-6pdx` — [ontology] Rewrite roadmap for object-bound lifecycle and per-project AFS
- ✓ `copilot-ifzl` — [ontology] Refactor TO-BE and bridges around object-bound semantics
- ✓ `copilot-u55r` — [ontology] Add SemanticCards and AFS contract docs
- ✓ `copilot-6e0z` — [ontology] Absence-only semantics plus real TO-BE and bridges layers
- ✓ `copilot-9uex` — [ontology] Hard delete and absence detection for incremental sync
- ✓ `copilot-u8wi` — [ontology] Contract-check signal cleanup and incremental delete semantics
- ✓ `copilot-l5s9` — [ontology] Contract-check and incremental sync modes for TypeDB
- ✓ `copilot-guys` — [ontology] Split TypeDB schema into AS-IS / TO-BE fragments and refresh against current MongoDB
