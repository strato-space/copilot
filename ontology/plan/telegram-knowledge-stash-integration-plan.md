# План: интеграция сохраненного Telegram knowledge слоя из stash

**Сформировано**: 2026-03-12  
**Основание**: `stash@{0}` + `stash@{1}` в `copilot/main`  
**Статус**: execution planning

## Кратко

В репозитории сохранены два stash, которые вместе образуют один незавершенный feature slice:

- `stash@{0}` — новый runtime/service слой Telegram knowledge
- `stash@{1}` — tracked-интеграция этого слоя в backend routes и ontology

Это не случайный мусор и не «две мелкие правки». Это один отдельный незавершенный workstream, который был сознательно сохранен при закрытии сессии, чтобы не потерять код.

## Что лежит в stash

### `stash@{0}`

Полностью отсутствующий в текущем `HEAD` runtime слой:
- `backend/src/services/telegramKnowledge.ts`
- `backend/scripts/seed-telegram-knowledge.ts`

Это означает:
- сервисный слой не влит;
- seed/import path не влит;
- даже если часть идеи уже отражена в docs/ontology, сам production runtime feature отсутствует.

### `stash@{1}`

Tracked-интеграционный слой:
- `backend/package.json`
- `backend/src/api/routes/voicebot/permissions.ts`
- `backend/src/api/routes/voicebot/persons.ts`
- `backend/src/api/routes/voicebot/sessions.ts`
- `backend/src/constants.ts`
- `ontology/typedb/mappings/mongodb_to_typedb_v1.yaml`
- `ontology/typedb/queries/validation_v1.tql`
- `ontology/typedb/schema/fragments/00-kernel/10-attributes-and-ids.tql`
- `ontology/typedb/schema/fragments/10-as-is/10-entities-core.tql`
- `ontology/typedb/schema/fragments/10-as-is/40-relations.tql`
- `ontology/typedb/schema/str-ontology.tql`
- `ontology/typedb/scripts/typedb-ontology-ingest.py`

По сравнению с текущим `HEAD` это уже не полностью новый слой, а **частично пересеченный** слой:
- часть смыслов уже была переосмыслена и встроена в текущую ontology/voice модель;
- но сами Telegram knowledge изменения системно не доведены.

## Findings

### 1. Это один feature slice, а не две случайные пачки

Он делится на:
- untracked service/seed (`stash@{0}`)
- tracked backend/ontology integration (`stash@{1}`)

### 2. `stash@{1}` нельзя просто механически применить

Причина:
- он писался на более старом состоянии voice/ontology layer;
- сейчас уже произошли:
  - ontology migrations,
  - person/performer split,
  - voice-task status fixes,
  - session/taskflow contract changes.

Следствие:
- нужен reconcile against current `main`, а не `git stash pop`.

### 3. Главные незавершенные workstreams

1. **Telegram knowledge domain model**
- `telegram_chat`
- `telegram_user`
- `project_performer_link`
- memberships / linkage semantics
- seed/import path

2. **Voice route enrichment**
- `/voicebot/projects`
- `/voicebot/persons/list_performers`
- session/person/permissions enrichment
- `project_performers`

3. **Ontology / TypeDB parity**
- schema additions
- mapping additions
- validation updates
- ingest updates

4. **Testing and contract hardening**
- service tests
- route tests
- ontology validation tests
- sparse/mock compatibility

## Main Risks

### Risk A: semantic drift from old stash base
- stash changes were written against an older codebase state;
- some contracts are already different now.

### Risk B: `person` vs `performer_profile`
- current ontology already split these two;
- project/telegram links must attach to the correct semantic object.

### Risk C: service-layer leakage
- earlier review already showed route-utils leaking into service logic;
- this must not be repeated when integrating the stash.

### Risk D: test blindness
- current review already found that the Telegram knowledge slice lacks focused tests;
- naive integration will likely pass build but fail in sparse mocks or partial envs.

### Risk E: ontology mismatch
- stash carries schema/mapping intent from an older ontology state;
- must be reconciled with current post-migration TQL source.

## Execution Strategy

### Rule 1
Do **not** restore stash into working tree and continue editing from there.

### Rule 2
Treat stash as:
- reference source,
- donor of hunks,
- not canonical branch state.

### Rule 3
Land work in this order:
1. semantics reconciliation
2. service/seed layer
3. route integration
4. ontology parity
5. tests
6. rollout plan

## Work Breakdown

