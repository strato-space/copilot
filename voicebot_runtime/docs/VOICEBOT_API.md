# VoiceBot API

Base URL: `/voicebot`

Auth:
- `Authorization: Bearer <jwt>`
- or `x-authorization: <jwt>`
- or `Cookie: auth_token=<jwt>` (used by Web UI for `<img src>` proxy routes)

Content-Type: `application/json`

## Permissions (JWT `permissions`)
- `voicebot:sessions:create` - create sessions
- `voicebot:sessions:read_own` - access own sessions
- `voicebot:sessions:read_all` - access any sessions
- `voicebot:sessions:update` - update sessions (used by manual summarize trigger)

## POST `/voicebot/create_session`
Create a new VoiceBot session.

Permission: `voicebot:sessions:create`

Request body (all fields optional):
```json
{
  "chat_id": 123456789,
  "session_name": "Optional session title",
  "session_type": "multiprompt_voice_session"
}
```

Notes:
- If `chat_id` is missing, the backend tries to resolve it from the authenticated performer (`performer.telegram_id`).
- For Web UI sessions `chat_id` can be `null` (ownership is based on `user_id` until `project_id` is set).

Response `201`:
```json
{
  "success": true,
  "session_id": "507f1f77bcf86cd799439011"
}
```

Common errors:
- `401` missing/invalid JWT
- `403` insufficient permissions
- `500` server error

## POST `/voicebot/session`
Fetch a session payload for Web UI (session + messages + derived attachments).

Permission: `voicebot:sessions:read_own` or `voicebot:sessions:read_all`

Request body:
```json
{
  "session_id": "507f1f77bcf86cd799439011"
}
```

Response `200` (shape):
```json
{
  "voice_bot_session": {},
  "session_messages": [],
  "session_attachments": [
    {
      "message_oid": "507f1f77bcf86cd7994390aa",
      "message_timestamp": 1700000000,
      "kind": "screenshot",
      "source_type": "telegram",
      "uri": "/voicebot/message_attachment/507f1f77bcf86cd7994390aa/0",
      "direct_uri": "/voicebot/public_attachment/698c6bc84d8af0e866f832e3/UNIQ_ABC123",
      "mimeType": "image/jpeg",
      "caption": "Screenshot caption"
    }
  ],
  "socket_token": "<jwt>",
  "socket_port": 8083
}
```

Notes:
- `session_attachments` is a derived read model for the `Screenshort` tab.
- For Telegram attachments:
  - `uri` is a legacy/backend-auth proxy path (`/voicebot/message_attachment/...`) for UI compatibility;
  - `direct_uri` is a public path (`/voicebot/public_attachment/<session_id>/<file_unique_id>`) when `file_unique_id` exists.

## GET `/voicebot/public_attachment/:session_id/:file_unique_id`

Get Telegram attachment bytes by stable identifiers, without session auth.

Path params:
- `session_id`: Mongo `session_id` (`automation_voice_bot_sessions._id`)
- `file_unique_id`: Telegram attachment `file_unique_id`

Response:
- streams binary attachment content and sets headers:
  - `Cache-Control: private, max-age=3600`
  - `Content-Type: <detected>`

Behavior:
- Resolves attachment by `session_id + file_unique_id` and verifies telegram source.
- Uses bot `getFile(file_id)` + Telegram file download under the hood.

Errors:
- `400` invalid params (`session_id` / `file_unique_id`).
- `404` attachment/session not found, missing `file_id`, or non-Telegram source.
- `500` Telegram API/token errors.

## POST `/voicebot/add_text`
Add a text message to a session and enqueue it for async processing.

Permission: `voicebot:sessions:read_own` or `voicebot:sessions:read_all`

Request body:
```json
{
  "session_id": "507f1f77bcf86cd799439011",
  "text": "Hello",
  "speaker": "Optional speaker name",
  "attachments": [
    {
      "kind": "screenshot",
      "source": "web",
      "uri": "https://example.com/image.jpg",
      "name": "image.jpg",
      "mimeType": "image/jpeg",
      "size": 12345,
      "width": 1200,
      "height": 800,
      "caption": "Optional caption"
    }
  ]
}
```

Response `200`:
```json
{
  "success": true,
  "message": "Text has been added to session and queued for processing",
  "message_id": "550e8400-e29b-41d4-a716-446655440000"
}
```

Common errors:
- `400` missing `session_id` / `text`
- `403` access denied to this session
- `404` session not found

## POST `/voicebot/add_attachment`
Add an attachment-only message (screenshots/documents) to an existing session and enqueue it via `HANDLE_ATTACHMENT`.

Permission: `voicebot:sessions:read_own` or `voicebot:sessions:read_all`

Request body:
```json
{
  "session_id": "507f1f77bcf86cd799439011",
  "kind": "screenshot",
  "text": "Optional caption",
  "attachments": [
    {
      "kind": "screenshot",
      "source": "web",
      "uri": "https://example.com/image.jpg",
      "name": "image.jpg",
      "mimeType": "image/jpeg",
      "size": 12345,
      "width": 1200,
      "height": 800,
      "caption": "Optional caption"
    }
  ]
}
```

Response `200`:
```json
{
  "success": true,
  "message_id": "550e8400-e29b-41d4-a716-446655440000"
}
```

Common errors:
- `400` invalid `session_id` / empty `attachments`
- `403` access denied to this session
- `404` session not found

## GET `/voicebot/message_attachment/:message_id/:attachment_index`
Token-safe proxy for Telegram message attachments so the Web UI can render images without exposing bot tokens.

Permission: `voicebot:sessions:read_own` or `voicebot:sessions:read_all`

Path params:
- `message_id`: Mongo ObjectId string (`automation_voice_bot_messages._id`)
- `attachment_index`: 0-based index in `message.attachments[]`

Response `200`:
- streams the binary file content (for example `image/jpeg`)
- headers include:
  - `Cache-Control: private, max-age=3600`
  - `Content-Type: <detected>`

Notes:
- Only Telegram-sourced attachments are supported (for non-Telegram sources, use the `uri`/`url` directly).
- The session access check is enforced by resolving `message.session_id` and reusing the same rules as `/voicebot/session`.

## POST `/voicebot/trigger_session_ready_to_summarize`
Manual trigger for the summarization flow.

What it does:
1. Ensures the session has a `project_id`. If missing, assigns the default PMO project.
2. Enqueues notify event `session_ready_to_summarize` (BullMQ queue `voicebot--notifies[-suffix]`).
   The notifies worker will run local hooks configured by `VOICE_BOT_NOTIFY_HOOKS_CONFIG` (defaults to `./notifies.hooks.yaml`)
   and (optionally) POST to `VOICE_BOT_NOTIFIES_URL`.

Permission: `voicebot:sessions:update` (route also includes `read_own` in middleware)

Request body:
```json
{
  "session_id": "507f1f77bcf86cd799439011"
}
```

Response `200`:
```json
{
  "success": true,
  "project_id": "6981b223ccb993fded944b72",
  "project_assigned": true
}
```

Common errors:
- `400` missing/invalid `session_id`
- `404` session not found
- `500` PMO project not found / failed to enqueue notify
