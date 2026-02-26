# Changelog

## 2026-02-26
### PROBLEM SOLVED
- **12:22** In active recording sessions, Transcription tab could stay visually empty while chunks were already uploaded/queued, because rows without immediate text payload were filtered out from rendering.
- **12:22** Worker-side transcribe updates (success/error/retry) did not always trigger realtime `message_update`, so operators often needed manual refresh to see processing/error states.
- **12:22** Upload incident diagnostics lacked a stable correlation key between browser errors and backend logs, slowing down triage for `Failed to fetch` / transport issues.
- **12:22** Sessions list filters could show raw numeric identities (chat ids) in creator/participant dropdowns, and deleted sessions had no explicit opt-in list mode for operators.
- **12:22** Runtime accumulated stale empty sessions (no linked messages) with no autonomous cleanup path in TS workers.
- **12:39** Production deploy script was blocked by TypeScript compile errors introduced by strict type narrowing in voice/permission helper paths.

### FEATURE IMPLEMENTED
- **12:22** Added realtime-safe transcription visibility: frontend now renders pending/error/audio rows immediately, and worker transcribe flow emits `message_update` across success/failure branches.
- **12:22** Added upload correlation ids end-to-end (`request_id`): browser sends `X-Request-ID`, backend echoes/returns it in success and error payloads, and logs every upload stage with the same id.
- **12:22** Added worker-level empty-session cleanup pipeline: new `CLEANUP_EMPTY_SESSIONS` job + scheduler in TS runner with env-configurable interval/age/batch limits.
- **12:22** Added sessions list UX hardening: `include_deleted` fetch mode + `Показывать удаленные` toggle, and numeric placeholder suppression in creator/participant filters.
- **12:22** Added sessions list bulk delete flow for selected non-deleted rows with confirmation and clear result feedback.
- **12:39** Restored green backend build for deploy path by fixing strict TS typing regressions in voice routes/runtime integration contracts.
- **12:22** Added WebRTC monitor resilience UX: explicit chunk states (`local/uploading/uploaded/upload_failed`) and pending-upload snapshot hint after refresh.

### CHANGES
- **12:22** Voice frontend updates:
  - `app/src/components/voice/Transcription.tsx`, `app/src/components/voice/TranscriptionTableRow.tsx` (pending/error fallback rendering).
  - `app/src/pages/voice/SessionsListPage.tsx`, `app/src/store/voiceBotStore.ts` (`include_deleted` state/query support, numeric identity filtering, bulk delete for selected rows).
  - `app/public/webrtc/webrtc-voicebot-lib.js` (chunk state labels, upload `request_id`, backend-unavailable diagnostics, pending-upload snapshot restore hint).
- **12:22** Voice backend/runtime updates:
  - `backend/src/workers/voicebot/handlers/transcribe.ts` (safe `message_update` emit helper + branch coverage).
  - `backend/src/api/routes/voicebot/uploads.ts` (request-id resolver, structured upload stage logs, request-id in all responses).
  - `backend/src/services/voicebotSessionCleanupService.ts` (new), `backend/src/workers/voicebot/handlers/cleanupEmptySessions.ts` (new), `backend/src/workers/voicebot/{manifest.ts,runner.ts}`, `backend/src/constants.ts` (new cleanup job wiring/scheduler).
  - `backend/src/api/routes/voicebot/sessions.ts`, `backend/src/permissions/permission-manager.ts` (`include_deleted` filter contract for list endpoint and permission filter generation).
- **12:22** Type-safety/lint/config polish:
  - added `app/eslint.config.js`, `backend/eslint.config.js`;
  - narrow TS type cleanups in `backend/src/{services/db.ts,services/transcriptionTimeline.ts,api/socket.ts,api/routes/voicebot/{persons.ts,permissions.ts},voicebot_tgbot/{runtime.ts,commandHandlers.ts},miniapp/index.ts}` and `app/src/components/crm/finances/PaymentForm.tsx`.
- **12:22** Tests updated:
  - `backend/__tests__/voicebot/{workerTranscribeHandler,workerScaffoldHandlers,workerAncillaryHandlers}.test.ts`.
- **12:22** Added persisted attachment artifact for regression context:
  - `backend/uploads/voicebot/attachments/699ebd71eaf48b3aa41c2010/wa_63a675fb495defe0_mm31mc9s.png`.
- **12:39** TS compile compatibility fixes for deploy:
  - `backend/src/api/routes/voicebot/{permissions,sessions}.ts` (safe array typing + canonical transcription helper call signature).
  - `backend/src/{api/socket.ts,permissions/permission-manager.ts,services/{db,transcriptionTimeline}.ts,voicebot_tgbot/commandHandlers.ts}` (type contracts aligned with runtime signatures).

## 2026-02-25
### PROBLEM SOLVED
- **23:55** `session_ready_to_summarize` notify path in Copilot had two blockers: `actions@call` transport instability (`/notify` 502) and missing local hooks parity in TS worker runtime.
- **17:11** Voice runtime hardening shipped on `origin/main` for upload-outage handling, Telegram poller ownership, and transcription transport diagnostics, but this date block was missing from changelog history.
- **22:02** Voice sessions list state was not URL-persistent (filters, tab, pagination), and operators could not quickly reassign project directly from the table row.
- **22:02** Session close (`Done`) UX could stay stale until refresh, and post-close processing did not receive an immediate kick after successful done-flow completion.
- **22:02** CRM and Miniapp task payloads used mixed performer identifiers (`id`, `_id`, `ObjectId`), which could break performer resolution across create/update/filter paths.
- **22:02** CREATE_TASKS postprocessing could remain pending when categorization was incomplete without proactively requeueing missing categorization jobs.
- **22:02** Public session links in TG-related flows could still inherit legacy host/path variants, which made links inconsistent with the canonical Copilot Voice URL.

### FEATURE IMPLEMENTED
- **23:55** Restored notify transport reliability for Copilot voice: fixed `actions@call` launch command in `/home/tools/server/mcp/call.env`; `https://call-actions.stratospace.fun/notify` now returns `200`.
- **23:55** Implemented TS local notify hooks parity in `backend/src/workers/voicebot/handlers/notify.ts`:
  - supports `VOICE_BOT_NOTIFY_HOOKS_CONFIG` (YAML/JSON, default `./notifies.hooks.yaml`, empty string disables),
  - runs detached hooks with structured logs,
  - writes session-log events `notify_hook_started`, `notify_http_sent`, `notify_http_failed`.
- **17:11** Synced changelog coverage for already-landed runtime hardening on 2026-02-25 (upload outage shaping, tg poller lock, transcribe diagnostics).
- **22:02** Added URL-driven Sessions list UX in Voice (`tab`, filters, and pagination in query params), plus inline project reassignment and active-project option filtering.
- **22:02** Added optimistic/real-time done-state propagation: frontend store now reacts to `session_status=done_queued`, `finishSession` applies ack-driven state updates, socket handler emits immediate `session_update`, and done-flow enqueues a deduplicated `PROCESSING` kick.
- **22:02** Added robust performer normalization in CRM ticket create/update and identifier-compatible performer matching for Miniapp tasks.
- **22:02** Added automatic categorization requeue from CREATE_TASKS postprocessing when required categorization rows are pending.
- **22:02** Added deferred migration spec for immediate done notifications and routing-source move to Copilot DB (`plan/session-done-notify-routing-migration.md`, tracking: `copilot-1y3o`).

### CHANGES
- **23:55** Added notify hooks sample config: `backend/notifies.hooks.yaml` (StratoProject summarize command wiring).
- **23:55** Added env sample key in `backend/.env.example`: `VOICE_BOT_NOTIFY_HOOKS_CONFIG`.
- **23:55** Added regression tests:
  - `backend/__tests__/voicebot/notifyWorkerHooks.test.ts`
  - updated targeted notify/done route/worker suites and build checks.
- **23:55** Updated documentation:
  - `docs/VOICEBOT_API.md`
  - `docs/VOICEBOT_API_TESTS.md`
  - `backend/src/workers/README.md`
  - `plan/session-done-notify-routing-migration.md`
- **17:11** Documented 2026-02-25 committed history from `origin/main`:
  - `deploy/nginx-host.conf`, `app/public/webrtc/webrtc-voicebot-lib.js`
  - `backend/src/voicebot_tgbot/runtime.ts`, `backend/src/workers/voicebot/handlers/transcribe.ts`
  - tests/docs updates in `backend/__tests__/deploy/nginxUploadLimits.test.ts`, `backend/__tests__/voicebot/workerTranscribeHandler.test.ts`, `README.md`.
- **22:02** Voice frontend sessions UX updates:
  - `app/src/pages/voice/SessionsListPage.tsx` (query-param state, `Tabs` for `all/without_project`, filter persistence, inline project `Select`, navigation with preserved search string).
  - `app/src/index.css` (`.voice-project-select-popup` width override for grouped project selector).
  - `app/src/components/voice/MeetingCard.tsx` (session dialogue-tag edit control with localStorage-backed remembered tags).
  - `app/src/store/voiceBotStore.ts` (`session_status` listener for `done_queued`, `session_done` ack callback handling + immediate state projection).
  - `app/__tests__/voice/voiceSocketRealtimeContract.test.ts` contract assertions for done realtime/ack behavior.
- **22:02** Voice backend/session flow updates:
  - `backend/src/api/socket/voicebot.ts` now emits immediate `session_update` payload in `session_done` path.
  - `backend/src/services/voicebotSessionDoneFlow.ts` enqueues deduplicated common `PROCESSING` kick (`<session>-PROCESSING-KICK`) after done close.
  - `backend/src/workers/voicebot/handlers/createTasksPostprocessing.ts` requeues pending `CATEGORIZE` jobs before delayed CREATE_TASKS retry.
  - `backend/src/utils/audioUtils.ts` added `splitAudioFileByDuration(...)` helper via ffmpeg segmentation.
- **22:02** CRM/Miniapp/TG URL consistency updates:
  - `backend/src/api/routes/crm/tickets.ts` performer normalization (`id`/`_id`/lookup) on create and update.
  - `backend/src/miniapp/routes/index.ts` performer matching expanded for `performer.id`, raw `performer`, and `performer._id`.
  - `backend/src/api/routes/voicebot/sessions.ts` and `backend/src/voicebot_tgbot/sessionTelegramMessage.ts` switched to canonical `https://copilot.stratospace.fun/voice/session[/<id>]` base with legacy-host fallback guard.
  - `backend/src/voicebot_tgbot/commandHandlers.ts` now uses shared done-flow orchestration and canonical TG auth/session link origin handling.
  - `backend/.env.example` now declares `VOICE_WEB_INTERFACE_URL=https://copilot.stratospace.fun/voice/session/`.
- **22:02** Added/updated regression tests:
  - `backend/__tests__/voicebot/{sessionTelegramMessage,tgCommandHandlers,tgSessionRef,voicebotSocketDoneHandler,workerPostprocessingCreateTasksAudioMergingHandlers}.test.ts`.
- **22:02** Added planning artifact:
  - `plan/session-done-notify-routing-migration.md` (deferred spec for immediate done notify + routing source migration).

## 2026-02-24
### PROBLEM SOLVED
- **19:18** Voice transcription download from session page used an outdated frontend path (`/transcription/download/:id`), so markdown export could fail behind the current `/api/voicebot/*` routing contract.
- **19:18** Backend transcription runtime route had no dedicated `GET /transcription/download/:session_id` implementation in TS runtime, which limited parity for safe markdown export and explicit access checks.
- **19:18** OperOps Projects Tree still used split-pane inline editing, which reduced usable table width and made editing flow less predictable.
- **19:18** TypeDB ontology ingestion tooling for STR OpsPortal ERD work was not scaffolded in Copilot backend, so setup/ingest/validate steps were ad-hoc.
- **19:18** Local bd metadata after Dolt->SQLite rollback remained partially unsynced in repo files and claim command examples needed normalization.
- **19:48** Ontology artifacts stayed outside version control scope, so TypeDB schema and mapping changes could diverge from backend ingestion scripts in follow-up sessions.
- **22:01** Session `done` logic was duplicated inside socket handlers, which made maintenance flows harder to reuse and increased drift risk across queue/fallback branches.
- **22:01** Voice runtime had no dedicated automation path to close stale active sessions by real activity timestamps (session/message/session-log), leaving long-idle sessions open.
- **22:01** Investigating transcript state for session `69981f2e0dc0db172fdde208` required manual ad-hoc DB queries without a checked-in script.

### FEATURE IMPLEMENTED
- **19:18** Added TS transcription markdown download route with deterministic message ordering, strict access checks, and filename normalization, and aligned frontend store endpoint usage.
- **19:18** Added TypeDB helper toolchain in backend (`venv` setup + ingest/validate scripts + env samples + npm commands) for ontology ingestion workflows.
- **19:18** Refactored Projects Tree editing UX to modal-based flow with explicit save/close lifecycle handlers.
- **19:18** Synced `.beads` workspace config/metadata and committed rollback artifacts for reproducible local issue-tracker state.
- **19:48** Added tracked `ontology/typedb` package to Copilot repository so TypeDB model assets are versioned together with runtime ingestion code.
- **22:01** Extracted shared `completeSessionDoneFlow` orchestration and reused it in socket `session_done` handling for consistent close/update/log behavior.
- **22:01** Added idle-session auto-close maintenance script (`voicebot-close-inactive-sessions.ts`) with dry-run/apply, threshold/session filters, and JSON/JSONL output modes.
- **22:01** Added a focused diagnostics utility (`tmp-explain-69981f2e.ts`) for transcript/chunk inspection on a concrete session id.

### CHANGES
- **19:18** Voice transcription download path updates:
  - `app/src/store/voiceBotStore.ts` now calls `/voicebot/transcription/download/:session_id`.
  - `backend/src/api/routes/voicebot/transcription.ts` now exposes `GET /transcription/download/:session_id` with `getRawDb` read path, markdown builder, and access helper reuse.
  - `backend/__tests__/voicebot/transcriptionRuntimeRoute.test.ts` extended with download route coverage (success + invalid id).
- **19:18** Added TypeDB tooling:
  - `backend/requirements-typedb.txt`
  - `backend/scripts/run-typedb-python.sh`
  - `backend/scripts/typedb-ontology-ingest.py`
  - `backend/scripts/typedb-ontology-validate.py`
  - `backend/package.json` scripts `ontology:typedb:*`
  - `backend/.env.example` TypeDB variables block.
- **19:18** OperOps UI update:
  - `app/src/pages/operops/ProjectsTree.tsx` migrated from split-pane edit card to modal editor workflow.
- **19:18** Planning/docs and bd workspace sync:
  - `plan/str-opsportal-erd-draft-v0.md` adjusted domain assumptions (`tenant_scope` note instead of standalone `Tenant` row).
  - `AGENTS.md` + `README.md` updated with closeout notes and `bd update <id> --claim`.
  - `.beads/.gitignore`, `.beads/config.yaml`, `.beads/metadata.json`, `.beads/dolt-open-issues-*.{json,jsonl}` synchronized for current SQLite-backed bd state.
