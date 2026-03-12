# План: интеграция сохраненного Telegram knowledge слоя из stash

**Сформировано**: 2026-03-12  
**Основание**: `stash@{0}` + `stash@{1}` в `copilot/main`  
**Статус**: implemented

## Кратко

В репозитории сохранены два stash, которые исторически образовывали один feature slice:

- `stash@{0}` — новый runtime/service слой Telegram knowledge
- `stash@{1}` — tracked-интеграция этого слоя в backend routes и ontology

Сейчас это уже не “код, который надо восстановить”, а historical donor для hardening: большая часть feature уже landed в `main`, а оставшаяся работа — это dedupe, слойная чистота, focused tests и rollout discipline.

## Что лежит в stash

### `stash@{0}`

Этот runtime/service слой уже влит в текущий `main`:
- `backend/src/services/telegramKnowledge.ts`
- `backend/scripts/seed-telegram-knowledge.ts`

Текущая задача уже не в восстановлении этих файлов, а в их hardening и покрытии тестами.

### `stash@{1}`

Tracked-интеграционный слой исторически содержал:
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
- но в текущем `main` большая часть этих изменений уже landed; remaining work — hardening, dedupe, tests, and rollout discipline.

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
Land the remaining work in this order:
1. dedupe + utility extraction
2. focused tests
3. rollout plan

## Work Breakdown

### T5 Add focused regression coverage
Goal:
- service tests
- route tests
- ontology validation tests
- sparse/mock compatibility coverage

Acceptance:
- no route 500s in tests due to missing `.find()` or incomplete collection stubs;
- Telegram knowledge slice has direct test ownership.

### T7 Deduplicate `project_performer_links` and extract neutral Telegram ID utils
Goal:
- deduplicate `project_performer_links` in person enrichment
- move ID helpers out of route-layer into neutral utility/service layer

Acceptance:
- no duplicate `project_performer_links` when both `person_id` and `performer_id` point to the same row
- `telegramKnowledge.ts` no longer imports ID helpers from route-layer files

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

- `copilot-5gdl.7 -> copilot-5gdl.5`
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

- `stash` is no longer the canonical source of missing code; it is now only an audit/donor artifact.
- Most of the Telegram knowledge slice is already landed in `main`; remaining work is hardening.
- The Telegram knowledge slice should be integrated as a separate wave, not folded into unrelated Voice or ontology fixes.

## BD Tracking
- ✅ `copilot-5gdl` — [voice][telegram] Integrate preserved telegram-knowledge stash wave
- ✅ `copilot-5gdl.1` — T1 Rebase telegram-knowledge stash semantics against current voice and ontology contracts
- ✅ `copilot-5gdl.2` — T2 Land telegramKnowledge service and seed pipeline
- ✅ `copilot-5gdl.3` — T3 Integrate Telegram knowledge enrichment into Voice routes
- ✅ `copilot-5gdl.4` — T4 Reconcile ontology schema, mapping, and validation for telegram knowledge
- ✅ `copilot-5gdl.5` — T5 Add focused regression coverage for telegram knowledge slice
- ✅ `copilot-5gdl.6` — T6 Prepare prod-safe seed, rollout, and rollback plan
- ✅ `copilot-5gdl.7` — T7 Deduplicate project_performer_links and extract neutral Telegram ID utils
