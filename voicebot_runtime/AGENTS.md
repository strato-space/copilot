# Repository Guidelines

## Project Structure & Module Organization
- Root entrypoints are Node services and workers (e.g., `voicebot-backend.js`, `voicebot-tgbot.js`, `echo-tgbot.js`, `voicebot-queue-monitor.js`).
- `voicebot/` contains the processing pipeline (jobs, processors, postprocessing, prompts, and custom prompts).
- `crm/` is the Express API surface with `controllers/` and `routes/`.
- The `/voicebot/projects` CRM response includes `board_id`, `drive_folder_id`, and `design_files` for downstream DBI flows.
- CRM voicebot routes include recovery endpoints such as `restart_corrupted_session` (guarded by `VOICEBOT_SESSIONS.PROCESS`).
- CRM routes also include `send_to_crm`, `sessions_in_crm`, and `restart_create_tasks` to flag sessions for CRM and (re)run the `create_tasks` agent; results are stored in `agent_results.create_tasks`.
- Web UI sessions can be created without `chat_id`; access is tied to the authenticated `user_id`, and list permissions match on `user_id` as well as `chat_id`.
- `permissions/`, `utils/`, and `constants.js` hold shared helpers and configuration.
- `app/` is the React + Vite frontend; `app/src` is organized into `components/`, `pages/`, `store/`, `hooks/`, and `assets/`.
- `services/` contains shared backend services and microservices (e.g., MCP proxy client).
- **`docs/` is the designated location for ALL documentation, examples, guides, and auxiliary documents. Always place documentation files here, not in code directories.**
- `plan/` contains explicitly requested raw planning artifacts and should remain scoped to active business initiatives.
- Runtime mismatch UX note: session routes now show a dedicated runtime-aware error screen on 404 instead of spinning indefinitely.

## Documentation Guidelines
- **ALL documentation, examples, READMEs, guides, changelogs, and auxiliary documents MUST be created in the `docs/` directory.**
- Code directories (`services/`, `voicebot/`, `crm/`, etc.) should contain ONLY executable code files.
- When creating integration examples, tutorials, or explanatory documents, always place them in `docs/`.
- Planning specs may live under `plan/` when explicitly requested by stakeholders; otherwise keep them in `docs/`.
- Raw stakeholder notes are allowed under `plan/` when explicitly requested, but the canonical release narrative must remain in English in `CHANGELOG.md`.
- Current diarization migration plan documents the canonical immutable transcription chain `transcription_raw -> transcription` (model-agnostic) and treats chunk-like lists as legacy read adapters only: `plan/gpt-4o-transcribe-diarize-plan.md`.
- Event-log/edit/rollback draft for segment-level operations and replay-oriented audit trails: `plan/edit-event-log-plan.md`.
- Launch-ready consolidated implementation draft for staged delivery (`event-log -> diarization`): `plan/implementation-draft-v1.md`.
- Example session snapshot used for schema reviews: `plan/session-697b75eabebd2e48576bc6ed.pretty.json`.
- Keep example session snapshots pretty-printed; avoid reformatting unless needed for clarity.
- Reference documentation from code using relative paths: `see docs/README_MCP_PROXY.md`.
- Keep documentation organized by topic: `docs/MCP_PROXY_QUICKSTART.md`, `docs/INTEGRATION_EXAMPLE.js`, etc.
- Current Telegram session-management specification for voice sessions lives at `plan/session-managment.md` and includes strict active-session behavior for `/start`, `/done`, `/session`, `/login` (one-time `tg_auth` URL, independent of active session), plus socket contract notes (`session_done` from `session_id` only; user resolved on backend from JWT with permission checks).

## MCP Configuration
- MCP server endpoints and transports live in `agents/fastagent.config.yaml`.
- StratoSpace MCP endpoints use Streamable HTTP (`transport: "http"`) with root URLs.

## AgentCards (fast-agent)
- Agent definitions live in `agents/agent-cards/` (one AgentCard per file, `.md`/`.yml`/`.yaml`).
- Prefer Markdown cards with YAML frontmatter and put the full instruction in the body (no external prompt file paths).
- Required fields: `type: agent`, `name`, `model`; set `default: true` for the primary agent exposed by the MCP server.
- Use `description` for the MCP tool description, and `servers`/`tools` for MCP allowlists when needed.
- PM2 serves AgentCards via `fast-agent serve --agent-cards agent-cards` (see `agents/ecosystem.config.cjs`); keep paths in sync.
- Do not add new Python-based agent wrappers; AgentCards are the source of truth.

## Build, Test, and Development Commands
- Backend tests (Jest): `npm test`, `npm run test:watch`, `npm run test:coverage`.
- Voicebot runner scripts: `npm run test:voicebot`, `npm run test:voicebot:unit`, `npm run test:voicebot:integration`.
- Frontend dev/build: `cd app && npm run dev`, `npm run build`, `npm run preview`, `npm run build-test`, `npm run host`.
- Local services are plain Node entrypoints; example: `node voicebot-backend.js`.
- Session recovery (CLI): `node cli/restart-voicebot-sessions.js --help`.

