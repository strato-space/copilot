# Voice Task Surface Normalization Spec 2

## Status ⚪Open

- Spec/control ticket line (`copilot-jn28`, `copilot-br3m`): ⚪Open 1  🟡In Progress 0  💤Deferred 0  ⛔Blocked 0  ✅Closed 1
- Related runtime follow-up ticket line (`copilot-3d7n`, `copilot-muzv`): ⚪Open 2  🟡In Progress 0  💤Deferred 0  ⛔Blocked 0  ✅Closed 0
- Plan status: follow-up contract recorded; runtime simplification landed, Mongo parity folded in, legacy payload migration wave applied, and the status block is normalized to current `bd` state; ambiguous residual tail still needs cleanup.
- Canonical follow-up spec ticket: `copilot-jn28`
- Related runtime tickets: `copilot-3d7n`, `copilot-muzv`
- Status-normalization docs ticket: `copilot-br3m` (closed).
- Landed-but-unclosed slices: `copilot-3d7n` and `copilot-muzv` already contain implementation evidence in `bd` comments, but formal closure and residual cleanup are still pending.
- Mongo re-check (2026-03-21): live draft rows store label `Draft`, accepted voice rows store `Ready` / `Progress 10` / `Review / Ready`; route semantics normalize these stored values back to lifecycle keys.

**Статус документа**: follow-up contract open; runtime simplification landed; status block normalized
**Дата**: 2026-03-21
**Основание**: текущие `bd` states for `copilot-jn28`, `copilot-3d7n`, `copilot-muzv`, `copilot-br3m`; текущие comments уже фиксируют landed draft-reconcile/backlog-cleanup work в `copilot-3d7n` и `copilot-muzv`, но все follow-up tickets остаются open; live Mongo recheck against `automation_tasks` / `automation_voice_bot_sessions` done on 2026-03-21.

**Conceptual source**: [voice-dual-stream-ontology.md](/home/strato-space/copilot/ontology/plan/voice-dual-stream-ontology.md)

## Purpose
Этот документ фиксирует **task-plane only** contract для voice-driven draft task baseline.

Он не описывает:
- product entities (`business_need`, `requirement`, `goal_product`),
- comment semantics,
- non-draft discussion-linking logic,
- general runtime ontology outside task-plane.

Он описывает только:
- как `DRAFT_10` task rows читаются,
- как пересчитываются,
- как связываются с session/project,
- и какие task-plane actions допустимы.

## Ontological Scope

### In-scope entity kinds
- `task`
- `voice_session`

Explicit normalization:
- current AS-IS storage family is `task` in ontology and `automation_tasks` in Mongo; this document uses the same word `task` for both semantic and AS-IS storage layers
- there is no separate `TaskDraft` entity kind,
- historical wording `TaskDraft` means `task` with `task_status = DRAFT_10`.

### Out-of-scope entity kinds
- `business_need`
- `goal_product`
- `requirement`
- `issue`
- `risk`
- `constraint`
- `decision`
- `assumption`
- `open_question`

Они могут присутствовать в transcript и project context, но этот документ не делает их частью task-plane storage contract.

## Canonical Task-Plane Relations

### Verified Mongo Reality (2026-03-21)

- raw task-plane storage remains one collection: `automation_tasks`;
- raw Mongo stores compatibility labels (`Draft`, `Ready`, `Progress 10`, `Review / Ready`, `Done`, `Archive`), while API/spec semantics continue to speak in lifecycle keys (`DRAFT_10`, `READY_10`, ...);
- live draft rows currently include `1611` docs with `source_kind=voice_possible_task` plus `5` draft docs without `source_kind`, so `source_kind` cannot be the semantic gate;
- live draft docs have `0` rows with `source_data.refresh_state="stale"`;
- accepted `source_kind=voice_session` rows total `33`, with `5` legacy payload residues still carrying `source_data.refresh_state="stale"` (`Ready=3`, `Review / Ready=2`);
- session linkage is universally recoverable from `source_ref` / `external_ref` / `source_data.voice_sessions[]`, but direct `discussion_sessions[]` is still partial in raw Mongo;
- `discussion_count` is a read-surface derived field; raw Mongo docs do not currently persist a standalone `discussion_count`.
- raw BSON types remain mixed across draft vs accepted rows (`project_id` / `performer_id` especially), so read surfaces still need type normalization at the boundary.
- after the 2026-03-21 migration wave `0` active `automation_voice_bot_sessions` still retain non-empty `processors_data.CREATE_TASKS.data`; residual payload remains only on `78` non-active / historical sessions and is no longer part of normal runtime draft semantics.

