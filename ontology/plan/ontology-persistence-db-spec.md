# Ontology Persistence Layer Spec

## Status

- Status: draft for discussion, no implementation in this wave.
- Date: 2026-03-24.
- Scope: generic persistence-layer design only.
- Role: domain-agnostic architecture for ontology-driven persistence.
- Domain-specific alignment belongs in separate bridge specs, for example `ontology/plan/voice-ontology-persistence-alignment-spec.md`.
- System-needs companion docs:
  - `ontology/plan/ontology-persistence-system-needs.ru.md`
  - `ontology/plan/ontology-persistence-system-needs.en.md`

## Purpose

This document specifies a persistence architecture in which one annotated TQL card is the sole authoritative contract for:

- TypeDB 3.x schema names and constraints;
- MongoDB collection and attribute naming, unless an explicit mapping override is declared;
- TypeScript static types and runtime validators;
- typed CRUD, search, projection, and LLM-facing read interfaces;
- future project-local ontology overlays extracted from interviews and then reviewed and applied.

This document does not define a domain-specific entity catalog or domain-specific traceability chain. Such specializations belong in separate bridge specs that bind a concrete domain ontology to this generic persistence kernel.

This is a specification, not an implementation task list.

## 1. Prolegomena

### 1.1 Function of this section

This section fixes the principal meanings used by the rest of the document.

Its purpose is ontological discipline. Later sections must not slide between schema objects, persistence directives, stored instances, and query renderings as if they were one genus.

If later prose uses a looser phrase, the meanings fixed here govern.

### 1.2 Orders of discourse

The specification moves across five distinct orders. A statement may pass from one order to another only by explicit derivation.

- `schema order`
  - contains `type`, `entity`, `relation`, `attribute`, role names, and formal constraints written in TQL;
  - concerns what kinds of things may exist and what may be predicated of them.

- `card order`
  - contains the annotated `TQL card`;
  - concerns normative persistence directives that accompany one persistence-bearing schema type but are not themselves extra schema objects.

- `instance order`
  - contains concrete occurrences of entities and relations;
  - concerns persisted facts, not schema declarations.

- `storage order`
  - contains backend-specific materializations in `TypeDB` and `MongoDB`;
  - concerns how an instance is durably carried by a backend.

- `result order`
  - contains validated projections and their renderings as `JSON` or `TOON`;
  - concerns returned views of stored facts, not new facts or new schema.

First ontological rule:

- a `type` is not a stored document;
- a `card` is not a `type`;
- an `instance` is not a schema declaration;
- a `projection` is not a new fact;
- a result rendering is not a second source of truth.

### 1.3 Lexical normalization

- Typographic variants from the source request are normalized here; this document uses only `MongoDB`, `entity`, and `CRUD`.
- `TOON` is reserved for an output notation only.
- If source phrasing conflicts with the normalized terms below, the normalized terms prevail.

### 1.4 Formal definitions

- `TypeDB 3.x`
  - a typed semantic database and query system in which entity types, relation types, role names, attribute types, and schema constraints are first-class formal objects;
  - in this spec it serves as the semantic and constraint-bearing store, not as a generic blob store.

- `MongoDB`
  - a document database whose primary persistent objects are collections and BSON-like documents;
  - in this spec it serves as the operational and materialization-oriented store for document-shaped current state unless a card explicitly declares otherwise.

- `type`
  - a schema-level formal object declared in TQL;
  - a type is not an instance row, not a document, and not a runtime DTO.

- `entity`
  - a schema-level kind whose instances are identity-bearing objects of discourse;
  - an entity is not reducible to one serialized document shape, even if one backend materializes it that way.

- `relation`
  - a schema-level kind whose instances bind entities through declared roles and may themselves bear attributes;
  - a relation is not merely a foreign-key convenience and must not be reduced to an incidental join artifact when the ontology treats it as first-class.

- `attribute`
  - a typed value carrier owned by an entity or relation according to TQL;
  - an attribute is not an entity, not a relation, and not an independent persistence authority.

- `TQL card`
  - one annotated TQL definition block consisting of a machine-parsable metadata header in comments immediately preceding one persistence-bearing `entity` or `relation` definition in TypeDB 3.x syntax;
  - the card is the normative persistence contract for that type, not a second schema language.

- `instance`
  - one concrete persisted occurrence of an entity or relation;
  - an instance is governed by a type and described by a card, but it is identical with neither.

- `materialization`
  - the durable storage of instances of a type in a particular backend;
  - materialization answers where a fact is carried, not which backend is authoritative for that fact.

- `authority`
  - the unique backend whose successful commit makes a write authoritative for a type;
  - authority is a property of the persistence policy, not of a renderer, DTO, or mirror copy.

- `projection`
  - a validated subset of fields requested from a type or result set;
  - a projection is a partial view of a fact, not a new fact and not a schema mutation.

- `soft delete`
  - a logical deletion act represented by writing an explicit deletion marker attribute such as `is_deleted=true`, optionally plus temporal metadata such as `deleted_at`;
  - soft delete is not physical removal of the stored record.

- `TOON`
  - a compact typed notation for rendering query results;
  - in this spec it is output-only and never a second authoring format or source of truth.

### 1.5 Derived clarifications

- `type` in this spec means a schema-level TQL type, ordinarily an `entity` or `relation` when persistence policy is under discussion.
- standalone `attribute` types remain pure TQL declarations; their persistence policy is governed by the owning entity/relation cards rather than by separate persistence cards.
- a backend mirror may materialize a type without becoming its authority.

