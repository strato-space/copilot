# Voice Ontology Persistence Alignment Spec

## Status

- Status: draft for discussion.
- Date: 2026-03-24.
- Role: domain-to-persistence bridge spec.
- Inputs:
  - `ontology/plan/voice-dual-stream-ontology.md`
  - `ontology/plan/ontology-persistence-system-needs.ru.md`
  - `ontology/plan/ontology-persistence-system-needs.en.md`
  - `ontology/plan/ontology-persistence-db-spec.md`

## Purpose

This document does one thing only:

- import persistence-relevant commitments from the voice dual-stream ontology;
- map them onto the generic persistence requirements;
- state how the generic persistence architecture must be specialized for the voice/task domain.

It is not:

- the canonical domain ontology;
- the generic persistence spec;
- the implementation wave plan.

## Scope Boundary

Imported here:

- domain commitments that affect entity/relation coverage;
- first-class vs derived classification;
- traceability and history preservation;
- actor/authority/executor distinctions that affect persistence meaning;
- lifecycle normalization when it changes persistence semantics.

Explicitly out of scope here:

- Draft workspace layout;
- Markdown rendering/UI details;
- operator workflow visualization;
- downstream agent-card execution instructions;
- generic persistence rules that already live in `ontology-persistence-db-spec.md`.

## Dependency Order

This bridge spec sits downstream of:

1. `ontology/plan/voice-dual-stream-ontology.md` as the canonical voice/task domain ontology;
2. `ontology/plan/ontology-persistence-system-needs.ru.md` and `ontology/plan/ontology-persistence-system-needs.en.md` as generic persistence requirements;
3. `ontology/plan/ontology-persistence-db-spec.md` as the generic persistence architecture.

Therefore:

- this document is the only place in this document family where voice/task-specific persistence commitments are imported and bound to the generic persistence kernel;
- this document must not redefine the domain ontology;
- this document must not rewrite the generic persistence rules as if they were voice-specific inventions.

## Imported Domain Commitments

Stable bridge identifiers:

- `VA-001` `task` remains the central task-plane object; draftness and ready-plus semantics are lifecycle readings of one `task`, not separate entity kinds.
- `VA-002` `processing_run` and `task_execution_run` are different entity kinds and must never collapse into one persisted run object.
- `VA-003` voice/task traceability must survive persistence as a chain that can connect `voice_session`, `processing_run`, `task`, `execution_context`, `outcome_record`, and `acceptance_evaluation`.
- `VA-004` `outcome_record`, `artifact_record`, `acceptance_criterion`, and `acceptance_evaluation` are first-class persistence-bearing concepts, not prose-only enrichments.
- `VA-005` task/session discussion linkage is semantically many-to-many; derived fields such as `discussion_count` and `discussion_window` are not first-class entities unless later promoted explicitly.
- `VA-006` process-side and product-side referents must remain distinct: `task`, `goal_process`, `issue`, `risk`, and `constraint` do not collapse into `goal_product`, `requirement`, or `business_need`.
- `VA-007` `person`, `actor`, `performer_profile`, `coding_agent`, `executor_role`, and `authority_scope` answer different ontological questions and must not collapse into one overloaded participant type.
- `VA-008` the mutation chain `change_proposal -> writeback_decision -> patch -> history_step` consists of distinct persistence meanings, not one vague update record.
- `VA-009` aliases and markers remain subordinate: `result_artifact` aliases `artifact_record`; `codex_task` is a task-plane marker, not a separate entity kind.
- `VA-010` first-wave storage-preserving constraints remain domain-side rollout constraints and are not generic persistence laws; they must be explicitly reviewed at the end of the wave and either promoted to stable architecture law or removed as expired rollout constraints.

## First-Class vs Derived Mapping

### First-class persistence-bearing entities or relations

- `task`
- `voice_session`
- `voice_message`
- `processing_run`
- `task_execution_run`
- `executor_routing`
- `outcome_record`
- `artifact_record`
- `acceptance_criterion`
- `acceptance_evaluation`
- `change_proposal`
- `writeback_decision`
- `patch`
- `history_step`
- discussion linkage relation

