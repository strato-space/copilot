# Copilot

Copilot is the workspace for Finance Ops, OperOps/CRM, Voice, and Miniapp surfaces. Deprecated code is archived in `old_code/`.

Repo-root `.omx/` contains local OMX session/state artifacts and is intentionally ignored from version control.

## Critical Decisions For Future Agents

Use this as a fast guardrail before implementing anything:

- Copilot is the active Voice platform (`/voice/*` + `/api/voicebot/*`); do not design new behavior against legacy `voice.stratospace.fun`.
- Session closing is REST-driven (`POST /api/voicebot/session_done`, alias `/close_session`), with websocket used for server-to-client updates only.
- Voice control semantics are fixed to `New / Rec / Cut / Pause / Done` and must stay aligned between session page toolbar and FAB.
- Full-track chunks are intentionally non-uploading until diarization is introduced; do not re-enable implicit uploads.
- Runtime isolation for Voice is deployment-scoped (separate DB/instance per environment); `runtime_tag` is transitional metadata and not an operational routing contract.
- Realtime updates are required: uploads and workers must emit session/message events so Transcription/Categorization update without refresh.
- Summary notify retries for `SESSION_READY_TO_SUMMARIZE` and `summary_save` must preserve stable `correlation_id` / `idempotency_key` values so audit rows dedupe instead of downgrading previous status rows.
- Browser-based UI acceptance should restart `mcp@chrome-devtools.service` before each live verification cycle; stale MCP/CDP state is not an accepted explanation for skipped smoke checks.
- Browser-based layout verification should include screenshot-level overlap checks when footer/status widgets or task panes change; CSS/DOM-only assertions are not sufficient for acceptance.
- Shared selector parity is a product contract: project and operational task-type controls should reuse the same wrappers and option-source builders across Voice and OperOps so hierarchy/labels never degrade into flat lists or raw ids on one surface.
- Session list contracts are user-facing:
  - quick tabs: `Все`, `Без проекта`, `Активные`, `Мои`,
  - deleted toggle `Показывать удаленные`,
  - filter state persistence across navigation/reload.
- Possible Tasks contract:
  - canonical payload shape `id/name/description/priority/...`,
  - task extraction is ontology-first: only bounded deliverables should become Draft rows; coordination-only actions, input/access handoffs, references/ideas, and status updates are not canonical tasks by themselves,
  - full recompute with no chunk payload must use compact session raw transcript context, and replay acceptance requires stable Draft `row_id` identity across consecutive recompute runs for unchanged semantics,
  - `task_type_id` stays optional,
  - master store is `automation_tasks` with draft status `DRAFT_10`,
  - draft editing is autosave-first across both inline table edits and the right-hand detail editor,
  - the primary manual action is `Run`; it materializes the row to `READY_10` only after autosave succeeds, and there is no separate canonical `Save` action,
  - `process_possible_tasks` now materializes selected rows into `READY_10`,
  - accepted rows must not be soft-deleted by possible-task cleanup,
  - session `processors_data.CREATE_TASKS` is legacy historical payload only and must not be used as the source of truth for Draft reads,
  - canonical Draft reads come from session-linked `DRAFT_10` task docs and may expose `discussion_sessions[]` / `discussion_count`; `source_kind` and stale refresh markers are compatibility metadata, not the semantic draft gate,
  - stale `CREATE_TASKS` repair marker precedence is explicit: processor-level timestamps (`job_queued_timestamp`, request timestamps, finish timestamps) dominate stale-age evaluation; session `_id` timestamp is fallback-only when explicit markers are absent,
  - transition reformulation for `CREATE_TASKS` is bounded to one retry with machine-readable failures (`create_tasks_transition_retries_exhausted` / `create_tasks_runtime_rejections_malformed`); when unresolved candidates are only `task_draft_class_missing`, runtime may discard them and carry over persisted draft rows with explicit `runtime_transition_carry_over` evidence instead of silent zero-generation fallback,
  - user-owned draft fields follow a `user wins` collision policy against concurrent `CREATE_TASKS` recompute writes; the machine-actionable contract lives in `plan/2026-03-21-voice-task-surface-normalization-spec-2.md`,
  - accepted session-task reads are served through `POST /api/voicebot/session_tasks` with `{ session_id, bucket: 'Ready+' }`; this bucket is accepted-only and `DRAFT_10` rows there are a bug (`copilot-f6z4`), not an allowed fallback.
- Default transcription/categorization rendering stays operator-first: metadata signatures are rendered after the corresponding text block (never before it), while fallback error signatures remain visible when the transcript body is missing.

## Minimal Delta To Remember (2026-02-26 / 2026-02-27)

This is the smallest set of changes agents must keep in mind when touching Voice/ontology code:

- Session close is REST-driven only (`POST /api/voicebot/session_done`, alias `/close_session`), and websocket is receive-only for close lifecycle.
- `Done` is expected to work from paused and recording states; failed close must not silently reset UI to closed/idle.
- Realtime message/session updates are mandatory (`new_message`, `session_update`, `message_update`) to avoid refresh-only workflows.
- Sessions list behavior is contract-bound:
  - quick tabs (`Все`, `Без проекта`, `Активные`, `Мои`),
  - persisted filter/toggle state,
  - forced include-deleted mode sync under load.
- Sessions status in list uses state pictograms aligned with session page semantics; legacy red-dot-only marker is deprecated.
- TS transcribe worker supports Telegram file recovery before transcription when local file path is missing.
- TypeDB tooling was hard-moved to `ontology/typedb/scripts/*`; backend npm aliases call those canonical scripts.
- Canonical generated ontology output is `ontology/typedb/schema/str-ontology.tql`; editable source fragments live in `ontology/typedb/schema/fragments/*.tql`.
- Generated inventory and sampling artifacts live in `ontology/typedb/inventory_latest/*`.
- Ontology operator workflow now includes `ontology:typedb:{build,contract-check,domain-inventory,entity-sampling,ingest:*,sync:*}`.
- Backend now boots a checked semantic-card runtime before Mongo/Redis:
  - `backend/src/services/ontology/ontologyCardRegistry.ts` loads annotated TQL `semantic-card` blocks from `ontology/typedb/schema/fragments/*`,
  - `backend/src/services/ontology/ontologyPersistenceBridge.ts` binds Mongo mapping entries to card-backed vs schema-only coverage,
  - `backend/src/services/ontology/ontologyCollectionAdapter.ts` is the strict field-translation surface for collections that already have card-backed coverage.
- Ontology architecture and rollout roadmap live in `ontology/plan/ontology-and-operations.md`.
- `copilot` ontology is the kernel/common layer; projects are expected to extend it via per-project overlays and SemanticCards under `/home/strato-space/<project-slug>/`.
- Direct TypeDB write discipline now uses DB-side owner-level `@values(...)` constraints for `task.status` and `task.priority` plus key TO-BE execution objects; Mongo task labels are normalized directly into canonical lifecycle keys and `P1..P7` priority before writing.
- Executor-layer ontology is now staged in the kernel plan/spec surface: `task_family`, `executor_role`, `executor_routing`, and `task_execution_run` are the canonical next-wave execution objects.
- Dual-stream execution semantics are fixed in `ontology/plan/voice-dual-stream-ontology.md`: draft tasks stay `task[DRAFT_10]`, `context_enrichment` is mandatory before launch, `human approval` is launch authorization (not final acceptance), and runtime flow is `executor_routing` -> `task_execution_run` -> `artifact_record` -> `acceptance_evaluation`.

## Interface Contracts (High Impact)

- `POST /api/voicebot/upload_audio`
- `POST /api/voicebot/session_done` (legacy `POST /api/voicebot/close_session` alias remains server-side only)
- `POST /api/voicebot/save_summary`
- `POST /api/voicebot/upload_attachment` and `POST /api/voicebot/attachment` (alias)
- Socket namespace `/voicebot` with room subscription `subscribe_on_session`
- Canonical session links: `https://copilot.stratospace.fun/voice/session/:id`

## FinOps notes
- FX rates are managed in `app/src/store/fxStore.ts` and recalculate RUB values in analytics, KPIs, and plan-fact tables.
- The Employees directory supports a chat-driven form fill that prompts for missing fields.
- Plan-fact months can be pinned (up to 3), and the totals row stays visible under pinned months.
- Compact plan-fact `Value`, `Forecast`, and `Fact` RUB cells must keep the amount on one line so dense month grids do not introduce row-height jitter from wrapped currency text.
- Plan-fact frontend uses API-only data (local `mockPlanFact` fallback and CRM snapshot badges were removed from pages/stores).
- Plan-fact project edits are persisted through `PUT /api/plan-fact/project`; backend propagates `contract_type` updates into facts/forecasts records for the same `project_id`.
- Forecast edits now require a non-empty comment, and forecast revision history is available through `GET /api/plan-fact/forecast-history` with UI access from the income grid drawer flow.
- The Expenses tab combines payroll and other costs, with category-level operations and sticky totals.
- Expense attachments are uploaded via `/api/uploads/expense-attachments` and served from `/uploads/expenses`.
- Guide directories fall back to mock data when the automation API is unavailable, and the Guide header includes a global Log sidebar.
- FinOps spec discovery/index for scope alignment is tracked in `docs/FINOPS_SPEC_DISCOVERY.md` (canonical vs mirror sources + open product questions).

## OperOps/CRM notes
- CRM components migrated from `automation/appkanban` live in `app/src/components/crm/`.
- CRM pages: CRMPage, PerformersPage, FinancesPerformersPage, ProjectsTree, TaskPage in `app/src/pages/operops/`.
- CRM stores: `kanbanStore.ts` (tickets, epics, performers), `crmStore.ts` (UI state), `projectsStore.ts` (project tree), `requestStore.ts` (API).
- Socket.IO events: TICKET_CREATED, TICKET_UPDATED, TICKET_DELETED, EPIC_UPDATED, COMMENT_ADDED, WORK_HOURS_UPDATED.
- Routes accessible at `/operops/*` with OperOpsNav horizontal navigation.
- CRM Kanban task details link must resolve by `id || _id` to prevent `/operops/task/undefined` navigation for records without public `id`.
- OperOps project create/edit flow now uses dedicated routes `/operops/projects-tree/new` and `/operops/projects-tree/:projectId`; `ProjectsTree` navigates there instead of reopening inline project modals.
- CRM project display/filtering should resolve project name from `project_data`/`project_id`/`project`; performer filter must handle mixed `_id` and legacy `id` values.
- CRM work-hours linkage is canonical by `ticket_db_id` (`automation_tasks._id`) across CRM API, Miniapp routes, and reporting services; legacy `ticket_id` is tolerated only as migration input.
- Task comments are canonical through `automation_comments`: ticket reads aggregate `comments_list`, and `POST /api/crm/tickets/add-comment` now resolves canonical task ids plus optional session-aware metadata (`comment_kind`, `source_session_id`, `discussion_session_id`, `dialogue_reference`).
- Task attachments are shared between CRM and Miniapp tickets:
  - CRM endpoints: `POST /api/crm/tickets/upload-attachment`, `GET /api/crm/tickets/attachment/:ticket_id/:attachment_id`, `POST /api/crm/tickets/delete-attachment`.
  - Miniapp endpoints: `POST /tickets/upload-attachment`, `GET /tickets/attachment/:ticket_id/:attachment_id`.
  - Storage/validation is centralized in `backend/src/services/taskAttachments.ts` under `uploads/task-attachments` (override `TASK_ATTACHMENTS_DIR`), allowlist `pdf/docx/xlsx/png/jpg/jpeg/txt/zip`, max `100MB`.
  - Multipart uploads with mojibake UTF-8 filenames are normalized back to readable UTF-8 before task metadata is stored or returned.
- Added backfill utility for historical work-hours rows missing `ticket_db_id`: `cd backend && npx tsx scripts/backfill-work-hours-ticket-db-id.ts --apply` (use without `--apply` for dry-run).
- Short-link generation/collision/route-resolution contract is documented in `docs/OPEROPS_TASK_SHORT_LINKS.md`.
- OperOps TaskPage metadata now includes `Created by`, resolved from task creator fields with performer-directory fallback.
- OperOps TaskPage metadata now includes `Source` with source kind and clickable external link (Voice/Telegram/manual fallback contract).
- Voice-linked task payloads may include `discussion_sessions[]` / `discussion_count`; the OperOps task page renders those links as a `Discussed in Sessions` timeline.
- Materialized Voice/OperOps task refs are normalized:
  - Mongo `_id` is the durable internal row identity,
  - `external_ref` is the authoritative source reference and must be unique per bd issue when the source system exposes a durable source id,
  - `source_ref` is the authoritative OperOps self URL,
  - `bd_external_ref` is a separate bd sync key used only for Codex issue creation.
