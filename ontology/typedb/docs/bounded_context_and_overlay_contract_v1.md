# Bounded Context and Overlay Contract v1

## Purpose
Freeze sameness, bridge, and per-project overlay rules for the `copilot` ontology platform.

## Canonical Bounded Contexts
- `BC.ProjectWorld`
- `BC.VoiceWorld`
- `BC.TaskWorld`
- `BC.ModeEngineWorld`
- `BC.AgentWorld`
- `BC.ArtifactWorld`
- `BC.RoutingWorld` — operational only, not target-semantic truth

## Sameness and Equivalence Rules
Two records are the **same semantic object** only if they share the same canonical identity inside one bounded context.

Identity priority:
1. explicit ontology key (`*_id`)
2. stable source id + source system
3. canonical project-local object path where applicable

Cross-context equivalence is never implicit.
It must be expressed through:
- bridge relations in TypeDB
- or project-local overlay mapping rules

## Canonical vs Computed Context
Canonical semantic truth may be stored in:
- Mongo current object collections
- Mongo object history collections
- TypeDB ontology entities and relations
- project-local SemanticCards on AFS

Computed execution context includes:
- runtime routing payloads
- temporary context bundles
- retrieval rankings
- execution-only manifests and packing decisions before writeback

Rule:
- computed execution context must not become semantic truth unless written back through explicit object-bound writeback policy.

## Project Overlay Contract
Each project extends the `copilot` ontology kernel via a project-local overlay.

Required layout:
- `/home/strato-space/<project-slug>/ontology/tql/kernel-link.md`
- `/home/strato-space/<project-slug>/ontology/tql/overlays/*.tql`
- `/home/strato-space/<project-slug>/ontology/semantic/*`

### Overlay rules
- kernel is inherited, never copied
- project overlay may add:
  - domain-specific entities
  - domain-specific relations
  - domain-specific role names
  - domain-specific SemanticCards
- project overlay must not redefine kernel ids or change kernel meaning
- project overlay may deprecate local concepts only through explicit migration notes

### Import / update workflow
1. rebuild kernel schema in `copilot`
2. sync kernel reference into project repo
3. apply project-local overlay fragments
4. regenerate project-local schema artifact if the project uses a separate generated schema
5. run project-local contract-check and schema build
6. update project-local SemanticCards if any object semantics changed

## Overlay Bridge Policy
Project-local overlay entities may bridge to kernel entities only through explicit relation families defined in the overlay.

Examples:
- `customer_invoice_maps_to_artifact_record`
- `industry_case_maps_to_project_context_card`
- `domain_risk_extends_target_task_view`

Rule:
- overlay bridge semantics live in the project overlay, not in the kernel schema.
