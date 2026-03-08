# SemanticCard Workflow v1

## Purpose
Freeze how SemanticCards are created, updated, and referenced from TQL.

## Card Locations
Kernel semantic metadata lives directly in TQL comment blocks inside:
- `ontology/typedb/schema/fragments/20-to-be/*`
- `ontology/typedb/schema/fragments/30-bridges/*`

Kernel long-form semantics live in:
- `/home/strato-space/copilot/ontology/typedb/docs/semantic-glossary.md`
- `/home/strato-space/copilot/ontology/semantic/contexts/`

Project-local long-form semantic cards may live in:
- `/home/strato-space/<project-slug>/ontology/semantic/entities/`
- `/home/strato-space/<project-slug>/ontology/semantic/relations/`
- `/home/strato-space/<project-slug>/ontology/semantic/contexts/`
- `/home/strato-space/<project-slug>/ontology/semantic/glossary/`

## Embedded TQL Semantic Header Fields
- `id` (in the opening tag)
- `kind`
- `fpf_basis`
- `scope`
- `what`
- `not`
- `why`

## Creation Rules
Create a new card when:
- a new TO-BE entity is introduced
- a new bridge relation is introduced
- a kernel concept changes its semantic boundary
- a project overlay introduces domain-specific semantics not covered by the kernel glossary

## Update Rules
Update an existing card when:
- attributes change meaning
- relation roles change
- source-of-truth changes
- history policy changes
- `what/not/why` drift from the TQL meaning

## TQL Comment Rules
Each key TQL entity/relation should include an embedded semantic header with ultra-short semantics:
- `kind`
- `fpf_basis`
- `scope`
- `what`
- `not`
- `why`

The semantic-card block must wrap the full `entity` or `relation` definition, not only the header. Longer explanation belongs in the semantic glossary or project-local companion cards when needed.

## Review and Write Policy
- kernel SemanticCards may be changed only together with kernel ontology changes
- project-local SemanticCards may be changed with overlay changes

## Generation / Update Workflow
1. Change TQL fragment.
2. Update matching SemanticCard.
3. Rebuild generated schema.
4. Run ontology tests.
5. Run `contract-check`.
6. If project overlay was touched, update project-local cards and generated overlay schema.

## Stable Path Convention
Kernel semantics are co-located in TQL. Project-local long-form cards, when present, use:
- `ontology/semantic/entities/<entity>.md`
- `ontology/semantic/relations/<relation>.md`
- `ontology/semantic/contexts/<context>.md`
