# Bounded Context and Bridge Rules v1

## Purpose
Define:
- canonical semantic truth vs computed execution context
- sameness / equivalence rules across bounded contexts
- allowed bridge types
- overlay/import/update rules for project-local ontology extensions

## Bounded Contexts
- `BC.ProjectWorld`
- `BC.VoiceWorld`
- `BC.TaskWorld`
- `BC.ModeEngineWorld`
- `BC.AgentWorld`
- `BC.ArtifactWorld`
- `BC.RoutingWorld`

## Semantic Truth vs Computed Execution Context
### Canonical semantic truth
Lives in:
- TypeDB entities/relations
- project-local ontology overlays
- SemanticCards
- project-local semantic artifacts explicitly linked to ontology objects

### Computed execution context only
Includes:
- runtime routing payloads
- assembled prompt context that is not persisted back
- transient orchestration state
- routing-item instances

Rule:
- computed execution context may be derived from semantic truth
- it must not silently become semantic truth without explicit writeback

## Sameness / Equivalence Rules
Use four levels only.

### 1. identical-object
Same object, same identity, same current state surface.
Used for:
- current Mongo object <-> current TypeDB object anchor

### 2. same-subject-different-view
Same underlying subject, different view/model.
Used for:
- `project` <-> `project_context_card`
- `oper_task` <-> `target_task_view`
- `voice_session` <-> `mode_segment`

### 3. derived-from
New semantic object is derived from a source object or source event.
Used for:
- `object_conclusion` from summary/session
- `artifact_patch` from artifact update
- `object_manifest` from context assembly

### 4. supports-context
Artifact or memory mode supports a reasoning act but is not identical to the act.
Used for:
- `context_pack` -> `mode_definition`
- `artifact_record` -> `context_bundle`
- `shared_memory` -> `context_pack`

## Allowed Bridge Types
Allowed bridge families:
- AS-IS -> TO-BE projection bridges
- current-state -> semantic-view bridges
- object -> object-history bridges
- object -> context-assembly bridges
- project-card -> context-pack bridges

Not allowed:
- runtime routing instance -> target truth bridge
- generic memory bucket -> ontology truth bridge
- cross-project bridge without explicit shared/domain policy

## Project-Local Overlay Contract
Every project overlay lives under:
- `/home/strato-space/<project-slug>/ontology/tql/`

Required structure:
- `00-project-kernel-overrides/` only if kernel extension is explicitly approved
- `10-domain-entities/`
- `20-domain-relations/`
- `30-domain-bridges/`
- `README.md`

Rules:
- overlays extend `copilot` kernel; they do not fork it
- overlays must compile on top of generated `str-ontology.tql`
- project overlays may add domain-specific entities/relations/attributes
- project overlays must not redefine existing kernel ids/attributes with different semantics
- all overlay entities must have project-local SemanticCards

## Import / Update Workflow
1. Update kernel only in `copilot/ontology/typedb/schema/fragments/00-kernel/*.tql`
2. Rebuild generated kernel schema
3. Update project overlay fragments in `/home/strato-space/<project-slug>/ontology/tql/`
4. Rebuild project-local generated schema if the project keeps one
5. Update matching SemanticCards
6. Run contract checks and schema validation

## Routing Boundary Rule
- `project_context_card` owns stable project-level configuration semantics
- `routing_item_template` is absorbed into project card/config semantics
- `routing_item_instance` stays runtime/orchestration support object
- any routing-instance output becomes semantic truth only through explicit writeback and bridge semantics