### 1.6 Negative delimitations

These negations are part of the ontology, not editorial ornament.

- An `entity` must not be identified with a single MongoDB document shape.
- A `relation` must not be silently downgraded to a transport-only edge if the ontology treats it as first-class.
- An `attribute` must not be treated as an independent object of persistence policy.
- A `TQL card` must not be treated as a second editable schema dialect parallel to TQL proper.
- `TOON` must not be treated as a second authoring format.
- `soft delete` must not be redescribed as deletion simpliciter; physical erasure is a different act.

## 2. Quaestio

### 2.1 Question

What kind of persistence architecture is required if the ontology is to remain authoritative across TypeDB, MongoDB, TypeScript, CRUD, search, and LLM-facing interfaces?

### 2.2 Short answer

The required architecture is:

- one persistence-bearing type, one authoritative TQL card;
- one authoritative backend per type;
- the card as a whole (`TQL fragment` + `metadata fragment`) as the sole source of truth for persistence policy; within the card, the `TQL fragment` alone governs names and type constraints;
- TQL as the sole authority for names and type constraints;
- metadata only for what TQL syntax does not express;
- all operational artifacts generated or checked from the cards;
- all search and read interfaces constrained by card-declared scope and projection laws.

### 2.3 Companion system-needs baseline

The normative need inventory lives in:

- `ontology/plan/ontology-persistence-system-needs.ru.md`
- `ontology/plan/ontology-persistence-system-needs.en.md`

This spec is the design answer to those needs.

## 3. Ontological Diagnosis

### 3.1 First categorical failure: many authorities for one type

Failure:

- one type is defined once in TQL;
- again in Mongo mapping YAML;
- again in TypeScript interfaces;
- again in search and projection code;
- and eventually all four drift.

Concrete counterexample:

- `work_item.status` is constrained semantically in TypeDB, normalized operationally from Mongo labels, and consumed in TS and UI code;
- if each surface names or constrains it independently, runtime can accept values that the ontology rejects, or vice versa.

Minimal repair:

- one TQL card is authoritative;
- everything else is derived from it.

### 3.2 Second categorical failure: treating TOON as a second source of truth

This repository already has explicit historical evidence that TOON or YAML as source increased duplication and noise, after which the ontology was rolled back to annotated TQL as the only editable source.

Therefore:

- using TOON as a query output is admissible;
- using TOON as a second authoring format parallel to TQL is not admissible.

If one says, “TQL is canonical, but TOON also fully defines the same type,” the same failure has merely been renamed.

### 3.3 Third categorical failure: co-equal authority in MongoDB and TypeDB

If one type is materially stored in both databases and both are treated as simultaneously authoritative, the system has no unique answer to:

- which commit defines truth after partial failure;
- which version wins during recovery;
- which conflict policy is correct.

Minimal repair:

- every type has exactly one `authority`;
- other stores are mirrors, projections, or materializations.

### 3.4 Fourth categorical failure: calling the solution an ORM by trivialization

The word `ORM` is dangerous here.

Why:

- TypeDB is not a record-only store;
- relations, roles, and semantic constraints are first-class citizens;
- project scope and inference are not naturally expressible in classical row-object ORM terms.

If one redefines `ORM` to mean “any library that maps some types to some backend,” the discussion is saved only by trivialization. That is not a serious architectural conclusion.

Minimal repair:

- do not optimize for “a popular ORM for TypeDB”;
- optimize for a `card compiler + typed repository + adapter` architecture.

## 4. Premises and Modalities

### 4.1 Established claims

The following claims are established by current local and official sources.

1. Current repo doctrine keeps `MongoDB` as operational current-state storage and `TypeDB` as semantic and reasoning storage.
2. The current backend already uses the official `mongodb` driver directly, not Mongoose or another ODM.
3. TypeDB 3.x officially exposes:
   - gRPC drivers for Rust, Python, Java, C, and C#;
   - an official TypeScript HTTP driver package.
4. TypeDB docs state that the HTTP endpoint is more accessible, while gRPC drivers provide better performance and more sophisticated connection management for production applications.
5. TypeDB driver best-practice docs state that official drivers already handle connection pooling internally, are intended for concurrent use, and should be reused rather than recreated per operation.
6. TypeDB driver best-practice docs also recommend keeping transactions short, batching related operations in moderate chunks, and handling commit conflicts with retries.
7. TypeDB HTTP TypeScript driver exposes an `analyze(...)` operation for query type-checking.
8. The `analyze(...)` response is a type-annotated representation of the query and exposes inferred variable annotations.
9. TypeQL supports:
   - `select` for restricting returned variables;
   - `fetch` for deterministic JSON-shaped result documents.
10. TypeDB's optimizer works per pipeline stage; semantically equivalent queries split into multiple `match` stages may perform worse because they materialize larger intermediate results.
11. TypeDB Studio and TypeDB Console are official ready-made tooling surfaces for schema browsing, query execution, result inspection, and operator/debug workflows.
12. The official `typedb/typedb-driver` repository states that the old Node.js driver has not been upgraded to the TypeDB 3.x path, while the TypeScript HTTP driver is the current official JS and TS route.
13. The official `typedb/typeql` repository states that TypeQL query builders and schema-based ORM code generators are still in development.

### 4.2 Contingent hypotheses

These are design hypotheses, not established facts.