## Development & Debugging
- For web UI development and debugging, use `https://voice-dev.stratospace.fun`.
- Use `https://voice.stratospace.fun` only for production validation after dev is verified.
- Chrome remote debugging: see `../webrtc/docs/CHROME_DEVTOOLS.md`.
- The Vite dev server config also suppresses common Firefox console noise (Bluebird unreachable eval and empty optimized-deps sourcemaps); see `app/vite.config.js`.
- Web audio uploads accept closed sessions; the backend only blocks sessions with `is_deleted=true`, and the UI disables upload only for deleted sessions.

## Coding Style & Naming Conventions
- No repository-wide formatter is enforced; match the existing style in the file you touch.
- React components use `PascalCase.jsx` (e.g., `Navigation.jsx`); hooks use `use*` in `app/src/hooks`.
- Ant Design `Button` with `shape="circle"` can render icons baseline-shifted; wrap the icon in a flex container and set the button to `inline-flex` to keep glyphs centered (see `app/src/components/voicebot/MeetingCard.jsx`).
- Backend modules use lowercase/kebab-case filenames (e.g., `voicebot-queue-monitor.js`, `crm/controllers/auth.js`).

## Testing Guidelines
- Jest is configured in `package.json` to discover tests via `__tests__/**/*.test.js` and to load `__tests__/setup.js` when present.
- Keep tests close to the feature area (backend vs. frontend), and name them with a `.test.js` suffix.

## Logging Guidelines
- Avoid per-message warning loops; aggregate by session/processor and rate-limit warnings for pending work.
- Reserve warn/error for stuck processors or failures; use debug/info for routine pending states.

## Commit & Pull Request Guidelines
- Commit messages in history are short, imperative, and lowercase (e.g., “fixed permissions”, “minor ui fixes”); keep that style.
- PRs should include a concise summary, key files touched, and steps to verify.
- Include screenshots or short clips for UI changes under `app/`.

## Configuration & Secrets
- Backend configuration is driven by environment variables; use `.env.example` as the baseline.
- Frontend environments live in `app/.env.development`, `app/.env.test`, and `app/.env.production`; do not commit secrets.
- Keep the localhost API URL commented in `app/.env.development` when switching to a remote dev endpoint.
- OpenAI cost controls (optional env knobs):
  - `VOICEBOT_CATEGORIZATION_MODEL` (default: `gpt-4.1`) controls the categorization model used by `voicebot/voice_jobs/categorize.js`.
  - `VOICEBOT_TASK_CREATION_MODEL` (default: `gpt-4.1`) controls the task creation model (used by `voicebot/postprocessing/create_tasks.js` and `voicebot/common_jobs/create_tasks_from_chunks.js`).
  - `VOICEBOT_CATEGORIZATION_SHORT_TEXT_MAX_CHARS` / `VOICEBOT_CATEGORIZATION_SHORT_TEXT_MAX_WORDS` control short-text skipping in `voicebot/processors/categorization.js` (trivial texts and slash-commands are marked processed with `processors_data.categorization.skipped_reason`).

## Production data sources (MongoDB / Redis)
- **Where to find creds (prod):** `/srv/voicebot/.env`
  - MongoDB: `MONGO_USER`, `MONGO_PASSWORD`, `MONGODB_HOST`, `MONGODB_PORT`, `DB_NAME` (optional `DB_CONNECTION_STRING`).
  - Redis: `REDIS_CONNECTION_HOST`, `REDIS_CONNECTION_PORT`, `REDIS_USERNAME` (optional, often `default`), `REDIS_CONNECTION_PASSWORD`, `REDIS_DB_INDEX`.
- **Inventory reference:** `/home/tools/server/.production/production.md` (host list + Redis endpoint).
- **Mongo collections to inspect:**
  - `automation_voice_bot_sessions` (sessions, `processors_data`, `session_processors`)
  - `automation_voice_bot_messages` (messages, transcription/categorization payloads)
  - `automation_tg_voice_sessions` (TG session registry)
  - `automation_voice_bot_topics` (session topics)
- **Redis queue keys (BullMQ):**
  - `voicebot--common`, `voicebot--voice`, `voicebot--processors`, `voicebot--postprocessors`, `voicebot--events`, `voicebot--notifies`.
  - With `VOICE_BOT_IS_BETA` set, suffixes are appended (e.g., `voicebot--voice-gamma`).
  - BullMQ job keys do **not** use Redis TTL (`TTL=-1` is expected). Lifecycle is managed by:
    - BullMQ retention (`removeOnComplete/removeOnFail`) set via `defaultJobOptions` in `voicebot-backend.js` and `voicebot-tgbot.js`.
    - Fallback sweeper: `voicebot/redis_monitor.js` (runs `queue.clean(...)` and `queue.trimEvents(...)` when Redis memory is high).
  - Event streams live under `bull:<queue>:events` (Redis streams). These can grow large; the monitor keeps them bounded via `trimEvents(...)`.
