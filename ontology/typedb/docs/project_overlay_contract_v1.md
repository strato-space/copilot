# Project Overlay Contract v1

## Purpose
Define how a project-local ontology extends the `copilot` kernel without forking it.

## Kernel vs Overlay
- `copilot` ontology is the kernel/common layer.
- Each project ontology is an overlay.
- Overlays may add domain-specific entities, relations, bridge rules, and SemanticCards.
- Overlays must not duplicate or redefine kernel semantics unless there is a versioned migration decision.

## Project-Local AFS Root
Each project is expected to have:

```text
/home/strato-space/<project-slug>/
  ontology/
    tql/
      fragments/
      generated/
    semantic/
      entities/
      relations/
      contexts/
      glossary/
  context/
    manifests/
    history/
    scratchpads/
    reviews/
  artifacts/
  README.md
  AGENTS.md
```

## Overlay Source Layout
Recommended layout:

```text
ontology/tql/fragments/
  00-project-kernel-bindings/
  10-domain-entities/
  20-domain-bridges/
```

The overlay does not copy kernel files.
It adds fragments that are composed after the `copilot` kernel schema.

## Composition Rule
1. Build `copilot` kernel generated schema.
2. Append project-local fragments in stable order.
3. Generate a project-local schema artifact.
4. Validate overlay against:
   - kernel schema,
   - project-local fragments,
   - Mongo current/history contract,
   - project-local SemanticCards.

## Update Workflow
- kernel changes happen in `copilot`
- project overlay changes happen in the project repo
- project overlay must be revalidated when kernel changes in a breaking or semantically relevant way
- project overlay must explicitly reference the kernel version or commit used for validation

## Non-Fork Rule
Forbidden:
- copy-pasting kernel TO-BE entities into project overlay,
- redefining the same entity id/name with conflicting semantics,
- keeping project-only patched copies of kernel fragments.

Allowed:
- additional domain-specific entities,
- additional bridge relations,
- stronger project-specific policies,
- richer SemanticCards for domain concepts.