- Accepted Voice task reuse is lineage-based and preserves the original `created_at`; repeated materialization updates the existing row instead of creating a fresh duplicate.
- Voice `Задачи` and `Codex` tabs now use a shared authoritative source matcher with OperOps Kanban (`source_ref`/`external_ref`/`source_data.session_*` + canonical session URL parsing); voice-session linkage must prefer `external_ref` when `source_ref` is the materialized OperOps self-link, so Source->Voice navigation keeps task visibility consistent.
- Shared `CodexIssuesTable` contract applies in both Voice and OperOps tabs, with strict status segmentation tabs (`Open` / `In Progress` / `Deferred` / `Blocked` / `Closed` / `All`) and per-tab counters.
- Codex issue details rendering is shared between OperOps and Voice via `CodexIssueDetailsCard`; Voice inline details drawer uses wide layout (`min(1180px, calc(100vw - 48px))`) and preserves Description/Notes paragraph breaks (`whitespace-pre-wrap`) for parity with OperOps task page.
- Voice Codex inline details now fetch the canonical `POST /api/crm/codex/issue` payload on drawer open, so comments and related metadata match the standalone OperOps Codex issue page.
- Codex issue IDs now use one token renderer across `Issue ID` and `Relationships` (blue link + copy action); relationship rows also show status pictograms (`open`, `in_progress`, `blocked`, `deferred`, `closed`, fallback).
- Single-issue OperOps Codex loads now share the JSONL fallback path with the list route: when `bd show` reports out-of-sync JSONL and `bd sync --import-only` fails with `bufio.Scanner: token too long`, `/api/crm/codex/issue` falls back to direct `.beads/issues.jsonl` parsing instead of returning `502`.
- Codex relationship groups are normalized in details card as `Parent`, `Children`, `Depends On (blocks/waits-for)`, and `Blocks (dependents)` for deterministic dependency reading.
- Performer selectors normalize Codex assignment to canonical performer `_id=69a2561d642f3a032ad88e7a` (legacy synthetic ids are rewritten) in CRM and Voice task-assignment flows.
- OperOps `TaskPage` must keep hook ordering stable across loading / not-found / loaded renders; discussion-session memoization must not sit below early returns or the page can blank-crash with React hook-order errors.
- OperOps main task navigation is status-first:
  - top-level tabs are `Draft`, `Ready`, `In Progress`, `Review`, `Done`, `Archive`, and `Codex`,
  - lifecycle counts belong inline in those tab labels,
  - duplicate top summary widgets with the same lifecycle labels/counts are not part of the target contract,
  - the `Draft` tab still renders the orphan/session-grouped possible-task backlog above the CRM table as presentation-only grouping,
  - accepted Voice tasks are treated as `Ready` work, not as a separate `Backlog` semantic bucket.
- OperOps Draft/Archive visibility is operator-controlled with explicit depth presets `1d / 7d / 14d / 30d / ∞`; the default fast list/count surface is `1d`, while `∞` means an unbounded read.
- Temporal coverage/date-depth planning wave is closed: `plan/closed/2026-26-03-voice-date-depth-and-range-fix-spec.md` is `Status ✅Closed`, and epic `copilot-xmcm` with child line `copilot-xmcm.*` is fully closed in `bd`.
- Media-bearing attachment transcription planning now has an explicit BD DAG decomposition in `plan/2026-03-27-voice-media-attachment-transcription-spec.md` (`copilot-qtcp` + `.1..7`) and should be executed as bounded swarm waves.
- OperOps CRM list performance is split by payload mode: `/api/crm/tickets` list views use `response_mode=summary`, while heavy ticket fields (`work_data`, `comments_list`, `attachments`, discussion/source payloads) are hydrated lazily through detail reads when drawers or editors open; Draft/Archive summary and status-count reads may prefilter recency through lightweight source/timestamp projections before trimming transient linkage fields from response payloads.

## Voice notes
- Voice UI is native in `app/` under `/voice/*` (no iframe embed).
- Voice API source of truth is local: `/api/voicebot/*` (flat contract + legacy aliases during migration).
- Runtime isolation is enforced by per-environment deployment/database boundaries; `runtime_tag` is not a canonical runtime filter contract.
- Voice admin/person/project payloads can be enriched with Telegram user/chat links and project-performer memberships; `POST /api/voicebot/project_performers` returns a permission-checked `{ project, performers }` payload backed by `automation_telegram_*` and `automation_project_performer_links`.
- `POST /api/voicebot/project_performers` must remain safe when a project keeps performer links but the active performer selector resolves to zero rows; enrichment should return an empty performer list instead of building Mongo queries with empty logical arrays.
- Telegram/project knowledge can be seeded into those collections with `cd backend && npm run telegram:knowledge:seed:dry` or `cd backend && npm run telegram:knowledge:seed:apply`.
- Telegram knowledge seeding now reuses shared routing-project extraction (`backend/src/utils/routingConfig.ts`) so routing topics, project names, and project aliases resolve consistently when one routing item carries multiple project sources.
- Telegram seed rollout/rollback contract lives in `ontology/plan/telegram-knowledge-seed-rollout.md`.
- WebRTC FAB script should be loaded from same-origin static path (`/webrtc/webrtc-voicebot-lib.js`) via `VITE_WEBRTC_VOICEBOT_SCRIPT_URL`.
- Upload route (`/api/voicebot/upload_audio`) immediately emits socket events `new_message` + `session_update` into `voicebot:session:<session_id>` so new chunks appear without waiting for polling.
- Upload route defaults to a 600MB audio cap (`VOICEBOT_MAX_AUDIO_FILE_SIZE`, falling back to `VOICEBOT_MAX_FILE_SIZE` only when explicitly configured lower/higher); route-contract tests should override the limit locally instead of allocating production-scale payloads.
- Upload route remains valid for canonical Voice sessions even after the session becomes inactive; late/manual retry uploads should be evaluated against session existence/access rules, not rejected solely because `is_active=false`.
- Upload route returns structured oversize diagnostics (`413 file_too_large` with max-size metadata), and WebRTC upload client normalizes these payloads into concise UI-safe error messages.
- Upload route propagates `request_id` in success/error payloads and logs (`X-Request-ID` passthrough or generated fallback), and WebRTC surfaces this id in upload diagnostics.
- Upload route accepts audio-only recorder blobs mislabeled as `video/webm` and normalizes persisted/session-response MIME to `audio/webm`.
- ASR media handling is single-file-first: video inputs are always staged to extracted audio before transcription, oversized inputs attempt low-bitrate re-encode before segmented mode when chunk fan-out would exceed the hard cap, and the worker fails safely instead of dropping tail audio if a split still tries to exceed `8` chunks.
- Transcribe persistence now records forensic ASR fields `source_media_type`, `audio_extracted`, `asr_chunk_count`, `chunk_policy`, and `chunk_cap_applied` so operators can distinguish raw audio, video-audio staging, and capped segmentation outcomes.
- Upload route now has explicit upstream-failure shaping: Nginx intercepts `502/503/504` for `/api/voicebot/upload_audio` and returns structured JSON `503 backend_unavailable`, while WebRTC client keeps chunk in failed/manual-retry state and shows actionable retry guidance.
- Session upload flow consumes pending image anchors (`pending_image_anchor_message_id` / `pending_image_anchor_oid`): first uploaded chunk is linked with `image_anchor_message_id`, then pending anchor markers are cleared.
- Categorization updates are now delivered via websocket `message_update` events (no page refresh required): processor workers push `SEND_TO_SOCKET` jobs, backend consumes them and broadcasts to `voicebot:session:<session_id>`.
- `CREATE_TASKS` realtime delivery is Mongo-first and session-room based: workers persist refreshed Possible Tasks first, then enqueue `session_update.taskflow_refresh.possible_tasks` so all viewers refresh from canonical backend state.
- `Possible Tasks` recompute is driven by successful transcript chunks; it is no longer tied to session completion or to categorization completion.
- Voice draft reads now come from session-linked `DRAFT_10` task docs, dedupe by row lineage, and surface `discussion_sessions[]` / `discussion_count` for repeated-discussion visibility.
- Manual session-page `Tasks` refresh now carries `refresh_correlation_id` / `refresh_clicked_at_ms` from click -> backend completion log -> realtime hint so end-to-end refresh latency can be traced without browser-side MCP.
- `process_possible_tasks` is now non-destructive:
  - selected rows materialize into `READY_10`,
  - accepted rows keep `source_kind = voice_session`,
  - cleanup removes them from draft views but must not soft-delete the materialized task document.
- Draft reconcile no longer keeps an operational stale baseline: rows absent from the current desired set leave the live draft surface, while accepted-task/session-count reads ignore stale compatibility rows if any still exist.
- Voice task discussion linkage is visible in UI: `Possible Tasks` shows discussion count, and OperOps `TaskPage` links back to the related Voice sessions.
- Target task-surface normalization is now partially landed in runtime:
  - Voice session task counters normalize legacy stored statuses into the target lifecycle axis,
  - generic CRM status pickers now expose only the target editable subset (`Draft`, `Ready`, `In Progress`, `Review`, `Done`, `Archive`),
  - miniapp treats recurring work as lifecycle work plus recurring metadata instead of a standalone `Periodic` bucket.
  - manual `Summarize` no longer hard-fails just because a session has no `project_id` and no default `PMO` project exists; backend continues with `project_id=null` and the frontend surfaces backend error text instead of a raw Axios wrapper.
- Voice session `Задачи` count excludes draft rows with `source_kind = voice_possible_task`; the tab now reflects accepted tasks only.
- Repaired materialized rows can be restored with:
  - `cd backend && npm run voice:repair:softdeleted-materialized:dry -- --session <session_id>`
  - `cd backend && npm run voice:repair:softdeleted-materialized:apply -- --session <session_id>`
