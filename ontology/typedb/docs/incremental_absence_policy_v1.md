# Incremental Absence Detection Policy (v1)

Date: 2026-03-08  
Issue: `copilot-9uex.1`

## Purpose

Define how incremental ontology sync should interpret missing source data in MongoDB.

This policy distinguishes:
- explicit tombstones in source (`is_deleted=true`);
- source absence from an incremental query window;
- source absence after a complete full-sync scan;
- sparse / optional fields missing inside an otherwise valid source document;
- relation source absence where the entity still exists but an owner/link no longer resolves;
- collections that are not yet safe for absence-driven delete semantics.

## Core rules

### 1. Source absence is weak evidence
Absence from an incremental query window is not, by itself, proof of deletion.

### 2. Explicit tombstones are strong evidence
If a source doc exists and is tombstoned:
- preserve the ontology entity,
- update deletion/tombstone attributes,
- remove stale operational relations that should no longer stay active.

### 3. Sparse fields are not deletions
Missing fields inside a source doc are informational unless the contract explicitly marks them as required.

### 4. Relation source absence cleans relations, not entities
If an owner/link source field disappears:
- keep the entity,
- remove the stale relation,
- insert the new relation only if a new owner resolves.

### 5. Hard delete by absence needs stronger evidence
Hard delete from source absence should only happen after stronger evidence than one incremental omission:
- full scan,
- explicit deletion log/event,
- or source-of-truth policy that authorizes absence-based delete.

### 6. Full-sync absence and incremental absence are different signals
- incremental absence is weak evidence
- full-sync absence may be strong enough for a collection-specific delete or tombstone action
- the collection policy, not the sync runner alone, decides what to do

## Policy matrix

| Collection / family | Explicit tombstone in source | Incremental-window absence | Full-sync absence | Sparse optional field | Relation source absence | Current policy |
|---|---|---|---|---|---|---|
| `automation_projects` | keep entity, reconcile attrs, detach stale owner relations as needed | ignore by default; absence alone is not delete evidence | **actionable**: tombstone the project in ontology and detach stale owner relations | informational only | remove/rewrite affected relation during reconcile | safe |
| `automation_tasks` | keep entity as tombstone, set `is_deleted`, clean stale operational relations | ignore by default | protect for now; full-sync absence is still not enough for entity deletion without stronger evidence | informational unless field is declared contract-critical | remove/rewrite affected relations (`project`, `task_type`, `performer`, `voice_session_source`) | safe |
| `automation_voice_bot_sessions` | keep entity as tombstone, set `is_deleted`, clean stale project linkage | ignore by default | protect for now; session lifecycle is too operationally nuanced for absence-only delete | informational unless field is contract-critical | remove/rewrite affected relations (`project_has_voice_session`) | safe |
| `automation_voice_bot_messages` | keep entity as tombstone, set `is_deleted`, clean session relation and transcript chunk graph | ignore by default | protect for now; message/chunk graph is too easy to corrupt on absence-only evidence | informational unless field is contract-critical | remove/rewrite message-to-session link and rebuild/remove transcript chunk subgraph | safe |
| Other mapped collections | no generic tombstone behavior assumed | no hard delete from absence | no hard delete from absence until explicitly classified | informational only | no automatic delete behavior | unsupported until explicitly classified |

## Out of scope for v1

- automatic global hard delete from incremental omission
- source-agnostic delete policy shared by all collections
- inference of deletion from missing backlinks alone
