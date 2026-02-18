# voicebot

Node services and a React + Vite app for the voicebot pipeline and CRM.

## Structure
- Root entrypoints: `voicebot-backend.js`, `voicebot-tgbot.js`, `echo-tgbot.js`, `voicebot-queue-monitor.js`.
- `voicebot/`: processing pipeline (jobs, processors, prompts, postprocessing).
- `crm/`: Express API controllers and routes.
- `app/`: React + Vite UI (`app/src` for components, pages, store, hooks, assets).

## Recent updates
- 2026-02-17: Added strict runtime data isolation with `runtime_tag` across sessions/messages/active-session mapping, including worker/API guards for shared Mongo/Redis deployments and prod-safe legacy fallback for records without `runtime_tag`.
- 2026-02-17: Switched to strict explicit active-session routing across TG/Web/WebRTC (no default open-session fallback), added `/voicebot/active_session` + `/voicebot/activate_session`, added `/session` resolver page + session activation button, and hardened socket authz for `session_done`/mutating events with backend JWT-based performer resolution.
- 2026-02-17: Unified Telegram session event messages to a strict 4-line contract (`event`, `url`, `session-name`, `project-name`), moved `/login` to one-time `tg_auth` link issuance (independent of active session), and synced session-page controls to `New / Rec / Cut / Pause / Done` with state-driven status pictograms.
- 2026-02-17: Improved `/session/:id` UX by showing a dedicated message when a session cannot be loaded in the current runtime (`prod/dev mismatch`) instead of leaving an infinite loader.
- 2026-02-16: Added a stable public Telegram attachment route (`/voicebot/public_attachment/:session_id/:file_unique_id`) with optional `direct_uri` in `session_attachments`, plus regression/smoke coverage and API docs updates to support LLM/MCP consumers.
- 2026-02-15: Reduced OpenAI spend by skipping categorization for trivial short texts/commands; added model/env knobs (`VOICEBOT_CATEGORIZATION_MODEL`, `VOICEBOT_TASK_CREATION_MODEL`, short-text thresholds) and shortened prompts to cut input tokens.
- 2026-02-15: Added automatic recovery for quota-stalled transcription/categorization processing: quota-related failures now clear themselves after payment restore and resume from the existing retry loop without manual restarts.
- 2026-02-15: Implemented deterministic Telegram active-session management (`/start`/`/done`/`/session` + `/login`), added screenshot/document attachments ingestion + `Screenshort` tab (token-safe `/voicebot/message_attachment/*` proxy), and documented the full contract in `plan/session-managment.md`.
- 2026-02-14: Fixed audio uploader progress to show real byte-based progress for large web uploads; improved upload error hints; aligned edge Nginx upload limits to support the 600MB product cap.
- 2026-02-13: Polished transcription chunk UX (hover Copy/Edit/Delete above text, inline timeline labels), fixed duration/timing normalization (ffprobe + timeline service), added a duration backfill diagnostics script + Jest tests, and added WBS/Mermaid spec tracking artifacts under plan/.
- 2026-02-12: Locked product decisions for event-log/edit/rollback + diarization sequencing, fixed session-level transcript versioning semantics (session returns final effective transcript), and added the launch draft `plan/implementation-draft-v1.md`.
- 2026-02-12: Aligned planning specs to a minimal immutable transcription contract (`transcription_raw -> transcription`) and added the event-log/edit/rollback draft (`plan/edit-event-log-plan.md`) with segment-oriented event taxonomy.
- 2026-02-12: Added planning artifact `plan/edit-event-log-req.md` and documented close-session notes for the upcoming event-log/edit/rollback specification work.
- 2026-02-07: Added manual Summarize (∑) trigger (UI + API) to enqueue session_ready_to_summarize with PMO fallback; added Jest tests and API docs under docs/.
- 2026-02-07: Centered icons inside circle action buttons in the session header so the buttons align consistently.
- 2026-02-06: Added `session_ready_to_summarize` notify event and optional local hooks (`notifies.hooks.yaml`) to trigger background automation when a session is closed and has a project assigned (with hook start/spawn-error logging for troubleshooting).
- 2026-02-05: Web audio uploads now accept closed sessions (blocked only when `is_deleted=true`).
- 2026-02-04: `/voicebot/projects` now returns `board_id`, `drive_folder_id`, and `design_files` for project listings.