- Legacy Voice/CRM status cleanup has now been applied directly in Mongo for the current status field only; the checked-in one-off migration helpers were removed after the live cleanup wave completed.
- The same authoritative source-reference contract also applies to repaired/session-scoped task matching: reads must honor `source_data.voice_sessions[].session_id` in addition to session URLs carried in `source_ref` / `external_ref`, so accepted tasks remain visible after status migration and repair.
- `POST /api/voicebot/save_summary` now reuses `summary_correlation_id` to reconcile a pending `summary_save` audit row to `done` instead of inserting a duplicate event when done-flow automation and manual save meet on the same session.
- Transcribe worker now emits realtime `message_update` events for both success and failure branches, so pending/error rows appear in Transcription tab without manual refresh.
- OpenAI recovery-retry semantics are unified across transcribe/categorize/processing loop repair: both `insufficient_quota` and `invalid_api_key` are treated as retryable states with canonical retry metadata and operator-facing diagnostics.
- `POST /api/voicebot/transcription/retry` is message-driven: it re-arms session messages for transcription (`to_transcribe=true`, attempts reset, retry delay cleared), clears session-level transcription error markers, and returns processing-loop mode diagnostics (`processing_mode`, `messages_marked_for_retry`).
- Post-transcribe garbage detection now runs in worker flow (`backend/src/services/voicebot/transcriptionGarbageDetector.ts`, default `gpt-5.4-nano`): garbage chunks are marked via `garbage_detection`, categorization/`CREATE_TASKS` enqueue is skipped, and a `transcription_garbage_detected` session-log event is emitted.
- The garbage detector now has a local repeated-ngram shortcut for obvious silence hallucinations before it falls back to the LLM classifier; this path should remain precision-first and covered by regression tests.
- Transcription fallback rows with `transcription_error` render metadata signature footer (`mm:ss - mm:ss, file.webm, HH:mm:ss`) and are replaced in place when realtime `message_update` brings transcript text.
- Transcription metadata signatures and fallback footers normalize UTF-8-as-Latin1 mojibake filenames from message/attachment metadata before rendering file labels.
- The default Transcription table view intentionally hides raw attachment projection/debug metadata; metadata signatures stay below the text block and only actionable skip/error state belongs inline with the operator-facing body text.
- Voice socket reconnect now performs session rehydrate and ordered upsert (`new_message`/`message_update`) to prevent live-state drift after transient disconnects.
- Voice websocket must use the `/voicebot` namespace (`getVoicebotSocket`), not the root namespace (`/`), otherwise session subscriptions (`subscribe_on_session`) are ignored.
- `subscribe_on_session` must replay a `session_update.taskflow_refresh.possible_tasks` hint so reconnecting session pages refetch canonical possible-task state even if an earlier realtime hint was missed.
- `POST /api/voicebot/sessions/get` follows fail-fast lookup semantics and returns `404 Session not found` when the session cannot be resolved in canonical scope.
- Categorization table no longer renders `Src` and `Quick Summary` columns (`copilot-eejo`); phase-1 view is status + text + `Materials` with sortable order.
- Session close initiation is REST-first: clients call `POST /api/voicebot/session_done` and fail fast on errors; websocket is used for server-originated realtime updates only (`session_status`, `session_update`, `new_message`, `message_update`).
- Voice session header includes a `Tasks` action before `Summarize`; it generates possible tasks from current meeting context without waiting for session close.
- Voice session header top action row now owns both `Скачать Транскрипцию` and `Загрузить аудио`; `SessionStatusWidget` is status-only and no longer owns upload controls.
- Voice session tabs now show compact counts for `Транскрипция`, `Категоризация`, `Задачи`, `Codex`, and `Screenshort`; `Log` stays count-free.
- `Задачи` is the unified session task surface: the parent tab keeps total count, and the subtab list must come from backend `status_counts` (`voicebot/session_tab_counts`) with no fallback to legacy `tasks_work_count` / `tasks_review_count`.
- Inside `Задачи`, lifecycle subtabs are status-first (`Draft`, `Ready`, `In Progress`, `Review`, `Done`, `Archive`) and show the per-status count inline in the label.
- The lifecycle subtab axis inside `Задачи` must remain visible even when every bucket count is zero; empty state belongs inside the selected lifecycle bucket, not instead of the lifecycle filter row.
- The parent `Задачи` count must include all lifecycle buckets, including `Draft`, and it must be computed from the canonical exact-key lifecycle buckets only.
- Frontend Voice task tabs must translate backend status labels back into canonical CRM status keys before filtering `CRMKanban`; label strings are not valid task-status filter inputs by themselves.
- Voice and OperOps task displays must render target labels (`Draft`, `Ready`, `In Progress`, `Review`, `Done`, `Archive`) rather than raw stored labels like `Progress 10` or `Review / Ready`.
- `Codex` badge is computed from the same session-scoped Codex issue source/filter as the `Codex` tab content itself.
- `Транскрипция`, `Категоризация`, and `Задачи` show a slow green processing dot only while live runtime work is still active; closed/inactive/finalized sessions suppress stale dots even if historical payloads remain incomplete.
- WebRTC REST close diagnostics now always include `session_id` in client warning payloads (`close failed`, `close rejected`, `request failed`) to speed up backend correlation.
- `Done` in WebRTC now runs bounded auto-upload draining and marks remaining failed chunk uploads for explicit retry instead of indefinite automatic loops.
- WebRTC page `Done` stays enabled from `paused` in embedded Settings/Monitor contexts whenever active/session state exists, even without `pageSession` in the iframe URL.
- WebRTC FAB now surfaces a red `Mic 1 OFF` critical state during `recording` / `paused` / `cutting`, and missing saved Mic 1 devices downgrade deterministically `LifeCam -> Microphone -> OFF`.
- WebRTC close path no longer emits `session_done` from browser Socket.IO; FAB/page/yesterday close flows use the same REST close endpoint for deterministic behavior across host/path variants.
- WebRTC unload persistence now stores any non-recording state as `paused` to avoid stale auto-resume after refresh/unload races.
- Full-track recording segments are represented as `full_track` in Monitor/UI with duration and timestamp metadata, but upload to backend is intentionally disabled until diarization workflow is enabled.
- Voice workers schedule periodic `PROCESSING` scans in TS runtime; default background scans still skip ordinary waiting sessions, but prioritized scans must include waiting sessions when message rows carry retryable transcription/categorization work.
- TS `processingLoop` now also prioritizes sessions inferred from pending message backlog (including rows with `is_messages_processed=true`), requeues categorization after quota cooldown via processors queue, and restores waiting-session transcription rows after balance recovery when they are marked with canonical retry reasons such as `insufficient_quota`.
- TS transcribe handler deduplicates repeated uploads by file hash (`file_hash` / `file_unique_id` / `hash_sha256`) and reuses existing session transcription before new OpenAI requests.
- Historical WebRTC duplicates can be collapsed by filename per session via backend script:
  - dry run: `cd backend && DOTENV_CONFIG_PATH=.env.production npm run voice:dedupe:webm:dry`
  - apply: `cd backend && DOTENV_CONFIG_PATH=.env.production npm run voice:dedupe:webm:apply`
  - rules: only non-Telegram `*.webm` messages, grouped by `(session_id, file_name)`, keep one most relevant message and mark the rest `is_deleted=true`.
- Idle active sessions can be auto-closed via backend script:
  - dry run: `cd backend && DOTENV_CONFIG_PATH=.env.production npm run voice:close-idle:dry -- --inactive-minutes=10`
  - dry run (LLM/automation JSON): `cd backend && DOTENV_CONFIG_PATH=.env.production npm run voice:close-idle:dry -- --inactive-minutes=10 --json`
  - dry run (streaming JSONL): `cd backend && DOTENV_CONFIG_PATH=.env.production npm run voice:close-idle:dry -- --inactive-minutes=10 --jsonl`
  - apply: `cd backend && DOTENV_CONFIG_PATH=.env.production npm run voice:close-idle:apply -- --inactive-minutes=10`
  - `--inactive-hours` remains accepted as an operational override, but the canonical operator surface is minutes-first with default `10`.
  - activity window uses latest session update/message/session-log timestamps; idle sessions are closed through canonical `DONE_MULTIPROMPT` orchestration and auto-generate a missing title through composite `create_tasks.session_name` before completion.
- Production voice workers also schedule `CLOSE_INACTIVE_SESSIONS` automatically; tune with `VOICEBOT_CLOSE_INACTIVE_SESSIONS_{ENABLED,INTERVAL_MS,TIMEOUT_MINUTES,BATCH_LIMIT}`.
- Summarize MCP dependency watchdog is available for `session_ready_to_summarize` prerequisites:
  - dry run: `cd backend && DOTENV_CONFIG_PATH=.env.production npm run voice:summarize-mcp-watchdog:dry`
  - dry run JSON: `cd backend && DOTENV_CONFIG_PATH=.env.production npm run voice:summarize-mcp-watchdog:dry -- --json`
  - apply (auto-heal): `cd backend && DOTENV_CONFIG_PATH=.env.production npm run voice:summarize-mcp-watchdog:apply`
  - checks required endpoint/service mappings: `fs`, `tg-ro`, `call`, `seq`, `tm`, `tgbot`.
  - remediation is targeted: inactive `mcp@*` units are started, active units with endpoint `502`/unreachable probes are restarted.
- Incident-grade voice session forensics are canonical through `cd backend && npm run voice:session:forensics -- --session <session_id> --bundle-dir ../tmp/voice-investigation-artifacts/<run-id>-<session_id>`; the standard bundle is `index.json`, `index.md`, per-session JSON/Markdown reports, queue snapshots, PM2 log hits, and a linked `bd` verdict. The operator workflow lives in `docs/VOICE_SESSION_FORENSICS_PLAYBOOK.md`.
- Empty stale sessions can be cleaned in worker runtime by scheduled `CLEANUP_EMPTY_SESSIONS` jobs (no-message sessions older than configured threshold are marked `is_deleted=true`):
  - env knobs: `VOICEBOT_EMPTY_SESSION_CLEANUP_INTERVAL_MS`, `VOICEBOT_EMPTY_SESSION_CLEANUP_AGE_HOURS`, `VOICEBOT_EMPTY_SESSION_CLEANUP_BATCH_LIMIT`.
- Voice sessions list supports deleted-session mode (`include_deleted` / `Показывать удаленные`); creator/participant filters suppress numeric identity placeholders and keep only human-readable labels.
- Sessions-list visibility contract is canonical in runtime/tests: non-deleted sessions with `is_active=false` and `message_count=0` must stay hidden from list responses; parity fixtures should provide explicit message-count aggregates.
- Voice sessions list now persists active tab + filter set in local storage and restores them on reopen; current quick tabs are `Все`, `Без проекта`, `Активные`, `Мои`.
- Voice sessions list forces a mode-sync refetch when `showDeletedSessions` intent changes during an in-flight load (`force=true` bypasses loading short-circuit for this case).
- Voice sessions list fetch must remain independent from project/person hydration; metadata warm-up should not retrigger `/api/voicebot/sessions/list`, and canonical row ordering now lives in the store.
- Voice sessions list backend path now batches `message_count` and session task counters instead of doing per-row fan-out work; startup indexes must include `automation_voice_bot_messages.session_id` for this route.
- Voice sessions list supports bulk delete for selected active rows (`Удалить выбранные`) with confirmation and safe exclusion of already deleted sessions.
- Voice sessions list state marker is now a dedicated pictogram column aligned with session state semantics (`recording`, `cutting`, `paused`, `final_uploading`, `closed`, `ready`, `error`).
- Session read path normalizes stale categorization rows linked to deleted transcript segments (including punctuation/spacing variants) and saves cleaned `processed_data`.
- Session read path force-clears categorization rows when all transcript segments are deleted in a message, so UI does not show orphan categorization tails after full transcript deletion.
- Categorization table contract is now `Time | Audio | Text | Materials`; the old processing (`Обработка`) column/renderer path was removed.
- Categorization rows now use stable identity (`row_id`/`segment_oid` priority + deterministic fallback), so selection/actions are row-local and collision-safe.
- Categorization rows support Copy/Edit/Delete actions via backend routes `POST /api/voicebot/edit_categorization_chunk` and `POST /api/voicebot/delete_categorization_chunk`.
- Categorization mutation APIs emit realtime `message_update` + `session_update`, and return deterministic validation/runtime errors (`invalid_row_oid`, `message_session_mismatch`, `ambiguous_row_locator`, `row_already_deleted`, etc.).
- Deleting the last active categorization row cascades deletion of the linked transcript segment with compensating rollback when log persistence fails.
- Image attachments in categorization are rendered only in the Materials column; image-only blocks remain visible without image-as-text rows.
- Session-scoped taskflow parity is now canonical across backend + Voice UI + mcp@voice:
  - backend route `POST /api/voicebot/session_tasks` exposes canonical `Draft/Ready+/Codex` buckets only (no lowercase aliases/fallback), with draft reads served as `{ session_id, bucket: 'Draft' }`,
  - mutations emit `session_update.taskflow_refresh` flags for `possible_tasks` / `tasks` / `codex`,
  - possible-task saves can carry `refresh_correlation_id` and `refresh_clicked_at_ms`; backend persists/logs these values and echoes them in `session_update.taskflow_refresh` for end-to-end latency diagnostics,
  - frontend consumes those hints with additive refresh tokens so the unified `Задачи` surface and `Codex` refresh without manual reload,
  - assistant workflow is fixed to `discuss -> preview -> apply -> verify`.
- Voice message grouping links image-anchor rows to the next transcription block and suppresses duplicate standalone anchor groups; transcription rows now show inline image previews when image attachments are present.
- Web pasted images are persisted via backend upload endpoint (`POST /api/voicebot/upload_attachment`, alias `/api/voicebot/attachment`) into `backend/uploads/voicebot/attachments/<session_id>/<file_unique_id>.<ext>`.
- Session page no longer has a separate `Возможные задачи` top tab; draft rows are rendered inside unified `Задачи` when the selected lifecycle subtab is `DRAFT_10`.
- Possible tasks are persisted as master Mongo tasks in `automation_tasks` with `task_status=DRAFT_10`; session-local taskflow payloads are not a valid Draft read source.
- The first production write/read slice now runs through the ontology runtime:
  - `POST /api/voicebot/save_possible_tasks` writes task core fields through the card-backed `automation_tasks` adapter,
  - `POST /api/voicebot/session_tasks` with `{ session_id, bucket: 'Draft' }` validates the same Draft-master scalar subset plus lineage/lifecycle invariants before API normalization, but keeps read-time compatibility for legacy `source_kind='voice_session'` rows while write-time persistence remains strict on `source_kind='voice_possible_task'`,
  - structured compatibility payloads (`source_data`, `dependencies`, `dependencies_from_ai`, `status_history`, `task_status_history`, `comments_list`) and compatibility-only overlays (`relations`, `parent`, `children`, `discussion_sessions`) remain deferred outside the strict validated subset in this wave.
