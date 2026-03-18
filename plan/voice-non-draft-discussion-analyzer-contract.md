# Voice Non-Draft Discussion Analyzer Contract

## Status ⚪Open

- Task-surface ticket line: ⚪Open 2  🟡In Progress 0  💤Deferred 0  ⛔Blocked 0  ✅Closed 0
- Plan status: exact contract recorded; implementation not started.
- Canonical contract ticket: `copilot-roqv`
- Related implementation ticket: `copilot-zvxa`

**Статус документа**: contract draft open; implementation pending
**Дата**: 2026-03-18  
**Основание**: updated [voice-dual-stream-ontology.md](/home/strato-space/copilot/plan/voice-dual-stream-ontology.md) and [voice-task-session-discussion-linking-spec.md](/home/strato-space/copilot/plan/voice-task-session-discussion-linking-spec.md).

## Purpose
Определить отдельный output contract для analyzer, который обнаруживает **повторное обсуждение существующих non-draft tasks** в voice session и не создает новые draft rows.

Этот analyzer существует отдельно от `create_tasks`.

## Ontological Scope

### In-scope entity kinds
- `task`
- `voice_session`
- `comment`
- `dialogue_reference`

### Out-of-scope actions
This analyzer must not:
- create new `DRAFT_10` rows
- update non-draft task title/description automatically
- mutate task lifecycle status
- emit product-plane entities

## Primary responsibility
Analyzer answers one question:

> Does the current voice session materially re-discuss one or more existing non-draft tasks, such that the system should link the task to this session and optionally add a clarification comment?

## Canonical Output Shape

Top-level result:
```json
{
  "discussion_actions": []
}
```

Where `discussion_actions[]` is an array of objects with the following schema:

```json
{
  "entity_kind": "task",
  "action_kind": "link_session" | "link_session_and_comment",
  "target_task_id": "string",
  "target_task_status": "string",
  "session_id": "string",
  "project_id": "string",
  "evidence": {
    "dialogue_reference": "string",
    "confidence": "high" | "medium" | "low",
    "why_this_is_the_same_task": "string"
  },
  "comment": {
    "comment": "string",
    "comment_kind": "discussion_note",
    "source_session_id": "string",
    "discussion_session_id": "string",
    "dialogue_reference": "string"
  }
}
```

## Field Semantics

### Required fields
- `entity_kind`
  - must be `task`
- `action_kind`
  - `link_session`
  - or `link_session_and_comment`
- `target_task_id`
  - canonical existing task identifier
- `target_task_status`
  - current stored/runtime status of the matched task
- `session_id`
  - current voice session id
- `project_id`
  - project scope used for the match
- `evidence.dialogue_reference`
  - quote or compressed reference to transcript evidence
- `evidence.confidence`
  - analyzer confidence in the identity match
- `evidence.why_this_is_the_same_task`
  - short explicit explanation of why this is a relink, not a new task

### Conditional fields
- `comment`
  - required only for `action_kind = link_session_and_comment`

### Forbidden fields
This analyzer must not emit:
- `row_id`
- `name`
- `description`
- `priority`
- `dependencies_from_ai`
- any draft-task mutation fields

Reason:
- those belong to `create_tasks` draft-plane contract, not to non-draft discussion linking.

## Allowed Action Semantics

### `link_session`
Use when:
- the current session clearly re-discusses an existing non-draft task,
- but does not add enough materially new detail to justify a comment.

Effect:
- append current session to `discussion_sessions[]` if absent
- do not change task text
- do not create a comment

### `link_session_and_comment`
Use when:
- the session clearly re-discusses an existing non-draft task,
- and introduces material clarification worth keeping on the task.

Effect:
- append current session to `discussion_sessions[]` if absent
- create a task comment with session-aware metadata
- do not change task title/description automatically

## Routing Rules

### Input context required
The analyzer must be able to see:
1. `voice.fetch(session_id, mode="transcript")`
2. `voice.crm_tickets(session_id=session_id, include_archived=false, mode="table")`
3. `voice.crm_tickets(project_id=project_id, include_archived=false, mode="table")`
4. optional current draft baseline if useful for duplicate suppression

### Output routing
- `discussion_actions[]` must be handled by a dedicated backend handler
- not by `persistPossibleTasksForSession(...)`
- not by `create_tasks` draft reconcile

### Backend handler responsibilities
For each action:
- verify target task exists
- verify target task is non-draft
- append current session to `discussion_sessions[]` if absent
- if action includes comment, create comment via canonical comment route/model
- keep operation idempotent

## Matching Rules

### Positive match requirement
A non-draft relink may be emitted only when:
- analyzer can explain **why** it is the same task,
- confidence is at least `medium`,
- and the evidence is specific enough that a duplicate draft task would be worse than reuse.

### Conservative bias
If uncertain:
- do **not** emit non-draft relink
- let `create_tasks` or user review handle the ambiguity later

This contract must bias toward false-negative rather than false-positive linking.

## Idempotency Rules
- repeated runs against the same session/task pair must not create duplicate session links
- repeated comment creation should dedupe by `(target_task_id, session_id, normalized comment text)` if needed in backend

## Examples

### Example 1: pure relink
```json
{
  "discussion_actions": [
    {
      "entity_kind": "task",
      "action_kind": "link_session",
      "target_task_id": "696749eb37df0a922c0a1897",
      "target_task_status": "PROGRESS_10",
      "session_id": "69ba3f8a4c4606700596afc3",
      "project_id": "698af98806b3a6762286b867",
      "evidence": {
        "dialogue_reference": "Снова обсуждали запуск схем на сервере и ComfyUI workflow",
        "confidence": "high",
        "why_this_is_the_same_task": "В разговоре обсуждается тот же deliverable: локальный запуск ComfyUI-схем и server run, уже зафиксированный в существующей задаче."
      }
    }
  ]
}
```

### Example 2: relink + comment
```json
{
  "discussion_actions": [
    {
      "entity_kind": "task",
      "action_kind": "link_session_and_comment",
      "target_task_id": "696749eb37df0a922c0a1897",
      "target_task_status": "PROGRESS_10",
      "session_id": "69ba3f8a4c4606700596afc3",
      "project_id": "698af98806b3a6762286b867",
      "evidence": {
        "dialogue_reference": "Отдельно проговорили, что нужен headless/server run и схема связки запросов для команды",
        "confidence": "high",
        "why_this_is_the_same_task": "Это не новый deliverable, а существенное уточнение уже идущей инфраструктурной задачи."
      },
      "comment": {
        "comment": "Уточнение по обсуждению: требуется headless/server run для схем и рабочая схема интеграции запросов команды.",
        "comment_kind": "discussion_note",
        "source_session_id": "69ba3f8a4c4606700596afc3",
        "discussion_session_id": "69ba3f8a4c4606700596afc3",
        "dialogue_reference": "Отдельно проговорили, что нужен headless/server run и схема связки запросов для команды"
      }
    }
  ]
}
```

## Open Decisions
1. Should the analyzer return only `high` confidence actions, leaving `medium` for manual review?
2. Should backend dedupe discussion comments strictly or allow repeated session notes with timestamps?
3. Should a future UI expose `re-discussed in this session` separately from `created/updated in this session`?

## Conclusion
This contract makes non-draft discussion linking structurally correct by separating it from `create_tasks`.

It is sound only if:
- non-draft relink is not encoded as fake draft creation,
- title/description of non-draft tasks remain stable,
- comments are treated as separate artifacts,
- and relation mutations remain idempotent.