- **19:48** Added ontology assets:
  - `ontology/typedb/schema/str_opsportal_v1.tql`
  - `ontology/typedb/mappings/mongodb_to_typedb_v1.yaml`
  - `ontology/typedb/queries/validation_v1.tql`
  - `ontology/typedb/docs/rollout_plan_v1.md`
  - `ontology/typedb/README.md`
- **22:01** Refactored done-flow orchestration:
  - added `backend/src/services/voicebotSessionDoneFlow.ts` to centralize session close, queue/fallback dispatch, mapping cleanup, and notify log write.
  - updated `backend/src/api/socket/voicebot.ts` to call shared flow with socket-status emitter callback.
- **22:01** Added idle auto-close tooling:
  - added `backend/scripts/voicebot-close-inactive-sessions.ts` (activity scoring across session/message/session-log, `--inactive-hours`, `--session`, `--limit`, `--json`, `--jsonl`, `--apply`).
  - added `backend/package.json` scripts `voice:close-idle:dry` and `voice:close-idle:apply`.
  - updated `README.md` and `AGENTS.md` with operation notes for idle close script.
- **22:01** Added diagnostics script `backend/scripts/tmp-explain-69981f2e.ts` for one-session transcription/chunk state snapshots.

## 2026-02-22
### PROBLEM SOLVED
- **10:10** The STR OpsPortal analysis flow had no fixed, reproducible extraction protocol for deriving ERD candidates from narrative specs, which risked inconsistent entity/attribute/relationship modeling.
- **10:33** The project lacked a consolidated ERD draft that combines OpsPortal, OperOps, Voice, and FinOps domains into one reviewable model for MVP planning.

### FEATURE IMPLEMENTED
- **10:10** Added an FPF-based extraction protocol document that defines step-by-step normalization, catalog outputs, quality gates, and ERD projection rules for `STR-OpsPortal.md`.
- **10:33** Added an extended ERD draft document with cross-domain entity catalogs, relationship mapping, FinOps and OperOps/Voice extensions, and open design questions for next iteration.

### CHANGES
- **10:10** Added `plan/fpf-erd-extraction-protocol-str-opsportal.md` (protocol-first extraction playbook with templates for Entity/Attribute/Relationship catalogs, bridges, and ERD projection checks).
- **10:33** Added `plan/str-opsportal-erd-draft-v0.md` (conceptual ERD draft covering Tenant/Client/Project core, Voice/OperOps execution flow, FinOps data model extensions, and unresolved architecture decisions).
- **22:01** Updated session closeout summaries in `AGENTS.md` and `README.md` to include both new STR OpsPortal planning artifacts.

## 2026-02-21
### PROBLEM SOLVED
- **22:00** None.

### FEATURE IMPLEMENTED
- **22:00** Added a draft OSS platform research report for OperOps/FinOps/Guide/Voice stack selection, including architecture options and a 90-day execution roadmap.

### CHANGES
- **22:00** Added `plan/deep-research-oss-platforms-operops-finops.report.draft.md` (Russian-language draft covering candidate evaluation, architectural recommendations, and migration waves).

## 2026-02-20
### PROBLEM SOLVED
- **09:20** Session page in Copilot missed the `Возможные задачи` tab even after session postprocessing had produced `CREATE_TASKS.data`, forcing operators to leave the session UI to create tasks.
- **09:20** Non-text placeholders (`image` / `[Image]` / `[Screenshot]`) could block `CREATE_TASKS` postprocessing and keep sessions in `is_messages_processed=false` despite having nothing to categorize.
- **09:20** Finalization scan could starve newly closed sessions when old stuck sessions accumulated in `to_finalize=true` backlog.
- **09:20** Voice header metadata still rendered verbose labels (`Создано`, `Session ID`, `Участники`, `Доступ`) contrary to the compact value-only contract.
- **09:02** OperOps CRM task details link from the eye icon could resolve to `/operops/task/undefined` for rows without a public `id`, causing `404` on `/api/crm/tickets/get-by-id`.
- **09:02** CRM table filter by performer could miss valid rows because records mix `_id` and legacy `id` across ticket payloads and dictionary data.
- **09:02** Newly created/edited CRM tasks could show placeholder/malformed project labels in the table when only `project_id` was present and `project` name was not hydrated.
- **09:02** Ticket create/update diagnostics lacked normalized project/performer payload traces, slowing incident triage for CRM regressions.
- **06:35** Voice migration documentation drifted across three plan files: status legend usage and BD source-of-truth mapping were inconsistent, making rollout state ambiguous.
- **06:01** WebRTC full-track archive uploads generated redundant backend rows without downstream diarization consumption, creating avoidable duplicate payloads.
- **06:05** Migration docs still referenced open backlog and incomplete legacy-removal status after `copilot-vsen`/`copilot-ia38` were already completed.
- **05:18** Migration planning docs drifted from current `bd` execution state: open backlog and accepted decisions were not clearly reflected in one place.

### FEATURE IMPLEMENTED
- **09:20** Added session-level `Возможные задачи` tab in Copilot with task-triage table (`description` restored, no `status/project/AI` columns), validation highlights, and row-level AI metadata expander.
- **09:20** Hardened TS voice workers: categorization now marks non-text rows as processed (with realtime `message_update`), and `CREATE_TASKS` treats non-categorizable rows as ready while still marking session messages processed on empty/no-chunks paths.
- **09:20** Updated processing loop finalization strategy to prioritize newest sessions under backlog pressure via sorted wide-window scan.
- **09:20** Updated UI contract to value-only metadata row and synchronized Playwright/Jest expectations.
- **09:02** Added robust CRM task-link fallback and identifier normalization in Kanban so task details open by `id || _id` and project labels resolve from `project_data`/`project_id`/`project`.
- **09:02** Implemented performer filter compatibility layer in CRM Kanban to match rows reliably for mixed `_id`/`id` performer references.
- **09:02** Added structured CRM ticket normalization logs on `create` and `update` with before/after `project_id` and performer identifiers.
- **06:35** Performed deep BD-driven documentation sync for migration program/project/frontend plans with unified status legend `[v] / [x] / [~]`.
- **06:01** Disabled backend upload for `full_track` WebRTC segments while preserving Monitor visibility and metadata for future diarization rollout.
- **06:05** Completed full closeout of migration waves: legacy runtime removed, full test sweep closed, plan docs synced to current BD state.
- **05:18** Added a refreshed execution-oriented migration plan with explicit open backlog mapping (`copilot-vsen`, `copilot-ia38`) and accepted-decision section.

### CHANGES
- **09:20** Voice session page + task UI updates:
  - `app/src/pages/voice/SessionPage.tsx`: conditional `Возможные задачи` tab injection (requires `CREATE_TASKS.data` and `PROJECTS.UPDATE` permission).
  - `app/src/components/voice/PossibleTasks.tsx` (new): task triage table with required-field validation, search/filter controls, row selection, delete flow, and expandable AI metadata details.
  - `app/src/components/voice/MeetingCard.tsx`: compact value-only metadata row (labels removed).
- **09:20** Worker runtime behavior updates:
  - `backend/src/workers/voicebot/handlers/categorize.ts`: transcription text resolution now checks `transcription_text`, `text`, `transcription.text`, `transcription_raw.text`; non-text messages are marked processed with empty categorization and emitted via socket update.
  - `backend/src/workers/voicebot/handlers/createTasksPostprocessing.ts`: non-categorizable message-type allowlist for readiness and explicit `is_messages_processed=true` marking for empty/no-chunks/success paths.
  - `backend/src/workers/voicebot/handlers/processingLoop.ts`: finalize backlog scan widened and sorted by newest sessions (`updated_at`, `_id`).
- **09:20** Added/updated regression tests:
  - new `app/__tests__/voice/possibleTasksDesignContract.test.ts`;
  - new `app/__tests__/voice/sessionPagePossibleTasksTabContract.test.ts`;
  - updated `app/e2e/voice-fab-lifecycle.spec.ts`;
  - updated backend worker tests: `workerPostprocessingCreateTasksAudioMergingHandlers.test.ts`, `workerProcessingLoopHandler.test.ts`, `workerScaffoldHandlers.test.ts`.
- **09:02** Updated CRM Kanban render/filter/action behavior:
  - `app/src/components/crm/CRMKanban.tsx`: normalized project lookup (string/ObjectId-like values), display-name resolution for project tag/filter/sort, performer filter id-compatibility, and eye-link fallback to `_id`.
  - `app/src/components/crm/CommentsSidebar.tsx` and `app/src/components/crm/WorkHoursSidebar.tsx`: render project name via store resolver instead of raw stored identifier.
  - `app/src/store/kanbanStore.ts`: project resolver (`getProjectByIdentifier`) and ticket edit/create normalization paths for `project`/`project_id`/`project_data`.
- **09:02** Updated CRM ticket API normalization and diagnostics:
  - `backend/src/api/routes/crm/tickets.ts`: safe project conversion (`project` -> `project_id`) on update, guarded `ObjectId` conversion for `project_id`, and structured logs (`[crm.tickets.create]`, `[crm.tickets.update]`).
- **06:35** Deep-refreshed migration docs from closed BD tickets (`bd list --all`):
  - `docs/MERGING_PROJECTS_VOICEBOT_PLAN.md`: rebuilt as BD-driven execution plan with stream status matrix, updated final structure, and explicit `[x]` Playwright gaps.
  - `docs/PLAYWRIGHT_MIGRATION_MATRIX.md`: synchronized scenario mapping and status classification (`[v]` green e2e, `[~]` partial/manual, `[x]` not migrated).
  - `docs/MERGING_FRONTENDS_VOICEBOT.PLAN.md`: rewritten to frontend capability matrix linked to closed BD evidence and test artifacts.
- **06:35** Updated doc governance references:
  - `AGENTS.md`: pinned the three migration documents as primary execution artifacts and fixed legend/source-of-truth policy.
  - `README.md`: aligned Voice migration docs section with BD-driven workflow and legend contract.
- **06:01** Updated WebRTC FAB runtime policy (`copilot-hmkq`):
  - `app/public/webrtc/webrtc-voicebot-lib.js`: introduced `ARCHIVE_TRACK_UPLOAD_ENABLED=false`, skipped `uploadArchiveTrackSegments` by policy, disabled upload button on `full_track` rows, and hard-blocked manual upload for `trackKind=full_track`.
  - `app/__tests__/voice/webrtcDoneUploadPolicy.test.ts`: updated regression contract to assert policy-based full-track skip.
- **06:01** Copied planning references from external voicebot repo into copilot local plan folder:
  - added `plan/session-managment.md`;
  - added `plan/gpt-4o-transcribe-diarize-plan.md`.
- **06:05** Refreshed docs and migration status:
  - updated `README.md` and `AGENTS.md` with full-track upload policy and new `plan/*` references;
  - updated `docs/MERGING_FRONTENDS_VOICEBOT.PLAN.md` to rev.3, marked `copilot-vsen` and `copilot-ia38` as closed and removed stale “open backlog” wording;
  - adjusted `app/e2e/voice-fab-lifecycle.spec.ts` status-widget assertion to match current layout contract (functional marker-based check).
- **06:08** Finalized legacy runtime elimination (`copilot-vsen`) in the repo tree:
  - removed `voicebot_runtime/` subtree from Copilot;
  - kept migration source-of-truth references pointing to external `/home/strato-space/voicebot`;
  - moved custom prompt runtime artifacts into `backend/resources/voicebot/custom_prompts` and bound TS handlers to the new path.
- **05:18** Refreshed migration docs to current `bd` execution state (`copilot-xna2`):
  - updated `docs/MERGING_FRONTENDS_VOICEBOT.PLAN.md` with explicit open backlog (`copilot-vsen`, `copilot-ia38`);
  - moved section “decision points” to accepted decisions and aligned next-wave plan to active issues;
  - synced `README.md` migration docs section with current open backlog references.
- **05:11** Deep-refreshed `docs/MERGING_FRONTENDS_VOICEBOT.PLAN.md` into a BD-driven execution document:
  - replaced legacy Q/A draft structure with implementation status from closed `bd` tasks;
  - added direct references to key closed issues (`copilot-z9j*`, `copilot-zpb9`, `copilot-soys`, `copilot-ryl8`, `copilot-qeq0`, `copilot-ltof`, runtime isolation tasks);
  - added explicit contradiction section (`old plan assumptions` vs `implemented behavior`) for product-owner decisions.
- **05:11** Updated `README.md` Voice migration section:
  - marked `voicebot_runtime/` as deprecated in Copilot and scheduled for elimination (`copilot-vsen`);
  - added pointer to `docs/MERGING_FRONTENDS_VOICEBOT.PLAN.md` as current frontend migration decision log.

## 2026-02-19
### PROBLEM SOLVED
- **23:24** Historical Voice sessions accumulated duplicate WebRTC message rows for identical `*.webm` filenames (same session), producing repeated transcript/categorization blocks.
- **23:24** Session API returned message rows with `is_deleted=true`, so deduplicated/deleted records could still leak into UI timeline rendering.
- **22:01** Image-only uploads referenced by session pending anchors could appear as detached transcript blocks and duplicate standalone rows.
- **22:01** Oversized upload failures surfaced raw backend payload text with inconsistent diagnostics across `413`/`500` paths.
- **22:01** Browser unload races could persist stale WebRTC `recording` state, triggering incorrect auto-resume behavior after refresh.
- **22:01** TS processing loop could miss pending retries when sessions were already marked `is_messages_processed=true`, and categorization quota retries were not requeued automatically.
- **22:01** Voice FAB lifecycle parity lacked explicit regression guards for pause wait-state busy controls and temporary-session delete cleanup flow.
- **18:49** Voice realtime updates could drift after websocket reconnect because UI re-subscribed but did not force rehydrate current session state.
- **18:49** `message_update` events for not-yet-present rows could be dropped from UI state, causing out-of-order/live categorization gaps until manual refresh.
- **18:43** OpenAI key mask diagnostics still used mixed legacy formats (`sk-pro...XXXX`/raw prefix variants), complicating cross-runtime incident triage.
- **18:40** Screenshot cards showed internal `message_attachment` proxy paths in caption/footer, which made copy-paste sharing inconvenient and inconsistent with canonical public links.
- **18:36** Fast-Agent service on port `8722` was configured to bind `0.0.0.0`, exposing MCP HTTP endpoint on all interfaces unnecessarily.
- **18:36** Dev frontend MCP URL still pointed to `http://copilot-dev.stratospace.fun:8722`, which is incompatible with loopback-only hardening.
- **18:21** Deleting transcript segments in Copilot did not reliably remove matching categorization rows; punctuation/spacing variants could survive and still appear in Categorization UI.
- **18:21** Miniapp E2E command could pick up non-Playwright tests from mixed project tooling, causing unstable execution expectations for CI/local smoke runs.
- **14:04** Long-running voice sessions could stall processing when pending message scans were gated by strict `is_waiting=false`; rows with `is_waiting` absent were skipped and transcription/categorization stayed pending.
- **14:04** Re-uploaded chunks with identical binary payload could trigger redundant transcription runs and duplicate categorization queue pressure.
- **14:04** Operators could not switch chronological direction in Transcription/Categorization tables from the UI, and sort preference was not persisted between reloads.
- **01:39** Telegram `/start` in `copilot-voicebot-tgbot-prod` failed with Mongo update conflict (`Updating the path 'runtime_tag' would create a conflict`) during active-session upsert.