1. Comment metadata blocks can remain readable if they stay narrow and never duplicate TQL structure.
2. A boot-time card registry compiled from the `TQL fragment` plus the comment-level `metadata fragment` can be made robust enough for strict typed CRUD, either by compiling validation logic directly or by caching a checked registry used for later per-object write validation.
3. Project overlays extracted by LLMs can be kept safe if ontology mutation goes through proposal -> validation -> approval -> apply.

### 4.3 Modal separation

Necessary:

- TQL must remain the single authoritative naming surface.
- Every type must have at most one authority backend.
- Type checking must occur before any durable write.
- TOON must remain derived output only.
- project filtering must not depend solely on prompt text.

Contingent:

- whether the first implementation is TypeScript-only, Rust-backed, or hybrid;
- whether dual-materialized operational types use synchronous mirror writes or outbox-driven propagation;
- how rich the first card compiler is.

Conditionally necessary:

- `SN-011`, `SN-015`, `SN-016`, and `SN-017` are necessary within this architecture only under the establishment of Hypothesis 4.2.2;
- once the architecture claims card-derived enforcement, service startup must read the `TQL fragment` plus `metadata fragment`, build or verify the runtime card registry, and make that registry available either as compiled validation logic or as cached per-object write-validation state.

Not achievable under current assumptions:

- a formally strong single-step atomic commit across MongoDB and TypeDB without introducing a dedicated commit coordinator or a supported two-phase commit surface across both systems.

## 5. Normative Thesis

### 5.1 Principal thesis

The persistence layer must be governed by the following thesis:

- one persistence-bearing schema type is normed by one authoritative TQL card;
- the TQL fragment determines names and semantic constraints;
- the metadata fragment determines only extra-TQL persistence directives;
- all runtime validators, repositories, projections, and read surfaces are generated from or checked against that card;
- every materialized type has exactly one authority backend.

### 5.2 Immediate corollaries

From that thesis it follows that:

- ad hoc handwritten Mongo mappings are subordinate, never co-equal;
- TypeScript types are derivative, never canonical;
- search and read interfaces are governed by card-declared admissibility, not by prompt convention;
- dual materialization is allowed only under unique authority plus explicit recovery semantics.

## 6. Card Ontology and Naming Law

### 6.1 Principle

One type, one card, one TQL definition.

The TQL card contains:

- the actual TypeDB 3.x definition of the type;
- a minimal comment metadata block for everything that TypeDB syntax does not express.

The card must not duplicate:

- owned attributes already declared in TQL;
- relation roles already declared in TQL;
- type names already declared in TQL.

### 6.2 Card header shape

Recommended shape:

```tql
# --- <tql-card id="work_item" version="1"> ---
# kind: entity
# scope: BC.ExecutionWorld
# what: primary operational work object
# not: not a second lifecycle-specific entity
# why: shared typed work carrier for runtime and persistence
# persistence:
#   authority: mongodb
#   typedb:
#     materialized: true
#   mongodb:
#     materialized: true
#     collection: work_items
# project_scope:
#   required: true
#   anchor:
#     kind: attribute
#     name: project_id
# deletion:
#   mode: soft
#   marker_attr: is_deleted
#   timestamp_attr: deleted_at
# llm:
#   default_result: toon
# projections:
#   brief: [work_item_id, name, status, priority, assignee_id]
#   table: [work_item_id, name, priority, assignee_id, classification_id]
# projection_aliases:
#   project_name:
#     kind: relation_attr
#     path:
#       - relation: belongs_to_project
#         role: project
#     attribute: name
# attr_overrides:
#   source_blob:
#     stores: [mongodb]
# --- </tql-card> ---
entity work_item,
  owns work_item_id @key,
  owns project_id,
  owns name,
  owns status @values("OPEN", "READY", "IN_PROGRESS", "REVIEW", "DONE", "ARCHIVED", "UNKNOWN"),
  owns priority,
  owns assignee_id,
  owns is_deleted,
  owns deleted_at,
  owns source_blob;
```

### 6.3 Admissible metadata vocabulary

Allowed meta-block keys in v1:

- `kind`
- `scope`
- `what`
- `not`
- `why`
- `persistence`
- `project_scope`
- `deletion`
- `llm`
- `projections`
- `projection_aliases`
- `attr_overrides`
- `relation_realization` for relation cards only

Everything else is rejected unless the card-compiler version explicitly adds it.

### 6.4 TQL authority and metadata subordination

TQL alone determines:

- entity labels;
- relation labels;
- attribute labels;
- attribute value types;
- ownership;
- role names;
- TypeDB-side constraints such as `@key`, `@unique`, `@values`, `@regex`, `@range`.

The metadata block may determine only:

- where instances are materialized;
- which store is authoritative;
- MongoDB collection naming overrides;
- MongoDB attribute naming overrides;
- projection presets;
- projection alias definitions;
- scope anchors;
- deletion policy declarations that point to TQL-declared marker attributes;
- LLM-facing output defaults;
- relation realization strategy in non-TypeDB stores.

Derivation note:

- `projections` and `projection_aliases` are stored in card order not as facts of result order, but as admissibility directives that constrain which result-order shapes are legal for this type.

## 7. Persistence Laws

### 7.1 Materialization loci

Each card must declare one of:

- `typedb only`
- `mongodb only`
- `typedb + mongodb`

### 7.2 Authority law

If a type is materialized in one store only, that store is authoritative.

If a type is materialized in both stores, the card must declare exactly one:

- `authority: typedb`
- `authority: mongodb`

`authority: both` is forbidden.

### 7.3 Default Mongo naming law

If a type is materialized in MongoDB and no override is declared:

