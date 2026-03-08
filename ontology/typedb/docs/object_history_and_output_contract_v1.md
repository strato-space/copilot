# Mongo Current/History and Output Contract Mapping v1

## Purpose
Freeze:
- current vs history storage contract in MongoDB
- retention/compression rules
- boundary between `project_context_card` and runtime routing data
- mapping of `output_contract` split back to current product/runtime flows

## Current vs History Rule
Default read returns current object state only.
History is queried only by explicit request.

### Current collections
Store current state for object families such as:
- projects
- tasks / possible tasks
- voice sessions
- voice messages
- cards / configs / current semantic artifacts where runtime uses Mongo

### History collections / event streams
Store append-only or versioned history for:
- object revisions
- object events
- artifact patches
- writeback decisions
- review annotations
- conclusions when versioning is needed

## High-Value Object Family Contract
### Project
- current: one current project row
- history: project revisions/config changes

### Task / Possible Task
- current: one current task row
- history: status transitions, patch decisions, conclusions if persisted

### Voice Session
- current: one current session row
- history: session log, merge log, summary lifecycle, mode-segment changes when materialized

### Voice Message
- current: one current message row
- history: message events, transcript/categorization changes, dedup/image-anchor lifecycle

### Artifact
- current: current artifact metadata/state
- history: patch chain and writeback decisions

## Retention / Compression Rules
- current state is never treated as history
- history may be compressed
- history may be archived
- history must not be silently merged back into current state
- deletion of history requires explicit policy, never default pruning

## project_context_card vs runtime routing boundary
### project_context_card contains
- stable project identity and summary semantics
- stable mode/context defaults
- stable context pack bindings
- stable ontology inheritance/config meaning

### runtime routing contains
- transient execution routing instances
- delivery/runtime fan-out choices
- computed execution context
- per-run orchestration details

Rule:
- runtime routing may read from project card
- project card must not mirror transient runtime routing instance state

## Output Contract Mapping To Runtime
### `output_contract`
Represents the typed output surface expected from a mode/pipeline.
Maps to runtime product flows such as:
- summary generation
- task extraction
- artifact patch/update
- status export

### `promise_content`
Represents what the output semantically promises.
Maps to runtime deliverable semantics, not transport payload shape.

### `admissibility_gate`
Represents evidence/policy checks before output is considered valid.
Maps to:
- confidence thresholds
- required source coverage
- review-needed policies

### `writeback_gate`
Represents whether output may mutate durable state.
Maps to:
- automatic write allowed
- review required
- write forbidden / preview only

## Current Implementation Boundary
Current runtime APIs may still emit flatter payloads, but ontology and future context assembly should reason against the split model above.