### FEATURE IMPLEMENTED
- **23:24** Added runtime-aware historical dedupe algorithm for non-Telegram WebRTC uploads: group by `(session_id, file_name)`, keep one relevant row (transcript/categorization priority), mark duplicates deleted with dedupe metadata.
- **23:24** Added maintenance script `backend/scripts/voicebot-dedupe-webm-filenames.ts` with `--apply`, `--session`, `--limit`, and dry-run support.
- **22:01** Implemented pending-image-anchor contract across upload and UI: first chunk now stores `image_anchor_message_id`, session pending markers clear on consume, and frontend groups anchor images with the next transcript block.
- **22:01** Added inline image attachment previews in transcription rows (segmented and fallback render paths) with click-through to source image URL.
- **22:01** Added structured multer limit handling for `/voicebot/upload_audio` (`file_too_large`, `max_size_bytes`, `max_size_mb`) and normalized WebRTC client-side upload errors.
- **22:01** Extended TS `processingLoop` with backlog-priority session scan, quota-aware categorization requeue, and runtime queue-map fallback when handler-local queues are absent.
- **22:01** Expanded Playwright FAB lifecycle coverage with pause busy-state semantics and session delete cleanup contract checks.
- **18:49** Added reconnect-safe voice session rehydration on socket reconnect and deterministic realtime message upsert/sort for `new_message` + `message_update`.
- **18:43** Normalized OpenAI key masking in both TS and legacy runtime transcription paths to a single canonical format: `sk-...LAST4`.
- **18:40** Screenshot card link rendering now prefers canonical `public_attachment` URLs (`direct_uri`), resolves them to absolute host URLs, and provides hover-only copy button.
- **18:36** Hardened agents runtime networking: `copilot-agent-services` now binds to `127.0.0.1` and docs/env defaults are aligned to loopback MCP URL.
- **18:21** Added server-side categorization cleanup on session read: stale categorization rows for deleted transcript segments are normalized (including loose punctuation/spacing matching) and persisted back to `processed_data`.
- **18:21** Added dedicated Miniapp Playwright config and scripts isolation so `npm run test:e2e` runs only Playwright tests (`--pass-with-no-tests` for empty suites).
- **14:04** Added deterministic voice-processing scheduler in TS workers: `runner` now registers periodic `PROCESSING` jobs and `processingLoop` scans sessions with `is_waiting: { $ne: true }`.
- **14:04** Added hash-based transcription reuse in TS transcribe worker: when a session already has a successful transcription for the same file hash (`file_hash`/`file_unique_id`/`hash_sha256`), worker reuses text/speaker metadata and skips duplicate OpenAI calls.
- **14:04** Added chronological sort toggle for Transcription/Categorization lists with explicit direction control (up/down icon) and client-side persistence in `sessionsUIStore`.
- **11:39** Fixed live categorization delivery path in Copilot voice UI:
  - frontend Voice socket now connects to Socket.IO namespace `/voicebot` (instead of root `/`), restoring valid `subscribe_on_session` behavior;
  - backend categorization handler now enqueues `message_update` websocket events for both success and failure updates, so Categorization tab refresh is not required.
- **11:40** Added backend Socket.IO cross-process room delivery support:
  - enabled `@socket.io/redis-adapter` in `backend/src/index.ts`;
  - socket events worker now returns room diagnostics (`room_size`, `no_room_subscribers`) to speed up runtime troubleshooting.
- **01:41** Hardened runtime-scoped upserts in TS backend:
  - `backend/src/voicebot_tgbot/activeSessionMapping.ts` now writes `runtime_tag` via `$setOnInsert` (not `$set`) for `setActiveVoiceSession` upserts.
  - `backend/src/services/db.ts` adds `patchRuntimeTagIntoSetOnInsert(...)` to avoid injecting `runtime_tag` into `$setOnInsert` when update already sets it in `$set`.
- **01:44** Added TypeScript voice worker runtime scaffold (`backend/src/workers/voicebot/{runner.ts,runtime.ts}`) plus npm scripts `dev:voicebot-workers` / `start:voicebot-workers` for separate worker process bring-up.
- **01:55** Added first TS parity wave for queue backlogs: handlers for `START_MULTIPROMPT`, `SEND_TO_SOCKET`, and `session_*` notify jobs (`backend/src/workers/voicebot/handlers/{startMultiprompt,sendToSocket,notify}.ts`) plus manifest bindings.
- **02:10** Fixed web upload transcription enqueue path: `backend/src/api/routes/voicebot/uploads.ts` now pushes `TRANSCRIBE` jobs to `VOICEBOT_QUEUES.VOICE` when queue map is available (`to_transcribe=false` in queued mode), and backend runtime now initializes shared VoiceBot queue map for API/socket handlers.
- **02:10** Updated BullMQ deduplication option from `{ key }` to `{ id }` across TS voice paths (`uploads`, `voicebot_tgbot/ingressHandlers`, `workers/processingLoop`) to match active BullMQ contract and avoid runtime enqueue failures.

- **03:42** Added TS handlers for `VOICEBOT_JOBS.voice.SUMMARIZE` and `VOICEBOT_JOBS.voice.QUESTIONS` with runtime-scoped message/session guards and processors_data persistence (`backend/src/workers/voicebot/handlers/{summarize,questions}.ts`).
- **03:43** Expanded TS worker manifest coverage for `SUMMARIZE`, `QUESTIONS`, and `CREATE_TASKS_FROM_CHUNKS` parity path (`backend/src/workers/voicebot/manifest.ts`).

- **09:09** Added TS runtime handler for `VOICEBOT_JOBS.voice.CUSTOM_PROMPT` (`backend/src/workers/voicebot/handlers/customPrompt.ts`) with prompt-file resolution (`VOICEBOT_CUSTOM_PROMPTS_DIR`), runtime-safe guards, and `processors_data.<processor_name>` persistence.
- **09:09** Updated worker manifest/runtime coverage for `CUSTOM_PROMPT` binding (`backend/src/workers/voicebot/manifest.ts`) and documented handler inventory in `backend/src/workers/README.md`.
- **09:17** Wired TS postprocessing handlers `ALL_CUSTOM_PROMPTS` and `ONE_CUSTOM_PROMPT` into worker manifest (`backend/src/workers/voicebot/manifest.ts`), completing runtime dispatch coverage for custom-prompt postprocessing chain.
- **09:22** Added TS postprocessing handlers for `CREATE_TASKS` and `AUDIO_MERGING`: `CREATE_TASKS` now runs through `createTasksPostprocessing` (categorization-ready gating + delayed requeue + notify emission), while `AUDIO_MERGING` has explicit controlled-skip behavior in TS runtime with telemetry.
- **10:16** Upgraded TS `DONE_MULTIPROMPT` worker parity: on session close it now queues postprocessing chain (`ALL_CUSTOM_PROMPTS`, `AUDIO_MERGING`, `CREATE_TASKS`) and `SESSION_DONE` notify job in addition to active-session cleanup and session-log write.

### CHANGES
- **23:24** Updated dedupe/runtime backend paths:
  - `backend/src/services/voicebotWebmDedup.ts`
  - `backend/scripts/voicebot-dedupe-webm-filenames.ts`
  - `backend/src/api/routes/voicebot/sessions.ts` (`is_deleted` filter for session message payload)
  - `backend/package.json` (new scripts `voice:dedupe:webm:dry|apply`)
  - `README.md`
- **22:01** Updated image-anchor linkage and transcript image rendering:
  - `app/src/store/voiceBotStore.ts`
  - `app/src/components/voice/TranscriptionTableRow.tsx`
  - `app/src/types/voice.ts`
  - `app/__tests__/voice/voiceImageAnchorGroupingContract.test.ts`
  - `app/__tests__/voice/transcriptionImagePreviewContract.test.ts`
- **22:01** Updated upload route/file-size diagnostics and WebRTC client error handling:
  - `backend/src/api/routes/voicebot/uploads.ts`
  - `app/public/webrtc/webrtc-voicebot-lib.js`
  - `backend/__tests__/voicebot/uploadAudioRoute.test.ts`
  - `backend/__tests__/voicebot/uploadAudioFileSizeLimitRoute.test.ts`
  - `app/__tests__/voice/webrtcUploadErrorHandling.test.ts`
  - `app/__tests__/voice/webrtcPausedRestoreContract.test.ts`
- **22:01** Updated worker retry behavior, lifecycle e2e coverage, and docs:
  - `backend/src/workers/voicebot/handlers/processingLoop.ts`
  - `backend/__tests__/voicebot/workerProcessingLoopHandler.test.ts`
  - `backend/__tests__/voicebot/workerScaffoldHandlers.test.ts`
  - `app/e2e/voice-fab-lifecycle.spec.ts`
  - `AGENTS.md`
  - `README.md`
- **18:49** Updated realtime socket state handling:
  - `app/src/store/voiceBotStore.ts`
  - `app/__tests__/voice/voiceSocketRealtimeContract.test.ts`
- **18:43** Updated key-mask format in transcription diagnostics:
  - `backend/src/workers/voicebot/handlers/transcribe.ts`
  - `voicebot_runtime/voicebot/voice_jobs/transcribe.js`
  - `backend/__tests__/voicebot/workerTranscribeHandler.test.ts`
  - `README.md`
- **18:40** Updated screenshot attachment UI:
  - `app/src/components/voice/Screenshort.tsx`
  - `app/__tests__/voice/screenshortAttachmentUrl.test.ts`
- **18:36** Updated agent networking and docs:
  - `agents/ecosystem.config.cjs` (`--host 127.0.0.1`)
  - `agents/pm2-agents.sh` (startup URL output)
  - `agents/README.md` (local run and security note)
  - `app/.env.development` (`VITE_AGENTS_API_URL=http://127.0.0.1:8722`)
  - `README.md`, `AGENTS.md` (loopback-only guidance)
- **18:21** Updated transcript/categorization cleanup and tests:
  - `backend/src/api/routes/voicebot/messageHelpers.ts`
  - `backend/src/api/routes/voicebot/sessions.ts`
  - `backend/__tests__/voicebot/messageHelpers.test.ts`
  - `backend/__tests__/voicebot/sessionsRuntimeCompatibilityRoute.test.ts`
  - `backend/__tests__/voicebot/uploadAudioRoute.test.ts`
- **18:21** Added Miniapp Playwright runtime config and script wiring:
  - `miniapp/playwright.config.ts`
  - `miniapp/package.json`
- **14:04** Updated voice UI sort contracts and persistence:
  - `app/src/components/voice/Transcription.tsx`
  - `app/src/components/voice/TranscriptionTableHeader.tsx`
  - `app/src/store/sessionsUIStore.ts`
- **14:04** Updated TS voice worker processing/transcription runtime:
  - `backend/src/workers/voicebot/handlers/processingLoop.ts`
  - `backend/src/workers/voicebot/handlers/transcribe.ts`
  - `backend/src/workers/voicebot/runner.ts`
- **14:04** Performed production data hygiene for legacy pending records: marked 7 stale rows as deleted in session `6996d9169bce3264e9851c1c` where relative `file_path` values could not be resolved on current runtime.
- Updated docs to reflect live websocket categorization contract and runtime ownership:
  - `README.md` (Voice notes),
  - `AGENTS.md` (VoiceBot product notes),
  - `backend/src/workers/README.md` (EVENTS queue ownership and sendToSocket behavior).
- Added regression test `backend/__tests__/voicebot/activeSessionMapping.test.ts`.
- Extended `backend/__tests__/services/dbAggregateRuntimeScope.test.ts` with upsert runtime-tag conflict coverage.
- Added worker-runner regression coverage `backend/__tests__/voicebot/workerRunner.test.ts` (manifest routing, explicit handler-not-found error, queue concurrency defaults).
- **02:09** Enabled `copilot-voicebot-workers-prod` in `scripts/pm2-voicebot-cutover.ecosystem.config.js` and restarted prod runtime (`copilot-backend-prod`, `copilot-voicebot-tgbot-prod`, `copilot-voicebot-workers-prod`).
- Added regression suite `backend/__tests__/voicebot/workerAncillaryHandlers.test.ts` and updated worker docs (`backend/src/workers/README.md`, `docs/MERGING_PROJECTS_VOICEBOT_PLAN.md`) for current manual-only runtime limits.
- **02:10** Requeued pending chunks for session `6995810a9bce3264e9851b87` on `voicebot--voice-prod-p2`; worker logs confirm successful `TRANSCRIBE` completion for all pending messages (pending=0).
- Live smoke confirmed via PM2 raw Telegram logs after restart:
  - `/help`, `/session`, `/login`, `/start`, `/done` processed by copilot runtime.
  - `/start` created session `69963fb37d45b98d3fbc0344`; `/done` closed it.

- **03:34** Fixed Voice toolbar cross-browser state drift in `app/src/components/voice/MeetingCard.tsx`: `New/Rec/Done` availability no longer depends on `VOICEBOT_AUTH_TOKEN` presence in localStorage and now follows FAB/session runtime state consistently.
- **03:35** Added Playwright regression `@unauth controls stay enabled on session page without local VOICEBOT token` to `app/e2e/voice-fab-lifecycle.spec.ts`; validated on both `chromium-unauth` and `firefox-unauth` against `https://copilot.stratospace.fun`.

- `cd backend && npm test -- --runInBand __tests__/voicebot/workerSummarizeQuestionsHandlers.test.ts __tests__/voicebot/workerCreateTasksFromChunksHandler.test.ts __tests__/voicebot/workerScaffoldHandlers.test.ts`
- `cd backend && npm run build`

- `cd backend && npm test -- --runInBand __tests__/voicebot/workerCustomPromptHandler.test.ts __tests__/voicebot/workerSummarizeQuestionsHandlers.test.ts __tests__/voicebot/workerScaffoldHandlers.test.ts`
- `cd backend && npm run build`