- collection name = TQL type label;
- MongoDB field name = TQL attribute label.

Overrides are optional and explicit:

```yaml
mongodb:
  collection: work_items
attr_overrides:
  assignee_id:
    mongodb_name: assigneeId
```

### 7.4 Attribute-level materialization

By default, if a type is materialized in a store, all of its attributes are assumed materialized there.

Exceptions must be explicit in `attr_overrides`:

```yaml
attr_overrides:
  source_blob:
    stores: [mongodb]
  runtime_tag:
    stores: [typedb, mongodb]
```

This satisfies the intended law:

- type checking is still derived from the TQL card;
- an attribute may physically exist only in MongoDB.

### 7.5 Relation-level materialization

TypeDB relations are native.

MongoDB relation realization, when needed, must be declared on the relation card via one of:

- `owner_embedded`
- `foreign_key`
- `edge_collection`
- `derived_only`

Example:

```tql
# relation_realization:
#   mongodb:
#     strategy: owner_embedded
#     owner_type: work_item
#     owner_path: linked_contexts[]
relation work_item_linked_to_context,
  relates work_item,
  relates context_record;
```

Authority rule for owner-embedded relation mirrors:

- if a relation card is authoritative in `TypeDB` but mirrored into an owner document in `MongoDB`, the embedded Mongo representation is derived state only;
- it must not be mutated independently through the owner-entity repository;
- it may change only through the relation write path or by mirror replay.

### 7.6 Deletion policy declaration

Every persistence-bearing card must declare a deletion policy.

Recommended shapes:

```yaml
deletion:
  mode: soft
  marker_attr: is_deleted
  timestamp_attr: deleted_at
```

or, only by explicit exception:

```yaml
deletion:
  mode: hard
  privilege: ontology_admin_only
```

Laws:

- `mode: soft` is the ordinary default policy;
- a soft-delete marker attribute must be declared in TQL and therefore remain within the TQL naming authority;
- `timestamp_attr` is optional but, if present, must also be TQL-declared;
- `mode: hard` is not ordinary deletion semantics but an exceptional privileged policy.

### 7.7 Build and boot law

The persistence service must read the annotated TQL source at startup.

Recommended interpretation:

1. Build step compiles annotated TQL cards into:
   - generated `str-ontology.tql`;
   - generated `ontology-card-manifest.json`;
   - generated TypeScript types and validators.
2. Boot step re-reads annotated TQL fragments, hashes them, and verifies that the generated manifest matches.
3. On mismatch, service refuses to start.

This preserves the required boot-time dependence on TQL while avoiding ad hoc runtime parsing drift.

### 7.8 Derived artifacts

The canonical derived artifacts should be:

- `ontology/typedb/schema/str-ontology.tql`
- `ontology/typedb/generated/ontology-card-manifest.json`
- `backend/src/generated/ontology-types.ts`
- `backend/src/generated/ontology-validators.ts`
- `backend/src/generated/ontology-repositories.ts`

The generated manifest is not a second source of truth. It is a cache of the TQL-card compilation result.

## 8. Typed Write and Read Laws

### 8.1 Write pipeline

For every write:

1. Resolve the target card by TQL type label.
2. Validate input field names against TQL-owned attributes and relation roles.
3. Validate value types against TQL attribute value types.
4. Validate enumerated domains against TQL constraints such as `@values`.
5. Validate store-specific mapping overrides.
6. Validate operation-specific policy such as deletion mode and deletion-marker admissibility when the operation is a delete.
7. Persist to the authoritative store.
8. Persist or schedule propagation to mirror stores named in the card.

No write path may bypass steps 2 through 6.

### 8.2 Typed CRUD surface

The public TypeScript contour should expose generated repositories instead of generic untyped collection access.

Illustrative shape:

```ts
type EntityName = "work_item" | "objective" | "risk_item";
type RelationName = "work_item_linked_to_context" | "threatens_objective";

interface Scope {
  project_id: string;
}

interface EntityRepository<TName extends EntityName> {
  create(input: CreateInput<TName>, scope: Scope): Promise<EntityDTO<TName>>;
  get(id: EntityId<TName>, projection?: Projection<TName>, scope?: Scope): Promise<EntityDTO<TName> | null>;
  update(id: EntityId<TName>, patch: UpdateInput<TName>, scope: Scope): Promise<EntityDTO<TName>>;
  delete(id: EntityId<TName>, scope: Scope): Promise<void>;
}

interface RelationRepository<TName extends RelationName> {
  create(input: CreateRelationInput<TName>, scope: Scope): Promise<RelationDTO<TName>>;
  get(id: RelationId<TName>, projection?: Projection<TName>, scope?: Scope): Promise<RelationDTO<TName> | null>;
  delete(id: RelationId<TName>, scope: Scope): Promise<void>;
}
```

The crucial point is not the exact API syntax but the derivation law:

- entity and relation repository surfaces are generated from cards;
- field names are not handwritten in CRUD code.

Corollary:

- if a relation is first-class in the ontology, its authoritative writes must occur through an explicit relation write path;
- owner-entity repositories must not silently absorb authoritative relation mutation.

### 8.3 Soft-delete law

Default deletion semantics in this spec are soft delete.

Therefore:

- `delete(...)` in a generated repository means logical deletion by writing the deletion-marker attribute declared by the card;
- default markers are `is_deleted=true` and, when present in the card, `deleted_at=<timestamp>`, but both remain subject to the card's explicit deletion policy;
- hard delete is forbidden unless a card explicitly declares a privileged physical-delete policy;
- default reads and search results must exclude soft-deleted objects unless the caller explicitly requests deleted state.

