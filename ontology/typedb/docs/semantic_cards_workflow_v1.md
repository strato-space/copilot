# SemanticCards and AFS Workflow v1

## Purpose
Define:
- stable SemanticCard paths
- required fields
- generation/update workflow
- review rules
- relation to TQL comments and platform glossary

## Stable Paths
Platform kernel cards:
- `/home/strato-space/copilot/ontology/semantic/entities/<entity>.md`
- `/home/strato-space/copilot/ontology/semantic/relations/<relation>.md`

Project-local cards:
- `/home/strato-space/<project-slug>/ontology/semantic/entities/<entity>.md`
- `/home/strato-space/<project-slug>/ontology/semantic/relations/<relation>.md`
- `/home/strato-space/<project-slug>/ontology/semantic/contexts/<context>.md`
- `/home/strato-space/<project-slug>/ontology/semantic/glossary/<term>.md`

## Embedded TQL Semantic Header Fields
- `id` (in the opening tag)
- `kind`
- `fpf_basis`
- `scope`
- `what`
- `not`
- `why`

## TQL Comment Contract
Each key entity/relation in kernel or TO-BE should include short comments only:
- `what`
- `not`
- `why`
- `semantic-card: <path>`

The detailed semantic explanation lives in the SemanticCard, not in TQL.

## Generation / Update Workflow
### Kernel
1. Change TQL fragment
2. Rebuild generated schema
3. Update or create matching SemanticCard
4. Update `semantic-glossary.md` if the concept is kernel-level
5. Run schema/test/contract-check

### Project overlay
1. Change project overlay fragment
2. Update project-local SemanticCard
3. If a kernel concept boundary changed, update project README/AGENTS and relevant glossary page
4. Run project-local validation

## Write Permissions
### Automation MAY write
- generated boilerplate card skeletons
- path-correct stub cards for new entities/relations
- glossary stubs for new kernel concepts

### Automation MUST NOT finalize without review
- `what/not/why` for high-impact concepts
- changes that alter ontology meaning
- changes that redefine history/source-of-truth policy

### Human review required
- kernel concept cards
- project card semantics
- access policy semantics
- writeback semantics
- domain/customer ontology overlays

## Review Flow
- schema change -> matching SemanticCard required
- missing card = incomplete ontology change
- semantic drift between TQL and card = bug
- project-local overlay change without card update = invalid

## Relation to semantic-glossary
- `semantic-glossary.md` is the kernel-level index and compact explanation layer
- SemanticCards are the full object-level explanation layer
- glossary links concepts together; cards explain one object precisely