- Added regression suite `backend/__tests__/voicebot/workerPostprocessingCustomPromptsHandlers.test.ts` (queue handoff + final-processing enqueue path) and expanded manifest contract expectations in `backend/__tests__/voicebot/workerScaffoldHandlers.test.ts`.
- Added regression suite `backend/__tests__/voicebot/workerPostprocessingCreateTasksAudioMergingHandlers.test.ts` and updated worker docs (`backend/src/workers/README.md`, `docs/MERGING_PROJECTS_VOICEBOT_PLAN.md`) for postprocessing dispatch parity.
- Expanded done handler regression coverage in `backend/__tests__/voicebot/workerDoneMultipromptHandler.test.ts` to assert postprocessing/notify queue fan-out and session-not-found behavior under runtime-scoped filtering.

### TESTS
- **06:03** `cd backend && npm test -- --runInBand` → 61/61 passed.
- **06:03** `cd app && npm test` → 24/24 passed.
- **06:04** `cd miniapp && npm test` → 3/3 passed.
- **06:04** `cd app && PLAYWRIGHT_BASE_URL=https://copilot.stratospace.fun npm run test:e2e` → 53 passed, 4 skipped.
- **06:04** `cd miniapp && npm run test:e2e` → pass-with-no-tests (configured behavior).
- **06:07** `cd backend && npm test -- --runInBand` → 61/61 passed.
- **06:07** `cd app && npm test` → 24/24 passed.
- **06:07** `cd backend && npm run build` → passed.
- **06:08** `cd app && npm run build` → passed.
- **23:25** `cd backend && npm test -- --runInBand __tests__/voicebot/webmFilenameDedupe.test.ts __tests__/voicebot/sessionUtilityRoutes.test.ts`
- **23:25** `cd backend && npm run build`
- **22:02** `cd app && npm test -- --runInBand __tests__/voice/transcriptionImagePreviewContract.test.ts __tests__/voice/voiceImageAnchorGroupingContract.test.ts __tests__/voice/webrtcPausedRestoreContract.test.ts __tests__/voice/webrtcUploadErrorHandling.test.ts`
- **22:02** `cd backend && npm test -- --runInBand __tests__/voicebot/uploadAudioRoute.test.ts __tests__/voicebot/uploadAudioFileSizeLimitRoute.test.ts __tests__/voicebot/workerProcessingLoopHandler.test.ts __tests__/voicebot/workerScaffoldHandlers.test.ts`
- **22:03** `cd backend && npm run build`
- **22:03** `cd app && npm run build`
- **22:04** `cd app && PLAYWRIGHT_BASE_URL=https://copilot.stratospace.fun npm run test:e2e -- e2e/voice-fab-lifecycle.spec.ts --project=chromium-unauth --workers=1`
- **18:49** `cd app && npm test -- --runInBand __tests__/voice/voiceSocketRealtimeContract.test.ts __tests__/voice/screenshortAttachmentUrl.test.ts __tests__/voice/transcriptionTimelineLabel.test.ts`
- **18:49** `cd app && npm run build`
- **18:40** `cd app && npm test -- --runInBand __tests__/voice/screenshortAttachmentUrl.test.ts __tests__/voice/transcriptionTimelineLabel.test.ts`
- **18:40** `cd app && npm run build`
- **18:21** `cd backend && npm test -- --runInBand __tests__/voicebot/messageHelpers.test.ts __tests__/voicebot/sessionsRuntimeCompatibilityRoute.test.ts __tests__/voicebot/uploadAudioRoute.test.ts __tests__/voicebot/publicAttachmentRoute.test.ts __tests__/smoke/voicebotAttachmentSmoke.test.ts __tests__/voicebot/workerTranscribeHandler.test.ts`
- **18:21** `cd app && npm test -- --runInBand __tests__/voice/transcriptionTimelineLabel.test.ts`
- **18:21** `cd miniapp && npm run test:e2e`
- **18:21** `cd backend && npm run build`
- **18:21** `cd app && npm run build`
- **14:04** `cd backend && npm test -- --runInBand __tests__/voicebot/workerProcessingLoopHandler.test.ts __tests__/voicebot/workerTranscribeHandler.test.ts __tests__/voicebot/workerRunner.test.ts`
- **14:04** `cd backend && npm run build`
- **14:04** `cd app && npm run build`
- `cd backend && npm test -- --runInBand __tests__/voicebot/workerCategorizeHandler.test.ts __tests__/voicebot/voicebotSocketEventsWorker.test.ts`
- `cd backend && npm run build`
- `cd app && npm run build`
- `cd backend && npm test -- --runInBand __tests__/services/dbAggregateRuntimeScope.test.ts __tests__/voicebot/activeSessionMapping.test.ts __tests__/voicebot/tgCommandHandlers.test.ts`
- `cd backend && npm run build`

- `cd app && PLAYWRIGHT_BASE_URL=https://copilot.stratospace.fun npm run test:e2e -- e2e/voice.spec.ts e2e/voice-log.spec.ts --project=chromium-unauth --workers=1`

- `cd backend && npm test -- --runInBand __tests__/voicebot/workerAncillaryHandlers.test.ts __tests__/voicebot/workerRunner.test.ts __tests__/voicebot/tgCommandHandlers.test.ts __tests__/voicebot/workerScaffoldHandlers.test.ts`
- `cd backend && npm test -- --runInBand __tests__/voicebot/uploadAudioRoute.test.ts __tests__/voicebot/tgIngressHandlers.test.ts __tests__/voicebot/workerProcessingLoopHandler.test.ts`
- `cd backend && npm test -- --runInBand __tests__/voicebot/workerPostprocessingCustomPromptsHandlers.test.ts __tests__/voicebot/workerScaffoldHandlers.test.ts`
- `cd backend && npm run build`
- `cd backend && npm test -- --runInBand __tests__/voicebot/workerPostprocessingCreateTasksAudioMergingHandlers.test.ts __tests__/voicebot/workerPostprocessingCustomPromptsHandlers.test.ts __tests__/voicebot/workerScaffoldHandlers.test.ts`
- `cd backend && npm run build`
- `cd backend && npm test -- --runInBand __tests__/voicebot/workerDoneMultipromptHandler.test.ts __tests__/voicebot/workerScaffoldHandlers.test.ts`
- `cd backend && npm run build`

## 2026-02-18
### PROBLEM SOLVED
- **11:02** Session `69953b9207290561f6e9c96a` accepted new WebRTC chunks but transcription stayed empty because `copilot-voicebot-tgbot-prod` inherited a stale OpenAI key from process env, producing `insufficient_quota` retries.
- **11:03** New chunk rows could appear late on `/voice/session/:id` because upload completed in DB first and UI waited for polling instead of immediate socket push.
- **11:08** Prod runtime filtering treated only exact `runtime_tag=prod`, so `prod-*` session family visibility and access were inconsistent between pages.
- **11:09** MCP agent URL in production UI could be missing in built envs, triggering `Не настроен MCP URL агента` when requesting AI title.
- **11:10** Passive WebRTC monitor restore could request microphone permission immediately on page load in Copilot voice UI.
- **11:40** `Done` flow could repeatedly auto-retry previously failed uploads, especially full-track chunks, making recovery ambiguous.
- **13:52** Runtime-scoped aggregate pipelines could still pull cross-runtime rows through `$lookup` joins, creating hidden data-leak vectors in composed reporting/session queries.
- **13:53** Quota/file errors in transcription did not include key-source/server diagnostics, slowing root-cause analysis when multiple runtimes used different env files.
- **14:08** Session toolbar state icon parity and FAB-sync semantics still lacked explicit regression tests in Copilot, leaving room for unnoticed UI contract drift.
- **14:10** Playwright migration task for controller-level voice flows remained open because `trigger_session_ready_to_summarize` had no dedicated e2e coverage entry.

### FEATURE IMPLEMENTED
- **11:03** Hardened Voice runtime bootstrap: `voicebot_runtime/voicebot-tgbot.js` now loads dotenv via explicit path/override (`DOTENV_CONFIG_PATH`, `DOTENV_CONFIG_OVERRIDE`) so cutover runtime always applies `voicebot_runtime/.env.prod-cutover` values.
- **11:03** Added deterministic PM2 cutover env wiring in `scripts/pm2-voicebot-cutover.ecosystem.config.js` to pass dotenv path/override for `copilot-voicebot-tgbot-prod`.
- **11:05** Added socket-delivery regression coverage for upload flow (`backend/__tests__/voicebot/uploadAudioRoute.test.ts`): verifies `new_message` + `session_update` are emitted to `voicebot:session:<id>`.
- **11:08** Implemented prod-family runtime model (`prod`, `prod-*`) in backend/runtime scope utilities and session/message queries.
- **11:09** Added MCP URL fallback chain for frontend voice flows (`window.agents_api_url` -> `VITE_AGENTS_API_URL` -> `http://127.0.0.1:8722`) and aligned tool call to `generate_session_title`.
- **11:10** Added passive mic-permission gate in WebRTC boot flow to skip monitor restore until microphone permission is already granted.
- **11:40** Added one-pass upload policy for pending chunks in `Done`: after one automatic pass, failed chunks enter manual retry state (`pending-manual`) with explicit controls.
- **11:40** Added full-track archive tracking in WebRTC (new metadata + naming + UI marker `· full-track`, with metadata `trackKind: 'full_track'`).
- **11:40** Relaxed task creation validation in voicebot runtime task UI by removing hard requirement for `task_type_id` in `TasksTable` and ticket preview modal.
- **13:53** Added runtime-aware aggregate lookup scoping and dedicated coverage to keep runtime isolation intact beyond top-level collection filters.
- **13:54** Added explicit socket-auth unit coverage for `session_done` authorization path via exported `resolveAuthorizedSessionForSocket` helper.
- **13:54** Extended transcription error context with masked OpenAI key source + env file + runtime server identity for fast production diagnostics.
- **14:08** Added dedicated MeetingCard contract tests for state-badge mapping, control order, and active-session sync wiring (`localStorage` + event channel).
- **14:10** Extended Playwright voice-log coverage with ready-to-summarize API trigger scenario and refreshed migration matrix status.

### CHANGES
- **11:03** Extended backend socket integration in upload pipeline (`backend/src/api/routes/voicebot/uploads.ts`, `backend/src/api/socket/voicebot.ts`, `backend/src/index.ts`) to emit session-scoped updates immediately after insert/update.
- **11:04** Updated runtime docs (`README.md`, `AGENTS.md`) with production cutover constraints for voice workers and real-time upload events.
- **11:06** Executed production recovery for stuck session `69953b9207290561f6e9c96a`: cleared transcription error flags, requeued untranscribed messages on `voicebot--voice-prod-p2`, and confirmed session returned to processed state.
- **11:08** Updated runtime constants/filters in backend and legacy runtime (`backend/src/services/runtimeScope.ts`, `backend/src/constants.ts`, `backend/src/services/db.ts`, `voicebot_runtime/constants.js`, `voicebot_runtime/services/runtimeScope.js`) to derive `runtime_tag` as `<prod|dev>-<server>` and apply family-safe queue/filter logic.
- **11:09** Updated voice session APIs/controllers for prod-family compatibility and upload tagging (`backend/src/api/routes/voicebot/sessions.ts`, `backend/src/api/routes/voicebot/messageHelpers.ts`, `backend/src/api/routes/voicebot/uploads.ts`, `voicebot_runtime/crm/controllers/voicebot.js`).
- **11:09** Updated frontend + runtime MCP integration (`app/.env.production`, `app/src/store/voiceBotStore.ts`, `app/src/store/sessionsUIStore.ts`, `app/src/pages/operops/CRMPage.tsx`, `voicebot_runtime/app/src/store/sessionsUI.js`, `voicebot_runtime/services/setupMCPProxy.js`, `agents/agent-cards/generate_session_title_send.md`).
- **11:10** Updated Google Sheet export runtime branching (`voicebot_runtime/voicebot/common_jobs/save_to_google_sheet.js`) and documented frontend-agent integration in `docs/MERGING_FRONTENDS_VOICEBOT.PLAN.md`.
- **11:40** Updated `app/public/webrtc/webrtc-voicebot-lib.js`:
  - `waitForAllPendingUploads` now uses bounded wait/timeout, returns structured status, and marks per-item `autoUploadAttempted`.
  - `uploadArchiveTrackSegments` now skips previously auto-attempted full-track segments and supports one manual retry cycle.
  - `buildArchiveSegmentFileName`/`ensureArchiveSegmentListItem` added for full-track chunk labeling and metadata storage (sessionId, mic, start/end, duration).