- **Mongo DNS gotcha:** if Mongo driver fails with `getaddrinfo EAI_AGAIN managed-...`, add `directConnection=true` to the URI or use the diagnostics scripts with `MONGO_DIRECT=true`.

## Diagnostics scripts (repo)
- All scripts expect `.env` in repo root (same variables as prod). Run from `/srv/voicebot` or repo root locally.
- `node cli/diagnostics/check_session.js <sessionId> [--full]`
  - Prints session + message status for quick triage (ObjectId + string session_id).
  - Optional `MONGO_DIRECT=true` to force direct connection.
- `node cli/diagnostics/check_queue_counts.js`
  - Shows BullMQ job counts for all voicebot queues (suffix-aware via `VOICE_BOT_IS_BETA`).
- `node cli/diagnostics/check_postprocessors.js [sessionId]`
  - Lists delayed/failed postprocessor jobs; filter by session if provided.
- `node cli/diagnostics/scan_redis_keys.js <pattern>`
  - SCAN-based key lookup (useful for `*<session_id>*` or `*<message_id>*`).
- `node cli/diagnostics/check_processing_staleness.js [sessionId|--session sessionId] [--minutes 10] [--json] [--metrics]`
  - Smoke-check for stuck `is_processing` locks.
  - Default threshold is `10m`; prints all stale entries if lock age exceeds threshold.
  - Session mode examples:
    - one session: `node cli/diagnostics/check_processing_staleness.js 698dbe033e7c061197071496`
    - full scan: `node cli/diagnostics/check_processing_staleness.js`
  - Exit code: `0` = clean, `1` = found stale locks, `2` = script/runtime error.
- `node cli/diagnostics/recalc_session_duration.js <sessionId> [--apply]`
  - Recomputes per-message durations (from message metadata, chunks, or `ffprobe` when files are present) and aggregates session duration; with `--apply`, writes the backfill to Mongo.
  - Fast path: for each message it first uses stored chunk/session math, then falls back to file-based probe using `message.file_path` if chunks/duration are missing.
  - If `file_path` is relative (legacy/typical for this repo), run from repo root so path resolves to `uploads/audio/...` correctly.

### Where source webm/audio files are stored
- All audio uploads are persisted by `moveToSessionFolder(...)` into `AUDIO_DIR` (`constants.file_storage.AUDIO_DIR`), currently `uploads/audio`.
- Typical persisted layout for a session:
  - `uploads/audio/sessions/<session_id>/<timestamp>_<hash>.webm`
- On prod with repo at `/srv/voicebot` this is:
  - `/srv/voicebot/uploads/audio/sessions/<session_id>/<file>`
- Telegram source messages usually have `file_path = null` and do not have a local `.webm` here; web uploads do.
- Quick locate + quick check:
  ```bash
  # 1) Pull candidate paths from DB
  cs=$(grep -m1 "^DB_CONNECTION_STRING=" /srv/voicebot/.env | cut -d= -f2-)
  mongosh "$cs" --quiet --eval 'db=db.getSiblingDB("stratodb"); db.automation_voice_bot_messages.find({ session_id: ObjectId("<session_id>"), file_path: { $exists: true, $ne: null } }, { _id: 1, file_path: 1, file_metadata: 1 }).sort({ created_at: -1 }).toArray()'

  # 2) Check filesystem quickly
  ls -lah /srv/voicebot/uploads/audio/sessions/<session_id>/
  ```
- If session scan looks empty, run from the correct host and repo root (`cd /srv/voicebot`) and inspect both `uploads/audio/sessions/<session_id>/` and `./uploads/audio/...` paths; older codepaths may keep relative paths.

### Duration extraction notes (diagnostics)
- Runtime extractor `utils/audio_utils.js:getAudioDuration()` uses ffprobe on:
  - `format=duration`
  - `stream=duration`
- `ffprobe` may return `Duration is unavailable in ffprobe metadata` for fragmented webm/packets-only files; fallback command that worked in practice:
  ```bash
  ffprobe -v error -show_entries packet=pts_time \
    -select_streams a -of json <local_audio_path> \
    | node -e "const fs=require('fs');const d=JSON.parse(fs.readFileSync(0,'utf8'));const pts=(d.packets||[]).map(p=>Number(p.pts_time)).filter(n=>Number.isFinite(n));if(!pts.length){process.exit(1);}console.log(Math.max(...pts).toFixed(3));"
  ```
- Prefer running the recalc script first; only use one-by-one fallback for specific unresolved messages:
  - `node cli/diagnostics/recalc_session_duration.js <sessionId>`
  - `node cli/diagnostics/recalc_session_duration.js <sessionId> --apply` (only after review)