### Persisted attributes or markers

- lifecycle state such as `DRAFT_10`
- task priority
- task classification
- `codex_task`
- approval flags and status markers

### Derived read-model fields or policies

- `discussion_count`
- `discussion_window`
- `draft_recency_horizon`
- `active_draft_window`
- review completeness signals

### Aliases, not second objects

- `result_artifact -> artifact_record`
- `ready_plus_task -> task` in later lifecycle states

## Persistence Consequences for the Voice Domain

### Entity and relation coverage

The generic persistence layer must be instantiated so that:

- `task` stays first-class and does not split into separate draft/ready entity kinds;
- `processing_run` and `task_execution_run` are persistently distinguishable;
- discussion linkage is realized as relation semantics, not as a permanently overloaded single source field;
- outcome and acceptance semantics are represented by first-class entity/relation surfaces;
- mutation-chain entities remain distinct and traceable.

### Classification discipline

The specialization must explicitly classify each imported concept as one of:

- persistence-bearing entity/relation;
- persisted attribute/marker;
- derived field;
- runtime policy only.

No imported domain term may remain ontologically unclassified.

### Project scope implications

For voice/task specialization:

- `task`, `processing_run`, `task_execution_run`, `executor_routing`, `outcome_record`, and related management objects must have explicit project-scope treatment if they are project-scoped;
- discussion linkage and evidence relations must not create project-scope escape paths;
- derived discussion windows and recency horizons must not be mistaken for project-scope anchors.

### Soft delete implications

Soft delete for this domain must preserve:

- task/session/result traceability;
- mutation-chain history;
- acceptance/evidence auditability.

Ordinary reads may exclude soft-deleted objects, but the domain specialization must retain a recoverable path for audit and historical reconstruction.

## Coverage Against Generic Needs

- `VA-001` -> `SN-018`, `SN-039`
- `VA-002` -> `SN-018`, `SN-040`, `SN-041`
- `VA-003` -> `SN-005`, `SN-018`, `SN-026`, `SN-031`, `SN-033`
- `VA-004` -> `SN-005`, `SN-018`
- `VA-005` -> `SN-020`, `SN-021`, `SN-026`, `SN-027`
- `VA-006` -> `SN-038`, `SN-040`, `SN-041`
- `VA-007` -> `SN-038`, `SN-040`, `SN-041`
- `VA-008` -> `SN-011`, `SN-013`, `SN-031`, `SN-033`
- `VA-009` -> `SN-038`, `SN-040`, `SN-041`
- `VA-010` -> outside generic `SN-*`; rollout constraint only

## Coverage Against Generic Persistence Spec

- ontological discipline imports lean on `Prolegomena`, `Ontological Diagnosis`, and `Normative Thesis`
- card-level specialization relies on `Card Ontology and Naming Law`
- storage and authority specialization relies on `Persistence Laws`
- typed read/write specialization relies on `Typed Write and Read Laws`
- project scoping relies on `Project Scope and Cross-Store Correctness`
- validation discipline relies on `Proof Obligations and Validation`

## Open Domain-Specific Gaps To Resolve Later

- exact task/session discussion linkage materialization strategy for the live voice stack;
- whether `execution_context` is modeled as first-class entity, embedded structured surface, or mixed representation;
- how much of actor/authority ontology is first-wave persisted versus deferred behind existing runtime stores;
- where modal fields such as `necessity` and `knowledge_state` first become durable.

## Outbound References

- Canonical domain ontology: `ontology/plan/voice-dual-stream-ontology.md`
- Generic persistence requirements: `ontology/plan/ontology-persistence-system-needs.ru.md`
- Generic persistence requirements EN mirror: `ontology/plan/ontology-persistence-system-needs.en.md`
- Generic persistence architecture: `ontology/plan/ontology-persistence-db-spec.md`