- **11:40** Added regression test `app/__tests__/voice/webrtcDoneUploadPolicy.test.ts` for one-shot auto-upload policy and full-track separation.
- **11:40** Updated task validation in `voicebot_runtime/app/src/components/voicebot/TasksTable.jsx` and `voicebot_runtime/app/src/components/voicebot/TicketsPreviewModal.jsx` so missing task type no longer blocks ticket creation.
- **13:53** Updated runtime scope internals to support expression-based filtering (`buildRuntimeFilterExpression`) and aggregate `$lookup` auto-scoping (`backend/src/services/runtimeScope.ts`, `backend/src/services/db.ts`).
- **13:54** Added/updated regression tests for aggregate runtime scope and socket/session authz (`backend/__tests__/services/dbAggregateRuntimeScope.test.ts`, `backend/__tests__/voicebot/voicebotSocketAuth.test.ts`, `backend/__tests__/voicebot/tgCommandHandlers.test.ts`, `backend/__tests__/voicebot/messageHelpers.test.ts`, `backend/__tests__/voicebot/uploadAudioRoute.test.ts`).
- **13:55** Updated engineering docs for runtime diagnostics and socket/runtime scoping expectations (`README.md`, `AGENTS.md`, `docs/MERGING_PROJECTS_VOICEBOT_PLAN.md`).
- **13:55** Extended E2E selectors for transcript edit/delete dialogs in log workflows to match current AntD combobox behavior (`app/e2e/voice-log.spec.ts`).
- **13:55** Added transcription diagnostic payload in runtime job errors (`voicebot_runtime/voicebot/voice_jobs/transcribe.js`): `server_name`, `openai_key_source`, `openai_key_mask`, `openai_api_key_env_file`, `file_path`, `error_code`.
- **13:59** Closed changelog-gap verification tasks `copilot-sm0` and `copilot-orh` with explicit test evidence for Telegram 4-line output and `/login` one-time `tg_auth` behavior (active-session independent).
- **14:00** Closed changelog-gap verification tasks `copilot-ueu` and `copilot-szo` with Playwright evidence for runtime-mismatch error screen and page/FAB lifecycle control parity (`New/Rec/Cut/Pause/Done`).
- **14:01** Closed changelog-gap verification tasks `copilot-ajg` and `copilot-qkd` with backend route-contract evidence for active-session Web API/UI controls and session lifecycle parity.
- **14:10** Closed a 5-iteration verification wave (10 tasks): `copilot-ris`, `copilot-3tx`, `copilot-2mo`, `copilot-yud`, `copilot-e2o`, `copilot-r75`, `copilot-amj`, `copilot-1he`, `copilot-9x8`, `copilot-602`.
- **14:10** Updated docs to capture completed migration evidence: `docs/MERGING_PROJECTS_VOICEBOT_PLAN.md`, `docs/PLAYWRIGHT_MIGRATION_MATRIX.md`, and `README.md` voice toolbar/state contract notes.
- **15:06** Added voice session fetch diagnostics parity in `app/src/store/voiceBotStore.ts`: structured error logging now includes endpoint/target/status/runtimeMismatch/response payload for faster 404 runtime-mismatch triage.
- **15:07** Closed changelog-gap verification tasks `copilot-6jv` and `copilot-f4f` with explicit `/login` one-time semantics and SessionPage 404-vs-generic UX coverage; updated migration plan evidence (`docs/MERGING_PROJECTS_VOICEBOT_PLAN.md`).
- **15:24** Exposed public attachment endpoints before auth middleware in `backend/src/api/routes/voicebot/index.ts` (`/public_attachment/:session_id/:file_unique_id` and legacy `/uploads/public_attachment/...`) to preserve external processor access while keeping other voice routes protected.
- **15:25** Added session attachment contract parity coverage for simultaneous `uri` (legacy protected path) and `direct_uri` (stable public path) in `backend/__tests__/voicebot/sessionsRuntimeCompatibilityRoute.test.ts`.
- **15:27** Closed changelog-gap verification tasks `copilot-dmw`, `copilot-jte`, `copilot-csk`, `copilot-9gj` after public attachment auth-bypass parity and `session_attachments` dual-link contract checks.
- **15:34** Closed changelog-gap verification tasks `copilot-yup` and `copilot-aqt` after confirming Screenshort `direct_uri` rendering fallback contract and backend public attachment route registration parity.
- **15:36** Closed changelog-gap verification tasks `copilot-0da` and `copilot-97q` after auth-gate parity validation for unauth `/voicebot/public_attachment/*` and direct_uri-safe frontend normalization checks.
- **15:41** Closed changelog-gap verification tasks `copilot-n5l` and `copilot-dep` after confirming public attachment docs/test parity and deterministic TG active-session handoff semantics (`/start`/`/session`/`/done`).
- **15:46** Closed changelog-gap verification tasks `copilot-wca` and `copilot-gvq` after validating strict session selection behavior for TG routing and command discoverability (`/help` + `/login`).
- **15:49** Closed changelog-gap verification tasks `copilot-g4v` and `copilot-xqt` after validating token-safe attachment UI links and canonical `/session`/`/login` response formatting with public URLs.
- **15:52** Closed changelog-gap verification tasks `copilot-8qn` and `copilot-3y0` after validating TG session lifecycle documentation parity and explicit `/start` `/session` `/done` `/login` operator contract.
- **15:55** Closed changelog-gap verification tasks `copilot-328` and `copilot-wxa` after validating session attachments end-to-end contract and Screenshort UI parity.
- **16:00** Closed changelog-gap verification tasks `copilot-xhb` and `copilot-emo` after adding smoke coverage for Telegram attachment proxy flow and validating normalized TG command/event responses with public host URLs.
- **16:08** Closed changelog-gap verification tasks `copilot-2nj` and `copilot-mwg` after adding runtime unit coverage for quota-stall recovery and Redis enqueue-failure rollback (`voicebot_runtime`).
- **16:17** Closed changelog-gap verification tasks `copilot-l20` and `copilot-0g1` after validating Redis cleanup safety rails (history-only + trimEvents) and categorization cost controls (skip trivial commands/short texts).
- **16:27** Closed changelog-gap verification tasks `copilot-7vb` and `copilot-6lv` after validating attachment-aware LLM context blocks and processing_loop quota auto-recovery behaviors.
- **16:41** Closed changelog-gap verification tasks `copilot-e7y` and `copilot-6ym` after validating retry/backoff gating (`*_next_attempt_at` + max attempts) and BullMQ bounded retention + enqueue rollback under Redis OOM/noeviction (voicebot_runtime tests).
- **16:58** Closed changelog-gap verification tasks `copilot-st8` and `copilot-6of` after validating Redis protection rails (history-only cleanup + trimEvents + REDIS_USERNAME support) and LLM cost controls (VOICEBOT_*_MODEL env knobs + model_not_found fallback) in voicebot_runtime.
- **17:06** Closed changelog-gap verification tasks `copilot-5b2` and `copilot-g7i` after adding a spec smoke test to guard `voicebot_runtime/plan/session-managment.md` command semantics and WebRTC FAB/page lifecycle contract.
- **17:23** Closed changelog-gap verification tasks `copilot-w8b` and `copilot-9xw` after validating attachment persistence + message_attachment proxy contract and Screenshort tab wiring via backend/app tests.
- **17:41** Closed changelog-gap verification tasks `copilot-irv` and `copilot-0vc` after re-validating TG formatter/session-resolution behavior and retry hard-stop gating via backend + voicebot_runtime unit tests.
- **17:56** Closed changelog-gap verification tasks `copilot-4bp` and `copilot-5qu` after validating BullMQ retention/enqueue rollback and RedisMonitor emergency cleanup rails via voicebot_runtime unit tests.
- **18:12** Closed changelog-gap verification tasks `copilot-aaa` and `copilot-3em` after adding voicebot_runtime tests for prompt-length cost rails and doc smoke checks for cost-control env knobs/auto-reprocessing.
- **18:41** Closed changelog-gap verification tasks `copilot-b6w` and `copilot-qkq` after implementing byte-level upload progress in Copilot voice UI and aligning nginx upload limits/timeouts for 600MB uploads (with tests).
- **18:56** Closed changelog-gap verification tasks `copilot-v0b` and `copilot-3u9` after confirming byte-level upload progress UI and removing forced multipart Content-Type for axios uploads (test-backed).
- **19:18** Closed changelog-gap verification tasks `copilot-4jr` and `copilot-fo9` after adding upload error-hint parity (413/network/timeout) and doc smoke coverage for duration backfill/ffprobe notes.
- **19:46** Closed changelog-gap verification tasks `copilot-bs3` and `copilot-baj` after validating close-only done handler behavior and nginx upload limit/timeouts parity via tests.
- **20:08** Closed changelog-gap verification tasks `copilot-ddl` and `copilot-dwl` after porting TranscriptionTableRow hover actions (Copy/Edit/Delete) and removing standalone Time column from header (test-backed).
- **20:42** Closed changelog-gap verification tasks `copilot-mub` and `copilot-bix` after porting timeline labels (HH:mm, mm:ss - mm:ss) into Copilot Transcription UI and confirming transcriptionTimeline normalization coverage via unit tests.
- **21:06** Closed changelog-gap verification tasks `copilot-kqt` and `copilot-s8z` after adding a CLI smoke test for recalc_session_duration and re-running unit coverage for timeline normalization + session-close behavior.
- **22:52** Closed changelog-gap verification tasks `copilot-dw8` and `copilot-ot2` with test evidence for duration/timeline parity and operator edit/delete segment UI actions (tests: `backend/__tests__/voicebot/audioUtils.test.ts`, `voicebot_runtime/__tests__/services/transcriptionTimeline.test.js`, `app/__tests__/voice/transcriptionRowActions.test.ts`).
- **22:52** Updated migration evidence notes in `docs/MERGING_PROJECTS_VOICEBOT_PLAN.md`.
- **22:57** Closed changelog-gap verification tasks `copilot-9qu` and `copilot-7v2` with evidence for 4-line done/notify Telegram output and session control/state-marker parity (source `Rec/Activate/Done` treated as superseded by current `New/Rec/Cut/Pause/Done` contract).
- **22:56** Closed changelog-gap verification tasks `copilot-nrv` and `copilot-zhd` with evidence for quota-retry recovery semantics (`insufficient_quota` stays retryable) and runtime isolation across shared Mongo/Redis (including aggregate lookup scoping + prod-family compatibility).
- **22:58** Closed tracking tasks `copilot-fko` and `copilot-7bm`: finalized Playwright migration matrix (`voicebot/webrtc -> copilot`) and completed 1:1 changelog verification registration (133 `voicebot-changelog-gap` tasks).
- **23:03** Fixed strict TS build regressions in voice UI/store: `TranscriptionTableRow` now uses exact-optional-safe payload/timeline typing, and `uploadAudioFile` now wires `onUploadProgress` via conditional `AxiosRequestConfig` assignment (no implicit undefined config fields).
- **23:03** Updated `app/__tests__/voice/audioUploadProgress.test.ts` for the new progress wiring contract (`requestConfig.onUploadProgress` assignment).
- **23:03** Closed bug `copilot-ad4` after runtime recovery verification for session `69953b9207290561f6e9c96a` (`is_messages_processed=true`, `transcribed=21/21`, no transcription errors).
- **23:03** Closed changelog-gap verification tasks `copilot-d9l` and `copilot-g44` as non-functional version-bump bookkeeping (copilot keeps independent app semver).
- **23:12** Closed changelog-gap verification tasks `copilot-t85`, `copilot-2tr`, `copilot-6av` with doc-smoke evidence for synced event-log and diarization planning artifacts in `docs/voicebot-plan-sync/*` (including immutable `transcription_raw -> transcription` contract).
- **23:13** Closed changelog-gap verification tasks `copilot-be3` and `copilot-8zy`: synced planning specs (`gpt-4o-transcribe-diarize-plan`, `edit-event-log-plan`) are tracked as docs-only with no runtime/API regressions.
- **23:15** Closed changelog-gap verification tasks `copilot-b24` and `copilot-89c`: validated inline/hover transcript editing UX plus optional `reason` contract on session-log action endpoints (frontend + backend parity).
- **23:17** Closed changelog-gap verification tasks `copilot-io6` and `copilot-3vx` with e2e evidence for Transcription/Log tabs, segment edit-delete wiring, and rollback/resend/retry session-log actions.
- **23:19** Closed changelog-gap verification tasks `copilot-pim` and `copilot-8h6` with backend/e2e evidence for session-log storage/action endpoints (edit/delete/rollback/retry/resend) and replay-friendly metadata contract.
- **23:24** Closed changelog-gap verification tasks `copilot-a9z`, `copilot-97r`, `copilot-jzk` with backend+e2e evidence for manual summarize trigger (`POST /voicebot/trigger_session_ready_to_summarize`), PMO fallback assignment, and session_ready_to_summarize notify metadata path.
- **23:26** Closed changelog-gap verification tasks `copilot-itr` and `copilot-tdt` after updating `AGENTS.md`/`README.md` planning references (implementation draft + transcript-versioning specs) and documenting close-session outcomes in the core docs set.
- **23:31** Closed changelog-gap verification tasks `copilot-4qs` and `copilot-sve` with parity evidence for closed-session upload policy: backend accepts uploads when `is_active=false` (unless deleted), and UI keeps upload button enabled unless `is_deleted=true` (`backend/__tests__/voicebot/uploadAudioRoute.test.ts`, `app/__tests__/voice/sessionStatusWidgetUploadPolicy.test.ts`).
- **23:31** Closed changelog-gap verification task `copilot-7l7` by confirming `.gitignore` includes `agents/.venv/` and `agents/logs/`, with docs smoke guard `voicebot_runtime/__tests__/docs/gitignore_fastagent_artifacts.test.js`.
- **23:48** Restored frontend Summarize control parity in `MeetingCard`: added circle `Summarize (∑)` action next to AI-title trigger with strict 3-minute cooldown and endpoint wiring to `voicebot/trigger_session_ready_to_summarize` via `voiceBotStore.triggerSessionReadyToSummarize`.
- **23:48** Reworked MeetingCard header action buttons to centered circle-icon rendering (`Edit`/`AI`/`Summarize`) using flex wrappers to prevent baseline drift in icon glyph alignment.
- **23:49** Closed changelog-gap verification tasks `copilot-ap6`, `copilot-ziw`, `copilot-jfi`, and `copilot-g68` with test-backed frontend/store parity evidence.
- **23:57** Closed changelog-gap verification tasks `copilot-eho`, `copilot-b9i`, and `copilot-om9` with docs-sync evidence for event-log source requirements, immutable `transcription_raw -> transcription` chain, and session-level transcript versioning/final-effective response contract in synced planning artifacts.
- **00:11** Updated `/voicebot/update_project` parity: notify-context log events are now emitted only when `project_id` actually changes and include `old_project_id`/`project_id` metadata; no project-assignment notify side-effect is tied to `update_name`.
- **00:11** Added regression contracts for append-only session-log replay lineage (`source_event_id`, `is_replay`, `event_version`) and for session-page tabs ordering (Log tab last).
- **00:12** Closed changelog-gap verification tasks `copilot-jyr`, `copilot-th5`, and `copilot-9hl` with backend/app test-backed parity evidence.
- **00:19** Added speaker-display normalization in Copilot transcription UI: technical raw labels map to `Спикер 1/2/...` in display layer while preserving original raw labels in message/transcription data.
- **00:19** Closed changelog-gap verification task `copilot-tyz` with test-backed speaker mapping parity evidence.

- **16:07** Added voicebot_runtime unit coverage for quota recovery and enqueue-failure rollback; made `voicebot_runtime/__tests__/setup.js` tolerant of missing `mongodb-memory-server` so unit tests can run on prod-like installs.

- **16:16** Added voicebot_runtime unit coverage for RedisMonitor history-only cleanup + trimEvents and categorization short-text/command skip guards to keep LLM spend bounded.

- **16:26** Added voicebot_runtime tests to guard attachment LLM context rendering (proxy URLs) and quota auto-recovery (requeue + stale categorization lock reset).

- **22:03** Committed previously untracked voicebot_runtime regression tests for retry/backoff gating, BullMQ retention bounds, and enqueue rollback (`voicebot_runtime/__tests__/bullmq_default_job_options_retention.test.js`, `voicebot_runtime/__tests__/common_jobs/processing_loop_retry_gating.test.js`, `voicebot_runtime/__tests__/processors/categorization_retry_gating.test.js`, `voicebot_runtime/__tests__/processors/questioning_enqueue_failure_rollback.test.js`).

- **23:58** Upgraded `backend/src/workers/voicebot/handlers/transcribe.ts` from scaffold to a TS runtime handler for local uploaded audio (`file_path`) with OpenAI Whisper direct transcription, runtime-family filters (`prod` + `prod-*`), retry/backoff, and quota-aware error handling.
- **23:58** Added transcription diagnostics parity in TS worker path: `transcription_error_context` now includes `server_name`, `openai_key_source`, `openai_key_mask`, `openai_api_key_env_file`, `file_path`, and `error_code`. Updated worker docs in `backend/src/workers/README.md` and migration evidence in `docs/MERGING_PROJECTS_VOICEBOT_PLAN.md`.

- **00:16** Strengthened TS transcribe worker failure-path coverage: added `file_not_found` and `openai_api_key_missing` regression tests, validating diagnostic payload completeness (`server_name`, key mask/source, env file, file_path, error_code) and non-retry behavior for non-quota errors.