### Primary relation
- `task -> discussed_in -> voice_session`

### Storage-side realization today
На task docs это выражается через:
- normalized read field `discussion_sessions[]`
- normalized read field `discussion_count` (derived, not raw-stored)
- compatibility carrier in `source_data.voice_sessions[]`

Important current-storage note:
- current draft write path writes `discussion_sessions[]` directly for newly refreshed draft rows;
- historical draft rows and current accepted voice rows are still linked session-wise primarily through `source_data.voice_sessions[]`;
- therefore `discussion_sessions[]` is a canonical read/output field, but not yet a universal raw-storage invariant.

### AS IS vs TO BE session linkage

AS IS:
- one primary session carrier still typically sits in `source_ref` / `external_ref`;
- multi-session compatibility is carried in `source_data.voice_sessions[]`;
- top-level `discussion_sessions[]` is partial raw storage and `discussion_count` is read-derived.

TO BE:
- one `task` may be linked to many `voice_session` rows as a first-class relation/output shape;
- `discussion_sessions[]` should become canonical normalized task/session linkage for reads and writes;
- transcript/message/chunk evidence should remain a separate trace layer, not be collapsed into the task entity itself.

Migration implication:
- historical `processors_data.CREATE_TASKS.data` must be lifted into canonical `DRAFT_10` task docs;
- after the 2026-03-21 migration wave, session payload `.data` is legacy history only and must not participate in runtime semantics.

### Context relations
- `task -> belongs_to -> project`
- `task -> has_status -> DRAFT_10`
- `task -> evidenced_by -> transcript_segment | voice_message` (through `dialogue_reference` today, stronger evidence model later)

## Canonical Entity Shape: Draft Task

A session draft row is a `task` with these canonical task-plane properties:
- `row_id`
- `id`
- `name`
- `description`
- `priority`
- `priority_reason`
- `performer_id`
- `project_id`
- `task_type_id`
- `dialogue_tag`
- `task_id_from_ai`
- `dependencies_from_ai[]`
- `dialogue_reference`
- `task_status = DRAFT_10`
- `discussion_sessions[]` (normalized read field; raw Mongo may still fall back to `source_data.voice_sessions[]`)
- `discussion_count` (derived, not raw-stored)

Compatibility/provenance fields may remain:
- `source_ref`
- `external_ref`
- `source_data`
- `source_kind`
- `accepted_from_possible_task`
- `accepted_from_row_id`

But they are not the semantic discriminator of draftness.

Concurrency metadata (write-contract level) must be present for machine-actionable collision handling:
- `row_version` (monotonic per-row CAS token)
- `last_user_edit_version` (monotonic per-row user-write marker)
- `last_recompute_version` (last applied recompute marker for this row/session)
- `user_owned_overrides[]` (set of user-owned fields currently locked to user intent)
- `field_versions{}` (monotonic per-field versions for user-owned fields; used for machine-readable conflict reporting)

## Canonical Draft Criterion
Canonical lifecycle key: `DRAFT_10`.
Compatibility label during transition: `Draft`.

A row belongs to the session Draft baseline iff:
1. it is a `task`,
2. it is linked to the current `voice_session`,
3. normalized lifecycle key resolves to `DRAFT_10` (current Mongo stored value is typically `Draft`),
4. it is not deleted.

`source_kind=voice_possible_task` is no longer required as the primary semantic gate.
Current read paths may resolve linkage from `discussion_sessions[]`, `source_data.voice_sessions[]`, `source_ref`, or `external_ref`; the semantic criterion is session linkage itself, not one exact legacy field.

## Canonical Read Contract

### `voice.session_tasks(session_id, bucket="Draft")`
This route/tool is the canonical read surface for the current session draft baseline.

Behavior:
- reads session-linked `DRAFT_10` rows,
- dedupes by `row_id`,
- prefers active/current row if duplicate lineage exists,
- returns normalized draft rows,
- includes normalized `discussion_sessions[]` and derived `discussion_count`.

### `voice.session_tasks(session_id, bucket="Ready+")`
This route/tool is the canonical accepted-only session task surface.