## Development
- Backend: `node voicebot-backend.js`
- Backend tests: `npm test`, `npm run test:voicebot`, `npm run test:voicebot:unit`
- Frontend: `cd app && npm run dev`

## Development & Debugging
- For web UI development and debugging, use `https://voice-dev.stratospace.fun`.
- Use `https://voice.stratospace.fun` only for production validation after dev is verified.
- Chrome remote debugging: see `../webrtc/docs/CHROME_DEVTOOLS.md`.
- The Vite dev server config suppresses common Firefox console noise (Bluebird unreachable eval and empty optimized-deps sourcemaps); see `app/vite.config.js`.

## Configuration
- Backend env: `.env.example`
- Frontend env:
  - Dev: `app/.env.development`
  - Tests: `app/.env.test`
  - Prod defaults (pinned for direct-IP access): `app/.env.production`
  - Prod overrides (on server, do not commit): `app/.env.production.local`

## Notify Hooks (Optional)
- The backend can POST notifications to an external webhook (see `.env.example`: `VOICE_BOT_NOTIFIES_URL`, `VOICE_BOT_NOTIFIES_BEARER_TOKEN`).
- Optionally, it can also run local hooks per event (detached spawn, fire-and-forget) via `VOICE_BOT_NOTIFY_HOOKS_CONFIG`:
  - Default: `./notifies.hooks.yaml` (set to empty string to disable).
  - Format: YAML mapping `event -> [{ cmd, args[] }, ...]`; the JSON event envelope is appended as the last CLI argument.
  - Recommendation: use an absolute `cmd` path (for example `/usr/local/bin/uv`) to avoid PATH differences under PM2/systemd.
  - The hook runner logs hook start and spawn failures in backend logs (hook stdout/stderr is ignored).

## Frontend runtime endpoints (window.backend_url / window.agents_api_url)
- Default: the built UI reads `VITE_API_URL` and `VITE_AGENTS_API_URL` into `window.backend_url` / `window.agents_api_url`.
- Override: when served from `*.stratospace.fun`, the UI forces:
  - `window.backend_url = ''` (same-origin)
  - `window.agents_api_url = window.location.origin + '/agents'`
  This avoids mixed content and keeps WSS working behind Nginx.

## UI Notes
- Sessions list includes a restart action for corrupted sessions (requires `VOICEBOT_SESSIONS.PROCESS`).
- Sessions list includes a "send to CRM" action that marks `show_in_crm` and triggers the `create_tasks` agent; results are saved in `agent_results.create_tasks` and can be re-triggered from CRM.
- Navigation includes a WebRTC call shortcut for quick access to recording controls.
- Core pages use responsive max-width containers to avoid overflow on MacBook-sized screens.
- Sessions created from the embedded WebRTC FAB auto-refresh the sessions list and can rely on the authenticated `user_id` when `chat_id` is unavailable.
- Session page actions now expose `New / Rec / Cut / Pause / Done` in the same order as FAB.
- Session status pictogram (left of action buttons) is now state-driven:
  - `recording` -> blinking red dot
  - `cutting` -> scissors glyph
  - `paused` -> pause bars
  - `final_uploading` -> green check
  - `closed` -> blue square
  - `ready` -> gray ring
  - `error` -> red exclamation
- Embedded mode (iframe): the app can run under `/embed/*` with a stripped layout; `VITE_EMBED_PARENT_ORIGINS` controls the allowed parent origins for postMessage sync.
- `/authorized` is a legacy entry path; it now redirects to `/login` to keep auth flows consistent.

## Operations
- Restart/requeue transcription for sessions: `node cli/restart-voicebot-sessions.js --help`
- If the sessions list is slow, ensure `automation_voice_bot_messages` has an index on `session_id` (see `AGENTS.md`).
## Diagnostics (CLI)
- Session + message snapshot: `node cli/diagnostics/check_session.js <sessionId> [--full]`
- Queue counters: `node cli/diagnostics/check_queue_counts.js`
- Postprocessor jobs: `node cli/diagnostics/check_postprocessors.js [sessionId]`
- Redis key scan: `node cli/diagnostics/scan_redis_keys.js <pattern>`
- Processing locks smoke-check: `node cli/diagnostics/check_processing_staleness.js [sessionId] [--minutes 10] [--json] [--metrics]`
  - For session triage: `node cli/diagnostics/check_processing_staleness.js <sessionId>`
  - `--json` outputs a structured payload and `--metrics` adds text metrics lines.