This rule exists to keep ontology identity, provenance, and relation traceability intact under deletion.

### 8.4 Search-facade layer above the persistence kernel

Natural-language interpretation does not belong to the persistence kernel simpliciter.

It belongs to a `search facade` layered above the kernel, while remaining governed by card-declared admissibility, scope, projection, and token-bound rules.

The persistence kernel proper still owns:

- typed write validation;
- read-only TQL execution rules;
- project-scope enforcement;
- projection admissibility;
- result rendering constraints.

The search facade owns:

- natural-language intake;
- NL2TQL compilation;
- binding the resulting query to the kernel-governed admissibility checks.

### 8.5 Structured search interface

Recommended structured search surface:

```ts
search({
  text: "high priority work items about authentication",
  types: {
    entities: ["work_item", "objective", "risk_item"],
    relations: ["threatens_objective"]
  },
  projection: {
    work_item: ["work_item_id", "name", "priority", "assignee_id"],
    risk_item: "brief"
  },
  scope: { project_id: "6875e887c5f43ce3d205e7c6" },
  format: "toon",
  max_tokens: 50000
})
```

Semantics:

- `text` is natural language and is compiled to TypeQL;
- `types.entities` is mandatory and constrains the primary search space;
- `types.relations` is optional in v1 but, if present, is governed by the same card-validation discipline;
- `projection` may be a named card projection or an inline field list;
- `scope.project_id` is mandatory unless the interface is explicitly privileged;
- `format` is `toon` by default and `json` optionally;
- `max_tokens` is a hard output cap; exceeding it is an error, not silent truncation.

### 8.6 Query-shape discipline for compiled search

To stay close to official TypeDB capabilities and keep the integration layer thin:

- compiled search should emit ordinary TypeQL strings and use the official driver, not a custom local query AST runtime;
- whenever the result shape is object-like, prefer one `match` stage followed by `fetch`, because `fetch` already produces deterministic JSON-shaped documents;
- use `select` when the intended result is a restricted variable set rather than a structured document;
- avoid splitting simple filters across multiple `match` stages when one stage suffices, because TypeDB's optimizer works per stage and unnecessary stage boundaries can inflate intermediate results;
- run `analyze(...)` on generated queries in validation paths and on privileged raw read-TQL paths before execution.

### 8.7 Projection law

Projection is analogous to `SELECT a, b, c`, but must be card-validated.

Two legal forms:

1. Named projection from the card:
   - `brief`
   - `table`
   - `audit`
2. Inline projection list:
   - `["work_item_id", "name", "priority", "assignee_id"]`

Cross-type or relation-derived fields are legal only if declared in `projection_aliases` on the card.

Recommended alias shape:

```yaml
projection_aliases:
  project_name:
    kind: relation_attr
    path:
      - relation: belongs_to_project
        role: project
    attribute: name
```

Illegal:

- fields not owned by the target type and not defined as projected relation aliases;
- projection names not present in the card.

### 8.8 JSON and TOON outputs

`JSON`:

- exact machine-readable document result produced from `fetch` when the query shape is document-oriented.

`TOON`:

- compact typed textual rendering of the same projected result;
- deterministic and loss-limited relative to the requested projection;
- intended for LLM context and operator inspection.

Illustrative TOON shape:

```text
work_item(work_item_id="w-17", name="Fix authentication callback", priority="P1", assignee_id="a-4")
work_item(work_item_id="w-18", name="Review redirect flow", priority="P2", assignee_id="a-9")
```

The exact TOON grammar can be versioned later, but two rules are fixed now:

1. TOON is derived from the same validated projection result as JSON.
2. TOON is not editable source.

Corollary for implementation thinness:

- the persistence layer should not invent a second document-shaping engine when TypeQL `fetch` already provides the machine-readable result surface needed for JSON and the intermediate input needed for TOON rendering.

### 8.9 Raw read-only TQL interface

The LLM must also have a compact, strict interface for arbitrary read-only TQL.

Recommended surface:

```ts
readTql({
  tql: `
    match
      $w isa work_item, has name $name;
    select $w, $name;
  `,
  types: {
    entities: ["work_item"],
    relations: []
  },
  scope: { project_id: "6875e887c5f43ce3d205e7c6" },
  format: "toon",
  max_tokens: 50000
})
```

Mandatory safeguards:

- read-only transaction only;
- reject `define`, `undefine`, `redefine`, `insert`, `put`, `update`, `delete`;
- analyze query before execution;
- enforce declared type whitelist;
- enforce project scope;
- enforce output token cap.

## 9. Project Scope and Cross-Store Correctness

### 9.1 Why free-text scope is insufficient

Putting `project-id=...` into natural language is not a sufficient safety mechanism.

Counterexample:

- “show work items for project X” may be translated to a query that forgets the join path for `risk_item` or `objective`.

This is an empirical failure mode, not a merely terminological one.

### 9.2 Card-level project anchor law

Every project-scoped card must declare a machine-usable anchor.

- direct attribute anchor:
  - `project_id`
- or relation-path anchor:
  - `work_item -> project`
  - `risk_item -> threatens -> objective -> project`

Recommended meta-block shape:

```yaml
project_scope:
  required: true
  anchor:
    kind: relation_path
    segments:
      - relation: threatens_objective
        role: objective
      - relation: belongs_to_project
        role: project
    terminal_attribute: project_id
```