Behavior:
- reads only non-draft accepted lifecycle rows linked to the session,
- may return only accepted lifecycle keys such as `READY_10`, `PROGRESS_10`, `REVIEW_10`, `DONE_10`, `ARCHIVE`,
- must not return `DRAFT_10`,
- returns `[]` when the session has no accepted linked tasks,
- `DRAFT_10` rows appearing in `bucket="Ready+"` are a contract violation / bug (`copilot-f6z4`), not accepted compatibility behavior.

### `voice.session_task_counts(session_id)`
Task counts must be computed from the same task-plane view:
- Draft counts from canonical session-linked `DRAFT_10` rows,
- accepted counts from non-draft task-plane,
- no semantic dependence on `source_kind`.

## Canonical Write Contract

### `create_tasks`
`create_tasks` is a draft-plane analyzer only.

Its semantic job:
- inspect transcript + current draft baseline + session/project task context,
- produce the full desired set of session-linked `DRAFT_10` task rows.

It must not:
- create non-draft mutations,
- relink existing non-draft tasks,
- create comments,
- emit product-plane entities.

### `persistPossibleTasksForSession(...)`
This is the canonical draft reconcile.

Behavior:
1. upsert desired `DRAFT_10` rows by `row_id/id`,
2. preserve session linkage and immutable row identity,
3. merge/refresh session linkage so normalized reads expose `discussion_sessions[]`,
4. apply field ownership merge policy (below) before writing user-editable fields,
5. reconcile absent rows under the omission policy below; user-owned rows are not silently dropped,
6. keep lifecycle status orthogonal to discussion linkage.

### Draft Collision Resolution: User Edits vs `CREATE_TASKS` Recompute

This section is normative for collisions between:
- explicit user writes (UI/API draft edits),
- backend desired-set recompute writes (`create_tasks` -> `persistPossibleTasksForSession`).

#### Ownership classes

System-owned fields (recompute is authoritative):
- `row_id`
- `id`
- `task_status`
- `discussion_sessions[]`
- `source_ref`
- `external_ref`
- `source_data`
- `source_kind`
- `accepted_from_possible_task`
- `accepted_from_row_id`
- `task_id_from_ai`
- `dialogue_reference`

User-owned fields (user intent is authoritative):
- `name`
- `description`
- `priority`
- `priority_reason`
- `performer_id`
- `project_id`
- `task_type_id`
- `dialogue_tag`
- `dependencies_from_ai[]`

Derived/read-only projection fields:
- `discussion_count`

`discussion_count` is computed from normalized linkage and is not an authoritative mutable storage field.

Classification rule for future fields:
- if a field is user-editable in draft UI/API, it defaults to user-owned unless this spec (or its direct successor) explicitly lists it as system-owned.

#### Merge policy (machine-actionable)

For every recompute attempt on an existing draft row:
1. load current row by `row_id/id` together with `row_version` and `user_owned_overrides[]`;
2. for each system-owned field present in desired recompute payload, write desired value;
3. for each user-owned field:
- if field is in `user_owned_overrides[]`, keep current stored value (user-wins);
- if field is not in `user_owned_overrides[]` and field is present in desired recompute payload, write desired recompute value;
- if field is not present in desired recompute payload, preserve current stored value;
4. if desired recompute payload omits the entire row:
- backend MUST NOT hard-delete, archive, or unlink the row when `user_owned_overrides[]` is non-empty;
- backend MUST NOT hard-delete, archive, or unlink the row when `last_user_edit_version > last_recompute_version`;
- such a row remains in the live draft baseline until an explicit user delete/archive action or a later recompute re-includes and reconciles it;
- every retain-on-omission pass still counts as a recompute pass for convergence purposes: backend MUST advance `last_recompute_version` on the retained row, and MAY mark an operational flag such as `recompute_omitted=true`;
- backend MAY remove/archive an omitted row only when `user_owned_overrides[]` is empty and `last_user_edit_version <= last_recompute_version`;
5. increment `row_version` and set `last_recompute_version` on successful write.

For explicit user draft edits:
1. request MUST include `expected_row_version`;
2. request MUST include `expected_field_versions{}` for every user-owned field present in the patch;
3. write only user-owned fields from the user patch;
4. add patched keys to `user_owned_overrides[]`, unless the same request explicitly lists them in `clear_user_owned_overrides[]`;
5. increment `field_versions[field]` for every patched user-owned field;
6. increment `row_version` and `last_user_edit_version`.