## Queue suffix (VOICE_BOT_IS_BETA)
- Queue names are shared across all workers by default, so dev/prod will compete on the same Redis queues unless you set a suffix.
- `VOICE_BOT_IS_BETA` controls the suffix (affects BullMQ queue names like `voicebot--voice[-suffix]`):
  - `true` → suffix `-beta`
  - `gamma` → suffix `-gamma` (any non-empty value becomes the suffix)
  - `false` or unset → no suffix (current prod behavior)
- Example (dev isolation):
  ```bash
  # on dev only
  VOICE_BOT_IS_BETA=gamma
  ```
- `IS_BETA` is treated as “any non-empty value”, so `gamma` also:
  - uses `TG_VOICE_BOT_BETA_TOKEN` (Telegram bot)
  - writes Google Sheets to `TRANSCRIPTIONS_TEST_FOLDER_ID`
- Use this to split dev/prod queues when sharing a DB/Redis (e.g., set `VOICE_BOT_IS_BETA=gamma` on dev only).

## Runtime data isolation (`runtime_tag`)
- Sessions/messages are runtime-scoped in Mongo via `runtime_tag` (`prod`, `gamma`, ...).
- New writes must persist `runtime_tag` (session create, voice/text/attachment ingest, web upload).
- Active-session mapping in `automation_tg_voice_sessions` is scoped by `telegram_user_id + runtime_tag`.
- Worker/API reads must apply runtime filters:
  - non-prod runtimes: strict `runtime_tag == current`;
  - prod runtime: `runtime_tag == "prod"` plus legacy rows where `runtime_tag` is missing.
- Cross-runtime operations are rejected by API guards (`404` for inaccessible sessions, `409 runtime_mismatch` for upload-to-foreign-runtime).

### Prod vs dev queue sanity check (avoid diagnostics mix‑ups)
- **Prod expectation:** `VOICE_BOT_IS_BETA=false` or unset → queue names **without suffix** (e.g., `voicebot--postprocessors`).
- **Dev expectation:** `VOICE_BOT_IS_BETA=beta|gamma|...` → queue names **with suffix** (e.g., `voicebot--postprocessors-gamma`).
- **Location check when unsure:** run `ip a` on the current host and confirm the expected IP (p2 dev: `5.129.216.39`, prod: `176.124.201.53`) before running diagnostics.
- If diagnostics output shows `-beta`/`-gamma` **while you are on prod**, you are not using the prod env:
  - Verify `/srv/voicebot/.env` on prod.
  - Make sure you run diagnostics from `/srv/voicebot` so `dotenv` loads the correct file.
- Prod Redis is typically `REDIS_DB_INDEX=1` (check `/srv/voicebot/.env`); dev often uses a different DB index or a suffix.
- Node is not in PATH on prod. Use the full path to run scripts:
  ```bash
  /root/.nvm/versions/node/v22.8.0/bin/node cli/diagnostics/check_queue_counts.js
  ```

## Frontend runtime endpoints (window.backend_url / window.agents_api_url)
- The built UI initializes:
  - `window.backend_url` from `VITE_API_URL`
  - `window.agents_api_url` from `VITE_AGENTS_API_URL`
- When served from `*.stratospace.fun`, the UI overrides both to avoid mixed content:
  - `window.backend_url = ''` (same-origin)
  - `window.agents_api_url = window.location.origin + '/agents'`
- This makes HTTPS/WSS work behind Nginx without any client-side rewrite rules.
- `/authorized` is a legacy entry path; the UI now redirects it to `/login` so authorization always lands on the standard login flow.

## Notify webhook (`/notify`)
- The backend can POST notifications to an external webhook (commonly mounted as `/notify` on the receiver side).
  - Transport implementation:
  - Worker: `notifiesWorker` in `voicebot-backend.js`.
  - Queue: `constants.voice_bot_queues.NOTIFIES` (typically `voicebot--notifies[-suffix]`).
  - Env vars:
    - `VOICE_BOT_NOTIFIES_URL` (full URL to POST to)
    - `VOICE_BOT_NOTIFIES_BEARER_TOKEN` (Authorization Bearer token)
    - `VOICE_BOT_NOTIFY_HOOKS_CONFIG` (optional; path to YAML mapping `event -> [hooks...]`, default `./notifies.hooks.yaml`; set to empty to disable)
- HTTP request shape (what the receiver gets):
  ```json
  {
    "event": "<event_name>",
    "payload": {
      "...": "...",
      "session_id": "<session_id>"
    }
  }
  ```
  - `session_id` is injected by the transport (from the BullMQ job data). Sender call sites usually do not include it in `payload`.
- Delivery semantics:
  - Enqueued via `voicebot/bot_utils.js:send_notify(...)`.
  - `attempts: 1` with exponential backoff; completed/failed jobs are auto-pruned from Redis via BullMQ `defaultJobOptions` (see queue setup in `voicebot-backend.js` and `voicebot-tgbot.js`).

