# Status Domain Inventory (2026-03-08)

This inventory is derived from live MongoDB distinct-value checks against current collections.

## Conclusion
`status` is not one semantic domain across the platform.

Current live split:
- `activity_state`
  - boolean-derived active/inactive semantics
  - applies to: `client`, `legacy_client`, `project`, `project_group`, `cost_category`, `voice_session`
- `status`
  - task workflow status only
  - applies to: `oper_task`
- `event_status`
  - process/event lifecycle states
  - applies to: `history_step`
- `deletion_state`
  - deleted/present semantics
  - applies to: `cost_expense`
- no primary status domain
  - applies to: `person`, `voice_message`, `voice_topic`, `epic_task`
  - these objects are governed by booleans or other lifecycle fields, not a meaningful status alphabet

## Distinct values from MongoDB

### `client` / `legacy_client` / `project` / `project_group`
Source field: `is_active`
- `true`
- `false`

Interpretation:
- not an enum-like business status
- should be modeled as `activity_state`

### `person`
Source field `status`: no real values in live MongoDB
- all observed values are `null`

Interpretation:
- do not treat `person.status` as a real status domain
- use explicit booleans such as `is_active`, `is_banned`, `is_deleted`, `is_employee`

### `oper_task`
Source field: `task_status`
Observed values:
- `Archive`
- `Complete`
- `Backlog`
- `Done`
- `Review / Ready`
- `Ready`
- `Periodic`
- `Progress 10`
- `Plan / Approval`
- `Plan / Performer`
- `null` (legacy sparse rows)

Interpretation:
- this is the only current live workflow-status domain that should remain under `status`

### `voice_session`
Source field `status`: all observed values are `null`
Relevant live booleans:
- `is_active`
- `is_deleted`
- `is_finished`
- `is_waiting`
- `is_messages_processed`
- `is_finalized`

Interpretation:
- do not model voice-session lifecycle as generic `status`
- use `activity_state` plus explicit lifecycle booleans

### `voice_message`
Source field `status`: all observed values are `null`
Relevant live booleans:
- `is_transcribed`
- `is_finalized`
- `is_deleted`

Interpretation:
- no meaningful status alphabet
- rely on explicit lifecycle booleans

### `voice_topic`
Source field `status`: all observed values are `null`

Interpretation:
- do not treat as live status domain

### `epic_task`
Source field `status`: all observed values are `null`

Interpretation:
- no live status alphabet at present

### `history_step`
Source field: `status`
Observed values:
- `done`
- `error`
- `pending`
- `queued`

Interpretation:
- this is event/process status
- should be modeled as `event_status`

### `cost_category`
Source field: `is_active`
Observed values:
- `true`

Interpretation:
- boolean activity domain, not business status

### `cost_expense`
Source field: `is_deleted`
Observed values:
- `false`

Interpretation:
- deletion semantics, not workflow status
- model as `deletion_state`
