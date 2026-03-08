# SemanticCards Workflow v1

## Purpose
Define how SemanticCards are created, updated, reviewed, and linked to TQL.

## Scope
A SemanticCard is required for every key ontology object type used by LLM-facing reasoning.

## Canonical locations
Platform kernel:
- `/home/strato-space/copilot/ontology/semantic/entities/*.md`
- `/home/strato-space/copilot/ontology/semantic/relations/*.md`
- `/home/strato-space/copilot/ontology/typedb/docs/semantic-glossary.md`

Project-local overlay:
- `/home/strato-space/<project-slug>/ontology/semantic/entities/*.md`
- `/home/strato-space/<project-slug>/ontology/semantic/relations/*.md`
- `/home/strato-space/<project-slug>/ontology/semantic/contexts/*.md`
- `/home/strato-space/<project-slug>/ontology/semantic/glossary/*.md`

## Required fields
- `id`
- `kind`
- `what`
- `not`
- `why`
- `attributes`
- `relations`
- `example`
- `tql_ref`

## TQL comment policy
TQL comments stay ultra-short and must contain:
- `what`
- `not`
- `why`
- `semantic-card: <path>`

Long semantic explanation belongs in Markdown cards, not in TQL.

## Update workflow
1. change ontology semantics in TQL fragments
2. update or create the corresponding SemanticCard
3. update `semantic-glossary.md` if the concept is kernel-level
4. rebuild generated schema
5. run ontology tests and contract-check
6. only then mark the semantic contract updated

## Review policy
- kernel SemanticCards require review in `copilot`
- project-local SemanticCards require review in the project repo
- cards affecting writeback, access, or output semantics should be reviewed together with the matching TQL fragment
