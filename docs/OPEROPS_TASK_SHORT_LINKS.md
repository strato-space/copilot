# OperOps Task Short-Link Contract

Canonical contract for OperOps task public IDs (`automation_tasks.id`) and task short-link resolution.

## Terms

- `task _id`: MongoDB `ObjectId` (primary key).
- `task id`: public short ID (example: `start-figma-02-28`).
- Short link route: `/operops/task/:taskId` where `:taskId` can be `_id` or public `id`.
- `id` is the user-facing short identifier; `_id` is the immutable DB primary key. 
  Use `_id` to guarantee exact row targeting, use `id` for human-readable links when unique.

## Source Of Truth

- Generation: `backend/src/services/taskPublicId.ts` -> `ensureUniqueTaskPublicId(...)`.
- API lookup: `POST /api/crm/tickets/get-by-id` in `backend/src/api/routes/crm/tickets.ts`.
- Kanban route selection: `resolveTicketRouteId(...)` in `app/src/components/crm/CRMKanban.tsx`.

## Generation Algorithm

Public ID format is Telegram-like: `<slug>-<MM-DD>`.

### Environment variables

- `TASK_PUBLIC_ID_DEFAULT_PREFIX` — fallback slug when both preferred/generic values are absent (default: `task`)
- `TASK_PUBLIC_ID_SLUG_MAX_LENGTH` — max length before `-MM-DD` suffix is appended (default: `120`)
- `TASK_PUBLIC_ID_NUMERIC_COLLISION_LIMIT` — collision attempts before UUID fallback (default: `9999`)
- `TASK_PUBLIC_ID_RANDOM_SUFFIX_LENGTH` — fallback UUID tail length for hard collision cases (default: `8`, max `16`)

Algorithm in `ensureUniqueTaskPublicId`:

1. Normalize raw text fields:
   - `preferredId` and `fallbackText` are trimmed.
   - empty or non-string inputs become `null`.
2. Slugify candidate text (`slugifyTaskPublicId`):
   - lowercase;
   - replace `/` and `_` with `-`;
   - `NFKD` normalize and strip combining marks;
   - transliterate Cyrillic (`Пинг` -> `ping`);
   - keep `[a-z0-9]`, map all other chars to `-`;
   - collapse repeated `-`, trim edge `-`, cut to max 120 chars.
3. Choose base slug:
   - use `preferredId` slug by default;
   - if preferred slug is empty or generic (`/^t\d+$/i`, `/^task-\d+$/i`, `/^task$/i`), use `fallbackText` slug when available;
   - if still empty, use `task`.
4. Append date suffix:
   - suffix is `MM-DD` from `now` (local `Date`);
   - if slug already ends with `-MM-DD`, do not append again.

Example (`2026-02-28`):

- `preferredId: "OPS-1"` -> `ops-1-02-28`
- `preferredId: "T1", fallbackText: "Пинг"` -> `ping-02-28`
- empty inputs -> `task-02-28`

## Uniqueness Strategy

`ensureUniqueTaskPublicId` prevents collisions in two scopes:

1. Request-local scope via `reservedIds: Set<string>` (batch-safe in-memory dedupe).
2. Database scope via `findOne({ id: candidate })` in `automation_tasks`.

Important: this is a best-effort runtime strategy, not a hard global guarantee. There is no unique Mongo index on `automation_tasks.id`, so highly concurrent writers can still create duplicates.

## Collision Handling

If base ID is taken:

1. Try numeric suffixes: `<base>-2` ... `<base>-9999`.
2. If all are taken, use UUID tail fallback: `<base>-<8 lowercase hex chars>` from `randomUUID().slice(0, 8)`.

Every returned ID is added to `reservedIds` (if provided) before returning.

## Mandatory Generation Call Sites

Creation paths that must use `ensureUniqueTaskPublicId`:

- `POST /api/crm/tickets/create` (`backend/src/api/routes/crm/tickets.ts`)
- `POST /api/voicebot/create_tickets` (`backend/src/api/routes/voicebot/sessions.ts`) with request-level `reservedIds`
- Telegram `@task` ingress (`backend/src/voicebot_tgbot/ingressHandlers.ts`)
- Voice Codex trigger (`backend/src/workers/voicebot/handlers/transcribe.ts`)

## Lookup And Routing Order

### UI Route Resolution (`CRMKanban`)

`resolveTicketRouteId(record)` logic:

1. Use `_id` if present.
2. Else use public `id` only if non-empty and not duplicated in the currently loaded tickets list.
3. Else return empty route id and disable open-link action.

This intentionally avoids opening ambiguous rows when duplicate public IDs exist.

### API Resolution (`/api/crm/tickets/get-by-id`)

Lookup order:

1. If `ticket_id` is strict 24-hex ObjectId format, query by `_id` first.
2. If no match, query by public `id`.
3. Aggregation sort order is deterministic: `updated_at DESC`, `created_at DESC`, `_id DESC`.
4. If multiple rows match public `id`, API returns the first (latest by sort) and logs:
   - `[crm.tickets.get-by-id] duplicate public ids detected; returning deterministic latest match`

## Diagnostics Runbook

### Symptom: link by public ID opens unexpected task

1. Confirm route payload:
   - If URL has 24-hex id, lookup is by `_id` and should be unambiguous.
   - If URL has short ID, check duplicates for that `id`.
2. Check backend logs for duplicate warning:
   - `duplicate public ids detected; returning deterministic latest match`
3. Inspect duplicates:

```javascript
db.automation_tasks.aggregate([
  { $match: { id: "<public-id>", is_deleted: { $ne: true } } },
  { $sort: { updated_at: -1, created_at: -1, _id: -1 } },
  { $project: { _id: 1, id: 1, name: 1, updated_at: 1, created_at: 1 } },
]);
```

4. Verify deterministic winner:
   - first row from query above is the row `get-by-id` returns.
5. If duplicates were newly created, audit write path for missing `ensureUniqueTaskPublicId` usage or concurrent creates without follow-up dedupe.

### Symptom: bulk task creation emits duplicate IDs inside one request

1. Verify caller passes one shared `reservedIds` set across the request loop.
2. Confirm `ensureUniqueTaskPublicId` is called per row, not once per batch.
3. Validate generated IDs in request logs or inserted docs.

## Developer Checklist

1. Always generate public IDs via `ensureUniqueTaskPublicId`.
2. For batch inserts, pass a shared request-level `reservedIds`.
3. Keep `_id`-first route behavior in UI; never rely on raw `id` when duplicates are known.
4. Keep deterministic sort (`updated_at`, `created_at`, `_id`) in public-id lookup paths.
5. Keep regression tests green.

## Regression Coverage

- `backend/__tests__/services/taskPublicId.test.ts`
- `app/__tests__/operops/taskShortLinkRouteContract.test.ts`