- Desktop Possible Tasks is a matched-height master/detail workspace: list and detail panes should use the same taller shell, and the detail card must not depend on an inner forced full-height scroller just to be readable.
- Voice session status footer (`Все сообщения обработаны` / processor chips) belongs to normal page flow after the central workspace content; it must not be fixed to the viewport bottom or overlap `Транскрипция`, `Категоризация`, or `Задачи`.
- Possible Tasks validation no longer requires `task_type_id`; blocking required fields are `name`, `description`, `performer_id`, and `priority`.
- Canonical task priorities in backend, Mongo, API payloads, and ontology surfaces are plain text `P1..P7`; urgent flame styling is presentation-only in frontend pills and must not be persisted as `🔥 P1`-style values.
- Possible Tasks session table no longer exposes editable `task_type_id` and `dialogue_tag` columns; create payload stays canonical for required operational fields.
- Possible Tasks creation flow now emits structured submit diagnostics in browser console:
  - `create_selected.aborted`
  - `create_selected.submit`
  - `process_possible_tasks.request`
  - `process_possible_tasks.response`
  - `create_selected.result`
  - `create_selected.validation_failed`
  - `create_selected.failed`
- CREATE_TASKS payloads are normalized to canonical `id/name/description/priority/...` shape in both worker (`createTasksFromChunks`) and API utility (`save_create_tasks`) write paths.
- Manual `POST /api/voicebot/generate_possible_tasks` and background `CREATE_TASKS` worker refresh now share one composite side-effect contract: session `summary_md_text` / `review_md_text` / generated `session_name` / `project_id`, Ready+ enrichment comments, Codex note enrichment, processor success markers, and `session_update.taskflow_refresh.summary` when summary text exists.
- Taskflow row-locator priority is canonical `row_id -> id -> task_id_from_ai`; `task_id_from_ai` remains a legacy fallback for mutation compatibility, not the primary row identity.
- Historical CREATE_TASKS legacy payload migration runbook is archived in `docs/archive/VOICEBOT_CREATE_TASKS_MIGRATION.legacy.md` (verify/apply/post-check + rollback).
- Categorization metadata signature is rendered once per message block footer (`mm:ss - mm:ss, source_file_name, HH:mm:ss`) instead of repeating per row; row focus uses blue selection only.
- Categorization readability contract now uses larger typography in `Time/Audio/Text/Materials` columns for dense session review.
- Session summary now has a canonical persistence path:
  - backend route `POST /api/voicebot/save_summary` validates `{ session_id, md_text }` and writes `summary_md_text` + `summary_saved_at`,
  - backend emits realtime `session_update.taskflow_refresh.summary`,
  - frontend exposes `Саммари` as a top-level read/edit tab bound to those canonical fields instead of rendering a second summary panel under `Категоризация`.
- Session-title generation is fail-fast and traceable:
  - frontend title generation uses stage-level timeouts and `finally` cleanup so `Генерирую заголовок` cannot spin forever,
  - backend composite analyzer path logs `session_name` generation correlations with `requestId` + `session_id` for incident triage.
- Done-flow summarize orchestration now propagates `summary_correlation_id` and writes summary audit events (`summary_telegram_send`, `summary_save`) with idempotency keys to session log.
- TS categorization/create-tasks chain treats non-text placeholders (`image`, `[Image]`, `[Screenshot]`) as non-blocking: rows are marked processed with empty categorization, and `CREATE_TASKS` can finalize without waiting on uncategorizable chunks.
- Session toolbar and FAB keep unified control order `New / Rec / Cut / Pause / Done`; `Rec` activates page session before routing to FAB control, while status badge follows runtime states (`recording`, `paused`, `finalizing`, `error`, `closed`, `ready`).
- Transcription/Categorization tables support client-side chronological direction switching (up/down) with preference persisted in local storage.
- Screenshot attachments now display canonical absolute URLs with `public_attachment` priority (`direct_uri`), and expose hover-only copy-link action in card footer.
- Screenshort cards keep `https://...` links fully visible, while `data:image/...;base64,...` values are displayed in truncated preview form (`data:image/...;base64,...`) and copied in full through the hover Copy action.
- Voice task creation in Copilot runtime no longer requires `task_type_id`; missing type is no longer a hard blocker in ticket/task generation.
- `copilot-voicebot-tgbot-prod` runs TypeScript runtime from `backend/dist/voicebot_tgbot/runtime.js` with `backend/.env.production` as the single env source.
- TS tgbot runtime protects against duplicate pollers using env-stable Redis distributed lock key (`voicebot:tgbot:poller_lock` + env suffix); lock loss triggers controlled shutdown to prevent split Telegram update consumption.
- `copilot-voicebot-workers-prod` runs TypeScript worker runtime from `backend/dist/workers/voicebot/runtime.js` (`npm run start:voicebot-workers`) via `scripts/pm2-voicebot-cutover.ecosystem.config.js`; queue workers consume all `VOICEBOT_QUEUES` and dispatch through `VOICEBOT_WORKER_MANIFEST` with `backend/.env.production`.
- `copilot-backend-prod` and `copilot-miniapp-backend-prod` now parse `backend/.env.production` into explicit PM2 app `env`, so runtime secrets like `OPENAI_API_KEY` are authoritative to the env file and cannot drift from inherited shell/daemon variables.
- Production bootstrap `./scripts/pm2-backend.sh prod` is responsible for recreating missing `copilot-voicebot-workers-prod` / `copilot-voicebot-tgbot-prod` runtimes, not only restarting already-existing PM2 entries.
- Canonical post-reboot/deploy readiness smoke: `./scripts/pm2-runtime-readiness.sh prod` (machine-readable JSON; non-zero exit on missing mandatory runtime).
- Canonical notify-upstream smoke: `./scripts/voice-notify-healthcheck.sh --env-file backend/.env.production` (machine-readable JSON; non-zero exit on non-2xx/transport failure).
- Backend API process runs dedicated socket-events consumer (`startVoicebotSocketEventsWorker`) for `voicebot--events-*` queue and uses Socket.IO Redis adapter for cross-process room delivery.
- TS transcribe handler never silently skips missing transport now: Telegram messages with `file_id` but without local `file_path` are marked `transcription_error=missing_transport` with diagnostics; text-only chunks without file path are transcribed via `transcription_method=text_fallback` and continue categorization pipeline.
- TS transcribe handler additionally supports Telegram transport recovery: for `source_type=telegram` + `file_id` + missing local file path it resolves `getFile`, downloads audio into local storage, persists `file_path`, and continues transcription in the same job.
- Attachment-origin audio/video payloads now use the same normalized projection contract as voice chunks: reads and realtime payloads expose `primary_payload_media_kind`, `primary_transcription_attachment_index`, `classification_resolution_state`, `transcription_eligibility`, `transcription_processing_state`, and attachment-level classification/skip metadata instead of treating `message_type=document` as a hard ASR skip.
- Pending attachment classification is explicit: `POST /api/voicebot/transcription/resolve_classification` is the operator/manual-review path, `processingLoop` and `restart_corrupted_session` preserve `pending_classification | pending_transcription | classified_skip | transcription_error` states, and ineligible media remains a deterministic skip until resolution changes.
- TS transcribe handler now supports media-bearing attachments end-to-end: nested attachment transport anchors can be promoted to top-level fields, video payloads are staged to mono 16k Opus via `ffmpeg` before ASR, deterministic `transcription_job_key` guards demote stale attachment jobs atomically, and legacy `legacy_attachment` placeholders can be repaired through `POST /api/voicebot/repair_legacy_attachment_media`.
- Voice backend exposes session-merge scaffolding (`voicebot/sessions/merge`) with explicit confirmation phrase and merge-log collection support (`automation_voice_bot_session_merge_log`).

### Voice TypeScript migration status (from closed BD issues)
- Runtime entrypoints migrated to TS:
  - `backend/src/voicebot_tgbot/runtime.ts` (`copilot-b2t`, `copilot-f1g`, `copilot-h84`)
  - `backend/src/workers/voicebot/runtime.ts` + manifest/runner (`copilot-ovg`)
- Core worker handlers migrated to TS (`copilot-6jm`, `copilot-lnu`, `copilot-lcf`):
  - `backend/src/workers/voicebot/handlers/{transcribe,categorize,finalization,processingLoop,summarize,questions,customPrompt,createTasksFromChunks,doneMultiprompt,...}.ts`
- Legacy runtime subtree was removed from this repo under `copilot-vsen`; historical implementation references live in external repo `/home/strato-space/voicebot`.
- JS cleanup completed for confirmed dead artifact: removed `sandbox-assets/ui-miniapp/app.js` (no runtime references in copilot).

### Voice migration planning docs
- Primary frontend migration decision log: `docs/MERGING_FRONTENDS_VOICEBOT.PLAN.md`
- Program-level migration source: `docs/MERGING_PROJECTS_VOICEBOT_PLAN.md`
- Playwright parity source: `docs/PLAYWRIGHT_MIGRATION_MATRIX.md`
- All three docs are synced from closed `bd list --all` items and use status legend `[v] / [x] / [~]`.
- This plan is maintained against closed `bd` issues and includes an explicit contradiction section between old assumptions and implemented behavior.
- Current open migration backlog is tracked only in `bd`; as of the latest refresh there are no open P1 frontend migration tasks.
- Legacy implementation history remains in external repo: `/home/strato-space/voicebot`
- Synced legacy planning references copied for context now live in `plan/session-managment.md` and `plan/gpt-4o-transcribe-diarize-plan.md`.
- Unified draft for next implementation wave lives in `plan/closed/voice-operops-codex-taskflow-spec.md` (Voice ↔ OperOps ↔ Codex contract and rollout phases).
- Current Voice task surface contract lives in `plan/closed/voice-task-surface-normalization-spec.md`; active runtime semantics use only the canonical six lifecycle statuses and strict status-key filtering.
- Voice session task edit parity with OperOps CRM is tracked separately in `plan/voice-session-task-edit-parity-spec.md`.
- Status-first Voice/OperOps surface convergence now lives in `plan/closed/voice-task-surface-normalization-spec.md` as the active contract; the old as-built Voice status plan is archived in `plan/archive/voice-task-status-normalization-plan.legacy.md`.
- Discussion-linking / ontology follow-up specs for the current Voice task wave live in:
  - `ontology/plan/voice-dual-stream-ontology.md`
  - `plan/2026-03-18-voice-task-session-discussion-linking-spec.md`
  - `plan/voice-non-draft-discussion-analyzer-contract.md`
  - `plan/2026-03-21-voice-task-surface-normalization-spec-2.md`
- Local delivery/process scratchpad lives in `methodology/index.md`.
- MPIC methodology review and artifact-graph corrections are documented in `ontology/plan/mpic-process-review.md`.


### Voice runtime: key configuration map
- OpenAI key is a shared variable: `OPENAI_API_KEY`.
  - Copilot backend: `backend/src/api/routes/voicebot/llmgate.ts`.
  - TS workers/tgbot runtime: `backend/src/workers/voicebot/*` and `backend/src/voicebot_tgbot/*`.
- Runtime/instance settings:
  - `APP_ENV` — canonical environment discriminator for env-stable queue/lock suffixing.
  - `VOICE_RUNTIME_ENV` / `VOICE_RUNTIME_SERVER_NAME` — transitional runtime metadata (not isolation source-of-truth).
  - `DOTENV_CONFIG_PATH`, `DOTENV_CONFIG_OVERRIDE` — explicit env file source for cutover startup.
- Telegram identity:
  - `TG_VOICE_BOT_TOKEN` (prod family)
  - `TG_VOICE_BOT_BETA_TOKEN` (non-prod runtime)
- OpenAI/LLM knobs:
  - `OPENAI_BASE_URL` (default `https://api.openai.com/v1`)
  - `VOICEBOT_CATEGORIZATION_MODEL` (default `gpt-4.1`)
- Transcription errors persist diagnostics (`openai_key_mask`, `openai_key_source`, `openai_api_key_env_file`, `server_name`) for quota/file-path incident analysis; key mask format is normalized to `sk-...LAST4`.
- Storage and services:
  - `OPENAI_*` keys are loaded from `backend/.env.production` for backend API, TS workers, and TS tgbot runtime.
  - `MONGO_*`, `REDIS_*`, `MAX_FILE_SIZE`, `UPLOADS_DIR` remain service-specific.