- **00:22** Upgraded `backend/src/workers/voicebot/handlers/categorize.ts` from scaffold to TS runtime logic: OpenAI Responses categorization path, prompt/model contract (`VOICEBOT_CATEGORIZATION_MODEL`), retry/backoff, quota-aware `insufficient_quota`, and hard-stop `max_attempts_exceeded`.
- **00:22** Added categorize worker regression suite `backend/__tests__/voicebot/workerCategorizeHandler.test.ts` (success normalization + quota retry + missing-key failure) and aligned scaffold contract test for runtime-safe session lookup.
- **00:28** Upgraded `backend/src/workers/voicebot/handlers/finalization.ts` from scaffold to TS runtime logic: OpenAI Responses dedup (`VOICEBOT_FINALIZATION_MODEL`), explicit `no_custom_data` short-circuit, and error-state parity (`openai_api_key_missing`, `finalization_failed`) with runtime-family filters.
- **00:28** Added finalization worker regression suite `backend/__tests__/voicebot/workerFinalizationHandler.test.ts` and updated scaffold coverage in `backend/__tests__/voicebot/workerScaffoldHandlers.test.ts`.
- **00:38** Upgraded `backend/src/workers/voicebot/handlers/processingLoop.ts` from snapshot scaffold to TS runtime loop: quota-blocked session unblock, stale categorization lock recovery, transcribe retry gating (`transcription_next_attempt_at` + hard max attempts), and finalize-state toggles with runtime-family filters.
- **00:38** Added processing-loop regression suite `backend/__tests__/voicebot/workerProcessingLoopHandler.test.ts` and updated scaffold contract coverage in `backend/__tests__/voicebot/workerScaffoldHandlers.test.ts`.
- **00:50** Started `copilot-f1g` non-command Telegram ingress migration: added `backend/src/voicebot_tgbot/ingressHandlers.ts` (session resolution, active-session routing, text/voice/attachment persistence) and wired runtime handlers in `backend/src/voicebot_tgbot/runtime.ts` for `voice/text/photo/document/audio`.
- **00:50** Extended worker manifest parity with `HANDLE_VOICE`, `HANDLE_TEXT`, `HANDLE_ATTACHMENT` mappings and added wrapper handlers (`backend/src/workers/voicebot/handlers/handleVoice.ts`, `handleText.ts`, `handleAttachment.ts`).
- **00:50** Added ingress regression coverage `backend/__tests__/voicebot/tgIngressHandlers.test.ts` and updated scaffold manifest assertions for new common jobs.
- **00:55** Extended TG ingress parity for edge-cases: explicit session resolution from `reply_text` and forwarded metadata passthrough (`forwarded_context`) in TS ingress pipeline (`ingressHandlers` + runtime context extraction).

### TESTS
- **11:02** `cd backend && npm test -- --runInBand __tests__/voicebot/uploadAudioRoute.test.ts __tests__/voicebot/runtimeScope.test.ts __tests__/voicebot/sessionsRuntimeCompatibilityRoute.test.ts`
- **11:05** `cd backend && npm test -- --runInBand __tests__/voicebot/uploadAudioRoute.test.ts`
- **11:05** `cd app && npm test -- --runInBand __tests__/voice/webrtcMicPermissionBoot.test.ts`
- **11:11** `cd backend && npm test -- --runInBand __tests__/voicebot/runtimeScope.test.ts __tests__/voicebot/uploadAudioRoute.test.ts __tests__/voicebot/sessionsRuntimeCompatibilityRoute.test.ts`
- **11:12** `cd app && npm test -- --runInBand __tests__/voice/webrtcMicPermissionBoot.test.ts`
- **11:40** `cd app && npm test -- --runInBand __tests__/voice/webrtcDoneUploadPolicy.test.ts`
- **13:52** `cd backend && npm test -- --runInBand __tests__/services/dbAggregateRuntimeScope.test.ts __tests__/voicebot/messageHelpers.test.ts __tests__/voicebot/voicebotSocketAuth.test.ts __tests__/voicebot/uploadAudioRoute.test.ts __tests__/voicebot/tgCommandHandlers.test.ts`
- **13:53** `cd backend && npm run build`
- **13:54** `cd app && PLAYWRIGHT_BASE_URL=https://copilot.stratospace.fun npm run test:e2e -- e2e/voice-log.spec.ts --project=chromium-unauth`
- **13:58** `cd backend && npm test -- --runInBand __tests__/voicebot/sessionTelegramMessage.test.ts __tests__/voicebot/doneNotifyService.test.ts __tests__/voicebot/tgCommandHandlers.test.ts`
- **14:00** `cd app && PLAYWRIGHT_BASE_URL=https://copilot.stratospace.fun npm run test:e2e -- e2e/voice.spec.ts --project=chromium-unauth -g "runtime mismatch screen on 404 session fetch"`
- **14:00** `cd app && PLAYWRIGHT_BASE_URL=https://copilot.stratospace.fun npm run test:e2e -- e2e/voice-fab-lifecycle.spec.ts --project=chromium-unauth`
- **14:01** `cd backend && npm test -- --runInBand __tests__/voicebot/sessions.test.ts __tests__/voicebot/sessionsRuntimeCompatibilityRoute.test.ts __tests__/voicebot/tgCommandHandlers.test.ts`
- **14:08** `cd app && npm test -- --runInBand __tests__/voice/meetingCardStateMapping.test.ts __tests__/voice/meetingCardFabSync.test.ts`
- **14:08** `cd app && PLAYWRIGHT_BASE_URL=https://copilot.stratospace.fun npm run test:e2e -- e2e/voice-fab-lifecycle.spec.ts --project=chromium-unauth`
- **14:09** `cd backend && npm test -- --runInBand __tests__/voicebot/runtimeScope.test.ts __tests__/services/dbAggregateRuntimeScope.test.ts __tests__/voicebot/sessionsRuntimeCompatibilityRoute.test.ts __tests__/voicebot/uploadAudioRoute.test.ts __tests__/voicebot/sessions.test.ts`
- **14:10** `cd app && PLAYWRIGHT_BASE_URL=https://copilot.stratospace.fun npm run test:e2e -- e2e/voice-log.spec.ts e2e/voice.spec.ts --project=chromium-unauth`
- **15:05** `cd app && npm test -- --runInBand __tests__/voice/sessionPageRequestDiagnostics.test.ts`
- **15:05** `cd backend && npm test -- --runInBand __tests__/voicebot/tgCommandHandlers.test.ts`
- **15:06** `cd app && PLAYWRIGHT_BASE_URL=https://copilot.stratospace.fun npm run test:e2e -- e2e/voice.spec.ts --project=chromium-unauth -g "runtime mismatch screen on 404 session fetch"`
- **15:23** `cd backend && npm test -- --runInBand __tests__/voicebot/publicAttachmentRoute.test.ts __tests__/voicebot/sessionsRuntimeCompatibilityRoute.test.ts`
- **15:33** `cd app && npm test -- --runInBand __tests__/voice/screenshortDirectUri.test.ts __tests__/voice/sessionPageRequestDiagnostics.test.ts`
- **15:42** `cd backend && npm test -- --runInBand __tests__/voicebot/publicAttachmentRoute.test.ts __tests__/voicebot/sessionsRuntimeCompatibilityRoute.test.ts __tests__/voicebot/tgCommandHandlers.test.ts`
- **15:43** `cd app && npm test -- --runInBand __tests__/voice/sessionPageRequestDiagnostics.test.ts __tests__/voice/screenshortDirectUri.test.ts`
- **15:59** `cd backend && npm test -- --runInBand __tests__/smoke/voicebotAttachmentSmoke.test.ts __tests__/voicebot/sessionTelegramMessage.test.ts __tests__/voicebot/tgCommandHandlers.test.ts`
- **16:07** `cd voicebot_runtime && npx jest --runInBand __tests__/common_jobs/processing_loop_quota_recovery.test.js __tests__/voicebot/categorization_enqueue_failure.test.js`
- **16:16** `cd voicebot_runtime && npx jest --runInBand __tests__/services/redis_monitor_safety.test.js __tests__/voicebot/categorization_cost_controls.test.js`
- **16:26** `cd voicebot_runtime && npx jest --runInBand __tests__/services/voicebot_ai_context_attachments.test.js __tests__/common_jobs/processing_loop_quota_recovery.test.js`

- **16:41** `cd voicebot_runtime && npx jest --runInBand __tests__/common_jobs/processing_loop_retry_gating.test.js __tests__/processors/categorization_retry_gating.test.js __tests__/processors/questioning_enqueue_failure_rollback.test.js __tests__/bullmq_default_job_options_retention.test.js`
- **16:58** `cd voicebot_runtime && npx jest --runInBand __tests__/services/redis_monitor_safety.test.js __tests__/services/redis_username_support.test.js __tests__/voice_jobs/categorize_model_env.test.js __tests__/postprocessing/create_tasks_model_fallback.test.js`
- **17:06** `cd voicebot_runtime && npx jest --runInBand __tests__/plan/session_management_spec_smoke.test.js`
- **17:23** `cd backend && npm test -- --runInBand __tests__/smoke/voicebotAttachmentSmoke.test.ts __tests__/voicebot/sessionsRuntimeCompatibilityRoute.test.ts`
- **17:23** `cd app && npm test -- --runInBand __tests__/voice/screenshortDirectUri.test.ts`
- **17:41** `cd backend && npm test -- --runInBand __tests__/voicebot/sessionTelegramMessage.test.ts __tests__/voicebot/tgCommandHandlers.test.ts`
- **17:41** `cd voicebot_runtime && npx jest --runInBand __tests__/common_jobs/processing_loop_retry_gating.test.js __tests__/processors/categorization_retry_gating.test.js __tests__/common_jobs/processing_loop_quota_recovery.test.js`
- **17:56** `cd voicebot_runtime && npx jest --runInBand __tests__/bullmq_default_job_options_retention.test.js __tests__/processors/questioning_enqueue_failure_rollback.test.js __tests__/voicebot/categorization_enqueue_failure.test.js __tests__/services/redis_monitor_safety.test.js`
- **18:12** `cd voicebot_runtime && npx jest --runInBand __tests__/prompts/prompt_length_cost_controls.test.js __tests__/docs/llm_cost_controls_docs_smoke.test.js __tests__/voicebot/categorization_cost_controls.test.js`
- **18:41** `cd app && npm test -- --runInBand __tests__/voice/audioUploadProgress.test.ts`
- **18:41** `cd backend && npm test -- --runInBand __tests__/deploy/nginxUploadLimits.test.ts`
- **18:56** `cd app && npm test -- --runInBand __tests__/voice/audioUploadProgress.test.ts`
- **19:18** `cd app && npm test -- --runInBand __tests__/voice/audioUploadProgress.test.ts`
- **19:18** `cd voicebot_runtime && npx jest --runInBand __tests__/docs/duration_backfill_docs_smoke.test.js`
- **19:46** `cd voicebot_runtime && npx jest --runInBand __tests__/common_jobs/done_multiprompt.test.js`
- **19:46** `cd backend && npm test -- --runInBand __tests__/voicebot/doneNotifyService.test.ts __tests__/deploy/nginxUploadLimits.test.ts`
- **20:08** `cd app && npm test -- --runInBand __tests__/voice/transcriptionRowActions.test.ts`
- **20:42** `cd app && npm test -- --runInBand __tests__/voice/transcriptionRowActions.test.ts __tests__/voice/transcriptionTimelineLabel.test.ts`
- **20:42** `cd voicebot_runtime && npx jest --runInBand __tests__/services/transcriptionTimeline.test.js`
- **21:06** `cd voicebot_runtime && npx jest --runInBand __tests__/services/transcriptionTimeline.test.js __tests__/common_jobs/done_multiprompt.test.js __tests__/cli/recalc_session_duration_cli_smoke.test.js`
- **22:53** `cd voicebot_runtime && npx jest --runInBand __tests__/common_jobs/done_multiprompt.test.js`
- **22:53** `cd backend && npm test -- --runInBand __tests__/voicebot/doneNotifyService.test.ts __tests__/voicebot/sessionTelegramMessage.test.ts`
- **22:54** `cd app && npm test -- --runInBand __tests__/voice/meetingCardStateMapping.test.ts`
- **22:55** `cd voicebot_runtime && npx jest --runInBand __tests__/common_jobs/processing_loop_quota_recovery.test.js __tests__/common_jobs/processing_loop_retry_gating.test.js __tests__/processors/categorization_retry_gating.test.js`
- **22:56** `cd backend && npm test -- --runInBand __tests__/voicebot/runtimeScope.test.ts __tests__/services/dbAggregateRuntimeScope.test.ts __tests__/voicebot/sessionsRuntimeCompatibilityRoute.test.ts`
- **22:58** `cd app && PLAYWRIGHT_BASE_URL=https://copilot.stratospace.fun npm run test:e2e -- e2e/voice.spec.ts --project=chromium-unauth --grep "@unauth loads /voice sessions table|@unauth resolves /voice/session to active-session"`
- **22:58** `cd /home/strato-space/copilot && bd list --all | rg "voicebot-changelog-gap" | wc -l` (expected `133`)
- **23:02** `cd app && npm run build`
- **23:03** `cd app && npm test -- --runInBand __tests__/voice/transcriptionRowActions.test.ts __tests__/voice/transcriptionTimelineLabel.test.ts __tests__/voice/audioUploadProgress.test.ts`
- **23:11** `cd voicebot_runtime && npx jest --runInBand __tests__/docs/event_log_plan_sync_docs_smoke.test.js`
- **23:13** `cd backend && npm test -- --runInBand __tests__/smoke/voicebotApiSmoke.test.ts`
- **23:14** `cd app && npm test -- --runInBand __tests__/voice/transcriptionRowActions.test.ts`
- **23:14** `cd backend && npm test -- --runInBand __tests__/voicebot/reasonOptionalRouteContract.test.ts`
- **23:16** `cd app && PLAYWRIGHT_BASE_URL=https://copilot.stratospace.fun npm run test:e2e -- e2e/voice-log.spec.ts --project=chromium-unauth`
- **23:18** `cd backend && npm test -- --runInBand __tests__/voicebot/sessionLogRouteContract.test.ts`
- **23:23** `cd backend && npm test -- --runInBand __tests__/voicebot/triggerSummarizeRoute.test.ts __tests__/smoke/voicebotApiSmoke.test.ts`
- **23:23** `cd app && PLAYWRIGHT_BASE_URL=https://copilot.stratospace.fun npm run test:e2e -- e2e/voice-log.spec.ts --project=chromium-unauth -g "session ready-to-summarize"`
- **23:25** `cd voicebot_runtime && npx jest --runInBand __tests__/docs/planning_references_docs_smoke.test.js`
- **23:30** `cd backend && npm test -- --runInBand __tests__/voicebot/uploadAudioRoute.test.ts`
- **23:31** `cd app && npm test -- --runInBand __tests__/voice/sessionStatusWidgetUploadPolicy.test.ts __tests__/voice/audioUploadProgress.test.ts`
- **23:31** `cd voicebot_runtime && npx jest --runInBand __tests__/docs/gitignore_fastagent_artifacts.test.js __tests__/docs/planning_references_docs_smoke.test.js`
- **23:46** `cd app && npm test -- --runInBand __tests__/voice/meetingCardSummarizeAndIconContract.test.ts __tests__/voice/voiceBotStoreSummarizeContract.test.ts __tests__/voice/meetingCardStateMapping.test.ts`
- **23:47** `cd app && npm run build`
- **23:56** `cd voicebot_runtime && npx jest --runInBand __tests__/docs/transcript_versioning_plans_smoke.test.js __tests__/docs/event_log_plan_sync_docs_smoke.test.js`
- **00:08** `cd app && npm test -- --runInBand __tests__/voice/sessionPageTabsOrderContract.test.ts __tests__/voice/transcriptionRowActions.test.ts`
- **00:09** `cd backend && npm test -- --runInBand __tests__/voicebot/updateProjectNotifyContract.test.ts __tests__/voicebot/sessionLogAppendOnlyContract.test.ts __tests__/voicebot/sessionLogRouteContract.test.ts`
- **00:10** `cd backend && npm run build`
- **00:17** `cd app && npm test -- --runInBand __tests__/voice/speakerDisplayContract.test.ts __tests__/voice/transcriptionRowActions.test.ts __tests__/voice/sessionPageTabsOrderContract.test.ts`
- **00:18** `cd app && npm run build`

