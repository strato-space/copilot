# SemanticCards

This directory contains the human/LLM-facing semantic conventions for the `copilot` ontology kernel.

## Purpose
- TypeQL remains the formal ontology surface.
- Kernel-level entity/relation semantics are embedded directly in TQL comment blocks.
- Kernel semantic metadata is stored directly next to TQL entities and relations.
- Per-project SemanticCards may still exist as a longer companion surface when a project needs richer explanation.
- Project-specific ontologies should mirror this structure under `/home/strato-space/<project-slug>/ontology/semantic/` and extend, not fork, the kernel cards.

## Layout
- entity and relation semantics for the kernel are now embedded directly in TQL comment blocks
- `templates/` — templates for embedding SemanticCard metadata into TQL and for project-local cards
- `contexts/` — context assembly and bounded-context notes
- `glossary/` — shared semantic vocabulary and longer kernel explanations

## SemanticCard contract
Kernel semantics live in TQL frontmatter-like comment blocks. Project-local AFS cards may still expand them.

Embedded TQL semantic header fields:
- `id` (in the opening tag)
- `kind`
- `fpf_basis`
- `scope`
- `what`
- `not`
- `why`