### Voice agents integration (frontend -> agents)
- Agent cards live in `agents/agent-cards/*` and are served by Fast-Agent on `http://127.0.0.1:8722/mcp` (`/home/strato-space/copilot/agents/pm2-agents.sh`).
- PM2 runtime launches agents through the repo-local bootstrap `uv run --directory /home/strato-space/copilot/agents python run_fast_agent.py serve ...`; the bootstrap owns repo-local runtime model registrations/profiling hooks while the default model still comes from `agents/fastagent.config.yaml`.
- PM2 agents runtime may pin a repo-local Codex OAuth file via `CODEX_AUTH_JSON_PATH`; local/prod runtime can use `agents/.codex/auth.json` instead of depending on the host-global Codex auth file.
- Backend `create_tasks` quota recovery is now self-healed server-side: on quota-class MCP failure the backend compares `/root/.codex/auth.json` with `agents/.codex/auth.json`, copies only when contents differ, restarts `copilot-agent-services` once, then retries the MCP call once.
- Backend `create_tasks` quota recovery retry waits for local agents MCP readiness (`http://127.0.0.1:8722/mcp`) after `copilot-agent-services` restart to avoid immediate `ECONNREFUSED` races.
- The same recovery path now treats invalid-key / `401 unauthorized` agent-runtime failures as recoverable auth drift for one automatic retry.
- The offline session-title utility `backend/scripts/voicebot-generate-session-titles.ts` uses the same quota-recovery rule and therefore avoids no-op agent restarts when the auth file is already up to date.
- `create_tasks` card no longer hardcodes model; runtime default is taken from `agents/fastagent.config.yaml`.
- Voice draft visibility is now caller-policy driven:
  - `POST /api/voicebot/session_tasks` and `POST /api/voicebot/session_tab_counts` accept optional `draft_horizon_days`
  - if omitted, `DRAFT_10` remains the full canonical baseline
  - for session-local reads the horizon is evaluated against the task's linked discussion window in both directions around the current session
- Current create_tasks overflow / payload investigation notebook lives in `docs/CREATE_TASKS_CONTEXT_OVERFLOW_PROFILING_2026-03-21.md`; temporary voice investigation artifacts were moved out of `plan/` into `tmp/voice-investigation-artifacts/`.
- Runtime key drift baseline for OpenAI-backed services is tracked in `docs/COPILOT_OPENAI_API_KEY_RUNTIME_STATE_2026-03-17.md` (live PM2 `OPENAI_API_KEY` mask, `backend/.env.production` value, and agents Codex OAuth account/model mode).
- Auth sync and model sync are canonical:
  - source of truth: `/root/.codex/auth.json`
  - runtime copy: `agents/.codex/auth.json`
  - runtime `default_model` is pinned to `gpt-5.4-mini`
  - auth recovery may restart agents and restore the same `gpt-5.4-mini` default after sync
- `create_tasks` now expects a structured JSON envelope inside `message` and enriches context directly through MCP `voice`; it must not route through `StratoProject` execution.
- `create_tasks` prompt is compact-session-first: it must tolerate sparse project cards, current Mongo possible-task rows (`VOICE_BOT` / `voice_possible_task` / empty `project_id` or `performer_id`), and split sequential deliverables instead of collapsing them into one task.
- Session-backed `create_tasks` uses `voice.fetch(..., mode="transcript")` as canonical metadata source and reads a single project card through `voice.project(project_id)` when transcript metadata includes a project id.
- Backend `runCreateTasksAgent(...)` derives a bounded `project_crm_window` from message/session timing using `VOICEBOT_PROJECT_CRM_LOOKBACK_DAYS` (default `14`, backend clamp `1..30`) and keeps project-wide CRM reads bounded; unbounded project CRM is not part of the active contract.
- Composite `create_tasks` output is the canonical session-naming path; standalone title agent cards are no longer part of the active runtime contract.
- Frontend trigger points:
  - AI title button in `/voice/session/:id` calls MCP tool `create_tasks` and consumes `session_name` from the composite output.
  - CRM "restart create_tasks" flow calls MCP tool `create_tasks`.
  - Session-page `Tasks` button in `/voice/session/:id` now calls backend `POST /api/voicebot/generate_possible_tasks`, which delegates to backend `runCreateTasksAgent(...)`, persists canonical draft rows, and inherits server-side quota recovery before returning refreshed items.
  - successful transcript completion in TS worker runtime auto-enqueues `CREATE_TASKS`, persists refreshed `DRAFT_10` master rows into `automation_tasks`, and only then emits `session_update.taskflow_refresh.possible_tasks` to all open viewers of the session.
  - live/manual possible-task refresh can use `refresh_mode=incremental_refresh`, which preserves unmatched existing candidate rows as stale instead of deleting them immediately; `full_recompute` stays the explicit destructive mode.
- Frontend MCP endpoint resolution order:
  1. `window.agents_api_url` (if set at runtime),
  2. `VITE_AGENTS_API_URL`,
  3. fallback `http://127.0.0.1:8722` (prod safety fallback).
- MCP transport path:
  - browser opens Socket.IO to backend (`/socket.io`),
  - frontend emits `mcp_call`,
  - backend MCP proxy (`backend/src/services/mcp/*`) calls Fast-Agent MCP endpoint.
- This MCP path is for Voice/legacy automation surfaces. It is not the transport contract for ACP chat UI.
- Required tool name in active agent cards:
  - `create_tasks` (`agents/agent-cards/create_tasks.md`)
- Historical web-upload audio recovery note: when old `source_type=web` voice messages still point to missing relative `uploads/audio/sessions/<session_id>/<file>.webm` files, first check `/home/strato-space/voicebot/uploads/audio/sessions/<session_id>/` on `p2` before declaring the source irrecoverable.

### ACP /agents integration

- `copilot /agents` is an ACP-only chat surface.
- Shared UI/kernel comes from `@strato-space/acp-ui`.
- `/agents` and `/agents/session/:id` consume the shared ACP package instead of copying ACP UI code into `copilot`.
- Cold-load restore for `/agents/session/:id` is route-authoritative: if the requested ACP session exists in persisted local storage, the page must keep the deep link until the live session store hydrates and then select that session instead of redirecting to `/agents`.
- ACP runtime transport is isolated from the Voice MCP proxy path:
  - frontend uses `app/src/services/acpSocket.ts`
  - frontend host bridge uses `app/src/services/acpHostBridge.ts`
  - backend ACP namespace is `backend/src/api/socket/acp.ts`
- `copilot /agents` must not depend on:
  - `mcp_call`
  - `/mcp`
  - Voice runtime transport assumptions
- Canonical ACP runtime verification commands:
  - `cd app && npm run test:agents:runtime`
  - `cd app && PLAYWRIGHT_BASE_URL=http://127.0.0.1:4174 npm run test:e2e:agents-shell`
  - `cd app && PLAYWRIGHT_BASE_URL=http://127.0.0.1:4174 npm run test:e2e:agents-harness`
- ACP review/session recovery handoffs live in checked-in plan artifacts:
  - `plan/acp-review-session-resume.md`
  - `plan/comfy-session-resume.md`
- Voice session header action ownership is explicit: `Tasks` and `Summarize` belong to the right header action cluster before the custom-prompt action, not to the left recording-control strip.
- If session-scoped Mongo task rows still fall outside the target task-status axis, they surface in a temporary `Unknown` subtab instead of disappearing; that subtab is rendered only when its count is greater than `0`.
- The top-level `Задачи` badge must wait for live `session_tab_counts` before rendering a count, so the page does not flash a misleading `0` during initial load.

### Ontology rollout supervision
- Canonical operator commands now include:
  - `cd backend && npm run ontology:typedb:sync:core:apply`
  - `cd backend && npm run ontology:typedb:sync:enrich:apply`
  - `cd backend && npm run ontology:typedb:full:from-scratch:apply -- --typedb-database <bench_db>`
  - `cd backend && npm run ontology:typedb:rollout:start`
  - `cd backend && npm run ontology:typedb:rollout:stop`
  - `cd backend && npm run ontology:typedb:rollout:clear-logs`
  - `cd backend && npm run ontology:typedb:rollout:status`
- The rollout path writes run-scoped cleanup/backfill logs and deadletters under `ontology/typedb/logs/` and keeps a single active rollout state file there.
- Operator terms are not interchangeable:
  - `cleanup_apply`
    - a data-hygiene pass ordered to restore canonical AS-IS core entities and mandatory relations for current validation gates;
    - for the `copilot-8wn1` cleanup wave this intentionally skips high-cost derived session projections via `--skip-session-derived-projections`.
  - `historical_backfill`
    - a semantic enrichment pass ordered to rebuild broader historical projections and support objects after cleanup+validate succeeds.
- Do not treat cleanup throughput as a proxy for backfill throughput; they are different operation classes with different objects and costs.
- Current profiling baseline and post-patch measurements are versioned in `ontology/typedb/docs/ingest_performance_profile_2026-03-15.md`.

## Miniapp notes
- Miniapp frontend sources live in `miniapp/src/` and build to `miniapp/dist`.
- Miniapp backend is served by the Copilot backend runtime (`npm run dev:miniapp` / `npm run start:miniapp`).
- PM2 mode scripts start both backend APIs (`copilot-backend-*` and `copilot-miniapp-backend-*`) together.
- In `IS_MINIAPP_DEBUG_MODE=true`, miniapp `/tickets` reads from raw DB (`getRawDb`) to keep debug ticket visibility when runtime tags differ between test data and scoped runtime.
- Miniapp backend can optionally start a Telegram bot via `TG_MINIAPP_BOT_TOKEN`; `/start` and `/miniapp` return an inline WebApp button, `/get_info` prints chat metadata for diagnostics, and graceful shutdown stops the bot before process exit.

## What is included
- `app/` React + Vite frontend for Finance Ops and OperOps/CRM.
- `miniapp/` React + Vite miniapp frontend.
- `backend/` Node/Express API for FinOps, CRM, VoiceBot, and miniapp backend routes.
- `figma/` standalone TypeScript service for Figma indexing, webhook intake, BullMQ workers, and PM2 packaging.
- `agents/` Python-based agents service and PM2 helper scripts.
- `scripts/` deployment helpers (`pm2-backend.sh`, `check-envs.sh`).
- `docs/`, `specs/`, `projects/` for product documentation and specs.
- `deploy/` Host-level Nginx config and notes.

## Planning Artifacts
- Synced voice migration planning docs are stored under `docs/voicebot-plan-sync/`.
- Keep `docs/voicebot-plan-sync/implementation-draft-v1.md` and session-level transcript versioning specs (`edit-event-log-plan.md`, `gpt-4o-transcribe-diarize-plan.md`) current with migration decisions.
- Session close/finalization outcomes for voice migration should be documented in `CHANGELOG.md` and mirrored in `AGENTS.md` + `README.md`.
- Recovered execution handoffs belong in dedicated plan artifacts such as `plan/acp-review-session-resume.md` and `plan/comfy-session-resume.md`, not in root governance text.

## Versioning And Dependencies
- SemVer policy: `MAJOR.MINOR.PATCH`.
- `MAJOR`: breaking API or behavior contract changes.
- `MINOR`: backward-compatible features/endpoints.
- `PATCH`: bugfixes/refactors without intentional behavior change.
- Dependency policy:
  - Prefer current stable TypeScript/Node LTS and keep strict typecheck green.
  - Prefer current stable `zod` 4.x for API schema/runtime validation.
  - Review lockfile changes in PRs; avoid silent transitive upgrades during hotfixes.

## Typed Contracts
- Backend voice handlers must validate request payloads with Zod at route boundaries.
- Keep callback/input types derived from schemas (`z.input<typeof schema>`) for compile-time safety.
- Do not bypass schema validation with ad-hoc parsing for public API endpoints.

## Development (p2)
For shared dev on p2, use PM2 scripts and serve static builds to avoid Vite port conflicts.

```bash
./scripts/check-envs.sh
./scripts/pm2-backend.sh dev
```

- Dev URL: https://copilot-dev.stratospace.fun
- Backend health: http://127.0.0.1:3002/api/health
- Agents MCP (fast-agent): http://127.0.0.1:8722 (plain HTTP; MCP endpoint is `/mcp`, loopback-only bind)
- Manual frontend builds:
  - `cd app && npm install && npm run build-dev`
  - `cd miniapp && npm install && npm run build-dev`