- Local hook execution (in addition to the webhook):
  - `notifiesWorker` can also run local shell hooks for a given `event`.
  - Hooks are configured via `VOICE_BOT_NOTIFY_HOOKS_CONFIG` (YAML file):
    ```yaml
    session_ready_to_summarize:
      # Use an absolute path to avoid PATH differences under PM2/systemd.
      - cmd: /usr/local/bin/uv
        args:
          - --directory
          - /home/strato-space/prompt/StratoProject/app
          - run
          - StratoProject.py
          - --model
          - codex
          - -m
    ```
  - Each script is spawned in the background (detached, fire-and-forget). The notify job is not blocked waiting for hook completion.
  - The hook runner logs a start line and spawn errors for troubleshooting (but hook stdout/stderr is ignored).
  - Hook input is passed as the **last CLI argument** (a single JSON string) that contains the same envelope as the webhook (`{ event, payload: {..., session_id} }`).
  - The runner appends the JSON argument automatically, so the config does not need to mention it explicitly.

### Real emitted events (current code) and payload attributes
- `session_tasks_created`
  - Sender: `voicebot/postprocessing/create_tasks.js`
  - Payload: `{}` (transport adds `session_id`)
- `session_categorization_done`
  - Sender: `voicebot/processors/finalization.js`
  - Payload: `{}` (transport adds `session_id`)
- `session_project_assigned`
  - Sender: `crm/controllers/voicebot.js` (`update_session_project`)
  - Emitted only if `project_id` actually changes.
  - Payload:
    ```json
    { "project_id": "<new_project_id>", "old_project_id": "<old_project_id|null>" }
    ```
- `session_done`
  - Sender: `voicebot/common_jobs/done_multiprompt.js` (session close)
  - Payload: `{}` (transport adds `session_id`)
- `session_ready_to_summarize`
  - Sender:
    - `voicebot/common_jobs/done_multiprompt.js` when closing a session (`is_active=false`) AND `project_id` is already assigned.
    - `crm/controllers/voicebot.js` (`update_session_project`) when project changes AND the session is already closed.
    - Manual trigger: `POST /voicebot/trigger_session_ready_to_summarize` (used by the UI "Summarize (∑)" button). It assigns the PMO project if `project_id` is missing, then enqueues the notify event; this does not prevent the standard automatic triggers from firing later when their conditions are met.
  - Payload:
    ```json
    { "project_id": "<project_id>" }
    ```
  - Meaning: both conditions are satisfied:
    - project is assigned (`project_id` exists)
    - session is closed (`is_active=false`)
  - Re-fire rules:
    - If a session is already closed and user changes the project, the event is emitted again with the new `project_id`.
    - If a session is closed after a project was assigned, the event is emitted on close.
  - Recommended hook on this event (for StratoProject summarization):
    - Configure `notifies.hooks.yaml` as shown above.
    - Voicebot will run the command in the background and append the event JSON as the last argument.

## Attachments (Screenshort) and `/voicebot/message_attachment/*`
- Telegram `photo` / `document` messages are ingested via the `HANDLE_ATTACHMENT` job and stored as regular session messages with `message_type` (`screenshot` / `document`) and `attachments[]` metadata.
- Web UI fetches a session via `POST /voicebot/session`, which returns:
  - `session_messages` (legacy-compatible)
  - `session_attachments` (derived read model for the `Screenshort` tab)
- **Token safety rule:** never expose raw Telegram file URLs to the browser (they contain the bot token). For Telegram attachments, `session_attachments[].uri` is always a backend proxy path:
  - `GET /voicebot/message_attachment/:message_id/:attachment_index`
  - This endpoint requires the regular session auth checks, plus attachment index validation and source guard.
- For external LLM/MCP consumers, the stable public path is now exposed when `file_unique_id` is available:
  - `direct_uri: /voicebot/public_attachment/<session_id>/<file_unique_id>`
  - `GET /voicebot/public_attachment/:session_id/:file_unique_id` resolves Telegram attachment bytes without session auth.
  - Security is intentionally pair-based (session-id + file_unique_id) and does not leak Telegram bot token URLs.
- The proxy endpoint:
  - checks access to the underlying session by resolving `message.session_id` (same rules as `/voicebot/session`);
  - calls Telegram Bot API `getFile(file_id)` and streams the file by `file_path`;
  - sets `Cache-Control: private, max-age=3600` and a best-effort `Content-Type`.
- Auth note: `<img src="/voicebot/message_attachment/...">` cannot send custom headers, so this route must work with cookie-based auth (the Web UI uses `auth_token` cookie).

## Embed mode (iframe)
- The UI supports `/embed/*` routes for iframe integration without the Voicebot side navigation.
- Allowed parent origins are configured via `VITE_EMBED_PARENT_ORIGINS` in `app/.env.*`.

