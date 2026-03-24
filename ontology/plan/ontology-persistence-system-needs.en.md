# System Needs: Ontology Persistence Layer

## Status

- Language: English.
- Purpose: verification checklist for `ontology-persistence-db-spec.md`.
- Role: generic persistence requirements for ontology-driven persistence, without a domain-specific entity catalog.
- Boundary: voice/task-specific persistence alignment is delegated to `ontology/plan/voice-ontology-persistence-alignment-spec.md`.
- All `SN-*` identifiers are stable and must match the Russian version.

Ontological frame for this document:
- `schema order`, `card order`, `instance order`, `storage order`, and `result order` are distinct;
- `type` means a persistence-bearing schema-level entity or relation type;
- `TQL card` means a normative annotated TQL block, not a second schema;
- `instance` means a concrete persisted occurrence, not a TQL declaration;
- `projection` means a validated subset of the returned result, not a new object and not a new write;
- standalone `attribute` types are governed by TQL declarations plus owning cards, not by separate persistence cards.

## Ontological discipline and formal definitions

- `SN-038` The spec must explicitly define `TypeDB 3.x`, `MongoDB`, `type`, `entity`, `relation`, `attribute`, `TQL card`, `instance`, `materialization`, `authority`, `projection`, `TOON`, and `soft delete` in terms strong enough for mathematically disciplined reading.
- `SN-040` The spec must explicitly distinguish `schema order`, `card order`, `instance order`, `storage order`, and `result order`, and must not transfer claims from one order to another without explicit derivation.
- `SN-041` The spec must explicitly state the negative delimitations: `entity` is not identical with a MongoDB document shape; `relation` is not reducible to an incidental join artifact; `attribute` is not an independent object of persistence policy; `TQL card` is not a second schema language; `TOON` is not a second authoring format.

## Authority and source of truth

- `SN-001` There must be exactly one authoritative TQL card for each persistence-bearing schema-level entity or relation type.
- `SN-002` The TQL card must be the only authority for entity, relation, and attribute names.
- `SN-003` Anything not expressible in TypeDB 3.x syntax must live only in the comment metadata block immediately preceding the TQL definition, not in a parallel duplicate source file.
- `SN-004` `TOON` must not become a second source of truth; it is allowed only as a derived output format.

## Materialization and authority

- `SN-005` Each persistence-bearing schema-level entity or relation type must explicitly declare whether it is materialized in `TypeDB`, `MongoDB`, or both.
- `SN-006` Each dual-materialized type must declare exactly one authority backend.
- `SN-007` `authority=both` is forbidden.
- `SN-008` By default, the TQL type label must equal the MongoDB collection name unless an explicit override is declared.
- `SN-009` By default, the TQL attribute label must equal the MongoDB field name unless an explicit override is declared.
- `SN-010` Collection and field overrides must be explicit and local to the card, not spread across arbitrary handwritten code.

## Typing and writes

- `SN-011` Type checking from the TQL card must run before every durable write operation, even when some attributes are physically stored only in MongoDB.
- `SN-012` Value domains expressed via TQL constraints (`@values`, `@regex`, `@range`, value type) must automatically feed runtime validators.
- `SN-013` Writes must be allowed only to the databases declared in the card.
- `SN-014` Direct untyped writes to MongoDB or TypeDB that bypass card-derived validators must count as contract violations.

## Boot and generation

- `SN-015` The persistence procedure must read the `TQL fragment` and `metadata fragment` from the annotated TQL source at service startup, build or verify the runtime card registry, and either compile the validation algorithm or cache it for subsequent per-object validation on the write path.
- `SN-016` TQL cards must generate TypeScript types, runtime validators, and typed repository surfaces for persistence-bearing entities and relations.
- `SN-017` A generated manifest is allowed only as a derived build artifact, never as a second source of truth.

## CRUD, search facade, projection

- `SN-018` CRUD operations must be typed per entity/per relation and derived from the card; if a relation is a first-class persistence object, the spec must provide an explicit relation write path.
- `SN-019` The search-facade interface, layered above the persistence kernel, must accept a natural-language query plus an entity whitelist.
- `SN-020` The search-facade interface must accept a projection contract defining the returned field subset in `result order`.
- `SN-021` The projection contract must be card-validated against card-declared fields or explicitly declared projection aliases; unspecified arbitrary fields must be rejected.
- `SN-022` The search-facade interface must support `JSON` and `TOON`, with `TOON` as the default format.
- `SN-023` There must be a separate kernel-governed interface for arbitrary read-only TQL with an enforced read-only restriction.
- `SN-024` Both the search facade and raw read-only TQL must enforce a mandatory `max_tokens` guard; overflow must return an error, not silent truncation.

## Project scope

- `SN-025` Project scoping must not rely only on query text; it must have a separate machine-checkable argument.
- `SN-026` Every project-scoped persistence-bearing entity or relation type must declare a machine-usable project anchor in the card.
- `SN-027` If a requested persistence-bearing entity or relation type has no declared project anchor, project-scoped search/read must be rejected.

## LLM and schema evolution

- `SN-028` The LLM must have a compact and strict ontology search/read interface.
- `SN-029` The LLM must have a path for proposing type-system changes that updates not only databases but also TQL definitions and metadata.
- `SN-030` LLM-driven schema evolution must follow proposal -> validation -> approval -> apply, not opaque direct production schema mutation.

## Correctness and recovery

- `SN-031` Dual-materialized types must define a formal recovery strategy for partial failures.
- `SN-032` The spec must not claim strong cross-store atomicity without a real coordination mechanism.
- `SN-033` Mirror stores must have an idempotent replay/reconciliation strategy.

## Architectural extensibility

- `SN-034` The architecture must allow extraction into an open-source subsystem and support external backends beyond MongoDB.
- `SN-035` The adapter contract must be general enough for `MongoDB`, `PostgreSQL`, `MySQL`, `SQLite`, and `Oracle`.
- `SN-036` The solution must not depend on a mature popular TypeDB ORM if such an ORM does not currently exist.

## Proof obligations

- `SN-037` The spec must explicitly enumerate proof obligations and separate machine-checkable obligations from empirical ones.

## Deletion semantics

- `SN-039` Default deletion semantics must be soft delete, meaning the write of an explicit deletion-marker attribute rather than physical record removal; the spec must also make the ordinary read semantics for soft-deleted objects explicit.

## Verification question

The spec is sufficient only if it gives an explicit answer to every `SN-*` requirement instead of hiding answers in informal prose.