- Manual Figma module flow:
  - `cd figma && npm install && npm run build`
  - `cd figma && ./scripts/pm2-figma.sh dev start`
- Production deploy path is `./scripts/pm2-backend.sh prod`; it now recreates/restarts mandatory runtimes and runs `./scripts/pm2-runtime-readiness.sh prod` as a fail-fast gate.

## Host maintenance
- Do not delete or prune `/root/.codex/sessions` during routine disk cleanup; treat it as retained session history unless the cleanup task explicitly targets that path.

## Repository Sync (bd)
This repo uses `bd` (Beads) and the `beads-sync` branch to keep repository metadata consistent.

```bash
bd sync
```

See `AGENTS.md` for the full workflow (including `bd doctor` guidance).

## Execution workflow
- Use bounded subagent roles consistently when delegating repo work:
  - `worker_*` for one write surface,
  - `postreview_*` for independent code review,
  - `fix_*` for forensics-backed incidents,
  - `scholastic_*` for ontology-first spec review with `greek-scholastic`.
- Bugfix and QA-first waves follow one order: digital forensics first, then implementation swarm, then independent review, then verification gates, then `bd` synchronization.
- Every worker packet must start with the literal command `bd show <id> --json` so child execution reads the full unfiltered issue payload before any repo edits.

## Telegram closeout messages
- When sending executive updates through `tgbot__send_bot_message` with `parse_mode=MARKDOWNV2`, first materialize the payload as a fully escaped local string or temp-file draft, then inspect the final escaped text before the live send.
- Treat Telegram MarkdownV2 as a strict output contract, not a forgiving renderer: escape dynamic text, especially `>`, `_`, `*`, `[`, `]`, `(`, `)`, `-`, `.`, `!`, and backslashes, to avoid first-send failures such as `Can't parse entities`.

## Authentication
- Backend proxies Voicebot auth via `/api/try_login` and `/api/auth/me`; set `VOICEBOT_API_URL` in the backend environment.
- Frontend auth checks call `https://voice.stratospace.fun/auth/me` by default; override with `VITE_VOICEBOT_BASE_URL` if needed.
- Login relies on the shared `auth_token` http-only cookie for `.stratospace.fun`.

## Nginx
The Finance Ops SPA is served by Nginx, and `/api` is proxied to the backend. For the public domain, see `deploy/nginx-host.conf` and `deploy/README.md`.

## Testing
- Canonical test matrix and suite composition are declared in `platforms.json`.
- Unified repo-level runner:
  - `./scripts/run-test-suite.sh baseline`
  - `./scripts/run-test-suite.sh voice`
  - `./scripts/run-test-suite.sh full`
- Detailed structured procedure: `docs/TESTING_PROCEDURE.md`.
- Module-level commands:
  - `app`: `npm run test`, `npm run test:serial`, `npm run e2e:install`, `npm run test:e2e`
  - `backend`: `npm run test`, `npm run test:parallel-safe`, `npm run test:serialized`
  - `miniapp`: `npm run test`, `npm run test:e2e`
- Default worker strategy:
  - `app`/`miniapp` unit tests use `--maxWorkers=${JEST_MAX_WORKERS:-50%}`
  - `backend` unit tests are split into parallel-safe + serialized groups (`BACKEND_JEST_MAX_WORKERS` controls parallel-safe group)
- Backend upload-size route coverage should use a tiny route-local test limit instead of allocating production-scale payloads; the canonical `/voicebot/upload_audio` size-limit contract test now verifies the real Multer path with an isolated `VOICEBOT_MAX_AUDIO_FILE_SIZE` override and `--detectOpenHandles`.
- `full` suite now executes app e2e and voice e2e as explicit shard jobs declared in `platforms.json`.
- Current caveat: `scripts/run-test-suite.sh` does not yet honor `resource_lock`, so the two `app-voice-e2e` shard jobs may conflict when `full` runs them in parallel. If `full` fails with `ERR_EMPTY_RESPONSE` on `/voice`, rerun `npm run test:e2e:voice:shard:1of2` and `npm run test:e2e:voice:shard:2of2` separately; both currently pass in isolation.
- `app` E2E requires explicit target URL via `PLAYWRIGHT_BASE_URL` (default config uses `http://127.0.0.1:3002`).
- Useful `app` E2E scopes:
  - `npm run test:e2e:ui`
  - `npm run test:e2e:headed`
  - `npm run test:e2e:unauth`
  - `npm run test:e2e:auth`

### E2E Auth Setup
To run authenticated tests:
1. Copy `app/.env.test.example` to `app/.env.test`
2. Fill in `TEST_USER_EMAIL` and `TEST_USER_PASSWORD`
3. Run tests: `npm run test:e2e`

Projects:
- `chromium-unauth`: Tests without authentication (login page, redirects)
- `chromium`: Authenticated tests (require valid credentials in `.env.test`)

## Desloppify
Current scanner triage baseline:
- `Accepted risk / false-positive: 6`

Accepted items for `desloppify` security scan:
1. `security::app/src/components/voice/TranscriptionTableRow.tsx::hardcoded_secret_name` (`openai_api_key_missing`) — UI error-code label, not a secret.
2. `security::app/src/constants/permissions.ts::hardcoded_secret_name` (`RESET_PASSWORD`) — permission key constant, not a credential.
3. `security::backend/src/constants.ts::hardcoded_secret_name` (`ONE_USE_TOKENS`) — collection-name constant, not a credential.
4. `security::backend/src/permissions/permissions-config.ts::hardcoded_secret_name` (`RESET_PASSWORD`) — permission key constant, not a credential.
5. `security::backend/src/voicebot_tgbot/runtime.ts::eval_injection` (line ~194) — Redis Lua `EVAL` command with static script, not JS `eval/new Function`.
6. `security::backend/src/voicebot_tgbot/runtime.ts::eval_injection` (line ~213) — Redis Lua `EVAL` command with static script, not JS `eval/new Function`.

Rule for updates:
- Keep this section synchronized with `.desloppify/state-typescript.json` triage notes whenever `desloppify` scan results are refreshed.

## Session closeout update
- Close-session refresh (2026-04-05 07:23):
  - Closed `copilot-bzt6` after live replay determinism verification on target session `69cf65712a7446295ac67771`: `4x` consecutive full recompute runs remained stable and produced a consistent Draft `row_id` key-set with `tasks_count=6`.
  - Simplified extraction behavior without prompt/code inflation: full recompute now runs from compact raw transcript context, dedupe is id-key based (`row_id`/`id`/`task_id_from_ai`), and unknown/missing `candidate_class` paths normalize deterministically.
  - Validation passed: `cd backend && npm run test:parallel-safe -- --runTestsByPath __tests__/voicebot/workers/workerCreateTasksFromChunksHandler.test.ts __tests__/services/voicebot/createTasksAgentRecovery.test.ts __tests__/services/voicebot/createTasksAgentCardContract.test.ts __tests__/voicebot/runtime/generatePossibleTasksRoute.test.ts` (`56/56`).
  - Production deploy/smoke passed: `./scripts/pm2-backend.sh prod`, `./scripts/pm2-runtime-readiness.sh prod`, `./scripts/voice-notify-healthcheck.sh --env-file backend/.env.production`, `curl -fsS http://127.0.0.1:3002/api/health`, and unauthenticated `POST /api/voicebot/session_tasks` returned expected `401`.
- Close-session refresh (2026-04-04 22:49):
  - Landed the ontology/morphology migration wave for `CREATE_TASKS` prompt/runtime boundaries (`copilot-j7dp`, related `copilot-52pj`): prompt card now owns semantic/lexical policy and explicit `runtime_rejections` handling, while runtime enforces deterministic transition legality.
  - Added structured transition failure propagation through worker/API surfaces (`error_code`, `error_details`) so invalid `task_draft` transitions are observable without flattening to opaque strings.
  - Added missing-class convergence behavior for replay stability (`copilot-2bd3`): when bounded transition retry still leaves only `task_draft_class_missing` candidates, runtime can discard those candidates and carry over persisted draft rows with explicit `runtime_transition_carry_over` evidence.
  - Added migration artifacts `plan/2026-04-04-create-tasks-ontology-prompt-migration-{spec,swarm-plan}.md` and synchronized governance note in `AGENTS.md`.
  - Validation passed: `cd backend && npm run test:parallel-safe -- --runTestsByPath __tests__/services/voicebot/createTasksAgentCardContract.test.ts __tests__/services/voicebot/createTasksAgentRecovery.test.ts __tests__/voicebot/workers/workerCreateTasksFromChunksHandler.test.ts __tests__/voicebot/runtime/generatePossibleTasksRoute.test.ts` and `cd backend && npm run build`.
  - Production deploy/smoke passed: `./scripts/pm2-backend.sh prod`, `./scripts/pm2-runtime-readiness.sh prod`, `./scripts/voice-notify-healthcheck.sh --env-file backend/.env.production`, `curl -fsS http://127.0.0.1:3002/api/health`, and unauthenticated `POST /api/voicebot/generate_possible_tasks` returned expected `401`.
- Close-session refresh (2026-03-28 00:40):
  - Closed Phase I of the current Voice stabilization wave: `copilot-qtcp.9` and the full `copilot-8h9u*` test-noise/UI-warning bundle are resolved and synchronized in `bd`.
  - Closed Phase II (`copilot-c4n8`, `copilot-haq2`): WebRTC now drops stale post-`Done` chunk uploads with guaranteed fallback transition correlation, and the end-to-end `create_tasks` correlation logging contract was re-verified as already canonical.
  - Hardened transcription forensics in `backend/src/workers/voicebot/handlers/transcribeHandler.ts` so missing transport/path branches surface the real configured OpenAI runtime-key state instead of a false negative.
  - Replaced the rejected test-only textarea workaround with a capability-based autosize guard in `app/src/components/voice/PossibleTasks.tsx`, and removed the remaining Ant Design deprecation surfaces from active Voice/OperOps pages.
  - Validation passed: `cd app && npm test`, `cd backend && npm run test:parallel-safe`.
- Close-session refresh (2026-03-27 10:10):
  - Hardened recovery-critical backend paths in `crm/tickets`, `crm/codex`, `voicebot/sessions`, and `voicebot/uploads` so restart/post-recovery behavior is deterministic and forensic correlation survives route boundaries.
  - Added targeted regression coverage for CRM temporal contracts, session-done/upload trace continuity, and backend smoke stability (`backend/__tests__/api/*`, `backend/__tests__/voicebot/*`, `backend/__tests__/smoke/voicebotApiSmoke.test.ts`).
  - Unified backend test-noise policy: logger console transport is disabled by default in tests unless explicitly enabled (`LOGS_TEST_CONSOLE=1`), and Node warning suppression for `ExperimentalWarning`/`DEP0040` is standardized via `backend/package.json`.
  - Completed active UI cleanup around shared selectors and OperOps task details pane (`TaskPage` borderless card API migration + related contract tests).
- Close-session refresh (2026-03-26 22:47):
  - Hardened WebRTC lifecycle concurrency and inactive-session fail-fast behavior: transition-correlation IDs now trace `New/Rec/Done`, `finishSession` awaits backend errors instead of swallowing them, and stale `session_inactive` responses no longer trigger local activation fallback.
  - Canonicalized Voice task-refresh semantics around categorization availability: web ingress, Telegram ingress, worker transcribe reuse, and processing-loop recovery now persist explicit `no_task_decision` metadata when categorization is not queued, while possible-task persistence keeps `discussion_sessions[]` lineage and monotonic `updated_at`.
  - Canonicalized CRM transport/request drift and OperOps rendering: `/api/crm/tickets` now resolves legacy aliases with warning telemetry, ticket mutations preserve monotonic `updated_at`, Kanban fetch no longer depends on legacy `includeOlderDrafts`, and `TaskPage` renders Markdown-first descriptions with sanitized HTML fallback.
  - Accepted pending local artifacts in this closeout package: `project`, `statuses`.
- Close-session refresh (2026-03-16 22:02):
  - Added taskflow refresh correlation telemetry for live possible-task saves: the frontend now forwards optional click metadata (`refresh_correlation_id`, `refresh_clicked_at_ms`) through `createPossibleTasksForSession` into `save_possible_tasks`, and backend socket hints/logs now preserve this metadata end-to-end.
  - Updated docs/contracts (`CHANGELOG.md`, `README.md`, `AGENTS.md`) for the correlation-aware refresh semantics; no behavior rollback or fallback paths were introduced.
  - Validation passed: `cd app && npm run build`, `cd backend && npm run build`.