The path grammar must be explicit enough that a compiler can determine, for every segment:

- which relation label is traversed;
- which role or target type is selected;
- which terminal attribute realizes project identity.

### 9.3 Query compiler rule

For `search` and `readTql`:

1. caller passes `scope.project_id`;
2. compiler resolves every requested entity or relation type's project anchor from the card registry;
3. compiler injects or verifies the project constraint;
4. if any requested entity or relation type has no project anchor, query is rejected.

This is preferable to hidden prompt-only filtering because it is checkable.

### 9.4 Strong claim that cannot be made honestly

The architecture cannot honestly claim strict atomic cross-store commit across MongoDB and TypeDB under the current tool surface.

To claim otherwise would be pseudo-formal.

### 9.5 Admissible correctness model

For dual-materialized types, choose one:

1. `authoritative synchronous commit + mirrored best-effort write`
2. `authoritative commit + durable outbox + idempotent mirror applier`

Recommendation:

- use `authority + outbox` as the default correctness model.

Under current assumptions, the formally achievable modality is eventual consistency with explicit replay, not atomic cross-store co-commit.

### 9.5.1 Concrete replay algorithm for `authority + outbox`

The default replay algorithm is:

1. The authoritative write commits to the authority backend together with a durable outbox record in the same authoritative transaction or an equivalently durable authority-coupled substrate.
2. Each outbox record carries at least:
   - `event_id`
   - `type_label`
   - `instance_id` or relation identity
   - `authoritative_version`
   - `operation`
   - `payload`
   - `scope` when required by the card
3. The mirror applier consumes outbox records in durable order.
4. Before applying a record, the applier checks an idempotence ledger keyed by `event_id` or an equivalent `(type_label, instance_id, authoritative_version)` tuple.
5. If the record is already marked applied, the applier performs no semantic write and advances.
6. If the record is new, the adapter computes a deterministic target mutation from the authoritative payload and card metadata.
7. The adapter then applies create, update, or logical delete in the mirror store by stable identity; this algorithm must not rely on a native SQL-style upsert primitive, but on the adapter's own deterministic read-by-key plus create-or-replace discipline.
8. Only after a successful mirror write does the applier persist the applied marker in the idempotence ledger.
9. If the mirror write fails, the outbox record remains pending and is retried without changing authoritative truth.
10. Reads that require definitive truth must continue to source from the authority backend until mirror lag is reconciled.

This algorithm is the reference meaning of `formal recovery strategy` and `idempotent replay` in `SN-031` and `SN-033`.

### 9.6 Recommended generic authority heuristic

- Document-shaped current-state entities with frequent operational mutation often default toward `mongodb` authority.
- Relation-first or graph-shaped semantic objects with constraint-heavy topology often default toward `typedb` authority.

This is a heuristic, not a domain-specific ontology decision. Concrete type assignments belong in bridge specs.

Additional relation rule:

- relation authority and owner-entity authority may differ;
- when they differ, any owner-embedded relation state in the non-authoritative store is projection state, not independently editable fact.

## 10. Prudential Engineering Options

### 10.1 No classical ORM requirement

Conclusion:

- there is no mature popular TypeDB ORM that currently satisfies this requirement set;
- official query builders and ORM code generators are still “in development”;
- therefore v1 should not depend on finding such an ORM.

Recommended stance:

- use generated repositories and validators, not an external TypeDB ORM.

### 10.1.1 Thin integration profile

To maximize reuse of the official TypeDB ecosystem and keep local integration thin, local code should be limited to:

- extracting `TQL card` envelopes from annotated source files;
- validating card metadata that TypeQL itself does not express;
- generating TypeScript repository surfaces and validators from cards;
- compiling approved query templates and search/projection requests into TypeQL strings;
- rendering `TOON` from validated JSON/fetch results;
- orchestrating cross-store recovery and mirror propagation outside TypeDB.

Local code should not, in v1, attempt to replace ready-made official capabilities for:

- connection management and pooling;
- authentication and transaction lifecycle management;
- query type-checking and inferred-type analysis;
- schema browsing and ad hoc query debugging;
- raw protocol handling.

Therefore the default tool stack should be:

- the official TypeScript HTTP driver package in the TypeScript service;
- official TypeDB Studio and TypeDB Console for operator/debug and schema-inspection workflows;
- official driver transaction options for timeout and lock handling;
- official `analyze(...)` for validation of generated or privileged read-only queries.

### 10.2 Option A: TypeScript-only runtime

Shape:

- boot-time TQL-card compiler in TypeScript;
- MongoDB via current official `mongodb` driver;
- TypeDB via the official TypeScript HTTP driver package;
- query validation via the same driver's `analyze(...)`;
- Studio/Console retained as the human admin and debugging surface instead of building a custom ontology admin UI.

Pros:

- aligns with current backend language;
- lowest integration friction;
- one deployment contour.

Cons:

- TypeDB path is HTTP, not primary gRPC;
- full static parsing of annotated cards still remains local responsibility if we insist on deeper-than-string analysis;
- if generalized adapter infrastructure later becomes central, this option may be outgrown.

Verdict:

- best short-term integration option.

### 10.3 Option B: TypeScript app layer plus Rust card compiler and core

Shape:

- Rust component handles TQL-card parsing, static checks, manifest generation, and perhaps TypeDB writes via the official Rust gRPC driver;
- TypeScript app consumes the generated manifest and keeps the Mongo and HTTP-facing API surface.

Pros:

