# Context Boundary and Sameness Rules v1

## Purpose
This document defines:
- bounded-context separation,
- semantic vs computed/execution context,
- sameness/equivalence rules,
- bridge admissibility rules.

It is the canonical contract for deciding whether a fact belongs to semantic truth, operational execution, or derived context assembly.

## Bounded Contexts
- `BC.ProjectWorld` — project, customer, project group, project card, overlay config
- `BC.VoiceWorld` — session, message, transcript chunks, session log, summary-bearing runtime artifacts
- `BC.TaskWorld` — possible tasks, oper tasks, codex tasks, target task view
- `BC.ModeEngineWorld` — mode definition, mode segment, interaction scope, aggregation window, context pack, output contract
- `BC.AgentWorld` — agent role, prompt pipeline, orchestration-capable runtime actors
- `BC.ArtifactWorld` — artifact record, artifact patch, object-bound semantic artifacts
- `BC.RoutingWorld` — routing item templates/instances and computed runtime routing outputs

## Semantic Truth vs Computed Execution Context
### Semantic truth
Belongs in TypeDB when it is:
- stable enough to reason over,
- object-bound,
- provenance-carrying,
- reused across more than one runtime step.

Examples:
- `project_context_card`
- `mode_definition`
- `mode_segment`
- `target_task_view`
- `artifact_record`
- `object_note`
- `object_conclusion`

### Computed execution context
Does not become target semantic truth when it is:
- ephemeral,
- runtime-only,
- product-of-routing rather than product-of-domain semantics,
- recomputable from canonical state.

Examples:
- `routing_item_instance`
- one-off assembled execution payloads without persisted manifest
- transient tool-call envelopes

## Sameness / Equivalence Rules
### Same object
Treat two records as the same object only if they share one canonical identity surface:
- same current-state object id,
- or same canonical external/source ref,
- or explicit bridge relation already binds them.

### Same meaning, different object
Do not collapse records when they are:
- same project but different lifecycle phase,
- same task title but different task object,
- same session but different mode segment,
- same artifact family but different artifact version.

### Bridge-required sameness
When AS-IS and TO-BE refer to the same semantic thing but different representational layers, sameness must be expressed via a bridge relation, not by pretending the entities are identical.

Examples:
- `as_is_project_maps_to_project_context_card`
- `as_is_voice_session_maps_to_mode_segment`
- `as_is_oper_task_maps_to_target_task_view`

## Canonical vs Non-Canonical Bridges
### Canonical bridges
Allowed when they translate operational truth into stable semantic truth.

Properties:
- explicit relation in `30-bridges`
- provenance-preserving
- non-CRUD
- deterministic from source contracts

### Non-canonical/computed bridges
Not stored as semantic truth when they are:
- request-local only,
- assembled for one runtime path,
- explainable but recomputable,
- not needed outside execution.

These should stay in manifests, logs, or runtime context bundles.

## Boundary Rules
- `routing_item_template` semantics belong to `project_context_card` and project overlay config, not as a TO-BE entity.
- `routing_item_instance` remains operational/runtime-facing.
- `context_bundle` is semantic only when persisted as an auditable context artifact with manifest/provenance.
- `history`, `memory`, and `scratchpad` are lifecycle/storage modes of concrete objects, not free-floating semantic stores.