- Close-session refresh (2026-03-17 11:50):
  - Closed the session-page `Tasks` quota-recovery gap tracked by `copilot-zv40`: the button no longer depends on browser-side MCP `create_tasks`, and instead uses backend `POST /api/voicebot/generate_possible_tasks`, which routes through `runCreateTasksAgent(...)`, persists canonical items, and inherits server-side agent auth/model recovery.
  - Added focused backend/frontend regression coverage for the new route and updated source-contract tests to assert the backend path instead of direct browser MCP parsing.
  - Validation passed: `cd backend && NODE_OPTIONS='--experimental-vm-modules' npx jest --runInBand __tests__/voicebot/runtime/generatePossibleTasksRoute.test.ts __tests__/voicebot/runtime/sessionUtilityRoutes.test.ts`, `cd app && npx jest --runInBand __tests__/voice/possibleTasksSaveCanonicalItemsContract.test.ts __tests__/voice/meetingCardTasksButtonContract.test.ts`, `cd backend && npm run build`, `cd app && npm run build`.
- Close-session refresh (2026-03-15 22:03):
  - Landed the staged ontology operator bundle for `copilot-8wn1`: repo/backend operator commands now expose `sync:core`, `sync:enrich`, and `full:from-scratch`, while the ingest engine and rollout chain distinguish cleanup hygiene from historical backfill and skip session-derived projections during focused cleanup.
  - Added/accepted the checked-in performance artifact `ontology/typedb/docs/ingest_performance_profile_2026-03-15.md` together with the new operator helpers `ontology/typedb/scripts/typedb-sync-chain.sh` and `ontology/typedb/scripts/typedb-full-from-scratch.sh`.
  - `copilot-8wn1` remains `in_progress`; handoff analysis tasks `copilot-sdqt` and `copilot-b96r` stay open for restored optimization-bundle / stash reconciliation and are not treated as deploy blockers for this closeout.
  - Validation passed: `cd backend && npm run build`, `cd backend && bash ../ontology/typedb/scripts/run-typedb-python.sh ../ontology/typedb/tests/test_ingest_modes.py`, `cd backend && npm run ontology:typedb:sync:dry -- --limit 5`, and `cd backend && npm run ontology:typedb:full:from-scratch:apply -- --typedb-database str_opsportal_profile_smoke_close_session_20260315 --limit 1` (expected validate warnings under `--limit 1` sample load).
- Close-session refresh (2026-03-15 10:38):
  - Closed `copilot-kvdp`: Codex tab issue IDs now expose the same copy affordance as other Codex surfaces; drawer-open and external-link behaviors remain intact, and the inline token layout was corrected after Chrome MCP verification showed the copy icon wrapping below the issue pill.
  - Closed `copilot-shdv`: `/api/crm/codex/issues` now falls back to direct JSONL parsing when `bd list` stays out-of-sync after failed `bd sync --import-only`, covering the observed `bufio.Scanner: token too long` recovery failure.
  - Closed `copilot-tpra` as not planned for implementation.
  - Validation passed: `cd app && npm run build`, `cd app && npx jest __tests__/operops/codexIssuesTableContract.test.ts __tests__/operops/crmPageCodexTabContract.test.ts __tests__/voice/sessionPageCodexTabContract.test.ts --runInBand`, `cd backend && NODE_OPTIONS='--experimental-vm-modules' npx jest --runInBand __tests__/api/crmCodexRouteRuntime.test.ts`, and `cd backend && npm run build`.
- Close-session refresh (2026-03-04 12:22):
  - Closed `copilot-w8l0` epic (`copilot-w8l0.1`..`copilot-w8l0.3`) for quota-recovery realtime parity: `tickets_prepared` now reaches session-room subscribers without requiring `socket_id`, and socket dispatch preserves array payloads for this event.
  - Transcription fallback rows with quota errors now show metadata signature footer and are designed for in-place replacement when retries produce transcript text.
  - Added QA runbook `docs/voicebot-plan-sync/quota-recovery-realtime-qa-checklist.md`.
  - Validation passed: `cd backend && npm run test -- __tests__/voicebot/workers/workerCreateTasksFromChunksHandler.test.ts __tests__/voicebot/workers/workerCreateTasksPostprocessingRealtime.test.ts __tests__/voicebot/socket/voicebotSocketEventsWorker.test.ts`, `cd app && npm run test:serial -- __tests__/voice/transcriptionFallbackErrorSignatureContract.test.ts`, `cd backend && npm run build`, `cd app && npm run build`.
- Close-session refresh (2026-03-03 20:20):
  - Added `docs/MULTI_AGENT_DISTILLATION_2026-03-03.md` as the canonical session artifact for multi-agent orchestration guidance: isolated worker context, `bd`-native forward-only graph usage, and explicit hierarchy mapping `CJM -> BPMN -> UserFlow -> Screens -> Widgets -> Atoms/Tokens`.
  - Synchronized closeout records in `CHANGELOG.md` / `AGENTS.md` / `README.md` and accepted pending local artifacts in this closeout package: `.agents/product-marketing-context.md`, `output/copilot-marketing-discovery-2026-03-03.pptx`, and `tmp/copilot-marketing-ppt/**`.
- Close-session refresh (2026-03-03 13:55):
  - Closed `copilot-q5cc`: `notify_requested` session-log entries now derive `metadata.source` from the real close/worker path instead of hardcoding `socket_session_done`.
  - Closed `copilot-zd9x`: `tools/voice` close wrappers are now strict fail-fast and do not fall back to `POST /api/voicebot/close_session`.
- Close-session refresh (2026-03-03 13:37):
  - Closed `copilot-7b9y` epic (`copilot-7b9y.1`..`copilot-7b9y.10`) and completed Voice session-done REST parity for `mcp@voice` and `actions@voice`.
  - `tools/voice` now closes sessions through backend REST `POST /api/voicebot/session_done` with explicit `5s` timeout and no automatic retry.
  - Validation passed: `71` targeted voice tests, a disposable close smoke, and a real `actions@voice` re-close of session `69a527c14b07162c36957e21`; downstream `CREATE_TASKS` refreshed (`5 -> 15`), `done_at` advanced, and notify events were emitted.
  - Added execution evidence to `tmp/voice-investigation-artifacts/69a527c14b07162c36957e21-voice-session-done-rest-parity-plan.md`.
- Close-session refresh (2026-03-02 22:03):
  - Closed `copilot-7r94` epic (`copilot-7r94.1`..`copilot-7r94.11`) and delivered Voice categorization cleanup: stable row identities, no processing column, materials-only rendering, typed edit/delete APIs, realtime mutation events, and last-row cascade transcript deletion.
  - Closed `copilot-j54y`: Codex relationship IDs now match Issue-ID behavior (`link + copy`) with status pictograms; shared Codex status tabs now include `In Progress` and `Blocked`.
  - Added planning artifacts for auth/video parser tracks: `voice-categorization-ux-cleanup-plan.md`, `plan/auth-option-a-copilot-oauth-provider-plan.md`, `plan/auth-option-b-google-oauth-plan.md`, `plan/auth-options-a-vs-b-comparison.md`, and `videoparser/specs/*`.
  - Included payout formula update in `app/src/store/kanbanStore.ts` (`basicBonus` coefficient `0.05`).
  - Validation passed: `cd app && npm run build`, `cd backend && npm run build`; `bd ready --json` returned empty queue.
- Close-session refresh (2026-03-02 13:45):
  - Closed `copilot-wtz7`: shared Codex table now uses explicit status tabs `Open / Deferred / Closed / All`; deferred compatibility treats both `status=deferred` and transitional `status=open + defer_until` as deferred, so Open no longer mixes deferred backlog.
  - Closed `copilot-ai1b`: `/voice` sessions list now renders AI-style loading placeholder and domain empty state (`Пока нет сессий по текущим фильтрам`) with reset-filters CTA; generic `No data` text is removed from this flow.
  - Added `docs/FINOPS_SPEC_DISCOVERY.md` and synced `README.md`/`AGENTS.md` references as progress artifact for `copilot-081q` (scope remains pending product decisions).
  - Validation passed: `cd app && npm run test:serial -- __tests__/operops/codexIssuesTableContract.test.ts __tests__/voice/sessionCodexTasksFilterOrderContract.test.ts __tests__/voice/sessionsListEmptyStateContract.test.ts` and `cd app && npm run build`.
- Close-session refresh (2026-03-02 13:30):
  - Closed `copilot-9ifu`: Codex details card now hides empty metadata rows, normalizes escaped newlines in Description/Notes, and renders explicit relationship groups from bd payload.
  - Closed follow-ups `copilot-x06u` and `copilot-2qne`: `copilot-*` IDs in `Relationships` and top `Issue ID` are now clickable to `/operops/codex/task/:id` while keeping Issue ID copy action intact.
  - Added/updated Codex contracts:
    - added `app/__tests__/operops/codexIssueDetailsCardContract.test.ts`,
    - updated `app/__tests__/operops/codexIssuesTableContract.test.ts` for raw relationship payload pass-through.
  - Included accumulated working-tree deltas in this closeout:
    - `app/src/components/crm/CRMKanban.tsx`: clone ticket action with normalized create payload,
    - `app/src/components/PlanFactGrid.tsx`: contract/subproject labels no longer forced to uppercase,
    - `app/e2e/task-create.spec.ts`: unauth-friendly task-create close/cancel test with mocked CRM/auth APIs and spinner click-through handling,
    - `docs/copilot-repo-visual-recap.html`: rewritten as MongoDB→TypeDB mapping-centric visual recap.
  - Validation: `cd app && npm run test:serial -- __tests__/operops/codexIssueDetailsCardContract.test.ts __tests__/operops/codexIssuesTableContract.test.ts __tests__/voice/codexTasksInlineDetailsContract.test.ts __tests__/operops/codexTaskPageContract.test.ts` and `cd app && npm run build` passed.
- Close-session refresh (2026-03-01 22:02):
  - Captured outstanding local docs commit `e577500` (`docs: fix Mermaid line breaks in visual recap diagram`) into close-session artifacts and prepared final release handoff.
  - Added `CHANGELOG.md` date block `2026-03-01` with explicit problem/feature/change entries for `docs/copilot-repo-visual-recap.html`.
  - Synced `AGENTS.md` and `README.md` session-closeout sections to keep closeout evidence aligned before final push and Telegram broadcast.
- Close-session refresh (2026-02-28 19:10):
  - `copilot-sxq1.14.8` execution hit Codex runner quota/usage-limit blocker during scoped subjective batch execution; task remained `in_progress` with explicit blocker note in issue history.
  - Decomposed `copilot-sxq1.14.8` into six independent child tasks by file-scope to remove one-shot batch dependency:
    - `copilot-sxq1.14.8.1` (`app/src/store/**`)
    - `copilot-sxq1.14.8.2` (`app/src/hooks/**`)
    - `copilot-sxq1.14.8.3` (`app/src/services/**`)
    - `copilot-sxq1.14.8.4` (`app/src/utils/**`)
    - `copilot-sxq1.14.8.5` (`app/src/types/**`)
    - `copilot-sxq1.14.8.6` (`app/src/constants/**`)
  - Validation rerun for reorganized test pipeline:
    - `cd app && npm run test:e2e:voice:shard:1of2` passed (`13/13`) after transient shard failure in one full run;
    - canonical gate passed: `./scripts/run-test-suite.sh full --fail-fast` (`10/10 PASS`).
  - Updated `desloppify` triage pointer for next remediation step: `review::.::holistic::abstraction_fitness::overuse_unknown_in_core_contracts::5ff2ecc1` (`desloppify next`, Tier 1).
- Close-session refresh (2026-03-07 22:01):
  - Refreshed `.desloppify` workspace artifacts: added `.desloppify/plan.json`, regenerated `.desloppify/{query.json,state-typescript.json,state-typescript.json.bak}`, and updated `scorecard.png`.
  - Current `desloppify next` queue now starts with subjective re-review `contract_coherence`, followed by `dependency_health`, `initialization_coupling`, `logic_clarity`, and `naming_quality`.
  - Current `desloppify show app/e2e --status open` follow-ups are limited to two low-priority items: `subjective_review::app/e2e/auth.setup.ts::unreviewed` and `structural::app/e2e/voice-fab-lifecycle.spec.ts`.