Override-release semantics:
- recompute MUST NEVER remove keys from `user_owned_overrides[]`;
- only an explicit user write may release an override lock;
- release is machine-actionable via `clear_user_owned_overrides[]`, and only for fields also present in the same explicit user write request.

#### Stale-write behavior

User writes:
- if `expected_row_version` does not match current `row_version`, backend MUST reject with `409 stale_write`;
- backend MUST compare user-supplied `expected_field_versions{}` against current stored `field_versions{}` for patched user-owned fields;
- `conflicting_fields[]` MUST contain exactly those patched fields whose stored `field_versions[field]` no longer match the user-supplied expectation;
- if `row_version` changed but none of the patched user-owned fields changed, backend MUST return `conflicting_fields=[]` together with the latest row snapshot.

Recompute writes:
- recompute MUST use CAS on `row_version`;
- on CAS miss, recompute MUST re-read latest row, re-run merge policy, and retry;
- recompute MUST NOT clear or overwrite values for fields present in `user_owned_overrides[]`;
- recompute MUST NOT remove a row from the live draft baseline when omission collides with retained user ownership, as defined above.

Linkage preservation note:
- “preserve session linkage” means preserving `discussion_sessions[]` / normalized session attachment and immutable row identity;
- it does not make `project_id` system-owned;
- `project_id` remains user-owned and may change only through explicit user write paths that pass normal validation.

## Allowed Task-Plane Actions
Within this spec, only these action kinds are valid:
- `create`
- `update`
- `link_session`
- `archive`

Semantics:
- `create`: new `DRAFT_10` task row
- `update`: reformulate an existing `DRAFT_10` task row in place; may be authored by recompute or by explicit user edit, with precedence defined by Draft Collision Resolution
- `link_session`: attach current session to an existing `DRAFT_10` row reused from another session
- `archive`: remove a row from the current live draft baseline

`add_comment` is out of scope for this document.

## Current Verified Runtime Facts
1. `create_tasks` reads:
- transcript via `voice.fetch(..., mode="transcript")`
- current draft baseline via `voice.session_tasks(..., bucket="Draft")`
- session-scoped tasks via `voice.crm_tickets(session_id=...)`
- project-scoped tasks via `voice.project(...)` and `voice.crm_tickets(project_id=...)`

2. Draft baseline no longer uses operational `stale` semantics.

3. Runtime deploy path restarts voicebot workers together with backend, so stale in-memory draft logic no longer persists across deploys.

4. Discussion linkage on draft rows is already available in runtime payloads even when raw Mongo still stores it only in `source_data.voice_sessions[]`.

5. Accepted session-linked task reads are still normalized from `source_ref` / `external_ref` / `source_data.voice_sessions[]`; direct `discussion_sessions[]` is not yet a universal accepted-row storage invariant.

6. Historical `processors_data.CREATE_TASKS.data` remains only on `78` non-active / historical residual sessions in Mongo; current draft semantics continue to read from canonical task docs rather than from session payload snapshots, and no active sessions rely on that payload anymore.

## Migration Outcome Already Landed
Already implemented/runtime-smoked:
- operational `source_data.refresh_state = stale` removed from active semantics;
- current live baseline = one visible `DRAFT_10` set per session;
- current draft write path adds `discussion_sessions[]`, while read paths derive `discussion_count` and fall back to `source_data.voice_sessions[]` for historical rows;
- `source_kind=voice_possible_task` reduced to metadata role.
- payload-to-draft migration wave has already removed `.data` from active runtime semantics; remaining payload residue exists only on `78` non-active / historical sessions.

## Open Decisions (Task-plane only)
1. After a row has already been validly removed/archived by the normative omission policy above, should long-tail storage policy remain soft-delete only or allow harder physical cleanup later?
2. Should project context for draft recompute continue to include draft rows from other sessions, or be narrowed later?
3. When exact `row_id` reuse is absent, what conservative identity rule should govern cross-session draft reuse?

## Conclusion
This spec is the **task-plane contract** for session-linked `DRAFT_10` rows.

It is sound only if:
- draftness is defined by lifecycle status plus session linkage,
- discussion linkage remains orthogonal to lifecycle,
- `create_tasks` remains draft-only,
- product-plane and non-draft discussion semantics stay outside this contract.