- closest to the official TypeDB driver core architecture, since official gRPC drivers are thin wrappers over a shared Rust core;
- better fit for formal parsing and future reusable OSS subsystem;
- gRPC path is available for production-grade TypeDB interaction.

Cons:

- duplicates part of the official driver/core stack unless a genuinely stronger parser/compiler boundary is needed;
- adds service or FFI boundary;
- higher operational complexity;
- longer initial delivery time.

Verdict:

- best medium-term option only if formal parsing, stronger static guarantees, or reusable cross-language compiler artifacts justify the extra boundary.

### 10.4 Option C: TypeScript app layer plus Python sidecar

Shape:

- keep the current Python TypeDB toolchain for schema, build, validation, and perhaps limited persistence sync;
- TypeScript remains the runtime API layer.

Pros:

- leverages existing local ontology tooling immediately;
- Python has the official TypeDB gRPC driver and already exists in repo workflows.

Cons:

- two dynamic languages are less attractive if the goal is a formally strong typed core;
- not an ideal foundation for a reusable external adapter subsystem.

Verdict:

- valid transitional bridge, not the cleanest long-term design.

### 10.5 Option D: “TypeDB plugin writes into MongoDB”

This option is not recommended.

Reason:

- current official TypeDB docs expose drivers, HTTP API, Cloud API, Studio, Console, and IDE plugins;
- they do not document a server-side plugin system suitable for this persistence design;
- therefore this path is speculative, not a grounded engineering baseline.

Verdict:

- reject as v1 architecture.

### 10.6 Recommended practical decision

Decision for discussion:

1. v1 runtime and API layer in TypeScript.
2. Use the official TypeScript HTTP driver package plus `analyze(...)` as the default TypeDB integration path.
3. Treat TypeDB Studio and TypeDB Console as the default human-facing schema/query tooling.
4. TQL-card compiler initially simple and narrow: parse only the card envelope plus bounded metadata, not the full TypeQL grammar.
5. Manifest generation and validation mandatory.
6. Leave room for a Rust compiler and core in v2 if:
   - full TQL AST parsing becomes necessary;
   - stronger proof obligations are required;
   - the external-adapter OSS subsystem becomes a committed product.

Default validation stance:

- compiling validation logic directly from the checked card registry is the preferred default;
- caching a checked registry for per-object validation is admissible only if boot-time hash verification and artifact/card coherence checks are enforced for the running service lifecycle.

## 11. LLM-Driven Ontology Evolution

### 11.1 Required workflow

The LLM must not directly mutate live ontology state as an opaque side effect.

Required chain:

1. propose TQL-card patch;
2. validate schema and metadata;
3. generate migration plan for affected stores;
4. require approval;
5. apply TQL change and storage migration;
6. regenerate manifest and TypeScript types;
7. restart services against the new card hash.

### 11.2 Why this is necessary

Interview-derived domain ontology is not merely new text. It changes:

- the TQL schema;
- persistence mappings;
- TypeScript surfaces;
- query-compiler admissibility;
- project-scope rules.

So ontology evolution is a schema-change discipline, not prompt-only enrichment.

## 12. Future OSS Adapter Subsystem

If this becomes a standalone open-source subsystem, the clean modular split is:

- `card-compiler`
- `typed-repository-runtime`
- `typedb-adapter`
- `mongodb-adapter`
- future:
  - `postgres-adapter`
  - `mysql-adapter`
  - `sqlite-adapter`
  - `oracle-adapter`

The stable cross-adapter interface should be defined at the card-manifest level, not at raw handwritten per-backend mappings.

## 13. Proof Obligations and Validation

### 13.1 Definition

A `proof obligation` in this spec is a claim that must be discharged before the architecture may be treated as sound for its intended scope.

There are two species:

- `mechanical proof obligations`
  - discharged by compilation, static analysis, schema validation, or deterministic tests;
- `empirical proof obligations`
  - discharged by runtime experiments, failure injection, benchmarks, and operational observation.

Saving an obligation by weakening it into “the system is generally careful” would be salvage by trivialization. The obligation must stay precise enough to fail.

### 13.2 Mechanical proof obligations

- `PO-001 Card uniqueness`
  - For every persistence-bearing entity or relation type there exists exactly one authoritative TQL card.
  - Discharge condition: compiler rejects duplicate card ids and duplicate persistence-bearing type declarations.

- `PO-002 Name authority`
  - Every generated repository field, validator field, projection field, and Mongo override target refers to a label declared in TQL.
  - Discharge condition: code generation fails if any referenced entity, relation, role, or attribute label is absent from the source cards.

- `PO-003 Attribute typing`
  - Every generated write validator accepts only values admitted by the TQL-declared value type and TQL constraints.
  - Discharge condition: generated validator test corpus proves agreement with TQL value domains for representative positive and negative cases.

- `PO-004 Materialization admissibility`
  - No write path persists a type or attribute to a store not declared in its card.
  - Discharge condition: repository generation plus integration tests reject undeclared store targets.

- `PO-005 Single authority`
  - Every dual-materialized type has exactly one authority backend.
  - Discharge condition: card compiler rejects missing or duplicate authority declarations.

- `PO-006 Projection safety`
  - Every named or inline projection is a subset of card-declared fields or declared projection aliases.
  - Discharge condition: search compiler rejects undeclared fields and unknown projection names.

- `PO-007 Scope safety`
  - Every project-scoped query can be rewritten through a declared machine-usable project anchor for every requested entity or relation type.
  - Discharge condition: query compilation fails when any requested type lacks a resolvable project anchor with explicit path grammar.

