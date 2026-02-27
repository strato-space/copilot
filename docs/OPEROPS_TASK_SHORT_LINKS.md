# OperOps Task Short-Link Contract

This document is the canonical contract for task public IDs ("short links") in OperOps.

It covers:
- how IDs are generated,
- how collisions are resolved,
- how task cards are opened deterministically,
- what operators should check during incidents.

## Terms

- `task _id`: MongoDB `ObjectId` (database primary key).
- `task id`: public short ID used in UI and external references (for example `task-1`).
- "short link": route `/operops/task/:taskId`, where `:taskId` may be `_id` or public `id`.

## Generation Contract

Short-link generation is centralized in:
- `backend/src/services/taskPublicId.ts` (`ensureUniqueTaskPublicId`).

### Input normalization

- `preferredId` is accepted when non-empty after trim.
- `/` is replaced with `-` to keep URL-safe public IDs.
- If no valid `preferredId` is provided, a UUID is used.

### Uniqueness rules

`ensureUniqueTaskPublicId` checks collisions against:
- existing records in `automation_tasks` by `id`,
- in-request `reservedIds` (prevents duplicates inside one bulk create request).

### Collision fallback

If base ID is already taken:
- try `<base>-2`, `<base>-3`, ... `<base>-9999`,
- if still unavailable, fallback to `<base>-<8-char-uuid-suffix>`.

### Mandatory call sites

All task creation paths that may set public ID must use `ensureUniqueTaskPublicId`:
- `POST /api/crm/tickets/create` (`backend/src/api/routes/crm/tickets.ts`)
- `POST /api/voicebot/create_tickets` (`backend/src/api/routes/voicebot/sessions.ts`)

## Resolution And Validation Contract

### UI route creation

Kanban must open task cards by database `_id` first:
- `/operops/task/${record._id || record.id}`

This avoids ambiguous routing when legacy duplicate public IDs exist.

### API lookup order

`POST /api/crm/tickets/get-by-id` resolves IDs deterministically:
1. If `ticket_id` looks like a 24-char ObjectId, query by `_id` first.
2. If not found, query by public `id`.
3. If multiple rows still match by `id`, return the latest deterministic row (sorted by `updated_at`, `created_at`, `_id`) and log warning:
   - `[crm.tickets.get-by-id] duplicate public ids detected; returning deterministic latest match`

## Operator Runbook

### Symptom: card opens wrong task for known short ID

Checks:
1. Open browser link and confirm URL uses `_id` (24-char hex) where possible.
2. Check backend logs for duplicate warning above.
3. Verify duplicates in MongoDB:

```javascript
db.automation_tasks.aggregate([
  { $match: { id: "<public-id>", is_deleted: { $ne: true } } },
  { $sort: { updated_at: -1, created_at: -1, _id: -1 } },
  { $project: { _id: 1, id: 1, name: 1, updated_at: 1, created_at: 1 } },
]);
```

Expected behavior with current contract:
- list/card navigation should remain stable because `_id` is preferred,
- API fallback returns deterministic latest row even if duplicates exist.

## Developer Checklist For New Entry Points

When adding any new task creation/integration path:
1. Always call `ensureUniqueTaskPublicId`.
2. Pass request-level `reservedIds` for batch inserts.
3. Keep UI links `_id`-first (`_id || id`).
4. Avoid `_id` + `id` mixed non-deterministic query patterns.
5. Keep contract tests green.

## Existing Regression Coverage

- `backend/__tests__/services/taskPublicId.test.ts`
- `app/__tests__/operops/taskShortLinkRouteContract.test.ts`