## Auto-Reprocessing & Stuck Sessions
- The repeat worker `voicebot/common_jobs/processing_loop.js` is the main auto-retry mechanism.
- It re-enqueues processors for sessions with `is_messages_processed=false` and re-queues transcription if `transcribe_timestamp` is stale or `to_transcribe=true`.
- Session finalization waits on `session_processors` (postprocessing) and logs `Skipping finalization. Not processed processors: ...` when something like `CREATE_TASKS` is still pending.
- Transcription failures set `is_corrupted=true` in `voicebot/voice_jobs/transcribe.js`; recovery uses `cli/restart-voicebot-sessions.js` or the UI restart action.
- Quota-related failures are treated as transient: the processors now set `transcription_retry_reason` / `categorization_retry_reason` to `insufficient_quota` and keep the job open for auto-retry.
- `voicebot/common_jobs/processing_loop.js` clears quota retry flags and resumes work automatically once balance is restored, without forcing manual restart actions.
- On a successful retry path, processors clear quota retry state, reset `is_corrupted`, and continue normal completion flow.


- Processing loop cadence: `voicebot-tgbot.js` runs `AsyncPolling` every **10 seconds**.

### Reset stuck categorization (DB)
- If a message has `processors_data.categorization.is_processing=true` for a long time, clear the flags and job timestamp.
- Example (replace message id):
  ```bash
  cs=$(grep -m1 "^DB_CONNECTION_STRING=" /srv/voicebot/.env | cut -d= -f2-)
  mongosh "$cs" --quiet --eval 'db=db.getSiblingDB("stratodb"); db.automation_voice_bot_messages.updateOne({ _id:ObjectId("<message_id>") }, { $set:{ "processors_data.categorization.is_processing":false, "processors_data.categorization.is_processed":false, "processors_data.categorization.is_finished":false }, $unset:{ "processors_data.categorization.job_queued_timestamp":"" } })'
  ```
- Wait for the next processing loop (10s) or restart `voicebot-backend` to requeue immediately.

### Sessions list performance (DB index)
- `/voicebot/sessions` aggregates message counts from `automation_voice_bot_messages`, so missing indexes can make the UI list load very slowly.
- Ensure index exists:
  ```bash
  cs=$(grep -m1 "^DB_CONNECTION_STRING=" /srv/voicebot/.env | cut -d= -f2-)
  mongosh "$cs" --quiet --eval 'db=db.getSiblingDB("stratodb"); db.automation_voice_bot_messages.createIndex({ session_id: 1 })'
  ```

## Production VoiceBot Ops (strato-space)
### PM2 services (prod) -> repo paths
- `voicebot-backend` — main VoiceBot backend API + processors; repo entrypoint: `voicebot-backend.js` (root of this repo).
- `voicebot-tgbot` — Telegram bot worker for sessions and uploads; repo entrypoint: `voicebot-tgbot.js` (root of this repo).
- `voicebot-queue-monitor` (optional) — queue visibility UI on port 8099; repo entrypoint: `voicebot-queue-monitor.js` (root of this repo).
- `echo-tgbot` (optional) — lightweight echo bot; repo entrypoint: `echo-tgbot.js` (root of this repo).
- `prompt_flow_api` — prompt-flow engine API; **outside this repo** (`/srv/agent/prompt_flow_engine/prompt_flow/prompt_flow_api.js`).
- `automation-*` — CRM automation services; **outside this repo** (see `/home/strato-space/automation`).
- `brand-files-http-server` — brand assets server; **outside this repo** (see `/home/strato-space/agent` / brand-files tooling).


### Prod server & access
- Production VoiceBot server: `176.124.201.53` (SSH as root).
- SSH: `ssh -i /root/.ssh/id_ed25519 root@176.124.201.53` (key must be present on the server).