- **23:57** `cd backend && npm test -- --runInBand __tests__/voicebot/workerScaffoldHandlers.test.ts __tests__/voicebot/workerTranscribeHandler.test.ts`
- **23:57** `cd backend && npm run build`

- **00:16** `cd backend && npm test -- --runInBand __tests__/voicebot/workerTranscribeHandler.test.ts __tests__/voicebot/workerScaffoldHandlers.test.ts`
- **00:16** `cd backend && npm run build`

- **00:22** `cd backend && npm test -- --runInBand __tests__/voicebot/workerCategorizeHandler.test.ts __tests__/voicebot/workerTranscribeHandler.test.ts __tests__/voicebot/workerScaffoldHandlers.test.ts`
- **00:22** `cd backend && npm run build`
- **00:28** `cd backend && npm test -- --runInBand __tests__/voicebot/workerFinalizationHandler.test.ts __tests__/voicebot/workerScaffoldHandlers.test.ts __tests__/voicebot/workerTranscribeHandler.test.ts __tests__/voicebot/workerCategorizeHandler.test.ts`
- **00:28** `cd backend && npm run build`
- **00:38** `cd backend && npm test -- --runInBand __tests__/voicebot/workerProcessingLoopHandler.test.ts __tests__/voicebot/workerScaffoldHandlers.test.ts __tests__/voicebot/workerFinalizationHandler.test.ts __tests__/voicebot/workerTranscribeHandler.test.ts __tests__/voicebot/workerCategorizeHandler.test.ts`
- **00:38** `cd backend && npm run build`
- **00:50** `cd backend && npm test -- --runInBand __tests__/voicebot/tgIngressHandlers.test.ts __tests__/voicebot/tgCommandHandlers.test.ts __tests__/voicebot/workerScaffoldHandlers.test.ts __tests__/voicebot/workerProcessingLoopHandler.test.ts`
- **00:50** `cd backend && npm run build`
- **00:55** `cd backend && npm test -- --runInBand __tests__/voicebot/tgIngressHandlers.test.ts __tests__/voicebot/tgCommandHandlers.test.ts __tests__/voicebot/tgSessionRef.test.ts __tests__/voicebot/sessionTelegramMessage.test.ts __tests__/voicebot/doneNotifyService.test.ts __tests__/voicebot/workerScaffoldHandlers.test.ts __tests__/voicebot/workerProcessingLoopHandler.test.ts __tests__/voicebot/workerTranscribeHandler.test.ts __tests__/voicebot/workerCategorizeHandler.test.ts __tests__/voicebot/workerFinalizationHandler.test.ts`
- **00:55** `cd backend && npm run build`

## 2026-02-17
### PROBLEM SOLVED
- **21:49** Voice migration after 2026-02-05 required strict runtime isolation in shared Mongo/Redis to avoid dev/prod cross-processing.
- **21:49** `/voicebot` socket auth trusted too much client-side context and did not enforce explicit session resolution consistently.
- **21:58** Flat Voice API compatibility for WebRTC/FAB flows (`/create_session`, `/upload_audio`, `/active_session`, etc.) and active-session resolution remained incomplete.
- **21:58** Voice session UI lacked session-log and Screenshort parity for attachment-centric debugging/review.

### FEATURE IMPLEMENTED
- **21:49** Added runtime-scope foundation for backend: `runtime_tag` helpers (`backend/src/services/runtimeScope.ts`) and runtime-aware DB proxy (`backend/src/services/db.ts`) with auto-filtering for scoped collections.
- **21:49** Hardened `/voicebot` socket contract with explicit authz resolution per `session_id`, explicit `session_done` ack `{ok,error}`, and shared session access policy helper (`backend/src/services/session-socket-auth.ts`).
- **21:58** Expanded Voice API parity with flat + legacy route mounting (`backend/src/api/routes/voicebot/index.ts`), active-session/create/activate flows (`backend/src/api/routes/voicebot/sessions.ts`), and upload/attachment runtime-mismatch handling (`backend/src/api/routes/voicebot/uploads.ts`).
- **21:58** Added Voice UI parity pieces: active-session resolver page, session attachments normalization in store, Screenshort tab, and session-log tab with action wiring.

### CHANGES
- **21:49** Added runtime backfill script `backend/scripts/runtime-tag-backfill.ts` and npm scripts `runtime:backfill:dry` / `runtime:backfill:apply`.
- **21:58** Added Voice backend helper/services for message and session actions: `backend/src/api/routes/voicebot/messageHelpers.ts`, `backend/src/services/voicebotSessionLog.ts`, `backend/src/services/voicebotOid.ts`, `backend/src/services/voicebotObjectLocator.ts`, `backend/src/services/transcriptionTimeline.ts`.
- **21:58** Added Voice frontend/runtime assets: `app/src/components/voice/Screenshort.tsx`, `app/src/components/voice/SessionLog.tsx`, `app/src/pages/voice/SessionResolverPage.tsx`, and same-origin WebRTC bundle under `app/public/webrtc/*`.
- **22:04** Updated BD task tracking for ongoing migration work (`copilot-2rk`, `copilot-d8s`, `copilot-z9j.2`) to `in_progress` with implementation notes.
- **21:49** Updated migration spec and project policies/docs (`docs/MERGING_PROJECTS_VOICEBOT_PLAN.md`, `AGENTS.md`, `README.md`).

### TESTS
- **21:55** `cd backend && npm run build`
- **21:56** `cd backend && npm test` (`11 suites`, `133 tests`, all passed)
- **22:02** `cd app && npm run build-dev`

## 2026-01-22
### PROBLEM SOLVED
- UI changes for FinOps could be ignored because JS duplicates shadowed TSX sources → removed JS duplicates so updates always apply.
- Summary totals did not reflect active table filters → totals now recalculate based on filtered rows.
- Active month borders were visually too heavy → borders lightened for clearer focus without overpowering the table.
- Pinned-month totals only appeared after horizontal scroll → pinned summary cells now stay visible with the pinned months.
- FX updates did not propagate to dashboards → FX rate changes now recalculate RUB values across analytics, KPIs, and plan-fact views.
- Directories layout for clients/projects/rates differed from other pages → header/back-link placement aligned.

### FEATURE IMPLEMENTED
- Added an analytics pie widget with an in-card metric filter (revenue vs hours) to show project distribution.
- Centered and normalized month subheaders (Forecast/Fact) for cleaner table readability.
- Modularized Copilot as an umbrella workspace with FinOps, OperOps, and ChatOps modules documented in README.
- Added a forecast/fact toggle for the project distribution chart.
- Added a chat-agent flow that fills the employee form and prompts for missing fields.
- Introduced FX rate storage and live recalculation for RUB metrics.

### CHANGES
- Removed redundant JS files in `app/src` to enforce TypeScript-only sources.
- Added chart layout styles and table header tweaks; adjusted active-month divider color.
- Bumped `app` version to 1.0.1 and added `jest-environment-jsdom` to devDependencies.
- Cleaned local JSON data stubs from `backend/app/data`.
- Added `fxStore` and wired it into FX, analytics, KPI cards, and plan-fact grid calculations.
- Reworked pinned-month summary positioning using shared width constants and sticky wrappers.
- Adjusted directory pages (Employees and Clients/Projects/Rates) layout and helper UI.

## 2026-01-23
### PROBLEM SOLVED
- Pinned-month totals in the plan-fact summary row slipped and appeared only after horizontal scroll → sticky positioning is now applied directly to summary cells so totals stay under pinned months.
- TypeScript builds could re-create JS duplicates inside `app/src` → `noEmit` now prevents output into source folders.
- Expense tracking only covered salaries and could not include other operating costs → expenses now consolidate payroll and other categories in one table.
- Expense attachments had no persistence path → backend now saves uploads and serves them from a stable URL.
- Employees could not be edited inline from the directory list → row-level edit actions now open the edit modal with prefilled data.

### FEATURE IMPLEMENTED
- Pinned months now allow unpinning the active month as long as at least one month remains pinned (still capped at 3).
- Added “Затраты” tab with unified rows for payroll and other expense categories, month pinning, and sticky totals.
- Added “Добавить расход” flow with category creation, FX handling, and an operations drawer per category/month.

### CHANGES
- Added a typed wrapper for summary cells to allow inline sticky styles with Ant Design typings.
- Removed conflicting relative positioning from summary cells to keep sticky offsets accurate.
- Added `/api/uploads/expense-attachments` and `/uploads/expenses` to store expense files on the backend.
- Introduced expense/category seed data and unified expense grid component in `app`.
- Wired employee directory data into both the expenses view and the salaries directory, with editable rows.

## 2026-01-26
### PROBLEM SOLVED
- The Copilot portal had no login and could not reuse Voicebot credentials → added a Voicebot-backed auth proxy and a portal login flow with token persistence.
- Ops planning exports did not surface enough task metadata for dashboards → CRM parsing now keeps status details, priority, task type, descriptions, epic links, and timestamps.
- Navigation URLs were inconsistent between FinOps, guide, and legacy paths → normalized `/analytics`, `/finops`, `/guide` routes with redirects to preserve deep links.

### FEATURE IMPLEMENTED
- Added a global agent/notification drawer with popup alerts, filters, snooze/mute actions, and command presets.
- Expanded analytics into OperOps/DesOps tabs with Ops metrics, approve/apply flow, and snapshot visibility.
- Introduced new module shells (Agents, OperOps, ChatOps, DesOps, Voice) with placeholder pages and badges.
- Added a persisted employee directory with per-month salary mapping, FX-aware totals, and updated roster seeds.

### CHANGES
- Added `/api/ops/tasks`, `/api/ops/intake`, and `/api/ops/projects` endpoints plus new response schemas.
- Added `/api/try_login` proxy and Voicebot auth configuration (`VOICEBOT_API_URL` / `VOICEBOT_TRY_LOGIN_URL`).
- KPI cards now include payroll + other expenses, FX-aware totals, and extra deltas derived from employee/expense stores.
- Updated expense categories/seeds, analytics layout styles, and notification UI styling.
- Host Nginx config now serves the FinOps build from `app/dist` with clean SPA routing.

## 2026-01-27
### PROBLEM SOLVED
- Auth checks against `/api/auth/me` could fail with 502s and cookies were not shared across subdomains → frontend now checks Voicebot directly and backend sets a shared auth cookie for `.stratospace.fun`.
- Tailwind utility classes were not compiling, so the login form could not be centered with utilities → enabled the Tailwind PostCSS pipeline and moved layout to Tailwind classes.

### FEATURE IMPLEMENTED
- Added a Voicebot-backed login page and global auth guard with a dedicated auth store.
- Added backend auth proxy endpoints (`/api/try_login`, `/api/auth/me`, `/api/logout`) with shared cookie handling.

### CHANGES
- Introduced a Voicebot API client and ensured credentialed requests from the frontend.
- Enabled Tailwind via `@tailwindcss/postcss` and `@import 'tailwindcss'`, updated Tailwind config.
- Scoped backend TypeScript builds to `src/` and refined error middleware + CRM snapshot date parsing for strict type safety.

## 2026-01-28
### PROBLEM SOLVED
- Copilot dev could collide with other Vite servers on shared hosts → switched dev flow to static `build-dev` output served by Nginx.
- OperOps/Voice sections were stubs with no unified navigation → added iframe embedding to load CRM/Voicebot inside Copilot.
- Guide directories failed hard on missing API data → added mock fallback index/directories with clearer source tags.
- Month labels were inconsistent across Guide tables → normalized date formatting to `DD.MM.YY` and enabled sticky headers.
- OperOps/Voice showed raw embed error text when URLs were missing → now render consistent placeholder panels.

### FEATURE IMPLEMENTED
- Added iframe embed bridge with route/height sync for Voicebot and CRM sections.
- Added a dev build script and environment-driven embed URLs for dev/prod.
- Rebuilt the Guide landing as a single table catalog with module filters and row navigation.
- Added directory detail routing with tabbed sub-tables, plus inline project-rate summaries and a comment drawer.
- Added a global Log sidebar and new SaleOps/HHOps shells with updated sidebar badges.

### CHANGES
- Replaced OperOps and Voice stub pages with iframe shell integration and `/*` routes.
- Added embed env files plus a reusable `EmbedFrame` component.
- Updated directory/guide pages with refreshed layouts and structure changes.
- Added guide mock datasets/config and wired fallback handling in `guideStore`.
- Updated Agents, Employees/Salaries, and FX tables with sticky headers and revised columns/actions.

## 2026-02-03
### PROBLEM SOLVED
- **14:08** FinOps tables still depended on partial API wiring and mixed local state, which caused stale values after reloads and inconsistent totals across views.

### FEATURE IMPLEMENTED
- **14:08** Added backend-backed fund workflow integration for plan/fact and related finance widgets, with aligned frontend service/store typing.

### CHANGES
- **14:08** Updated finance pages/components (`AnalyticsPage`, `PlanFactPage`, drawers, and grids), store modules, and shared format utilities.
- **14:08** Added/updated fund route integration in backend routing (`backend/src/api/routes/fund.ts`, `backend/src/api/routes/index.ts`) and frontend service type contracts.

## 2026-02-04
### PROBLEM SOLVED
- **15:27** Copilot backend lacked a full CRM API surface from automation, blocking unified OperOps backend support.

### FEATURE IMPLEMENTED
- **15:27** Merged CRM backend route modules (customers, projects, epics, finances, dictionary, imports, and related entities) into Copilot backend.