### T1 Rebase stash semantics against current voice and ontology contracts
Goal:
- identify which stash hunks are still valid,
- which are obsolete,
- which are already landed elsewhere,
- and which need adaptation.

Acceptance:
- reconciliation note exists for both stashes;
- every file from stash is classified into:
  - `obsolete`
  - `already landed`
  - `still needed with adaptation`
  - `still needed as-is`

### T2 Land `telegramKnowledge` service and seed pipeline
Goal:
- integrate:
  - `backend/src/services/telegramKnowledge.ts`
  - `backend/scripts/seed-telegram-knowledge.ts`
- plus required constants/indexes/packages.

Acceptance:
- service compiles;
- seed has dry-run/apply modes;
- service does not depend on route-layer helpers.

### T3 Integrate Telegram knowledge into Voice routes
Goal:
- enrich:
  - `/voicebot/projects`
  - `/voicebot/persons/list_performers`
  - session/person/permissions payloads
  - `project_performers`

Acceptance:
- routes return enriched payloads without breaking current access filters;
- sparse envs/tests do not crash when Telegram collections are absent or minimally stubbed.

### T4 Reconcile ontology schema + mapping + validation for telegram knowledge
Goal:
- integrate `telegram_chat`, `telegram_user`, `project_performer_link` into current TQL-first ontology.

Acceptance:
- current ontology source remains annotated TQL;
- mapping and validation reflect current `person` / `performer_profile` split;
- no stale schema assumptions from old stash survive unreviewed.

### T5 Add focused regression coverage
Goal:
- service tests
- route tests
- ontology validation tests
- sparse/mock compatibility coverage

Acceptance:
- no route 500s in tests due to missing `.find()` or incomplete collection stubs;
- Telegram knowledge slice has direct test ownership.

### T6 Prepare prod-safe seed / rollout / rollback plan
Goal:
- define:
  - dry-run seed path
  - apply path
  - smoke checks
  - rollback notes

Acceptance:
- rollout can be executed intentionally, not experimentally.

## DAG

- `copilot-5gdl.1 -> copilot-5gdl.2`
- `copilot-5gdl.1 -> copilot-5gdl.3`
- `copilot-5gdl.1 -> copilot-5gdl.4`
- `copilot-5gdl.2 -> copilot-5gdl.3`
- `copilot-5gdl.2 -> copilot-5gdl.6`
- `copilot-5gdl.4 -> copilot-5gdl.6`
- `copilot-5gdl.3 -> copilot-5gdl.5`
- `copilot-5gdl.4 -> copilot-5gdl.5`
- `copilot-5gdl.5 -> copilot-5gdl.6`

## Test Plan

### Static review
- compare stash hunks against current `HEAD`
- classify each hunk by relevance

### Service level
- direct tests for `telegramKnowledge`
- dedupe behavior for `project_performer_links`
- correct handling of sparse collections

### Route level
- `/voicebot/projects`
- `/voicebot/persons/list_performers`
- `/voicebot/project_performers`
- no 500s under current mocks

### Ontology level
- mapping / validation for:
  - `telegram_chat`
  - `telegram_user`
  - `project_performer_link`
- verify compatibility with current TQL source and current person/performer split

### Rollout level
- `seed` dry-run
- targeted apply
- smoke in prod

## Assumptions

- `stash@{0}` remains the only preserved copy of the runtime service/seed layer and therefore must not be dropped casually.
- `stash@{1}` contains meaningful integration work, but must be selectively re-applied, not mechanically restored.
- The Telegram knowledge slice should be integrated as a separate wave, not folded into unrelated Voice or ontology fixes.

## BD Tracking
- 🟡 `copilot-5gdl` — [voice][telegram] Integrate preserved telegram-knowledge stash wave
- ⚪ `copilot-5gdl.1` — T1 Rebase telegram-knowledge stash semantics against current voice and ontology contracts
- ⚪ `copilot-5gdl.2` — T2 Land telegramKnowledge service and seed pipeline
- ⚪ `copilot-5gdl.3` — T3 Integrate Telegram knowledge enrichment into Voice routes
- ⚪ `copilot-5gdl.4` — T4 Reconcile ontology schema, mapping, and validation for telegram knowledge
- ⚪ `copilot-5gdl.5` — T5 Add focused regression coverage for telegram knowledge slice
- ⚪ `copilot-5gdl.6` — T6 Prepare prod-safe seed, rollout, and rollback plan