- Use `MONGO_DIRECT=true` when DNS to managed Mongo hosts is flaky.

## Deploy (prod)
- SSH to prod: `ssh root@176.124.201.53`
- Repo: `cd /srv/voicebot && git pull`
- PM2 (prod uses NVM; ensure Node/PM2 are in PATH): `export PATH=/root/.nvm/versions/node/v22.8.0/bin:$PATH && pm2 status`
- Frontend: rebuild `app/dist/` if you need fresh UI changes:
  ```bash
  cd /srv/voicebot/app
  # Optional: override build-time endpoints (useful for direct-IP access and quick swaps).
  # Note: when served from *.stratospace.fun, the UI forces same-origin + /agents anyway.
  cat > .env.production.local <<'EOF'
VITE_API_URL=http://176.124.201.53:8083
VITE_AGENTS_API_URL=http://176.124.201.53:3001
VITE_PROXY_URL=
VITE_PROXY_AUTH=
EOF
  npm ci
  npm run build
  ```
- If you see a Browserslist warning about `caniuse-lite` being outdated, update it (commit `app/package-lock.json`):
  ```bash
  cd /home/strato-space/voicebot/app
  npx update-browserslist-db@latest
  ```
- Restart services: `pm2 restart voicebot-backend voicebot-tgbot`
- If HTTPS shows Socket.IO errors, check edge Nginx (p2): `/etc/nginx/sites-enabled/voice.conf` must proxy `/socket.io/` to `176.124.201.53:8083`.

## Production Ops
- Production server: `176.124.201.53` (SSH as root).
- PM2 list (ensure Node in PATH): `export PATH=/root/.nvm/versions/node/v22.8.0/bin:$PATH && pm2 list`.
- Logs live in `/root/.pm2/logs/` (voicebot backend/tgbot + prompt-flow API).
- Common failures: OpenAI `RateLimitError: 429 (insufficient_quota)`, BullMQ lock issues, Redis eviction policy warnings/timeouts.
- Full runbook: `AGENTS.md`.

## Docs
- All guides and auxiliary docs live in `docs/`.
- Planning specs live under `plan/` when requested (example: `plan/gpt-4o-transcribe-diarize-plan.md`, which includes a data model snapshot, segment-level chunk mapping, and message-level transcription fields).
- Example session snapshot for schema reviews: `plan/session-697b75eabebd2e48576bc6ed.pretty.json`.
- Keep example session snapshots pretty-printed; avoid reformatting unless necessary.

## Logging
- Pending processor logs are aggregated and rate-limited; warnings are reserved for stuck processors.

## MCP
- Server endpoints and transports are defined in `agents/fastagent.config.yaml`.
- StratoSpace MCP endpoints use Streamable HTTP (`transport: "http"`).
- Agent services are defined as AgentCards in `agents/agent-cards/` and served via `fast-agent serve` (see `agents/pm2-agents.sh`).


## Auto-Reprocessing Behavior
- The repeat job `voicebot/common_jobs/processing_loop.js` scans sessions with `is_messages_processed=false` and enqueues processor jobs for each `session.processors` entry (queue: `voicebot--processors`).
- It automatically re-queues transcription when a message is still untranscribed and either `transcribe_timestamp` is stale (default 10 minutes) or `to_transcribe=true`.
- Sessions with `is_messages_processed=true` and `to_finalize=true` are finalized only when every `session_processors` entry has `processors_data.<name>.is_processed=true`; otherwise it logs `Skipping finalization. Not processed processors: ...` and waits for postprocessors (e.g., `CREATE_TASKS`).
- Quota-related OpenAI `429 (insufficient_quota)` is treated as retryable for transcription/categorization and is auto-unblocked after payment restore (with attempt counters + backoff).
- Non-quota transcription failures may still mark the session as corrupted and require a manual restart (`cli/restart-voicebot-sessions.js`) to requeue.