### CHANGES
- **15:27** Added and wired `backend/src/api/routes/crm/*` modules plus route index integration.
- **15:27** Updated backend package/environment configuration to support merged CRM services.

## 2026-02-05
### PROBLEM SOLVED
- **11:56** CRM UI migration was still fragmented, which blocked stable navigation and task creation flows in `/operops`.
- **18:00** Post-merge configuration gaps in stores/forms created unstable behavior in kanban and ticket creation flows.

### FEATURE IMPLEMENTED
- **11:56** Integrated the CRM frontend module into Copilot with migrated components/pages and end-to-end coverage.
- **18:00** Finalized CRM kanban/forms/store integration and environment wiring for dev/prod/local usage.

### CHANGES
- **11:56** Added CRM component suite under `app/src/components/crm/`, OperOps pages, and Playwright specs for auth/kanban/operations/task creation.
- **18:00** Updated `.env` profiles, `vite.config.ts`, CRM stores (`kanbanStore.ts`, `projectsStore.ts`, `requestStore.ts`), and backend CRM route hooks.

## 2026-02-06
### PROBLEM SOLVED
- **10:30** VoiceBot APIs were missing from Copilot backend, so session/person/transcription workflows could not run in one secured stack.
- **11:08** One-use token auth behavior was inconsistent after backend migration.
- **17:57** Sessions list loading/refresh behavior regressed after voice merge updates.
- **23:11** Admin permission state in voice pages could become stale after updates.
- **14:45** Runtime log files were repeatedly tracked by git and polluted change history.

### FEATURE IMPLEMENTED
- **10:30** Added VoiceBot backend route modules with role-based guards and Jest coverage for core voice APIs.
- **11:08** Migrated one-use token auth support and aligned agent runtime scaffolding.
- **14:43** Delivered native voice session UI integration (`/voice/*`) with session cards, categorization, uploads, and admin controls.

### CHANGES
- **10:30** Added `backend/src/api/routes/voicebot/*`, permission manager wiring, and voicebot test suites.
- **11:08** Updated auth route behavior and agent configuration files under `agents/`.
- **14:45** and **14:47** Expanded `.gitignore` handling for backend/runtime logs.
- **17:57** Updated session hooks/pages/stores and `backend/src/api/routes/voicebot/sessions.ts`.
- **23:11** Fixed state handling in `app/src/store/permissionsStore.ts` and `app/src/store/voiceBotStore.ts`.

## 2026-02-09
### PROBLEM SOLVED
- **11:31** FinOps backend endpoints for employees/expenses/FX/month closures were incomplete, limiting real API-backed finance operations.
- **13:09** Analytics, KPI, and plan-fact views had post-migration display/calculation bugs.
- **15:21** Income/plan-fact migration support was incomplete, keeping part of financial history in inconsistent formats.
- **19:12** Miniapp was not merged into the main runtime path, forcing split deployment logic.
- **19:27** Local config artifacts continued to appear in git tracking.

### FEATURE IMPLEMENTED
- **09:15** Refactored voice session integration touchpoints to reduce duplicated app wiring.
- **11:31** Added a complete FinOps route module set under `backend/src/api/routes/finops/*` with frontend service/store integration.
- **15:21** Added migration tooling and support services for plan/fact and income-related finance data.
- **19:12** Merged Miniapp frontend/backend into Copilot with backend entrypoints and test scaffolding.

### CHANGES
- **09:15** Updated `App.tsx`, `SessionsListPage.tsx`, `voiceBotStore.ts`, and CRM ingest environment wiring.
- **11:31** Added FinOps services/models/routes (`employees`, `expensesCategories`, `expensesOperations`, `fxRates`, `monthClosures`) and frontend consumers.
- **13:09** Fixed finance UI regressions in KPI, analytics, and plan-fact components; updated migration helper constants.
- **16:02** Renamed merge plan docs into `docs/` for consistent project documentation layout.
- **19:12** Added `miniapp/` project files and backend miniapp bootstrapping under `backend/src/miniapp/*`.
- **19:27** Tightened `.gitignore` coverage for local configuration files.

## 2026-02-10
### PROBLEM SOLVED
- **18:15** Reports APIs were absent, so Ops reporting could not be generated from the Copilot backend.
- **14:40** and **18:28** Ignore rules still allowed temporary/generated files into commits.
- **18:43** Miniapp environment files remained tracked in git.
- **19:33** Start/build flow differed per environment and was error-prone to run manually.

### FEATURE IMPLEMENTED
- **18:15** Added reports API and services for Google Drive data, Jira-style reporting, and performer weekly summaries.
- **19:33** Introduced unified PM2 automation (`scripts/pm2-backend.sh`) for build + restart across `dev|prod|local`.

### CHANGES
- **18:15** Added `backend/src/api/routes/crm/reports.ts`, reports services/types, setup docs, and backend tests.
- **14:40** and **18:28** Updated `.gitignore` rules for runtime and generated artifacts.
- **18:43** Removed tracked miniapp env files (`miniapp/.env.development`, `miniapp/.env.production`) from repo history.
- **19:33** Added/updated startup scripts (`scripts/dev.sh`, `scripts/pm2-backend.sh`) and related operational docs.

## 2026-02-11
### PROBLEM SOLVED
- **17:44** ACT generation and performer finance workflows were not fully migrated, creating gaps in CRM finance operations.
- **20:34** Agent-triggered MCP calls from voice sessions were unstable in merged flow.
- **20:38** Fast-agent session artifacts were still being committed.
- **16:41** PM2 startup behavior for agents was not explicit in operator docs.

### FEATURE IMPLEMENTED
- **17:44** Migrated ACT generation into CRM finance flows and aligned performer payment handling.
- **20:34** Added MCP WebSocket/session wiring for voice pages and request stores.
- **16:41** Added operational guidance for PM2-run agent startup.

### CHANGES
- **17:44** Updated CRM finances UI (`BonusCalculator`, `PaymentForm`, `PerformerForm`), auth/finances backend routes, and numeric wording typing support.
- **20:34** Updated voice components/stores/hooks and backend socket/session handling for MCP-assisted flows.
- **20:38** Added `.gitignore` rules for `agents/.fast-agent/sessions/*` and removed tracked session artifacts.
- **16:45** Synced local `main` with remote updates.

## 2026-02-12
### PROBLEM SOLVED
- **12:07** Host Nginx routing needed refresh to match current Copilot deployment paths.
- **13:06** Dev environment defaults were out of date for current integration behavior.
- **18:13** Miniapp backend lifecycle was not managed together with backend API in PM2 routines.
- **19:09** Missing or inconsistent `.env` files were hard to detect before startup.

### FEATURE IMPLEMENTED
- **18:13** Extended PM2 orchestration to manage both `copilot-backend-*` and `copilot-miniapp-backend-*` services in one command.
- **19:09** Added `scripts/check-envs.sh` to validate required env files and print resolved ports/URLs per mode.

### CHANGES
- **12:07** Updated `deploy/nginx-host.conf` and related backend lockfile entries.
- **13:06** Updated `app/.env.development` defaults for dev mode.
- **15:10** Merged latest `main` into local branch.
- **18:13** Updated `scripts/pm2-backend.sh` and `scripts/pm2-backend.ecosystem.config.js` for miniapp PM2 startup.
- **22:04** Updated `AGENTS.md`, `README.md`, and `CHANGELOG.md` to align operational docs with the merged backend/miniapp/agents flow.

## 2026-02-13
### PROBLEM SOLVED
- **11:12** OperOps Voice session tasks rendered as dashes because agent output used human-friendly keys (for example, "Task Title", "Deadline", "Dialogue Reference") instead of the UI field names → normalized task objects before rendering the nested table so all columns display values.
- **11:12** MCP calls to Copilot Agent Services on `:8722` failed with `ERR_SSL_PACKET_LENGTH_TOO_LONG` when the server URL used `https://` even though the service is plain HTTP → updated dev env to use `http://` for `VITE_AGENTS_API_URL`.
- **16:17** Copilot still referenced the legacy `automation_clients` collection, which drifted from the actual `customers -> project_groups -> projects` DB relationship → removed `automation_clients` usage across backend/frontend and normalized types/contracts.

### FEATURE IMPLEMENTED
- None.

### CHANGES
- **11:12** Added task normalization in `app/src/pages/operops/CRMPage.tsx` while keeping compatibility with `exactOptionalPropertyTypes`.
- **11:12** Documented `/mcp` default path behavior for Streamable HTTP MCP servers in `backend/src/services/mcp/proxyClient.ts`.
- **11:12** Updated `app/.env.development` to point the agents MCP URL to plain HTTP.
- **14:49** Added `docs/FIXING_COLLECTIONS_MESS_PLAN.md` to document the customers/project-groups/projects relationship and the migration plan off `automation_clients`.
- **16:17** Removed `COLLECTIONS.CLIENTS` (`automation_clients`) from `backend/src/constants.ts` and updated CRM dictionary + related stores/services to use `automation_customers` and `automation_project_groups`.

## 2026-02-15
### PROBLEM SOLVED
- None.

### FEATURE IMPLEMENTED
- **10:08** Initialized `bd` (Beads) integration for repository sync automation (branch: `beads-sync`).

### CHANGES
- **10:08** Added `.beads/*` config and `.gitattributes` for `bd` integration.
- **10:10** Documented `bd` usage and required setup in `AGENTS.md`.

## 2026-02-18
### PROBLEM SOLVED
- **01:25** TS Telegram runtime kept non-command ingestion logic inline in `runtime.ts`, which made event-level verification difficult and slowed parity closure for non-command paths.

### FEATURE IMPLEMENTED
- **01:25** Extracted non-command Telegram update handling (`voice/text/photo/document/audio`) into a dedicated TS module with focused unit coverage.

### CHANGES
- **01:25** Added `backend/src/voicebot_tgbot/runtimeNonCommandHandlers.ts` and rewired `backend/src/voicebot_tgbot/runtime.ts` to use it.
- **01:25** Added `backend/__tests__/voicebot/runtimeNonCommandHandlers.test.ts` for command-text filtering, forwarded/reply context extraction, and attachment ingress routing.
- **01:25** Re-ran targeted TG suites and backend build (`tgCommandHandlers`, `tgIngressHandlers`, `runtimeNonCommandHandlers`, `npm run build`).
- **01:35** Added `backend/__tests__/voicebot/workerIngressHandlers.test.ts` to validate TS worker wrapper delegation for `HANDLE_VOICE`, `HANDLE_TEXT`, `HANDLE_ATTACHMENT` and payload normalization.
- **01:50** Updated `scripts/pm2-voicebot-cutover.ecosystem.config.js` to launch `copilot-voicebot-tgbot-prod` from backend TypeScript runtime (`npm run start:voicebot-tgbot`) with merged env (`backend/.env.production` + `voicebot_runtime/.env.prod-cutover`) instead of legacy `voicebot_runtime/voicebot-tgbot.js`.
- **02:05** Added Playwright guard `@unauth does not request microphone on initial /voice load` in `app/e2e/voice.spec.ts` and stabilized FAB recording-state e2e setup in `app/e2e/voice-fab-lifecycle.spec.ts`; verified local unauth suite (`13 passed`) on `http://127.0.0.1:3002`.

## 2026-02-20
### PROBLEM SOLVED
- **14:52** Screenshort cards could hide URL/metadata under the sticky bottom widget, and very long `data:image/...` links made cards unreadable → adjusted card layout (safe bottom spacing + constrained preview area) and introduced compact base64 preview text while keeping full-value copy.
- **14:52** Pasted images from web clipboard were stored as inline `data:image` payloads in message attachments, which broke canonical attachment URL behavior and complicated reuse/preview parity → switched clipboard image flow to backend attachment upload and persisted files in voicebot storage.
- **14:52** CREATE_TASKS rows were stored in mixed schemas (`Task ID`/`Task Title` and canonical fields), which caused inconsistent rendering and partial delete behavior → normalized task payloads to canonical fields and expanded delete matching to canonical + legacy identifiers.
- **14:52** Plan-fact pages still depended on local mock/snapshot UI state, which diverged from backend reality and hid project update persistence gaps → removed mock/snapshot frontend mode and enabled explicit backend project update route usage in edit flow.

### FEATURE IMPLEMENTED
- **14:52** Added voice image attachment upload endpoint (`/api/voicebot/upload_attachment`, alias `/api/voicebot/attachment`) with MIME validation, deterministic `file_unique_id`, and `public_attachment` URL response contract.
- **14:52** Added plan-fact project update endpoint (`PUT /api/plan-fact/project`) and backend service method that updates project metadata plus optional contract-type propagation to fact/forecast collections.

### CHANGES
- **14:52** Voice frontend: updated `app/src/store/voiceBotStore.ts` clipboard image flow to upload image files before `add_text`; added regression contracts `app/__tests__/voice/pastedImageServerStorageContract.test.ts`, `app/__tests__/voice/screenshortAttachmentUrl.test.ts`, and `app/__tests__/voice/screenshortLayoutVisibility.test.ts`.
- **14:52** Screenshort UI: updated `app/src/components/voice/Screenshort.tsx` to use `contain` previews, card-safe spacing, wrapped URL block, `data:image` truncation preview, and hover copy preserving full URL value.
- **14:52** Possible Tasks UI/API parity: made `task_type_id` optional in `app/src/components/voice/PossibleTasks.tsx`; normalized CREATE_TASKS persistence in `backend/src/api/routes/voicebot/sessions.ts` and `backend/src/workers/voicebot/handlers/createTasksFromChunks.ts`; added/updated tests in `backend/__tests__/voicebot/sessionUtilityRoutes.test.ts` and `backend/__tests__/voicebot/workerCreateTasksFromChunksHandler.test.ts`.
- **14:52** Plan-fact backend/frontend cleanup: removed `app/src/services/mockPlanFact.ts` and `backend/src/services/crmIngest.ts`; updated `app/src/store/planFactStore.ts`, `app/src/pages/PlanFactPage.tsx`, `app/src/pages/AnalyticsPage.tsx`, `app/src/services/types.ts`, `app/src/pages/ProjectEditPage.tsx`, `backend/src/api/routes/planFact.ts`, and `backend/src/services/planFactService.ts`.
- **14:52** Added backend attachment API contract tests in `backend/__tests__/voicebot/uploadAttachmentRoute.test.ts`.
- **14:52** Removed deprecated env key `CRM_SNAPSHOT_DIR` from `backend/.env.example`.
- **14:52** Added `docs/FINOPS_REALIZTION.md` and test fixture image files under `backend/uploads/voicebot/attachments/6996d9169bce3264e9851c1c/` used by attachment-flow verification.
- **14:52** Validation run: `cd app && npm test -- --runInBand` (`28 suites`, `57 tests`), `cd backend && npm test -- --runInBand` (`62 suites`, `307 tests`), and `cd app && npm run build` (success).