- Closed testing modernization epic `copilot-2gs1` (stages 1-8): unified runner is stage-parallel with fail-fast stage control, backend tests are split into parallel-safe/serialized groups, app+voice e2e run via shard jobs, and testing docs are synchronized (`README`/`AGENTS`/`docs/TESTING_PROCEDURE.md`) with benchmark history.
- Final full-suite benchmark for this wave: `163.97s -> 80.01s` (`+51.20%`).
- Closed `copilot-sxq1.8` and aligned contract tests with extracted voice/frontend helper modules (`voicebotHttp`, `voicebotRuntimeConfig`, `codexTaskTimeline`) plus sanitized TaskPage render contract updates.
- Updated backend contract/runtime tests for ESM-safe execution and current route contracts:
  - `backend/__tests__/voicebot/runtime/sessionUtilityRuntimeBehavior.validation.test.ts` (`jest` from `@jest/globals`),
  - `backend/__tests__/entrypoints/orphanedEntrypointsContract.test.ts` (`import.meta.url` path resolution),
  - `backend/__tests__/api/crmCodexRouteContract.test.ts` and `backend/__tests__/voicebot/rowMaterialTargetRouteContract.test.ts` (current route-shape expectations).
- Close-session validation summary:
  - `make test` target is absent in this repo (`No rule to make target 'test'`);
  - canonical suite passed: `./scripts/run-test-suite.sh full` (`10/10 PASS`);
  - type-safety builds passed: `cd app && npm run build`, `cd backend && npm run build`.
- Current `desloppify next` top unresolved item: subjective re-review `contract_coherence` (`desloppify review --prepare --dimensions contract_coherence`).
- Executed swarm waves for `top_open_in_progress_ids_by_priority`: closed `copilot-g0bd` (Codex routing fix) and `copilot-603` (placeholder cleanup), and recorded verification-only audit notes for remaining `copilot-ztlv*`/`copilot-ib30` backlog items.
- Hardened backend Codex routing in `POST /api/voicebot/create_tickets` (`backend/src/api/routes/voicebot/sessions.ts`) so Codex aliases/labels are resolved before strict ObjectId checks and cannot leak into Mongo task inserts.
- Added regression coverage for alias/name-based Codex routing and malformed non-Codex performer paths in `backend/__tests__/voicebot/sessionUtilityRuntimeBehavior.test.ts`.
- Documented active blocker for `copilot-ib30`: `POST /api/voicebot/activate_session` currently fails with `ERR_EMPTY_RESPONSE` in browser, blocking end-to-end screenshot paste verification.
- Added Codex API runtime recovery for out-of-sync `bd` state: `/api/crm/codex/issue` and `/api/crm/codex/issues` now auto-run `bd sync --import-only` and retry once before returning an error.
- Fixed OperOps Codex issue page loading for valid BD IDs (`copilot-f7w7`): `app/src/pages/operops/CodexTaskPage.tsx` now supports mixed `/api/crm/codex/issue` payload envelopes and posts both `id` + `issue_id`; added coverage in `app/__tests__/operops/codexTaskPageContract.test.ts`.
- Fixed Voice session Codex row visual artifact (`copilot-oh19`): removed unintended inline `Открыть задачу в OperOps` text fragment from row content while preserving OperOps navigation action; updated `app/__tests__/voice/sessionCodexTasksFilterOrderContract.test.ts`.
- Completed Wave 1 voice-operops-codex rollout items and closed `copilot-b1k5`, `copilot-s33e`, `copilot-u976`, `copilot-xuec`; epic `copilot-bq81` stays in progress for later waves.
- Canonicalized performer lifecycle filtering (`is_deleted` primary, legacy `is_active/active` compatibility) across Voice/CRM selectors with historical-id passthrough for edit safety.
- Added `git_repo` project contract support end-to-end (backend create/update/list + frontend types/edit form) and enforced Codex assignment guard in `POST /api/voicebot/create_tickets`.
- Extended Telegram `@task` ingress path to persist normalized task payload to session and create Codex task from the same payload contract.
- Increased Voice possible-task performer selector popup height with responsive desktop/mobile sizing and contract tests.
- Switched voice session close initiation to REST-only client path: frontend store and WebRTC runtime now call `POST /api/voicebot/session_done` (with `/close_session` alias support), and no longer emit browser-side `session_done` over Socket.IO.
- Added canonical backend close route in sessions API (`backend/src/api/routes/voicebot/sessions.ts`) with Zod payload validation, permission/access checks, shared `completeSessionDoneFlow` execution, and realtime `session_status/session_update` emissions.
- Added backend regression test `backend/__tests__/voicebot/sessionDoneRoute.test.ts` to lock REST close behavior and alias parity.
- Updated Voice Sessions list ordering in `app/src/pages/voice/SessionsListPage.tsx`: active sessions first, then latest voice activity, then creation time with mixed-format timestamp normalization.
- Fixed WebRTC FAB `Done` close reliability for `/voice/session/:id`: runtime now retries `session_done` across namespace base candidates (`origin`, stripped `/api`, full API base) and treats all failed attempts as close failure.
- Added fail-safe close UX: on `session_done` failure FAB stays in `paused` with toast `Failed to close session. Retry Done.` and does not clear active session metadata.
- Updated regression contract `app/__tests__/voice/webrtcSessionDoneSocketContract.test.ts` for fallback namespace attempts and strict failed-close handling.
- Fixed voice sessions deleted-mode sync (`copilot-nhwu`): `SessionsListPage` now forces list refetch when `sessionsListIncludeDeleted` differs from current `showDeletedSessions` intent.
- Updated store fetch guard so `fetchVoiceBotSessionsList({ force: true })` can run while list loading is active for required mode synchronization.
- Added regression test `app/__tests__/voice/sessionsListIncludeDeletedSyncContract.test.ts`.
- Restored notify transport path for voice summarize events: `actions@call` command fixed in `/home/tools/server/mcp/call.env`, `/notify` now healthy (`200`).
- Added TS local notify hooks parity in `backend/src/workers/voicebot/handlers/notify.ts`:
  - `VOICE_BOT_NOTIFY_HOOKS_CONFIG` support (YAML/JSON, default `./notifies.hooks.yaml`, empty disables),
  - detached hook spawn + structured logs,
  - session-log events `notify_hook_started`, `notify_http_sent`, `notify_http_failed`.
- Added sample hooks config `backend/notifies.hooks.yaml` and targeted regression test `backend/__tests__/voicebot/notifyWorkerHooks.test.ts`.
- Hardened TS notify hooks diagnostics:
  - per-hook stdout/stderr is persisted into `VOICE_BOT_NOTIFY_HOOKS_LOG_DIR` (default `./logs/voicebot-notify-hooks`);
  - `notify_hook_started.metadata.log_path` now stores exact hook log path;
  - hook spawn failures are persisted as `notify_hook_failed` in `automation_voice_bot_session_log`.
- Added Voice Sessions list URL-state workflow (`tab`, filters, pagination) with inline project reassignment and active-project-only selectors (`app/src/pages/voice/SessionsListPage.tsx`).
- Added MeetingCard dialogue-tag editing with remembered local tag options and persisted `dialogue_tag` updates.
- Updated done UX/state flow: frontend applies immediate ack-driven close projection, listens for `session_status=done_queued`, and backend socket emits immediate `session_update` on `session_done`.
- Added deduplicated immediate common-queue processing kick in shared done flow (`backend/src/services/voicebotSessionDoneFlow.ts`) to reduce finalize lag after session close.
- Hardened CREATE_TASKS postprocessing to enqueue pending CATEGORIZE jobs before delayed retry when categorization is incomplete.
- Added mixed-identifier performer normalization for CRM ticket create/update and Miniapp task performer matching compatibility (`id`/`_id`/ObjectId).
- Canonicalized Voice/TG public session links to `https://copilot.stratospace.fun/voice/session[/<id>]` and added `VOICE_WEB_INTERFACE_URL` sample default in `backend/.env.example`.
- Added `splitAudioFileByDuration(...)` ffmpeg helper in backend audio utilities for deterministic segment generation.
- Added deferred migration spec `plan/session-done-notify-routing-migration.md` for immediate done notifications and routing ownership move from JSON config to Copilot DB targets.
- Added tracked ontology package under `ontology/typedb/` (TypeQL schema, Mongo mapping, validation query set, rollout plan) to keep TypeDB model assets versioned in Copilot.
- Updated Voice transcription download flow to use `/api/voicebot/transcription/download/:session_id` with runtime-safe markdown export handling and Jest coverage.
- Added backend TypeDB ontology helper tooling (canonical paths under `ontology/typedb/scripts/`, npm aliases, and `.env` sample variables) for STR OpsPortal model ingestion.
- Switched OperOps Projects Tree editing to modal-based UX and removed split-pane edit card flow.
- Synced local bd SQLite metadata/config files and stored Dolt migration import/backup artifacts in `.beads/`.
- Added `plan/deep-research-oss-platforms-operops-finops.report.draft.md` (draft) summarizing platform research options for OperOps/FinOps/Guide/Voice and phased implementation recommendations.
- Added `ontology/fpf-erd-extraction-protocol-str-opsportal.md` and `ontology/str-opsportal-erd-draft-v0.md` for STR OpsPortal ERD extraction protocol definition and the initial consolidated ERD draft.
- Extracted shared Voice `completeSessionDoneFlow` service and switched socket `session_done` path to it for unified close/notify behavior.
- Added idle-active-session close automation script (`backend/scripts/voicebot-close-inactive-sessions.ts`) and npm commands `voice:close-idle:dry|apply` with JSON/JSONL outputs for operations.
- Added session-specific diagnostics helper script `backend/scripts/tmp-explain-69981f2e.ts` for transcription/chunk payload inspection.
- Completed Waves 2-5 and merged all implementation commits to `main`:
  - Wave 2 (`copilot-yqst`, `copilot-m2uw`, `copilot-8yuq`, `copilot-dkj6`, `copilot-aonw`, `copilot-su2v`, `copilot-grg4`, `copilot-upqs`)
  - Wave 3 (`copilot-0t2c`, `copilot-03gp`)
  - Wave 4 (`copilot-l3j6`, `copilot-c1xj`, `copilot-zwjl`)
  - Wave 5 (`copilot-2psh`, `copilot-ex9q`, `copilot-gb72`)
- Added deferred Codex review end-to-end lifecycle:
  - worker job `VOICEBOT_JOBS.common.CODEX_DEFERRED_REVIEW`,
  - issue-note persistence and Telegram approval cards,
  - Telegram callback actions `cdr:start:*` / `cdr:cancel:*`.
- Added Voice taskflow tabs and APIs:
  - Voice `Задачи` tab scoped by current `source_ref`,
  - Voice `Codex` tab backed by `POST /api/voicebot/codex_tasks`,
  - OperOps `Codex` tab backed by `POST /api/crm/codex/issues` (latest 500 `bd` issues).
- Added inline Codex task detail drawer in Voice session tab and expanded codex task payload mapping (`labels`, `dependencies`, `notes`, ownership metadata).
- Added Codex per-task `external_ref` uniqueness contract for voice-created tasks (`https://copilot.stratospace.fun/voice/session/<id>#codex-task=<task-id>`).
- Added transcribe trigger flow (`Codex`/`Кодекс`) and improved `@task` ingestion:
  - auto-create Codex session when no active session exists,
  - normalize and append canonical attachment links in created task descriptions.
- Completed categorization/material chain:
  - `copilot-hfvd`: hide `Unknown` speaker labels,
  - `copilot-c4bd`: `Materials` column replacing quick-summary behavior,
  - `copilot-a3k0`: pale metadata signature line,
  - `copilot-p31k`: image/text row-group cross-link model,
  - `copilot-250m`: explicit row-level material targeting with `image_anchor_linked_message_id`.
- Closed dependency branch `copilot-eejo -> (copilot-a3k0,copilot-c4bd,copilot-hfvd) -> copilot-p31k -> copilot-250m`.
- Closed coordinating epic `copilot-bq81`; `bd ready` queue is empty.
- Fixed `/session_done` permission compatibility in `backend/src/api/routes/voicebot/sessions.ts`: replaced unavailable route-level `requirePermission` call with inline `getUserPermissions` + `VOICEBOT_SESSIONS.UPDATE` check.
- Re-ran full test scope after the fix: `app` Jest (`50` suites, `113` tests) and `backend` Jest (`76` suites, `365` tests) both passed.
