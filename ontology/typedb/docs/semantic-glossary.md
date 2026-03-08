# Semantic Glossary

This glossary is the platform-level LLM-readable semantic companion for the `copilot` ontology kernel.

## Core rules
- There is no generic memory bucket.
- Notes, conclusions, manifests, and history are object-bound.
- Default reads return current object state.
- History is accessed only through explicit object-history queries.
- `MongoDB` stores current exemplars and object history.
- `TypeDB` stores semantic relations, roles, bridges, and provenance.
- `copilot` ontology is the kernel; project ontologies are overlays.

## Key concepts

### Project Context Card
Stable semantic entrypoint for a project. It is not a raw project row and not a routing template.

### Mode Segment
A bounded session interval with one active mode and one interaction scope.

### Context Pack
A reusable bounded set of context sources approved for one project or mode.

### Output Contract
A declaration of what output is promised, under which admissibility rules, and with which writeback policy.

### Artifact Record
A semantic artifact object with identity and lineage. It is not a raw blob and not generic memory.

### Object Revision / Event / Note / Conclusion / Manifest
History and interpretation attached to specific ontology objects, never as free-floating memory.

### Working / Session / Project / Shared Memory
Typed object-scoped memory semantics from Mode Engine. These are not generic stores; they describe the time horizon and scope of object-bound context.