### Deploy (VoiceBot)
- Prereq: deploy key added in GitHub (see https://github.com/strato-space/voicebot/settings/keys).
- SSH to prod: `ssh -i /root/.ssh/id_ed25519 root@176.124.201.53`.
- Go to repo: `cd /srv/voicebot`.
- Ensure Node/PM2 are in PATH (prod uses NVM):
  ```bash
  export PATH=/root/.nvm/versions/node/v22.8.0/bin:$PATH
  ```
- If the worktree is dirty, stash before pulling:
  ```bash
  git status --porcelain=v1
  git stash push -u -m "codex: stash before deploy $(date -Iseconds)"
  ```
- Pull latest: `git pull`.
- **Always rebuild the frontend after pulling** (UI fixes do not take effect without a fresh `app/dist/`):
  ```bash
  cd /srv/voicebot/app
  # Optional: override build-time endpoints (useful for direct-IP access and quick swaps).
  # Keep overrides in .env.production.local (ignored by git via *.local).
  # Note: when served from *.stratospace.fun, the UI forces same-origin + /agents anyway.
  cat > .env.production.local <<'EOF'
VITE_API_URL=http://176.124.201.53:8083
VITE_AGENTS_API_URL=http://176.124.201.53:3001
VITE_PROXY_URL=
VITE_PROXY_AUTH=
EOF
  npm ci
  npm run build
  cd /srv/voicebot
  ```
- Check PM2: `pm2 status`.
  - `automation-*` = CRM services.
  - `voicebot-*` = VoiceBot services (main: `voicebot-backend`, `voicebot-tgbot`).
  - `voicebot-queue-monitor` can be started for queue visibility (port 8099, no auth); stop it after use.
- Restart relevant services by PM2 id: `pm2 restart <id> <id> ...` (space-separated, no commas).

### WebSocket (Socket.IO) over HTTPS (WSS)
- The VoiceBot Socket.IO server runs on the same port as the backend (`BACKEND_PORT`, prod: `8083`) and must be reverse-proxied on the edge.
- If the browser shows `WebSocket connection to 'wss://voice.stratospace.fun/socket.io/…' failed`, validate:
  - Backend is listening: `ssh root@176.124.201.53 'ss -ltnp | grep :8083'`
  - Edge Nginx (p2): `/etc/nginx/sites-enabled/voice.conf`
    - `location /socket.io/` must proxy to `176.124.201.53:8083` (not `:3000`)
    - Reload after edits: `sudo nginx -t && sudo systemctl reload nginx`
- The UI connects to Socket.IO via same-origin (`window.backend_url` / `window.location.origin`) so it works behind a reverse proxy without hardcoded ports.

### Inspect running processes
- SSH (prod): `ssh root@176.124.201.53`
- PM2 list (ensure Node in PATH):
  ```bash
  export PATH=/root/.nvm/versions/node/v22.8.0/bin:$PATH
  pm2 list
  ```
- Process list filter:
  ```bash
  ps -eo pid,ppid,cmd | grep -E "voicebot|prompt_flow|pm2" | grep -v grep
  ```
- Working directories:
  ```bash
  readlink -f /proc/<PID>/cwd
  ```

### Typical services + working dirs
- `node /srv/voicebot/voicebot-backend.js` (cwd: `/srv/voicebot`)
- `node /srv/voicebot/voicebot-tgbot.js` (cwd: `/srv/voicebot`)
- `node /srv/agent/prompt_flow_engine/prompt_flow/prompt_flow_api.js` (cwd: `/srv/agent/prompt_flow_engine`)
- Redis is remote; host/port are defined in `/srv/voicebot/.env`.

### Log locations
- PM2 logs: `/root/.pm2/logs/`
  - `voicebot-backend-out.log`, `voicebot-backend-error.log`
  - `voicebot-tgbot-out.log`, `voicebot-tgbot-error.log`
  - `prompt-flow-api-out.log`, `prompt-flow-api-error.log`

### Typical errors observed
- OpenAI quota: `RateLimitError: 429 ... insufficient_quota` (often during transcription or LLM processors).
- `Error fetching models: Request failed with status code 500` (backend model list).
- BullMQ lock issues: `Missing lock`, `Lock mismatch`, `could not renew lock`.
- MCP dependency missing (backend boot loop): `Cannot find module '@modelcontextprotocol/sdk/client/index.js'`.
- Redis config warning: `Eviction policy is allkeys-lru. It should be "noeviction"`.
- Redis connectivity: `ETIMEDOUT` on Redis connections.

### Verifying logs quickly
- Session-specific search:
  ```bash
  grep -n "<session_id>" /root/.pm2/logs/voicebot-tgbot-out.log | tail -n 20
  ```
- Quota errors:
  ```bash
  grep -n "RateLimitError" /root/.pm2/logs/voicebot-*.log | tail -n 20
  ```
- Stuck/finalization issues:
  ```bash
  grep -n "Skipping finalization" /root/.pm2/logs/voicebot-tgbot-out.log | tail -n 20
  grep -n "not fully processed" /root/.pm2/logs/voicebot-tgbot-out.log | tail -n 20
  ```
  
### Redis connectivity checks (prod)
- TCP reachability:
  ```bash
  nc -vz -w 3 <redis_host> <redis_port>
  ```
- PING using app deps (Node + ioredis from /srv/voicebot):
  ```bash
  NODE_PATH=/srv/voicebot/node_modules /root/.nvm/versions/node/v22.8.0/bin/node -e "const Redis=require('ioredis'); const r=new Redis({host:'<redis_host>',port:<redis_port>,username:'default',password:'<redis_password>',db:<redis_db>,connectTimeout:3000}); r.ping().then(x=>{console.log('PING',x);process.exit(0)}).catch(e=>{console.error('ERR',e);process.exit(1)});"
  ```

### Stuck categorization/postprocessing indicators
- Session-level:
  - `is_postprocessing: true` + `processors_data.CREATE_TASKS.is_processed: false` and `job_queued_timestamp` set.
  - If `job_queued_timestamp` is old and no progress, check Redis timeouts/locks first.
- Message-level:
  - `processors_data.categorization.is_processing: true` with old `job_queued_timestamp` indicates a stuck worker.

### Session-by-session processing lock diagnosis (quick)
1. Run:
   - `node cli/diagnostics/check_processing_staleness.js <sessionId> --minutes 10`
2. Interpret output:
   - `OK: no stale processing locks found` — processing state is within expected window.
   - Any list item means one message/processor pair has `is_processing = true` longer than the threshold.
   - `processor` in output is the processor key (`transcription`, `categorization`, etc.).
   - `age` is computed from the current time minus the lock timestamp (`job_queued_timestamp` for processor state, `transcribe_timestamp` for transcription).
3. If stale locks are present:
   - check corresponding session/queue logs and the message doc for retry reasons (`transcription_retry_reason`, `categorization_retry_reason`);
   - check that restart scripts are not blocked by quota/other global gates;
   - rerun processing loop diagnostics after clearing manual interventions.

### DB spot-check (optional)
- Connection string is in `/srv/voicebot/.env` (`DB_CONNECTION_STRING`).
- Example query (session status):
  ```bash
  cs=$(grep -m1 "^DB_CONNECTION_STRING=" /srv/voicebot/.env | cut -d= -f2-)
  mongosh "$cs" --quiet --eval "db=db.getSiblingDB('stratodb'); db.automation_voice_bot_sessions.findOne({_id:ObjectId('<session_id>')},{is_messages_processed:1,is_finalized:1,session_processors:1})"
  ```

## Landing the Plane (Session Completion)

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   bd sync
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds

<!-- BEGIN BEADS INTEGRATION -->
## Issue Tracking with bd (beads)

**IMPORTANT**: This project uses **bd (beads)** for ALL issue tracking. Do NOT use markdown TODOs, task lists, or comment-based checklists.

### Why bd?

- Dependency-aware: Track blockers and relationships between issues
- Git-friendly: Auto-syncs to JSONL for version control
- Agent-optimized: JSON output, ready work detection, discovered-from links
- Prevents duplicate tracking systems and confusion

### Quick Start

Issue IDs in this repo look like `voicebot-<hash>`.

**Check for ready work:**

```bash
bd ready --json
```

**Create new issues:**

```bash
bd create "Issue title" --description="Detailed context" --type task --priority 2 --json
bd create "Issue title" --description="Follow-up found while working" --type bug --priority 1 --deps discovered-from:<issue-id> --json
```

**Claim and update:**

```bash
bd update <issue-id> --status in_progress --json
bd update <issue-id> --priority 1 --json
```

**Complete work:**

```bash
bd close <issue-id> --reason "Completed" --json
```

### Issue Types

- `bug` - Something broken
- `feature` - New functionality
- `task` - Work item (tests, docs, refactoring)
- `epic` - Large feature with subtasks
- `chore` - Maintenance (dependencies, tooling)

### Priorities

- `0` - Critical (security, data loss, broken builds)
- `1` - High (major features, important bugs)
- `2` - Medium (default, nice-to-have)
- `3` - Low (polish, optimization)
- `4` - Backlog (future ideas)

### Workflow for AI Agents

1. **Check ready work**: `bd ready` shows unblocked issues
2. **Claim your task**: `bd update <id> --status in_progress`
3. **Work on it**: Implement, test, document
4. **Discover new work?** Create linked issue:
   - `bd create "Found bug" --description="Details about what was found" --priority 1 --deps discovered-from:<parent-id>`
5. **Complete**: `bd close <id> --reason "Done"`

### Auto-Sync

bd keeps `.beads/issues.jsonl` in sync with your local DB:

- Exports to `.beads/issues.jsonl` after changes (5s debounce)
- Imports from JSONL when newer (e.g., after `git pull`)

Notes:
- `bd sync` updates JSONL but does **not** commit/push.
- With hooks installed (`bd hooks install`), `pre-commit` exports and stages `.beads/*.jsonl` automatically.
- `bd doctor --fix` may set `skip-worktree` flags for `.beads/*.jsonl`, so they might not appear in `git status` until staged by the hook; that's expected.
- Git hooks won't push for you; you still need `git push`.

### Important Rules

- ✅ Use bd for ALL task tracking
- ✅ Always use `--json` flag for programmatic use
- ✅ Link discovered work with `discovered-from` dependencies
- ✅ Check `bd ready` before asking "what should I work on?"
- ❌ Do NOT create markdown TODO lists
- ❌ Do NOT use external issue trackers
- ❌ Do NOT duplicate tracking systems

For more details, see `.beads/README.md`, run `bd quickstart`, or use `bd --help`.

<!-- END BEADS INTEGRATION -->