- `PO-008 Read-only TQL safety`
  - Raw LLM TQL execution cannot perform schema mutation or data mutation.
  - Discharge condition: analyzer plus transaction mode enforce rejection of mutating statements and reject execution outside read-only transactions.

- `PO-009 JSON and TOON equivalence`
  - `TOON` and `JSON` results are two renderings of the same validated projection result.
  - Discharge condition: golden tests compare JSON and TOON produced from the same intermediate projected structure.

- `PO-010 Relation mirror non-authority`
  - Owner-embedded relation mirrors in a non-authoritative store cannot be mutated as independent facts.
  - Discharge condition: repository API exposes authoritative relation writes only through the relation path, and owner-entity writes reject direct mutation of derived relation mirrors.

- `PO-011 Build and boot coherence`
  - Service startup must fail if annotated TQL source and generated manifest or types are out of sync.
  - Discharge condition: boot-time hash verification rejects mismatched generated artifacts.

- `PO-012 Schema-evolution discipline`
  - LLM-driven ontology changes cannot skip proposal -> validation -> approval -> apply.
  - Discharge condition: mutation workflow requires an explicit proposal artifact and blocks apply without a validated migration plan plus approval marker.

- `PO-013 Soft-delete semantics`
  - Default delete operations cannot physically erase persistence-bearing objects unless an explicit privileged hard-delete policy exists.
  - Discharge condition: cards declare deletion policy, generated repositories implement delete as deletion-marker writes by default, and tests prove that ordinary delete paths preserve identity while setting declared deletion attributes.

### 13.3 Empirical proof obligations

- `PO-014 Mirror convergence`
  - For dual-materialized types, mirror stores converge to authoritative state under ordinary retry and replay conditions.
  - Discharge condition: failure-injection tests show eventual convergence after dropped writes, duplicated deliveries, and delayed replay.

- `PO-015 Replay idempotence`
  - Replaying outbox events or mirror operations does not create duplicate semantic facts or divergent state.
  - Discharge condition: repeated replay runs preserve fixed-point state in both stores under the algorithm of `9.5.1`, including applied-marker checks and deterministic stable-identity writes.

- `PO-016 Failure recovery`
  - Partial failure after authoritative commit but before mirror completion is recoverable without manual semantic reconstruction.
  - Discharge condition: staged crash and restart tests demonstrate recovery from the persisted outbox or equivalent durable recovery substrate defined in `9.5.1`, without requiring operator-authored semantic repair.

- `PO-017 NL2TQL scope preservation`
  - Natural-language search compilation preserves mandatory entity and project-scope restrictions.
  - Discharge condition: adversarial evaluation set shows that compiled queries do not escape requested entity sets or project anchors.

- `PO-018 Token-bound correctness`
  - Output token estimation is conservative enough to prevent silent overshoot beyond `max_tokens`.
  - Discharge condition: measurement corpus shows bounded overrun within an agreed tolerance, or else the system fails closed before emission.

- `PO-019 Performance admissibility`
  - Boot-time card loading, validation, and query compilation remain operationally acceptable for the expected ontology size.
  - Discharge condition: benchmark envelope is defined and met for the current kernel plus representative project overlays.

### 13.4 What this section does not claim

This section does not claim:

- a full formal proof of correctness for the whole socio-technical system;
- strict atomic cross-store commit under the current backend assumptions;
- perfect NL2TQL compilation.

It claims only that the architecture exposes a finite set of obligations that can be checked, falsified, and discussed without ambiguity.

## 14. Final Determination

The strict answer of this document is:

1. Do not look for a classical ORM for TypeDB as the primary abstraction.
2. Build a TQL-card-first persistence compiler.
3. Keep TQL as the only authoritative type surface.
4. Treat TOON as output only.
5. Use a unique authority backend per type.
6. Use generated typed repositories and validators in TypeScript.
7. Use project-scope anchors declared in cards, not prompt text, to enforce `project_id` filtering.
8. Start in TypeScript to fit the current repo, but design the card-compiler boundary so a Rust core can replace or augment it later.

## References

Official external references used for this spec:

- TypeDB driver overview: `https://typedb.com/docs/core-concepts/drivers/overview/`
- TypeDB driver installation matrix: `https://typedb.com/docs/home/install/drivers/`
- TypeScript HTTP driver reference: `https://typedb.com/docs/reference/typedb-http-drivers/typescript/`
- TypeDB query analysis docs: `https://typedb.com/docs/core-concepts/drivers/analyze/`
- TypeQL `select` operator: `https://typedb.com/docs/typeql-reference/pipelines/select/`
- TypeQL `fetch` stage: `https://typedb.com/docs/typeql-reference/pipelines/fetch/`
- TypeDB driver repository: `https://github.com/typedb/typedb-driver`
- TypeQL repository and grammar note: `https://github.com/typedb/typeql`

Local generic sources used for alignment:

- `ontology/README.md`
- `ontology/AGENTS.md`
- `ontology/typedb/README.md`
- `ontology/typedb/AGENTS.md`
- `ontology/typedb/mappings/mongodb_to_typedb_v1.yaml`
- `ontology/typedb/schema/fragments/00-kernel/10-attributes-and-ids.tql`
- `ontology/typedb/docs/context_boundary_rules_v1.md`
- `ontology/typedb/docs/object_state_history_contract_v1.md`
- `ontology/plan/ontology-and-operations.md`
- `backend/package.json`
