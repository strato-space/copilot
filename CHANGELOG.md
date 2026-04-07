# Changelog

## 2026-04-06
### PROBLEM SOLVED
- **22:47** Draft stale-cleanup writes still relied on a parallel `$unset` for `source_data.superseded_at` even when the same mutation rewrote `source_data` as a full object, which made the cleanup path less explicit and harder to verify.
- **22:47** Repo close-session flow kept surfacing local `.omx/` agent state as untracked work, adding version-control noise unrelated to product/runtime artifacts.

### FEATURE IMPLEMENTED
- **22:47** `persistPossibleTasks` stale cleanup now rebuilds `source_data` without `superseded_at`, and the focused persist/runtime tests assert the cleaned object shape directly.
- **22:47** Repo hygiene now treats `.omx/` as local-only OMX state and keeps it out of version control.

### CHANGES
- **22:47** Updated stale-cleanup implementation and regression coverage:
  - `backend/src/services/voicebot/persistPossibleTasks.ts`
  - `backend/__tests__/services/voicebot/persistPossibleTasks.test.ts`
  - `backend/__tests__/voicebot/runtime/sessionUtilityRuntimeBehavior.validation.test.ts`
- **22:47** Updated repo hygiene/docs:
  - `.gitignore`
  - `AGENTS.md`
  - `README.md`
- **22:48** Verification:
  - `cd backend && NODE_OPTIONS='--experimental-vm-modules --disable-warning=ExperimentalWarning --disable-warning=DEP0040' npx jest --runInBand __tests__/services/voicebot/persistPossibleTasks.test.ts __tests__/voicebot/runtime/sessionUtilityRuntimeBehavior.validation.test.ts`
  - `cd backend && npm run build`
- **22:53** Production deploy/smoke:
  - `./scripts/pm2-backend.sh prod`
  - `./scripts/pm2-runtime-readiness.sh prod`
  - `./scripts/voice-notify-healthcheck.sh --env-file backend/.env.production`
  - `curl -fsS http://127.0.0.1:3002/api/health`
  - `POST /api/voicebot/session_tasks` unauthenticated smoke returned expected `401 Unauthorized`

## 2026-04-05
### PROBLEM SOLVED
- **07:23** `CREATE_TASKS` replay on the target session `69cf65712a7446295ac67771` still had unresolved closure criteria for `copilot-bzt6`: acceptance required not only `>=5` Draft tasks but also stable `row_id` identity across consecutive full recomputes.
- **07:23** Transition handling for unknown/missing `candidate_class` was still relying on bounded reformulation paths in places where deterministic runtime normalization should apply immediately.

### FEATURE IMPLEMENTED
- **07:23** Closed `copilot-bzt6` after live determinism verification: `4x` consecutive `full_recompute` runs returned stable Draft identity with `tasks_count=6` and no key-set drift.
- **07:23** Simplified `CREATE_TASKS` runtime behavior: full recompute with empty chunk input now uses compact session raw transcript context, merge dedupe uses canonical id keys (`row_id`/`id`/`task_id_from_ai`), and missing/unknown `candidate_class` paths normalize deterministically to deliverable class without extra retry inflation.
- **07:23** Tightened prompt-card lower-bound materialization rules for explicit task enumerations while preserving anti-overfitting constraints (generalized rules, no transcript-specific literals).

### CHANGES
- **07:23** Updated runtime and prompt surfaces:
  - `agents/agent-cards/create_tasks.md`
  - `backend/src/services/voicebot/createTasksAgent.ts`
  - `backend/src/workers/voicebot/handlers/createTasksFromChunks.ts`
- **07:23** Updated regression coverage:
  - `backend/__tests__/services/voicebot/createTasksAgentRecovery.test.ts`
- **07:23** Verification:
  - `cd backend && npm run test:parallel-safe -- --runTestsByPath __tests__/voicebot/workers/workerCreateTasksFromChunksHandler.test.ts __tests__/services/voicebot/createTasksAgentRecovery.test.ts __tests__/services/voicebot/createTasksAgentCardContract.test.ts __tests__/voicebot/runtime/generatePossibleTasksRoute.test.ts`
  - live replay check: `4x` consecutive `handleCreateTasksFromChunksJob({ session_id: '69cf65712a7446295ac67771', chunks_to_process: [] })` runs in `raw_text` mode, stable `tasks_count=6` and stable Draft `row_id` set.
- **07:29** Production deploy/smoke:
  - `./scripts/pm2-backend.sh prod`
  - `./scripts/pm2-runtime-readiness.sh prod`
  - `./scripts/voice-notify-healthcheck.sh --env-file backend/.env.production`
  - `curl -fsS http://127.0.0.1:3002/api/health`
  - `POST /api/voicebot/session_tasks` unauthenticated smoke returned expected `401 Unauthorized`.

## 2026-04-04
### PROBLEM SOLVED
- **22:49** `CREATE_TASKS` runtime still owned lexical/morphology semantics in TypeScript, so prompt/runtime responsibility boundaries drifted and replay behavior could vary by implementation detail instead of prompt contract.
- **22:49** Missing `candidate_class` outcomes could exhaust bounded reformulation and collapse generation to zero while legacy draft rows stayed persisted, making clean-vs-incremental replay convergence ambiguous.
- **22:49** Worker and route surfaces flattened transition failures into opaque errors, which hid machine-readable rejection context needed for operations and retries.

### FEATURE IMPLEMENTED
- **22:49** Migrated ontology/morphology ownership into the prompt card with explicit class mapping and `runtime_rejections` handling guidance; runtime now enforces transition legality without semantic stopword/allowlist ownership.
- **22:49** Added deterministic transition-failure contracts in runtime (`create_tasks_transition_retries_exhausted`, `create_tasks_runtime_rejections_malformed`) with one bounded reformulation retry and explicit retry-budget metadata.
- **22:49** Added missing-class convergence behavior: unresolved `task_draft_class_missing` candidates can be discarded and replaced with persisted Draft carry-over, with explicit `runtime_transition_carry_over` evidence.
- **22:49** Propagated structured transition failures through worker and API surfaces via `error_code`/`error_details` instead of string-only errors.

### CHANGES
- **22:49** Updated create_tasks contract and runtime implementation:
  - `agents/agent-cards/create_tasks.md`
  - `backend/src/services/voicebot/createTasksAgent.ts`
  - `backend/src/services/voicebot/persistPossibleTasks.ts`
  - `backend/src/workers/voicebot/handlers/createTasksFromChunks.ts`
  - `backend/src/api/routes/voicebot/sessions.ts`
- **22:49** Updated regression coverage:
  - `backend/__tests__/services/voicebot/createTasksAgentCardContract.test.ts`
  - `backend/__tests__/services/voicebot/createTasksAgentRecovery.test.ts`
  - `backend/__tests__/voicebot/workers/workerCreateTasksFromChunksHandler.test.ts`
  - `backend/__tests__/voicebot/runtime/generatePossibleTasksRoute.test.ts`
- **22:49** Added execution/spec artifacts:
  - `plan/2026-04-04-create-tasks-ontology-prompt-migration-spec.md`
  - `plan/2026-04-04-create-tasks-ontology-prompt-migration-swarm-plan.md`
- **22:49** Verification:
  - `cd backend && npm run test:parallel-safe -- --runTestsByPath __tests__/services/voicebot/createTasksAgentCardContract.test.ts __tests__/services/voicebot/createTasksAgentRecovery.test.ts __tests__/voicebot/workers/workerCreateTasksFromChunksHandler.test.ts __tests__/voicebot/runtime/generatePossibleTasksRoute.test.ts`
  - `cd backend && npm run build`
- **22:54** Production deploy/smoke:
  - `./scripts/pm2-backend.sh prod`
  - `./scripts/pm2-runtime-readiness.sh prod`
  - `./scripts/voice-notify-healthcheck.sh --env-file backend/.env.production`
  - `curl -fsS http://127.0.0.1:3002/api/health`
  - `curl -s -o /tmp/generate_possible_tasks_smoke.out -w '%{http_code}' -X POST http://127.0.0.1:3002/api/voicebot/generate_possible_tasks -H 'Content-Type: application/json' --data '{}'` (`401 Unauthorized` expected without auth token)

## 2026-04-03
### PROBLEM SOLVED
- **16:04** `CREATE_TASKS` still treated heterogeneous speech acts as flat task candidates, so sessions like `69cf65712a7446295ac67771` under-materialized real deliverables while letting coordination/input/status phrases compete with actual task extraction.
- **16:04** The extractor contract did not explicitly require ontology-first classification before Draft materialization, which left the MCP prompt and backend runtime free to diverge on what counts as a canonical task.

### FEATURE IMPLEMENTED
- **16:04** Added an ontology-first `CREATE_TASKS` contract: only bounded deliverables may materialize into `task_draft`, while coordination-only asks, access/input handoffs, references/ideas, and status/report statements are routed away from Draft materialization.
- **16:04** Added a backend safety-net that drops obvious non-deliverable draft rows even when the model emits them, preserving bounded preparation tasks that still end in a presentable artifact.

### CHANGES
- **16:04** Updated the canonical MCP prompt card:
  - `agents/agent-cards/create_tasks.md`
- **16:04** Updated backend extraction normalization:
  - `backend/src/services/voicebot/createTasksAgent.ts`
- **16:04** Added focused regression coverage:
  - `backend/__tests__/services/voicebot/createTasksAgentCardContract.test.ts`
  - `backend/__tests__/services/voicebot/createTasksAgentRecovery.test.ts`
- **16:04** Verification:
  - `cd backend && NODE_OPTIONS='--experimental-vm-modules --disable-warning=ExperimentalWarning --disable-warning=DEP0040' npx jest --runInBand __tests__/services/voicebot/createTasksAgentCardContract.test.ts __tests__/services/voicebot/createTasksAgentRecovery.test.ts`

## 2026-03-31
### PROBLEM SOLVED
- **09:26** Voice metadata signatures drifted across tabs: in some runs `Транскрипция`/`Категоризация` either lost signatures entirely or rendered them in the wrong visual position, which broke operator reading flow and forensics traceability.
- **09:26** Detached notify hooks could outlive the main notify HTTP ack without producing a terminal failure outcome, leaving summarize audit/session-log state inconsistent when a hook stalled.

### FEATURE IMPLEMENTED
- **09:26** Restored deterministic metadata-signature contract for Voice reading surfaces: signatures now render after text blocks in `Транскрипция` and `Категоризация`, with per-segment timeline labels preserved in transcript rows.
- **09:26** Added bounded notify-hook execution with timeout-driven failure finalization (`notify_hook_timeout`) so summarize audit/session logs get deterministic failed outcomes when detached hooks hang.

### CHANGES
- **09:26** Updated Voice UI/runtime files:
  - `app/src/components/voice/TranscriptionTableRow.tsx`
  - `app/src/components/voice/Categorization.tsx`
  - `app/src/utils/voiceMetadataSignature.ts`
  - `app/__tests__/voice/{transcriptionTimelineLabel,transcriptionFallbackErrorSignatureContract,categorizationMetadataSignatureContract,categorizationBlockMetadataSignature}.test.ts`
- **09:26** Updated notify-worker timeout handling and coverage:
  - `backend/src/workers/voicebot/handlers/notifyHandler.ts`
  - `backend/__tests__/voicebot/notify/notifyWorkerEventLog.test.ts`
- **09:26** Verification:
  - `cd app && npm test -- transcriptionTimelineLabel transcriptionFallbackErrorSignatureContract categorizationMetadataSignatureContract categorizationBlockMetadataSignature`
  - `./scripts/pm2-backend.sh prod`

## 2026-03-30
### PROBLEM SOLVED
- **22:46** `copilot-glsw` summary delivery could still start the notify pipeline and then lose durable outcome tracking when the detached hook died, leaving the chat attempt and audit rows out of sync.
- **22:46** The default transcription reading flow could still render per-segment timeline/file/timestamp signatures inline, which polluted the operator view even when the transcript text itself was clean.
- **14:46** Late/manual Voice uploads could still inherit the generic file-size fallback instead of the intended larger audio limit, so oversized-but-valid voice media hit a stricter threshold than the route contract expected.
- **15:09** Canonical `upload_audio` calls could be rejected just because the target session had already become inactive, which broke late retry/manual upload recovery even when the session still existed and the caller had access.
- **18:12** `copilot-mksr` waiting sessions with retryable transcription failures (`insufficient_quota`) could remain stuck forever after balance refill because the periodic processing loop skipped them before message-level recovery logic ran.
- **18:12** `copilot-za9v` blocked the backend regression pack: the `/voicebot/upload_audio` oversized-file Jest test tried to allocate a production-scale payload, timed out after 10 seconds, and left a `TCPSERVERWRAP` open handle.
- **00:40** ACP follow-up verification still had a coverage gap between the deterministic harness and the real `/agents` host shell, so regressions in the auth-token -> ACP socket -> host-bridge lifecycle could slip past the eval baseline.
- **00:45** The ACP socket layer could not be deterministically injected in browser/runtime tests, which made host-shell coverage harder to isolate and encouraged brittle live-only verification.
- **00:52** Unavailable ACP agent selection could desynchronize frontend and backend state: the backend announced the rejected agent instead of preserving the last valid selection, so the settings dialog could drift away from the real connected session state.
- **01:00** ACP review recovery notes were partially reconstructed from a previously frozen Codex session, but the checked-in handoff artifact did not yet explicitly record the recovery method and fully normalized issue frontier.

### FEATURE IMPLEMENTED
- **22:46** Added stable `correlation_id` / `idempotency_key` propagation through `trigger_session_ready_to_summarize`, `update_project` after `Done`, `done_multiprompt`, and notify worker audit writes so summary retries dedupe against existing status rows instead of downgrading them.
- **22:46** Removed inline per-segment timeline signatures from the default transcription view while keeping fallback error signatures visible when transcript text is absent.
- **14:46** Raised the canonical default Voice audio upload ceiling to 600MB so route/runtime behavior matches real voice-media expectations unless an explicit env override says otherwise.
- **15:09** Kept `/api/voicebot/upload_audio` valid for existing accessible sessions even after they turn inactive, preserving late retry/manual upload recovery.
- **18:12** Closed `copilot-mksr` by extending the TS processing loop so prioritized scans can requeue retryable waiting-session transcription rows after balance recovery, allowing stuck sessions to resume through the canonical worker path instead of manual DB edits.
- **18:12** Closed `copilot-za9v` by replacing the pathological oversized-upload harness with a deterministic small-limit `/voicebot/upload_audio` integration test that still exercises the real Multer 413 contract and exits cleanly under Jest.
- **00:44** Added a dedicated ACP runtime contract lane for the real `/agents` shell, combining focused Jest coverage with a Playwright shell spec that runs against the actual `MainLayout` host surface instead of the harness-only route.
- **00:47** Added an injectable ACP socket factory so browser/runtime tests can force deterministic ACP transport behavior without changing the production ACP-only transport contract.
- **00:55** Preserved ACP agent-selection truth on the backend: rejected unavailable-agent switches now keep the current valid agent selected and re-emit the authoritative agent list instead of lying about a failed selection.
- **01:02** Refreshed the checked-in ACP review resume artifact with recovered session-log evidence so the next execution pass no longer depends on tmux scrollback or partially lost subagent context.
- **00:31** Rolled the ACP follow-up fixes to production and revalidated the live `/agents` route after PM2 restart, so the real public Copilot shell now serves the same ACP contract proven in the local harness/runtime lanes.

### CHANGES
- **22:46** Updated `backend/src/api/routes/voicebot/sessions.ts`, `backend/src/services/voicebot/voicebotDoneNotify.ts`, `backend/src/workers/voicebot/handlers/{doneMultiprompt,notifyHandler}.ts`, `backend/__tests__/voicebot/notify/{doneNotifyService,notifyWorkerEventLog}.test.ts`, and `backend/__tests__/voicebot/runtime/{triggerSummarizeRoute,updateProjectRouteSummaryAudit}.test.ts`.
- **22:46** Updated `app/src/components/voice/TranscriptionTableRow.tsx` plus transcript contract tests `app/__tests__/voice/{transcriptionFallbackErrorSignatureContract,transcriptionTimelineLabel}.test.ts`.
- **22:46** Verification:
  - `cd app && npx jest --runInBand __tests__/voice/transcriptionFallbackErrorSignatureContract.test.ts __tests__/voice/transcriptionTimelineLabel.test.ts`
  - `cd backend && NODE_OPTIONS='--experimental-vm-modules' npx jest --runInBand __tests__/voicebot/notify/doneNotifyService.test.ts __tests__/voicebot/notify/notifyWorkerEventLog.test.ts __tests__/voicebot/runtime/triggerSummarizeRoute.test.ts __tests__/voicebot/runtime/updateProjectRouteSummaryAudit.test.ts __tests__/voicebot/workers/workerDoneMultipromptHandler.test.ts`
  - `cd app && npm run build`
  - `cd backend && npm run build`
- **14:46** Updated `backend/src/constants.ts` so `VOICEBOT_FILE_STORAGE.maxAudioFileSize` now defaults to `600 * 1024 * 1024` bytes before falling back to the generic file limit.
- **15:09** Updated `backend/src/api/routes/voicebot/uploads.ts` plus focused runtime tests `backend/__tests__/voicebot/runtime/{uploadAudioRoute,uploadAudioRoute.runtimeAnchors}.test.ts` so session existence/access remains the gating rule for `upload_audio`, not raw `is_active`.
- **18:12** Updated quota-recovery worker/runtime coverage:
  - `backend/src/workers/voicebot/handlers/processingLoop.ts`
  - `backend/__tests__/voicebot/workers/workerProcessingLoopHandler.test.ts`
  - added focused waiting-session regressions for generic pending transcriptions and `insufficient_quota` recovery
- **18:12** Updated backend upload-limit test harness:
  - `backend/__tests__/voicebot/attachment/uploadAudioFileSizeLimitRoute.test.ts`
  - switched to an isolated `VOICEBOT_MAX_AUDIO_FILE_SIZE=16` import path, exact 413 payload assertions, and clean `--detectOpenHandles` execution
- **18:12** Verification:
  - `cd backend && NODE_OPTIONS='--experimental-vm-modules --disable-warning=ExperimentalWarning --disable-warning=DEP0040' npx jest __tests__/voicebot/workers/workerProcessingLoopHandler.test.ts __tests__/voicebot/workers/workerProcessingLoopHandler.finalizationAndDeferred.test.ts __tests__/voicebot/runtime/processingLoop.pendingClassification.test.ts`
  - `cd backend && NODE_OPTIONS='--experimental-vm-modules --disable-warning=ExperimentalWarning --disable-warning=DEP0040' npx jest __tests__/voicebot/attachment/uploadAudioFileSizeLimitRoute.test.ts --runInBand --detectOpenHandles`
  - `cd backend && npm run test:parallel-safe`
- **00:44** Added real ACP shell verification surfaces:
  - `app/__tests__/agents/agentsOpsRuntimeContract.test.tsx`
  - `app/e2e/agents-shell.spec.ts`
  - `app/package.json` (`test:agents:runtime`, `test:e2e:agents-shell`)
- **00:47** Updated ACP host/runtime integration:
  - `app/src/services/acpSocket.ts`
  - `app/src/pages/AgentsHarnessPage.tsx`
  - `app/__tests__/agents/agentsAcpSurfaceContract.test.ts`
  - `app/e2e/agents-harness.spec.ts`
- **00:55** Updated backend ACP namespace behavior and added focused coverage:
  - `backend/src/api/socket/acp.ts`
  - `backend/__tests__/services/acpSocketAgentSelection.test.ts`
- **01:02** Refreshed the checked-in recovery handoff:
  - `plan/acp-review-session-resume.md`
- **00:31** Production deploy/smoke:
  - `./scripts/pm2-backend.sh prod`
  - `./scripts/pm2-runtime-readiness.sh prod`
  - `./scripts/voice-notify-healthcheck.sh --env-file backend/.env.production`
  - `curl -fsS http://127.0.0.1:3002/api/health`
  - `curl -I -fsS https://copilot.stratospace.fun/agents`
- **01:10** Verification:
  - `cd app && npm run test:agents:runtime`
  - `cd app && npm run build`
  - `cd backend && npm run build`
  - `cd backend && npm test -- --runTestsByPath __tests__/services/acpSocketIsolationContract.test.ts __tests__/services/acpSocketAgentSelection.test.ts`
  - `cd app && npm run e2e:install`
  - `cd app && npm run preview -- --host 127.0.0.1 --port 4173`
  - `cd app && PLAYWRIGHT_BASE_URL=http://127.0.0.1:4174 npm run test:e2e:agents-harness`
  - `cd app && PLAYWRIGHT_BASE_URL=http://127.0.0.1:4174 npm run test:e2e:agents-shell`

## 2026-03-29
### PROBLEM SOLVED
- **11:30** ACP conversation surfaces still had no single reusable kernel: VS Code ACP UI lived in the `acp-plugin` repo, while `copilot /agents` had no package-backed ACP surface and would have required another host-specific reimplementation.
- **11:35** ACP and MCP boundaries in `copilot` were still easy to blur at the planning/runtime level, which risked leaking MCP transport assumptions into `/agents` even though `/agents` is supposed to be an ACP-only interaction surface.
- **11:45** Repo-level execution governance was duplicated and partially ambiguous: spec-driven subagent work did not yet encode a strict precedence rule for full `bd show --json`, local spec path lineage, and parent-packet overrides.
- **22:34** Valid ACP deep links at `/agents/session/:id` still redirected to `/agents` on cold load before persisted sessions hydrated, so session resume/share URLs could not reliably reopen the requested ACP conversation after refresh.
- **22:46** ACP follow-up findings and Comfy/LTX forensics restart points were preserved only in local session logs and `tmux` scrollback, which made the next implementation pass depend on fragile operator memory instead of checked-in handoff artifacts.

### FEATURE IMPLEMENTED
- **11:40** Materialized an ACP-only `/agents` surface in `copilot` that consumes the shared `@strato-space/acp-ui` package instead of reimplementing ACP UI logic locally.
- **11:50** Split repo governance into a cleaner contract: `AGENTS.md` now carries repository execution policy, while `RUNTIME.md` carries deploy/runtime topology and smoke-check authority.
- **12:10** Added deterministic ACP harness coverage so `copilot /agents` can be verified against the same shared UI/kernel contract used by ACP Plugin and browser `acp-chat`.
- **12:25** Closed the ACP UI package wave (`copilot-o7g3`) with normalized BD decomposition, ACP-only host adapter boundaries, and checked-in verification lanes.
- **22:34** Closed `copilot-iseg` by making persisted ACP sessions authoritative during cold-load hydrate and adding a focused route-regression test for `/agents/session/:id` restore.
- **22:46** Opened `copilot-jory` and preserved two reusable session-resume artifacts for the ACP review wave and the blocked Comfy/LTX forensics thread.

### CHANGES
- **11:40** Added ACP-only host/runtime files for `copilot /agents`:
  - `app/src/pages/AgentsOpsPage.tsx`
  - `app/src/pages/AgentsHarnessPage.tsx`
  - `app/src/services/acpHostBridge.ts`
  - `app/src/services/acpSocket.ts`
  - `backend/src/api/socket/acp.ts`
  - `backend/src/services/acp/`
- **11:50** Updated governance/runtime docs:
  - `AGENTS.md`
  - `RUNTIME.md`
  - `README.md`
  - `plan/acp-ui-component-base-spec.md`
  - `plan/index.md`
- **12:10** Added ACP contract/eval coverage in:
  - `app/__tests__/agents/acpHostBridge.test.ts`
  - `app/__tests__/agents/agentsAcpSurfaceContract.test.ts`
  - `app/e2e/agents-harness.spec.ts`
  - `backend/__tests__/services/acpSocketIsolationContract.test.ts`
- **12:25** Normalized BD execution metadata for the ACP UI wave and closed `copilot-o7g3` after synchronizing issue DAG, acceptance criteria, and spec/source linkage.
- **12:30** Verification:
  - `cd app && npm run build`
  - `cd backend && npm run build`
  - `cd app && npm test -- --runTestsByPath __tests__/agents/acpHostBridge.test.ts __tests__/agents/agentsAcpSurfaceContract.test.ts`
  - `cd backend && npm test -- --runTestsByPath __tests__/services/acpSocketIsolationContract.test.ts`
  - `cd app && PLAYWRIGHT_BASE_URL=http://127.0.0.1:4174 npm run test:e2e:agents-harness`
- **13:12** Production deploy smoke passed via `./scripts/pm2-backend.sh prod`: mandatory PM2 runtimes came back online, `./scripts/voice-notify-healthcheck.sh --env-file backend/.env.production` returned HTTP 200, `/api/health` returned `status=ok`, and `https://copilot.stratospace.fun/agents` answered with HTTP 200 after rollout.
- **22:34** Updated `app/src/pages/AgentsOpsPage.tsx` and added `app/__tests__/agents/agentsDeepLinkRestore.test.tsx` so persisted ACP sessions hold a valid deep link during cold-load hydration and the requested session is selected once the live store catches up.
- **22:46** Added checked-in restart/handoff artifacts `plan/acp-review-session-resume.md` and `plan/comfy-session-resume.md`; updated `AGENTS.md` and `README.md` so recovered session-handoff notes have an explicit home outside root governance text.
- **22:49** Verification:
  - `cd app && npm test -- --runTestsByPath __tests__/agents/agentsDeepLinkRestore.test.tsx __tests__/agents/acpHostBridge.test.ts __tests__/agents/agentsAcpSurfaceContract.test.ts`
  - `cd app && npm run build`

## 2026-03-28
### PROBLEM SOLVED
- **00:40** Voice transcription error forensics still drifted in the `missing_transport` / `missing_file_path` branches: the worker stored `openai_key_present=false` even when a runtime key was configured, which made Telegram/media repair investigations point at the wrong root cause.
- **00:40** Backend/app test output remained noisy after the previous stabilization wave: Ant Design deprecation warnings, textarea autosize behavior under JSDOM, and direct console assertions in Voice contract tests all made passing suites harder to interpret.
- **00:40** WebRTC `Done` could still leave a stale late-upload path for already-closed sessions if a chunk arrived after close, and the trace metadata on that path was not guaranteed when the caller omitted an explicit `transition_id`.

### FEATURE IMPLEMENTED
- **00:40** Closed Phase I (`copilot-qtcp.9`, `copilot-8h9u*`) with deterministic transcription-error context, UI/test-noise cleanup, and capability-based textarea autosize fallback that works both in browsers and Jest.
- **00:40** Closed Phase II (`copilot-c4n8`, `copilot-haq2`) by enforcing a client-side post-`Done` closed-session upload barrier with fallback transition correlation, while verifying that the end-to-end `create_tasks` correlation logging path already satisfied the required contract.

### CHANGES
- **00:40** Updated `backend/src/workers/voicebot/handlers/transcribeHandler.ts` and focused worker tests (`backend/__tests__/voicebot/workers/workerTranscribeHandler.{errorPaths,fallbackAndConfig}.test.ts`) so `missing_transport` / `missing_file_path` error payloads now reuse the configured OpenAI key mask/presence instead of forcing a false-negative runtime diagnosis.
- **00:40** Updated `app/src/components/codex/CodexIssueDetailsCard.tsx`, `app/src/components/voice/Screenshort.tsx`, `app/src/pages/operops/{ProjectManagementPage,ProjectsTree,TaskPage}.tsx`, and related Voice contract tests to remove deprecated Ant Design API usage (`Descriptions.styles`, `Card.styles.body`, `Space.orientation`, `Timeline.items.content`).
- **00:40** Updated `app/src/components/voice/PossibleTasks.tsx` plus `app/__tests__/voice/possibleTasksDesignContract.test.ts` so the Draft description textarea now uses a capability-based autosize config (`supportsTextareaAutosize`) instead of a test-only branch, preserving browser behavior while avoiding JSDOM `NaN` sizing warnings.
- **00:40** Updated `app/public/webrtc/webrtc-voicebot-lib.js` and added `app/__tests__/voice/webrtcLateDoneChunkUploadRaceContract.test.ts` so `Done` always gets a fallback correlation id, closed sessions are remembered for a bounded TTL, and stale post-close chunk uploads are skipped with explicit trace/log metadata instead of hitting the backend.
- **00:40** Updated Voice contract tests (`app/__tests__/voice/{activateSessionResilienceContract,possibleTasksPostCreateContract,voiceSocketRealtimeContract}.test.ts`) so expected diagnostics are asserted via spies instead of leaking passing-test console noise.
- **00:40** Verification:
  - `cd app && npm test` (`110` suites, `343` tests, passed)
  - `cd backend && npm run test:parallel-safe` (`141` suites, `716` tests, passed)

## 2026-03-27
### PROBLEM SOLVED
- **08:34** После аварийного рестарта прод-среды часть Voice runtime-поведения оставалась недетерминированной: readiness запускался неявно, notify-поверхность проверялась вручную, а восстановление PM2-процессов зависело от локального состояния хоста.
- **08:34** CRM temporal/read contracts продолжали принимать смешанные legacy-формы параметров (`mode`, диапазоны дат, `include_older_drafts`), что создавало drift между app/backend и давало нестабильные результаты в session/task списках.
- **08:34** Session/task linkage и recency-семантика для Voice Drafts сохраняли риски stale-сопоставлений и неунифицированного `updated_at` bump при смешанных типах данных на маршрутах CRM/Voice.
- **10:44** Temporal range/depth spec closure status was still ambiguous (`Draft` header with implemented child backlog), which blocked objective closeout of the planning wave.

### FEATURE IMPLEMENTED
- **08:34** Добавлен production-grade runtime recovery kit: отдельные readiness/healthcheck скрипты, bootstrap-путь для PM2, и тестовое покрытие на обязательные recovery-инварианты после сбоя.
- **08:34** Temporal API-контракт приведен к каноническому виду: нормализация `response_mode` и диапазонов дат, удаление deprecated-пути `include_older_drafts`, плюс parity-тесты для route matcher/runtime.
- **08:34** Усилен Voice Draft consistency layer: безопасная нормализация date-like значений, устойчивое `updated_at` поведение и явная рекомпоновка session linkage в persistence/read путях.
- **10:44** Finalized a strict 5-gate spec closeout for the temporal wave and closed epic `copilot-xmcm` after verifying all dependent tickets are closed.

### CHANGES
- **08:34** Добавлены скрипты `scripts/pm2-runtime-readiness.sh` и `scripts/voice-notify-healthcheck.sh`, обновлен `scripts/pm2-backend.sh`, добавлены тесты `backend/__tests__/scripts/{pm2RuntimeReadiness,voiceNotifyHealthcheck,pm2BackendProdBootstrap}.test.ts`.
- **08:34** Обновлены `backend/src/api/routes/crm/tickets.ts`, `app/src/store/kanbanStore.ts` и связанные контрактные тесты (`backend/__tests__/api/crmTicketsTransportLegacyContract.test.ts`, `backend/__tests__/api/crmTicketsTemporal*.test.ts`, `app/__tests__/operops/crmKanbanTransportContract.test.ts`) для canonical temporal/transport поведения.
- **08:34** Обновлены `backend/src/api/routes/voicebot/{sessions,sessionsSharedUtils,possibleTasksMasterModel}.ts`, `backend/src/services/{draftRecencyPolicy,taskUpdatedAt}.ts`, `backend/src/services/voicebot/{createTasksAgent,persistPossibleTasks}.ts` и связанные runtime/service тесты для устойчивого session linkage и recency/date нормализации.
- **08:34** Обновлены документы `AGENTS.md`, `README.md`, `docs/VOICEBOT_API.md`, `docs/VOICEBOT_API_TESTS.md`, `agents/agent-cards/create_tasks.md`, добавлен spec `plan/2026-03-27-voice-media-attachment-transcription-spec.md` и forensic bundle `tmp/voice-investigation-artifacts/20260327T045412Z-69c60caf4926f6f263d066d6/`.
- **08:34** Verification:
  - `bash -n scripts/voice-notify-healthcheck.sh scripts/pm2-runtime-readiness.sh scripts/pm2-backend.sh`
  - `cd backend && NODE_OPTIONS='--experimental-vm-modules' npx jest --runInBand __tests__/scripts/voiceNotifyHealthcheck.test.ts __tests__/scripts/pm2RuntimeReadiness.test.ts __tests__/scripts/pm2BackendProdBootstrap.test.ts __tests__/services/voicebot/agentsRuntimeRecovery.test.ts __tests__/services/voicebot/createTasksAgentRecovery.test.ts`
- **10:44** Updated spec headers and status accounting in `plan/2026-26-03-voice-date-depth-and-range-fix-spec.md` (`Status ✅Closed`, real ticket-line counters), accepted and preserved the expanded `copilot-qtcp` BD decomposition in `plan/2026-03-27-voice-media-attachment-transcription-spec.md`, and closed `copilot-xmcm` in `bd` with close reason tied to dependency/quality gates.
- **10:50** Accepted and preserved additional forensic/planning notes in `plan/2026-03-27-test-noise.md` (Greek-scholastic classification split for `copilot-8h9u.*`) as part of close-session “accept all local changes” policy.

## 2026-03-26
### PROBLEM SOLVED
- **05:52** `test:parallel-safe` was unstable because stale `CREATE_TASKS` repair tests implicitly depended on fresh `ObjectId` timestamps, causing false `skip_recent` decisions instead of deterministic stale repair verdicts.
- **05:52** Sessions-list runtime parity tests still assumed legacy visibility behavior and could fail against the canonical contract where inactive non-deleted sessions with zero messages are filtered out.
- **22:47** WebRTC `New/Rec/Done` flows could race each other and stale active-session fallbacks could revive already-closed sessions, which let the UI drift away from backend `session_inactive` truth and made close/start behavior nondeterministic.
- **22:47** Voice task refresh still assumed categorization always queued successfully; when categorization could not be queued, `CREATE_TASKS` could refresh with ambiguous zero-task outcomes instead of preserving an explicit no-task decision and session lineage.
- **22:47** CRM/OperOps transport and detail rendering still drifted: `/api/crm/tickets` legacy aliases were informal, replayed mutations could move `updated_at` backwards, and task descriptions could misrender Markdown or unsafe HTML fragments.
- **22:59** Legacy Draft master rows with numeric `updated_at` could still be skipped by read compatibility, which let full-recompute inserts duplicate a historical possible-task row instead of reusing and canonicalizing it.

### FEATURE IMPLEMENTED
- **05:52** Stabilized stale marker semantics for `CREATE_TASKS`: explicit processor markers now have priority, with `_id` used only as fallback when explicit markers are absent.
- **05:52** Realigned sessions-list parity coverage to the current visibility policy and added reusable message-count aggregate mocking for deterministic runtime tests.
- **22:47** Serialized WebRTC lifecycle transitions with correlation ids, fail-fast inactive-session handling, and awaited REST `session_done` propagation so host/FAB/page controls share one deterministic close/start contract.
- **22:47** Added canonical `no_task_decision` persistence for categorization-not-queued flows across web ingress, Telegram ingress, worker transcribe reuse, and processing-loop recovery; Voice possible-task persistence now keeps `discussion_sessions[]` lineage and monotonic timestamps.
- **22:47** Canonicalized CRM tickets transport onto `statuses/project/response_mode/from_date/to_date`, removed legacy frontend `includeOlderDrafts` coupling from Kanban fetches, and upgraded OperOps `TaskPage` to Markdown-first sanitized description rendering.
- **22:59** Extended Draft read compatibility to normalize numeric `updated_at` values into canonical `Date` instances before reuse/filtering, preserving monotonic replay behavior for historical possible-task rows.

### CHANGES
- **05:52** Updated `backend/src/services/voicebot/createTasksStaleProcessingRepair.ts` and `backend/__tests__/services/voicebot/createTasksStaleProcessingRepair.test.ts` to enforce explicit marker precedence, remove `ObjectId-now` test drift, and add focused regression cases for marker-priority semantics.
- **05:52** Updated `backend/__tests__/voicebot/runtime/sessionsRuntimeCompatibilityRoute.sessionParity.test.ts` and `backend/__tests__/voicebot/runtime/sessionsRuntimeCompatibilityRoute.test.helpers.ts` so parity assertions use canonical message-count aggregation and explicitly test the hidden inactive-zero-message visibility branch.
- **05:52** Verification:
  - `NODE_OPTIONS='--experimental-vm-modules' npx jest --runInBand __tests__/services/voicebot/createTasksStaleProcessingRepair.test.ts __tests__/voicebot/runtime/sessionsRuntimeCompatibilityRoute.sessionParity.test.ts`
  - `npm run test:parallel-safe` (`128` suites, `586` tests, all passed).
- **22:47** Updated `app/public/webrtc/webrtc-voicebot-lib.js`, `app/src/store/voiceBotStore.ts`, and `app/src/components/voice/MeetingCard.tsx` so start/done transitions are serialized, `session_done` requests carry transition correlation ids, and `session_inactive` stops local activation fallback.
- **22:47** Updated `backend/src/api/routes/voicebot/{sessions,uploads}.ts`, `backend/src/workers/voicebot/handlers/{transcribeHandler,processingLoop}.ts`, `backend/src/voicebot_tgbot/ingressHandlers.ts`, `backend/src/services/voicebot/{createTasksCompositeSessionState,persistPossibleTasks}.ts`, and `backend/src/api/routes/voicebot/possibleTasksMasterModel.ts` so categorization-not-queued flows persist explicit no-task decisions, `CREATE_TASKS` refreshes re-arm with `incremental_refresh`, inactive sessions fail fast before/after insert, and Voice draft lineage keeps `discussion_sessions[]`.
- **22:47** Updated `backend/src/api/routes/crm/tickets.ts`, `backend/src/services/taskUpdatedAt.ts`, `app/src/store/kanbanStore.ts`, and `app/src/pages/operops/TaskPage.tsx` so CRM transport aliases resolve canonically with warning telemetry, `updated_at` stays monotonic across task/attachment mutations, and TaskPage descriptions render Markdown with sanitized HTML fallback.
- **22:47** Added regression coverage in `app/__tests__/operops/{crmKanbanTransportContract,taskPageMarkdownRenderContract}.test.ts`, `app/__tests__/voice/{doneStartRaceLockContract,webrtcStartTransitionContract}.test.ts`, `backend/__tests__/api/crmTicketsTransportLegacyContract.test.ts`, `backend/__tests__/services/taskUpdatedAt.test.ts`, `backend/__tests__/voicebot/runtime/{activateSessionRoute,sessionsRuntimeCompatibilityRoute.addTextParity}.test.ts`, and refreshed related Voice/CRM runtime suites.
- **22:47** Accepted pending local artifacts in this closeout package: `project`, `statuses`.
- **22:47** Verification:
  - `cd app && npm run test:serial -- __tests__/operops/crmKanbanTransportContract.test.ts __tests__/operops/taskPageMarkdownRenderContract.test.ts __tests__/voice/doneStartRaceLockContract.test.ts __tests__/voice/webrtcStartTransitionContract.test.ts __tests__/voice/activateSessionResilienceContract.test.ts __tests__/voice/possibleTasksPostCreateContract.test.ts __tests__/voice/transcriptionFallbackErrorSignatureContract.test.ts __tests__/voice/codexTasksInlineDetailsContract.test.ts` (`8` suites, `33` tests, passed)
  - `cd backend && NODE_OPTIONS='--experimental-vm-modules' npx jest --runInBand __tests__/api/crmTicketsTransportLegacyContract.test.ts __tests__/services/taskUpdatedAt.test.ts __tests__/voicebot/runtime/activateSessionRoute.test.ts __tests__/voicebot/runtime/sessionsRuntimeCompatibilityRoute.addTextParity.test.ts __tests__/voicebot/runtime/uploadAudioRoute.test.ts __tests__/voicebot/runtime/tgIngressHandlers.baseFlows.test.ts __tests__/voicebot/workers/workerTranscribeHandler.test.ts __tests__/voicebot/workers/workerProcessingLoopHandler.test.ts __tests__/voicebot/session/sessionDoneFlowService.test.ts __tests__/services/voicebot/persistPossibleTasks.test.ts` (`10` suites, `96` tests, passed)
  - `cd app && npm run build`
  - `cd backend && npm run build`
- **22:59** Updated `backend/src/services/voicebot/persistPossibleTasks.ts` so non-write Draft reads normalize legacy numeric `updated_at` values before validation/reuse, keeping session/project candidate pools compatible with historical master rows.
- **22:59** Verification:
  - `cd backend && NODE_OPTIONS='--experimental-vm-modules' npx jest --runInBand __tests__/services/voicebot/persistPossibleTasks.test.ts`
  - `cd backend && npm run build`

## 2026-03-25
### PROBLEM SOLVED
- **22:46** OpenAI `invalid_api_key` failures were still treated inconsistently across transcribe/categorize/processing-loop recovery paths, so sessions could stick in retry limbo with unclear operator diagnostics even after runtime credentials were repaired.
- **22:46** Low-signal chunks (noise/garbage ASR output) still flowed through categorization and post-transcribe task generation, creating avoidable downstream queue load and draft pollution.
- **22:46** Manual transcription retry (`POST /api/voicebot/transcription/retry`) only touched coarse session flags and did not reliably re-arm per-message retry metadata, so processing-loop retries were not deterministic.
- **14:15** Voice session status footer (`Все сообщения обработаны`) still behaved like a viewport-pinned strip on long tab content, so `Транскрипция`, `Категоризация`, and especially `Задачи` could visually collide with the footer instead of letting the workspace grow naturally.
- **14:15** Historical and freshly generated task priorities could still drift as decorated values like `🔥 P1`, which broke read/write validation symmetry across Voice Drafts, backend persistence, and ontology tooling.
- **14:15** Production deploy recovery still depended on pre-existing PM2 VoiceBot entries; if `copilot-voicebot-workers-prod` disappeared entirely, deploys could leave transcription/runtime queues dead instead of recreating the worker.
- **14:15** Composite `CREATE_TASKS` output still drifted into English review/summary/task prose on Russian-dominant sessions, even though operators expect session artifacts to stay in the session language with Russian as the mixed-language fallback.
- **05:08** Voice Draft desktop layout still wasted vertical space: the detail card depended on nested scroll, the task list and right panel were not height-aligned, and operators had to fight page-plus-widget double scroll to read one task.
- **05:08** The Voice sessions list at `/voice?page=1&pageSize=100` had regressed into a multi-second load because frontend hydration retriggered the list fetch while backend `sessions/list` still did oversized joins plus per-session message/task work.
- **04:15** Shared selector behavior still drifted between Voice and OperOps, so project and task-type controls could collapse into flat option lists, leak raw ids, or require different click paths depending on the surface.
- **04:15** Production UI regressed after the parity wave: `/operops/crm` could blank-render behind React error `#185`, while the left app shell became narrow enough to clip sidebar labels even though backend APIs and the database were healthy.
- **04:15** Historical `CREATE_TASKS` runs still left stale processing markers and request-vs-finished drift in session state, which kept green pending dots and processing footers alive on old Voice sessions after the real jobs had already ended.
- **01:12** The annotated-TQL persistence work had only a startup prototype: backend could load ontology cards, but no production Voice write/read path actually enforced the card-backed task contract on `automation_tasks`.
- **01:12** The new ontology adapter layer still had two silent drift risks: reverse Mongo translation could overwrite duplicate field mappings without error, and card inheritance depended on the accidental equality `semantic-card id == type label`.
- **01:12** Repo/operator docs did not yet explain the new semantic-card runtime, the first migrated `automation_tasks` slice, or the exact ontology validation/test commands needed to verify it.
- **04:27** The migrated Draft slice still stopped at field-coverage/reversible-mapping checks, so `automation_tasks` could carry scalar value/type/domain drift inside the supposedly strict ontology-backed path.

### FEATURE IMPLEMENTED
- **22:46** Unified OpenAI recovery handling around canonical retry codes (`insufficient_quota`, `invalid_api_key`) across worker handlers, processing-loop repair logic, and runtime recovery detection; Voice transcription UI now has explicit localized `invalid_api_key` diagnostics.
- **22:46** Added a post-transcribe garbage-detection gate (default model `gpt-5.4-nano`) that annotates chunks with `garbage_detection` metadata and short-circuits categorization/`CREATE_TASKS` enqueue when output is classified as noise.
- **22:46** Reworked transcription retry into a message-level rearm flow: retry route resets pending message retry state, clears session-level error markers, and returns explicit processing-loop retry diagnostics.
- **14:15** Put the Voice footer/status widget back into normal document flow, so tab content owns the page height and the footer renders after the workspace instead of overlaying it.
- **14:15** Reduced canonical priority storage to text-only `P1..P7` across frontend, backend, and ontology paths; urgent flame badges are now rendered visually in the UI only.
- **14:15** Hardened the production PM2 bootstrap so deploy can recreate missing VoiceBot worker/bot runtimes instead of assuming they already exist.
- **14:15** Added session-language preference to the `create_tasks` analyzer contract and a Russian language-repair pass for composite summary/review/task artifacts.
- **05:08** Landed a taller matched-height Voice Draft workspace: the list and detail panes now share the same desktop shell, the right card is readable without nested forced-height scrolling, and the overall `/voice/session/:id` tasks area no longer relies on accidental double scroll.
- **05:08** Accelerated the Voice sessions list path by removing duplicate frontend fetches and moving backend task/message counting to bounded batch reads, preserving the existing list contract while cutting the main latency sources.
- **04:15** Unified project/task-type selector parity onto shared option-source helpers and shared wrappers, keeping hierarchy/labels consistent between Voice and OperOps and making first-click inline editing deterministic again.
- **04:15** Hardened the app shell and CRM render path for production: the sidebar is readable again, CRM status-stat updates are idempotent, and `/operops/crm` plus `/voice` now render from the same stable shell without the frontend-only blank-page failure.
- **04:15** Added a canonical stale-state repair flow for historical `CREATE_TASKS` markers and formalized the browser acceptance ritual around `systemctl restart mcp@chrome-devtools.service` before each live UI smoke cycle.
- **01:12** Landed the first real card-backed persistence slice for Voice Draft tasks: backend now boots a semantic-card registry plus a checked/unchecked Mongo-card bridge, `save_possible_tasks` writes task core fields through the strict `automation_tasks` adapter, and `session_tasks(bucket='Draft')` checks Draft master rows against the same card-backed field-coverage/mapping contract before returning them.
- **01:12** Hardened the ontology runtime to fail fast on ambiguous reverse Mongo mappings and to resolve inherited card owns by supertype label rather than by accidental card-id equality.
- **01:12** Synced repo/operator docs and test runbooks to the new runtime contract, including focused ontology runtime Jest suites and the TypeDB contract/data validation stack.
- **04:27** Extended the Draft `automation_tasks` slice with card-derived scalar validation: the registry now carries attribute value types plus owner-level `@values(...)`, the adapter can validate selected Mongo fields against those card rules, and the migrated Voice Draft path now enforces strict Draft-master invariants while leaving structured compatibility payloads explicitly deferred.

### CHANGES
- **22:46** Updated `backend/src/workers/voicebot/handlers/{transcribeHandler,categorizeHandler,processingLoop}.ts`, `backend/src/workers/voicebot/handlers/shared/openAiErrors.ts`, and `backend/src/services/voicebot/agentsRuntimeRecovery.ts` plus focused worker/runtime tests so `invalid_api_key` joins quota-class recovery with consistent retry markers/messages and processing-loop requeue behavior.
- **22:46** Added `backend/src/services/voicebot/{transcriptionGarbageDetector,transcriptionQueue}.ts`, wired shared transcribe enqueue usage from `backend/src/api/routes/voicebot/uploads.ts`, `backend/src/voicebot_tgbot/ingressHandlers.ts`, and processing-loop requeue, and added detector/worker regression coverage.
- **22:46** Updated `backend/src/api/routes/voicebot/transcription.ts` so `/transcription/retry` re-arms pending message retries (`to_transcribe`, `transcribe_attempts`, `transcription_next_attempt_at`) and clears stale session transcription error fields before processing-loop pickup.
- **22:46** Updated `app/src/components/voice/TranscriptionTableRow.tsx`, `docs/COPILOT_OPENAI_API_KEY_RUNTIME_STATE_2026-03-17.md`, and `docs/voice-bugfix-wave-dag-2026-03-25.md` for localized invalid-key diagnostics and current production-state documentation alignment.
- **14:15** Updated `app/src/{index.css,components/voice/{Transcription,Categorization,PossibleTasks}.tsx}` and focused Voice layout contracts so tab panes grow in normal page flow, the footer is no longer viewport-fixed, and live browser acceptance now includes screenshot overlap checks for the changed surfaces.
- **14:15** Updated `app/src/constants/crm.ts`, `backend/src/{constants.ts,api/routes/voicebot/possibleTasksMasterModel.ts,services/voicebot/persistPossibleTasks.ts}`, ontology schema/scripts/tests, and related fixtures so persisted priorities are canonical `P1..P7` values only while the frontend renders the flame accent as presentation.
- **14:15** Updated `scripts/pm2-backend.sh` plus `backend/__tests__/scripts/pm2BackendProdBootstrap.test.ts` so `./scripts/pm2-backend.sh prod` recreates missing `copilot-voicebot-workers-prod` / `copilot-voicebot-tgbot-prod` runtimes instead of silently skipping them.
- **14:15** Updated `agents/agent-cards/create_tasks.md`, `backend/src/services/voicebot/createTasksAgent.ts`, `backend/src/services/voicebot/{createTasksCompositeSessionState,persistPossibleTasks}.ts`, `backend/src/api/routes/voicebot/sessions.ts`, `backend/src/workers/voicebot/handlers/createTasksFromChunks.ts`, and focused route/worker tests so composite analyzer output carries `preferred_output_language`, surfaces explicit `no_task_decision`, and repairs Russian session artifacts when non-allowlisted English prose leaks through.
- **05:08** Updated `AGENTS.md` and repo docs so subagent issue packets now require the literal first-step command `bd show <id> --json`, keeping child execution bound to the canonical ticket payload instead of parent paraphrase.
- **05:08** Updated `app/src/{index.css,pages/voice/SessionPage.tsx,components/voice/PossibleTasks.tsx}` and focused Voice task-surface tests so the Draft master/detail workspace uses `100dvh` shell flow, aligned pane heights, and no forced nested detail scroller on desktop.
- **05:08** Updated `app/src/{pages/voice/SessionsListPage.tsx,store/voiceBotStore.ts,types/voice.ts}`, `backend/src/api/routes/voicebot/sessions.ts`, `backend/src/constants.ts`, and focused route/contract tests so `/api/voicebot/sessions/list` no longer refetches on hydration, store ordering is canonical, `message_count` and task counters are batched, and `automation_voice_bot_messages.session_id` is indexed for the list route.
- **04:15** Updated `app/src/{App.tsx,index.css}` plus `app/__tests__/shell/appShell.test.tsx` to widen the sidebar, keep `(zero)`/other meta badges readable, and align shell spacing with the current Voice/OperOps parity contract.
- **04:15** Reworked `app/src/components/voice/PossibleTasks.tsx`, shared selector wrappers under `app/src/components/shared/`, and option builders `app/src/utils/{projectSelectOptions,taskTypeSelectOptions}.ts`; refreshed focused selector/Voice tests so project hierarchy and operational task-type labels come from one shared source.
- **04:15** Updated `app/src/components/crm/CRMKanban.tsx`, `app/src/store/crmStore.ts`, and `app/__tests__/operops/crmStoreStatusStats.test.ts` so filtered-ticket/status-stat recomputes are memoized/idempotent and no longer trigger the React render loop that blanked `/operops/crm` on production.
- **04:15** Added `backend/src/services/voicebot/createTasksStaleProcessingRepair.ts`, `backend/scripts/voicebot-repair-stale-create-tasks-processing.ts`, and focused backend tests to repair stale historical `CREATE_TASKS` state in place and keep session/activity indicators honest after queue completion.
- **01:12** Added backend ontology runtime services under `backend/src/services/ontology/{ontologyCardRegistry,ontologyPersistenceBridge,ontologyCollectionAdapter}.ts` plus focused suites `backend/__tests__/services/{ontologyCardRegistry,ontologyPersistenceBridge,ontologyCollectionAdapter}.test.ts`.
- **01:12** Updated `backend/src/services/voicebot/persistPossibleTasks.ts`, `backend/src/api/routes/voicebot/sessions.ts`, and `backend/__tests__/services/voicebot/persistPossibleTasks.test.ts` so the canonical Draft master-row path now round-trips task core fields through the ontology adapter while keeping `relations` / `parent` / `children` / `discussion_sessions` as compatibility overlays.
- **01:12** Extended the task ontology/mapping surface for the migrated path (`parent_id`, `deleted_at`), removed the ambiguous `priority_rank <- priority` reverse mapping from `ontology/typedb/mappings/mongodb_to_typedb_v1.yaml`, regenerated inventory artifacts, and refreshed `ontology/README.md`, `README.md`, `AGENTS.md`, `docs/VOICEBOT_API.md`, `docs/VOICEBOT_API_TESTS.md`, and `docs/TESTING_PROCEDURE.md`.
- **04:27** Updated `backend/src/services/ontology/ontologyCardRegistry.ts` to extract attribute value types and owner-level enum domains from TQL, updated `backend/src/services/ontology/ontologyCollectionAdapter.ts` with opt-in Mongo-field validation, and narrowed `backend/src/services/voicebot/persistPossibleTasks.ts` to a strict Draft-master scalar subset plus explicit defers for structured compatibility payloads.
- **04:27** Kept the migrated Draft slice legacy-safe: write-time invariants still require `source_kind=voice_possible_task`, but read-time validation now accepts legacy `voice_session` markers and project-wide Draft candidate pools drop invalid/unrelated rows instead of aborting the current session persist.
- **04:27** Added regression coverage for card-derived attribute specs, adapter value/type/domain enforcement, Draft invariant failures, compatibility-overlay pass-through, and route-level `session_tasks(Draft)` / `save_possible_tasks` behavior under the tightened ontology contract.
- **01:12** Verification passed except for the environment-blocked TypeDB endpoint gate:
  - `cd backend && npm run build`
  - `cd backend && npx jest --runTestsByPath __tests__/services/ontologyCardRegistry.test.ts __tests__/services/ontologyPersistenceBridge.test.ts __tests__/services/ontologyCollectionAdapter.test.ts __tests__/services/voicebot/persistPossibleTasks.test.ts`
  - `cd backend && NODE_OPTIONS='--experimental-vm-modules' npx jest --runTestsByPath __tests__/voicebot/runtime/sessionUtilityRuntimeBehavior.validation.test.ts -t "session_tasks\\(Draft\\)|save_possible_tasks"`
  - `cd backend && NODE_OPTIONS='--experimental-vm-modules' npx jest --runTestsByPath __tests__/voicebot/runtime/sessionUtilityRuntimeBehavior.validation.test.ts -t "save_possible_tasks stores master rows in automation_tasks|session_tasks\\(Draft\\) prefers automation_tasks master rows linked to the voice session|respects draft recency window override when include_older_drafts is true"`
  - `cd backend && npm run ontology:typedb:build`
  - `cd backend && npm run ontology:typedb:contract-check`
  - `cd backend && npm run ontology:typedb:domain-inventory`
  - `cd backend && npm run ontology:typedb:entity-sampling`
  - `cd backend && npm run ontology:typedb:ingest:dry`
  - `cd backend && npm run ontology:typedb:validate` remains environment-blocked without a reachable local TypeDB endpoint (`127.0.0.1:1729`)

## 2026-03-24
### PROBLEM SOLVED
- **23:10** Voice session and sessions-list surfaces still wasted desktop space: loading states collapsed into giant empty canvases, widget shells carried excess outer framing, and task/detail areas relied on nested scroll instead of using the available width and height efficiently.
- **23:10** Draft editing remained operator-hostile: inline title edits lost focus under autosave/refetch, first-click combobox editing was inconsistent, and the list/detail workspace still presented more chrome than useful task information.
- **23:10** Summary/review/taskflow session state still diverged across manual and background refresh paths, leaving some sessions without persisted `session_name`, `review_md_text`, or clear operator forensics after the task analyzer had already finished.

### FEATURE IMPLEMENTED
- **23:10** Landed a compact Voice Draft workspace with master-detail dominance, operable inline metadata pills, top-level `Саммари` / `Ревью` tabs, and stricter task-surface semantics aligned with the dual-stream ontology.
- **23:10** Added a forensic-grade session bundle workflow for Voice incidents, then used it to close parity gaps in composite `CREATE_TASKS` persistence and background worker side effects.
- **23:10** Promoted the agents runtime default to `gpt-5.4-mini` while keeping the large-window `gpt-5.4` registration in the bootstrap, so the fast-agent service now starts from the canonical mini default after auth/runtime recovery.

### CHANGES
- **23:10** Updated `app/src/{pages/voice/SessionPage.tsx,pages/voice/SessionsListPage.tsx,components/voice/{MeetingCard,PossibleTasks,SessionStatusWidget}.tsx,store/voiceBotStore.ts,utils/voiceSessionTabs.ts}` and related tests so Voice tabs, pending dots, summary/review surfaces, and draft editing share one canonical UI/runtime contract.
- **23:10** Added `backend/scripts/voicebot-session-forensics.ts`, `docs/VOICE_SESSION_FORENSICS_PLAYBOOK.md`, and session-level repair helpers so title/review/taskflow investigations produce reproducible bundles instead of ad hoc Mongo/PM2 spelunking.
- **23:10** Updated `agents/{fastagent.config.yaml,run_fast_agent.py,README.md}`, `backend/src/services/voicebot/agentsRuntimeRecovery.ts`, and focused runtime tests to pin the default fast-agent model to `gpt-5.4-mini` after runtime/auth sync.

## 2026-03-23
### PROBLEM SOLVED
- **22:47** Background `CREATE_TASKS` refreshes still applied only part of the composite analyzer output, so worker-driven recomputes could leave `summary_md_text`, `review_md_text`, generated session/project updates, and Ready+/Codex enrichment side effects missing even after draft rows were refreshed.
- **22:47** Incremental draft refreshes could still soft-delete unmatched rows outright, which made narrowed recomputes destructive and removed the stale compatibility evidence needed for repeated-session triage.
- **22:47** Voice incident investigations still depended on ad hoc Mongo/PM2 spelunking, so parity failures between manual and background `CREATE_TASKS` paths had no standard evidence bundle or first-response operator workflow.
- **22:47** Draft enrichment markdown still tolerated freeform preface text before the canonical sections, so parser/builders could drift away from the fixed `## description`-first contract.
- **00:58** Voice sessions still depended on manual `Done` even after activity stopped, which left inactive active sessions open indefinitely and could preserve missing titles until an operator intervened.
- **02:27** Closed voice sessions could keep blinking green `Категоризация` / `Задачи` dots because the frontend treated stale historical incompleteness as if runtime processing were still active.
- **01:53** Voice inline Codex details could hide existing `bd` comments because the modal reused table-row payloads instead of loading the canonical single-issue detail contract.
- **02:42** OperOps task pages could crash with React error `#310` and render a blank page when hook order drifted between loading/not-found renders and the final task render.
- **05:32** Long `Tasks` recomputes could fail on production sessions because the composite `create_tasks` runtime still hit context overflow, unbounded project evidence expectations, and wrapped retry paths that did not reliably fall back to reduced context.
- **05:49** Jira-style report generation could fail with `Не удалось сформировать отчет` even after the spreadsheet was created, because Google Sheets metadata loads were still vulnerable to proxy drift and transient `503` responses.
- **08:35** Voice session review surfaces had drifted into a split UX: `Summary` still lived at the bottom of `Категоризация`, `Draft` kept a noisy bulk/triage layout, and semantically identical drafts could be recreated in later sessions instead of reusing the canonical existing row.
- **08:58** The `create_tasks` agent card had regressed into an over-simplified contract that lost Greek-scholastic rigor, bounded project-context evidence rules, and the canonical plural Draft markdown template.
- **11:36** Draft editing still leaked operator-hostile details: task-type selectors exposed raw ids, priority reasons were hidden, and the form spread task semantics across too many separate fields instead of one Markdown surface plus explicit Q/A chunks.

### FEATURE IMPLEMENTED
- **22:47** Extracted shared composite session-state and comment-side-effect services for `CREATE_TASKS`, then reused them from both the manual route and the background chunk worker so session summary/review/title/project patches, Ready+/Codex enrichment, processor success markers, and summary refresh hints land consistently.
- **22:47** `incremental_refresh` now preserves unmatched draft candidates as `source_data.refresh_state='stale'` compatibility rows instead of deleting them immediately, while `full_recompute` remains the explicit destructive path.
- **22:47** Added an incident-grade voice session forensics CLI plus a checked-in operator playbook; investigations now produce reproducible bundles with queue snapshots, PM2 log hits, and per-session JSON/Markdown summaries.
- **22:47** Tightened the canonical Draft markdown contract so `## description` is always the first meaningful section and non-section prefaces are ignored by parsers/builders.
- **00:58** Added a worker-driven inactive-session close path with a default `10`-minute inactivity threshold, canonical `DONE_MULTIPROMPT` close orchestration, and automatic `generate_session_title` execution when a session is still unnamed at close time.
- **02:27** Activity dots in Voice tabs are now runtime-aware: closed/inactive/finalized sessions suppress stale green indicators, while active sessions still show pending processing.
- **01:53** Voice Codex details modal now fetches full `codex/issue` payloads on open, so comments and related metadata match the standalone OperOps Codex page.
- **02:42** Hardened the OperOps `TaskPage` render contract by making discussion-session memoization hook-safe across loading, not-found, and loaded renders.
- **05:32** Promoted the active `create_tasks` runtime to `gpt-5.4`, tightened bounded CRM/evidence reads, and preserved a strict reduced-context recovery path so `Tasks` recompute can complete on production sessions again.
- **05:49** Hardened Jira-style reporting with a proxy-safe Google Sheets client and bounded retry/backoff around metadata loads, so the report flow now completes through the canonical Sheets surface instead of failing after sheet creation.
- **08:35** Added top-level `Саммари` and `Ревью` tabs, removed the old bottom Summary editor from `Категоризация`, and converted Voice Drafts into a dominant master-detail workspace with immediate materialization controls.
- **08:35** Added strict project-scoped semantic Draft reuse so cross-session reruns relink to the canonical existing Draft row instead of inserting a shortened paraphrase with a fresh locator.
- **08:58** Restored a decision-complete composite `create_tasks` contract: bounded `summary_md_text`, exact Greek-scholastic review rules, project entrypoint shell reads, file-backed `evidence_links`, and immediate Ready+/Codex comment enrichment.
- **11:36** Simplified the Draft editor to one Markdown task surface plus a plain `Question:` / `Answer:` chunk, made task types human-readable, exposed priority reasons on hover, and reduced Save/Clone/Delete to icon-only task controls.

### CHANGES
- **22:47** Added `backend/src/services/voicebot/{createTasksCompositeSessionState,createTasksCompositeCommentSideEffects}.ts`, rewired `backend/src/api/routes/voicebot/sessions.ts` and `backend/src/workers/voicebot/handlers/createTasksFromChunks.ts`, and expanded focused route/worker tests so manual/background `CREATE_TASKS` now share session patching, comment enrichment, and processor-completion behavior.
- **22:47** Updated `backend/src/services/voicebot/persistPossibleTasks.ts` and focused persistence tests so `incremental_refresh` marks missing draft rows stale instead of soft-deleting them, while live draft reads still exclude stale compatibility rows.
- **22:47** Updated `backend/src/services/voicebot/createTasksAgent.ts`, `app/src/utils/voicePossibleTasks.ts`, `app/__tests__/voice/voicePossibleTasksParser.test.ts`, `agents/agent-cards/create_tasks.md`, and `plan/voice-dual-stream-ontology.md` to enforce the `## description`-first markdown contract for Draft enrichment surfaces.
- **22:47** Added `backend/scripts/voicebot-session-forensics.ts`, npm script `voice:session:forensics`, the English operator guide `docs/VOICE_SESSION_FORENSICS_PLAYBOOK.md`, and reference investigation bundles under `tmp/voice-investigation-artifacts/20260323T153446Z-69c13e953126bf876842c7ac*`.
- **00:58** Added `backend/src/services/voicebot/{voicebotInactiveSessionService,voicebotSessionTitleService}.ts`, `backend/src/workers/voicebot/handlers/shared/closeInactiveSessions.ts`, and worker-manifest/runner wiring for `VOICEBOT_JOBS.common.CLOSE_INACTIVE_SESSIONS`; refreshed `backend/scripts/voicebot-close-inactive-sessions.ts` to delegate through the shared service and prefer `--inactive-minutes` while keeping `--inactive-hours` as an operational override.
- **00:58** Added focused regression coverage in `backend/__tests__/services/voicebotInactiveSessionService.test.ts`, `backend/__tests__/scripts/voicebotCloseInactiveSessionsContract.test.ts`, `backend/__tests__/voicebot/session/sessionDoneFlowService.test.ts`, `backend/__tests__/voicebot/workers/queueLockNamingContract.test.ts`, and `backend/__tests__/entrypoints/orphanedEntrypointsContract.test.ts`.
- **01:53** Updated `app/src/components/codex/CodexIssuesTable.tsx` and new contract `app/__tests__/codex/codexIssuesTableModalDetailsContract.test.ts` so Voice Codex modal details load the canonical single-issue payload before rendering `CodexIssueDetailsCard`.
- **02:27** Updated `app/src/utils/voiceSessionTabs.ts`, `app/src/pages/voice/SessionPage.tsx`, and `app/__tests__/voice/voiceSessionTabs.test.ts` so pending indicators are gated by live runtime activity instead of stale historical payload shape.
- **02:42** Updated `app/src/pages/operops/TaskPage.tsx` to keep `discussionSessions` memoization above early returns, preserving hook order and preventing the blank-page crash on `/operops/task/:taskId`.
- **05:32** Updated `agents/fastagent.config.yaml`, `backend/src/services/voicebot/{createTasksAgent,agentsRuntimeRecovery}.ts`, `backend/__tests__/services/voicebot/{createTasksAgentRecovery,agentsRuntimeRecovery}.test.ts`, and `backend/__tests__/voicebot/runtime/generatePossibleTasksRoute.test.ts` so the composite analyzer runs on `gpt-5.4`, keeps the project CRM window bounded (`30d` server cap / `14d` analyzer horizon), and retries wrapped `context_length_exceeded` failures through the reduced-text path.
- **05:49** Updated `backend/src/services/reports/googleDrive.ts` with proxy-neutral `GoogleSpreadsheet` initialization plus retry/backoff for `429/502/503/504` and network drift, then verified `POST /api/crm/reports/jira-style` end-to-end against production Google Sheets.
- **08:35** Updated `app/src/{App.tsx,components/voice/Categorization.tsx,pages/voice/SessionPage.tsx,store/{sessionsUIStore,voiceBotStore}.ts,types/voice.ts}`, removed `app/src/components/voice/CategorizationTableSummary.tsx`, and refreshed the Voice tab/categorization tests so `Саммари` is a first-class top tab, `summary_md_text` is persisted through the composite analyzer, and the bottom Summary block no longer renders in `Категоризация`.
- **08:35** Reworked `app/src/components/voice/PossibleTasks.tsx`, `app/src/utils/voicePossibleTasks.ts`, `backend/src/services/voicebot/persistPossibleTasks.ts`, and new tests `app/__tests__/voice/possibleTasksTaskTypeOptions.test.ts` plus `backend/__tests__/services/voicebot/persistPossibleTasks.test.ts` so Drafts render as a simplified master-detail workspace, semantic duplicates are reused across sessions by project scope, and task-type labels stay human-readable.
- **08:58** Rewrote `agents/agent-cards/create_tasks.md`, aligned `agents/README.md`, `docs/VOICEBOT_API.md`, `plan/voice-dual-stream-ontology.md`, and `README.md`, deleted legacy cards `agents/agent-cards/{CompanyCreator,generate_session_title,generate_session_title_send}.md`, and removed the obsolete title-card prompt test so the composite analyzer is the only active task/session naming contract.
- **11:36** Tightened Draft markdown/runtime rules across `backend/src/services/voicebot/createTasksAgent.ts`, `backend/src/api/routes/voicebot/sessions.ts`, `app/src/components/voice/PossibleTasks.tsx`, `app/src/utils/voicePossibleTasks.ts`, and the focused Voice tests so the canonical headings are plural (`description/object_locators/expected_results/acceptance_criteria/evidence_links/executor_routing_hints/open_questions`), the form keeps only `name/priority/project/task_type/performer` as separate fields, and unresolved items travel as plain `Question:` / `Answer:` chunks in the Markdown surface.

## 2026-03-22
### PROBLEM SOLVED
- **15:00** Voice session pages could fail to open after session-list sorting when the selected project resolved to zero active performer rows; backend `project_performers` enrichment built an empty Mongo logical selector and returned `500`.
- **22:11** Voice/OperOps task linkage still mixed source URLs, self URLs, and `bd` sync keys, so accepted task reuse and Codex issue sync could duplicate logical work or collide on `bd` uniqueness.
- **16:42** Factory execution guidance was still implicit and mostly oral, so autonomous runs lacked one concise harness article that tied repo-level execution surfaces to the dual-stream ontology.

### FEATURE IMPLEMENTED
- **15:00** Added a safe empty-result path for `project_performers`, so zero resolved performer rows now return `200` with an empty list instead of crashing the session page.
- **22:11** Normalized task reference semantics across Voice -> OperOps -> `bd`: Mongo `_id` remains the internal identity, `external_ref` is the canonical source ref, `source_ref` is the canonical OperOps self URL, `bd_external_ref` is a separate sync key, and accepted task reuse preserves original creation identity.
- **16:42** Added the Factory harness article and Russian translation so autonomous execution has one explicit repo-local guide aligned with the platform’s voice/taskflow contracts.

### CHANGES
- **15:00** Updated backend `project_performers` enrichment guards and related deploy/runtime checks so empty performer selectors short-circuit before Mongo builds empty logical arrays.
- **22:11** Updated backend task materialization/sync surfaces to preserve lineage-based accepted-row reuse, keep `created_at` stable on updates, avoid blanket deletion of unrelated `codex_task` rows, and separate `bd_external_ref` from human-readable source URLs; updated frontend source-link matching and task-page utilities to prefer canonical `external_ref` source linkage.
- **16:42** Added `factory/harness.md` plus its Russian companion article, and aligned repo documentation with the executable harness workflow.

## 2026-03-21
### PROBLEM SOLVED
- **09:10** The ontology/spec wave still left one critical implementation gap: task/execution surfaces were described as if direct LLM writes to TypeDB were desirable, but canonical `task.status` and `task.priority` were not yet constrained on the DB side, so invalid raw labels could still leak into the write path.
- **09:10** The executor-layer rollout remained only partially formalized: `coding_agent` existed, but `task_family`, `executor_role`, `executor_routing`, and `task_execution_run` were not all present as exact ontology objects/relations, which left the next implementation wave underspecified.
- **09:10** Residual ambiguous-session rerun accounting was incomplete: batches `2` and `3` had only noisy MCP logs instead of structured outcomes, so the remaining migration tail could not be summarized deterministically.
- **21:25** `create_tasks` context-overflow work still lacked exact inner MCP payload profiling, so operator decisions about model choice or prompt trimming were still guesswork instead of evidence-based engineering.
- **21:25** Draft queue policy and historical digitization had drifted together: `DRAFT_10` visibility, session-local historical drilldown, and background recount were all using one implicit notion of “age”, which risked both ontology mistakes and wrong operational behavior.
- **21:25** Temporary voice investigation artifacts (batch reports, parity evidence plan) were still living under `plan/`, mixing short-lived operational evidence with actual long-lived planning documents.
- **22:00** The dual-stream ontology note still mixed launch approval semantics with final acceptance semantics and left executor-ready context boundaries underspecified, which could cause incorrect lifecycle modeling in follow-up implementations.

### FEATURE IMPLEMENTED
- **09:10** Added DB-side owner-level `@values(...)` constraints for `task.status`, `task.priority`, and the key TO-BE execution/process/product status carriers, making direct TypeDB writes materially safer.
- **09:10** Normalized Mongo task labels directly into canonical lifecycle keys and canonical `P1..P7` priorities before writing into TypeDB.
- **09:10** Landed the first executor-layer ontology surface end-to-end: `task_family`, `executor_role`, `executor_routing`, and `task_execution_run` now exist in the TypeDB semantic core and in the checked-in production specs.
- **09:10** Closed residual rerun accounting for ambiguous CREATE_TASKS batches: batch `1` and `4` remain manual-review buckets, while batches `2` and `3` are now classified as deterministic `timed_out` MCP buckets with structured reports.
- **21:25** Landed a live profiling substrate for `create_tasks`: backend now emits outer run/result size metrics, the repo-local fast-agent bootstrap emits per-tool inner MCP payload sizes and per-turn token landmarks, and a dedicated `gpt-5.4` runtime can be used for isolated investigation without disturbing the main `codexspark` runtime.
- **21:25** Implemented caller-provided Draft horizon policy (`draft_horizon_days` / `include_older_drafts`) across session/task surfaces, while preserving full canonical `DRAFT_10` baseline when the parameter is omitted.
- **21:25** Added a resumable historical Draft digitization runner plus a human-readable registry; historical backfill was resumed from checkpoint and then exhausted under the current contract.
- **21:25** Moved temporary voice investigation artifacts out of `plan/` into `tmp/voice-investigation-artifacts/` and linked the canonical profiling notebook to the active registries and `bd` issue.
- **22:00** Rewrote the dual-stream “target mechanics” section with explicit ontology-normalized terms (`task[DRAFT_10]`, `context_enrichment`, launch authorization vs acceptance, `executor_routing`, `task_execution_run`, `artifact_record`, `acceptance_evaluation`) and fixed minimal execution-context composition.

### CHANGES
- **09:10** Updated `ontology/typedb/schema/fragments/{10-as-is/10-entities-core,20-to-be/10-semantic-core}.tql`, `ontology/typedb/scripts/typedb-ontology-ingest.py`, and focused ontology tests so canonical `task` status/priority are normalized and constrained at the DB layer.
- **09:10** Extended the ontology kernel ids/attrs plus semantic-core relations for executor-layer objects (`task_family`, `executor_role`, `executor_routing`, `task_execution_run`) and aligned `plan/voice-dual-stream-ontology.md` plus `/home/strato-space/y-tasks-sandbox/OperOps/OperOps - Voice2Task.md` to the same exact labels.
- **09:10** Normalized Mongo priority noise in `automation_tasks` by rewriting legacy `🔥 P1` variants to canonical `P1`, then re-ran ontology verification (`build`, `test`, `contract-check`) successfully.
- **09:10** Updated `backend/scripts/rerun-ambiguous-create-tasks-batch.ts` with timeout-aware reporting and wrote structured results to `plan/ambiguous_batch_{2,3}_report.json`; final accounting is `batch1 manual_review=14`, `batch2 timed_out=14`, `batch3 timed_out=14`, `batch4 manual_review=12`.
- **21:25** Added `agents/run_fast_agent.py`, updated `agents/ecosystem.config.cjs`, and refreshed `agents/README.md`; the bootstrap now registers `gpt-5.4` as a large-window Codex model (`950000` configured context window), installs profiling hooks, and is the canonical PM2 entrypoint for repo-local agent runtime customizations.
- **21:25** Updated `backend/src/services/{mcp/proxyClient,voicebot/createTasksAgent}.ts` and `agents/run_fast_agent.py` so `create_tasks` runs emit `profile_run_id`, envelope byte counts, outer MCP result size, inner MCP tool payload size, and per-turn `input_tokens/output_tokens` with `configured_context_window`.
- **21:25** Added `backend/src/services/draftRecencyPolicy.ts`, `backend/scripts/{recount-draft-sessions-oldest-first,render-draft-recount-registry}.ts`, and focused tests `backend/__tests__/services/draftRecencyPolicy.test.ts` plus new `session_tasks(draft)` route coverage for horizon/override semantics.
- **21:25** Updated `backend/src/api/routes/{voicebot/sessions,crm/voicebot,crm/tickets}.ts` so Draft visibility can be caller-bounded by linked discussion recency, while session-local reads evaluate the current session against the task’s linked discussion window in both directions and Ready+ stays full-history.
- **21:25** Updated root `AGENTS.md`, root `README.md`, `docs/{VOICEBOT_API,VOICEBOT_API_TESTS,CREATE_TASKS_CONTEXT_OVERFLOW_PROFILING_2026-03-21}.md`, `plan/voice-dual-stream-ontology.md`, `/home/strato-space/y-tasks-sandbox/OperOps/OperOps - Voice2Task.md`, `/home/strato-space/prompt/{README.md,AGENTS.md,StratoProject/PM-04-DialogTaskSummary.md}`, and `agents/agent-cards/create_tasks.md` to document the new Draft-horizon contract, profiling workflow, bounded project CRM enrichment guidance, and active investigation registries.
- **21:25** Moved `plan/{69a527c14b07162c36957e21-voice-session-done-rest-parity-plan.md,ambiguous_batch_*.txt,ambiguous_batch_*_report.json}` into `tmp/voice-investigation-artifacts/` and rewired live repo references accordingly.
- **22:00** Updated `plan/voice-dual-stream-ontology.md` (“Целевая механика” normalization block) and synced root `AGENTS.md` + root `README.md` so repo-level instructions now explicitly preserve the launch/acceptance split and executor-ready context contract.

## 2026-03-19
### PROBLEM SOLVED
- **22:02** Routine host cleanup still had no checked-in repo guardrail for `/root/.codex/sessions`, so session history could be removed accidentally during disk-pressure maintenance.
- **22:02** The active Voice task-surface specs still left room to misread `session_tasks(bucket="tasks")` as compatible with draft fallback semantics, even though `DRAFT_10` leakage there is a backend/client bug rather than accepted behavior.
- **22:02** The checked-in Fast-Agent config no longer matched the current account-aware auth/model mapping, so a fresh runtime sync could fall back to `codexplan` even when the active auth account requires `codexspark`.

### FEATURE IMPLEMENTED
- **22:02** Added a repo-level host-maintenance guardrail that preserves `/root/.codex/sessions` unless a task explicitly requests purging that path.
- **22:02** Promoted the accepted-only session-task bucket semantics into the checked-in Voice task-surface specs, including explicit classification of `copilot-f6z4` as a contract violation.
- **22:02** Realigned the checked-in Fast-Agent default model to `codexspark` for the current auth-account mapping.

### CHANGES
- **22:02** Updated `AGENTS.md` and `README.md` so the repo instructions now record the `/root/.codex/sessions` cleanup guardrail and the accepted-only `POST /api/voicebot/session_tasks` `{ session_id, bucket: 'tasks' }` contract.
- **22:02** Updated `plan/closed/voice-task-surface-normalization-spec.md` and `plan/2026-03-21-voice-task-surface-normalization-spec-2.md` to define `voice.session_tasks(session_id, bucket="tasks")` as an accepted-only bucket and mark any `DRAFT_10` rows there as bug `copilot-f6z4`.
- **22:02** Updated `agents/fastagent.config.yaml` so the checked-in runtime default model is `codexspark`, consistent with the repo’s documented account-aware auth/model sync rule.

## 2026-03-18
### PROBLEM SOLVED
- **09:38** Voice `create_tasks` recovery still treated invalid OpenAI auth (`401`, rejected key) as a hard failure, so task generation could stay broken until an operator manually refreshed the agents runtime.
- **10:09** Production deploys restarted the backend and miniapp services but could leave the TypeScript voicebot worker and Telegram bot on stale code, creating split-runtime behavior after backend releases.
- **15:56** The live Voice draft baseline still relied on `source_kind` and stale-row compatibility markers, so duplicate/stale draft rows could leak into session reads and status counts instead of exposing one canonical `DRAFT_10` view.
- **16:10** Voice-linked task discussion history was stored only implicitly, so operators could not see from the UI how many sessions had re-discussed a task or open the linked sessions from the OperOps task page.
- **16:19** CRM comments were under-normalized: ticket reads did not join `automation_comments`, add-comment writes accepted inconsistent identifiers, and session-aware discussion metadata could not be stored/replayed deterministically.
- **19:22** The ontology/spec layer still lacked a checked-in contract that separated draft-task recompute from non-draft discussion relink/comment analysis, leaving the repeated-discussion model implicit across runtime and planning artifacts.

### FEATURE IMPLEMENTED
- **09:38** Extended agents-runtime recovery so `create_tasks` retries now treat invalid-key / `401` auth failures as recoverable runtime drift, using the same auth refresh and retry path as quota-class failures.
- **10:09** Extended the documented production PM2 deploy helper so `./scripts/pm2-backend.sh prod` also restarts `copilot-voicebot-workers-prod` and `copilot-voicebot-tgbot-prod` when those runtimes exist.
- **15:56** Normalized the Voice draft read model onto session-linked `DRAFT_10` tasks: draft rows are deduped by row lineage, missing rows leave the live baseline instead of lingering as operational `stale` entries, and accepted/session-count reads ignore stale compatibility rows.
- **16:10** Added `discussion_sessions[]` / `discussion_count` as first-class Voice-task payload fields and surfaced them in both Voice `Possible Tasks` and the OperOps task detail page.
- **16:19** Normalized CRM ticket comment reads/writes so task pages can load comments directly from Mongo aggregation and session-driven discussion notes can be written with canonical task ids plus discussion metadata.
- **19:22** Added a checked-in planning pack for the next Voice discussion wave: dual-stream ontology, draft-vs-non-draft discussion routing, and task-surface normalization follow-up specs.

### CHANGES
- **09:38** Updated `backend/src/services/voicebot/{agentsRuntimeRecovery,createTasksAgent}.ts` and focused recovery tests so `Invalid OpenAI API key`, rejected-key, and `401 unauthorized` failures enter the existing auth/runtime recovery flow before one retry.
- **10:09** Updated `scripts/pm2-backend.sh` so production deploys restart backend + miniapp as before, then also restart `copilot-voicebot-workers-prod` and `copilot-voicebot-tgbot-prod` through `scripts/pm2-voicebot-cutover.ecosystem.config.js` when present.
- **15:56** Updated `backend/src/api/routes/voicebot/{possibleTasksMasterModel,sessions}.ts`, `backend/src/services/voicebot/persistPossibleTasks.ts`, `backend/src/api/routes/crm/voicebot.ts`, and Voice runtime tests so draft reads come from session-linked `DRAFT_10` task docs, row duplicates collapse onto one visible entry, `discussion_sessions[]` is normalized, and stale compatibility rows are excluded from accepted/session-count reads.
- **16:10** Updated `app/src/{components/voice/PossibleTasks.tsx,pages/operops/TaskPage.tsx,store/kanbanStore.ts,types/{crm,voice}.ts,utils/voicePossibleTasks.ts}` so Voice tasks expose discussion counts, OperOps task detail shows a `Discussed in Sessions` timeline, and frontend comment writes use the normalized backend payload.
- **16:19** Updated `backend/src/api/routes/crm/tickets.ts` plus new contract tests `app/__tests__/operops/taskCommentsPayloadContract.test.ts` and `backend/__tests__/api/crmTicketCommentsContract.test.ts`; ticket reads now join `comments_list`, add-comment resolves `ticket_id/ticket_db_id/ticket_public_id`, and comment writes support `comment_kind`, `source_session_id`, `discussion_session_id`, and `dialogue_reference`.
- **19:22** Added `plan/{voice-dual-stream-ontology,voice-non-draft-discussion-analyzer-contract,voice-task-session-discussion-linking-spec,voice-task-surface-normalization-spec-2}.md` and accepted `methodology/index.md` as the current local methodology scratchpad for ongoing delivery/process notes.

## 2026-03-17
### PROBLEM SOLVED
- **11:50** The Voice session-page `Tasks` button still bypassed backend quota recovery because it called MCP `create_tasks` directly from the browser; when the active agents runtime stayed pinned to a quota-exhausted Codex account, operators could keep hitting `usage_limit_reached` without triggering the auth/model switch logic that already existed server-side.
- **12:13** Backend `create_tasks` quota recovery could restart `copilot-agent-services`, but the immediate retry path could still fail with `ECONNREFUSED` while local MCP startup was still in progress.
- **22:01** OpenAI runtime credential routing was operationally fragmented across PM2 process env, `backend/.env.production`, and agents Codex OAuth state, so incident response could not rely on one canonical audit snapshot.

### FEATURE IMPLEMENTED
- **11:50** Routed the session-page `Tasks` button through a backend generation path so live task refresh now inherits the same `runCreateTasksAgent(...)` quota recovery, auth sync, and model fallback rules as the server-side `create_tasks` flow.
- **12:13** Added readiness-gated quota recovery: backend retries now wait for local agents MCP endpoint availability after restart before continuing the `create_tasks` retry branch.
- **22:01** Added a single runtime-state memo plus repo-level guardrail links so operators can verify OpenAI key source drift and agents account/model mode in one place.

### CHANGES
- **11:50** Added `POST /api/voicebot/generate_possible_tasks` in `backend/src/api/routes/voicebot/sessions.ts`; the route resolves session access, calls `runCreateTasksAgent({ sessionId, projectId })`, persists canonical draft rows through `persistPossibleTasksForSession(..., refreshMode='full_recompute')`, and emits the existing `session_update.taskflow_refresh` hint.
- **11:50** Updated `app/src/store/voiceBotStore.ts` so `createPossibleTasksForSession` now calls the backend route and consumes canonical `items` from the response instead of performing browser-side MCP `create_tasks` execution and payload parsing.
- **11:50** Added `backend/__tests__/voicebot/runtime/generatePossibleTasksRoute.test.ts`, refreshed `backend/__tests__/voicebot/runtime/sessionUtilityRoutes.test.ts`, and updated `app/__tests__/voice/{possibleTasksSaveCanonicalItemsContract,meetingCardTasksButtonContract}.test.ts`; validation passed with targeted Jest plus `cd backend && npm run build` and `cd app && npm run build`.
- **12:13** Updated `backend/src/services/voicebot/agentsRuntimeRecovery.ts` with post-restart MCP readiness polling, refreshed `backend/__tests__/services/voicebot/agentsRuntimeRecovery.test.ts`, and aligned runtime model state in `agents/fastagent.config.yaml` after account switch to `codexplan`.
- **22:01** Added `docs/COPILOT_OPENAI_API_KEY_RUNTIME_STATE_2026-03-17.md` with current runtime masks, registry alias mapping, and reproducible verification commands for PM2/env/auth state.
- **22:01** Updated `AGENTS.md` and `README.md` to reference the runtime-state memo and register `agents/agent-cards/CompanyCreator.md` as the reserved company-creation card scaffold.

## 2026-03-16
### PROBLEM SOLVED
- **10:57** Voice session `Задачи` could still hide real Mongo rows when their current `task_status` fell outside the approved target axis, so a session could show `Задачи 0` or an empty lifecycle strip even though task rows physically existed.
- **10:57** The page could briefly flash a misleading `Задачи 0` badge before `session_tab_counts` returned the authoritative count.
- **10:57** Live Mongo still contained current legacy task-status values from the spec elimination table (`Backlog`, `Plan / Approval`, `Plan / Performer`, etc.), plus `Ready` rows with no performer and `null`/missing `task_status` rows.
- **10:57** Agent auth recovery still treated `agents/.codex/auth.json` sync and `fastagent.config.yaml` model selection as unrelated steps, even though `codexspark` is valid only for one specific account.
- **22:02** Possible-task refresh telemetry could not be correlated end-to-end from the UI click to backend websocket hint delivery, so operators had no deterministic latency trace for `save_possible_tasks` refresh runs.

### FEATURE IMPLEMENTED
- **10:57** Added a temporary `Unknown` task bucket so session-scoped Mongo rows never disappear from `Задачи`; the `Unknown` subtab is shown only when its count is non-zero.
- **10:57** Hid the top-level `Задачи` count until live `session_tab_counts` resolves, removing the false `0` flash on initial render.
- **10:57** Normalized the current Mongo `task_status` field onto the target lifecycle axis without rewriting any status history: legacy status values were migrated, `Ready` rows without performers were returned to `Draft`, and `null`/missing current statuses were normalized to `Draft`.
- **10:57** Extended agent recovery so auth sync also enforces account-aware model fallback: the spark-enabled account gets `codexspark`, all other accounts get `codexplan`.
- **22:02** Added correlation-aware possible-task refresh signaling: frontend now passes optional `refresh_correlation_id` / `refresh_clicked_at_ms`, and backend logs plus `session_update.taskflow_refresh` echo these fields for traceable latency diagnostics.

### CHANGES
- **10:57** Updated `backend/src/api/routes/voicebot/sessions.ts`, `app/src/pages/voice/SessionPage.tsx`, and `app/src/components/crm/CRMKanban.tsx` so session counts emit `UNKNOWN`, `Unknown` renders only when present, session-scoped rows stay visible, and the top-level `Задачи` badge waits for real counts.
- **10:57** Updated focused frontend/backend contracts in `app/__tests__/voice/{operopsTasksSourceFilterContract,sessionPageOperOpsTasksTabContract,sessionPageTabCountersContract}.test.ts`, `app/__tests__/operops/taskStatusSurface.test.ts`, `backend/__tests__/services/taskStatusSurface.test.ts`, and `backend/__tests__/voicebot/session/sessionTabCountsRoute.test.ts`; validated with targeted Jest plus `cd app && npm run build` / `cd backend && npm run build`.
- **10:57** Removed checked-in legacy task-status cleanup tooling from `backend/scripts/{voicebot-migrate-task-statuses,task-surface-normalize,voicebot-repair-softdeleted-materialized-tasks}.ts` and their helper/test files after the live cleanup wave completed.
- **10:57** Applied live Mongo cleanup to the current `task_status` field only: migrated residual legacy labels onto the target axis, moved `91` `Ready` rows without performers back to `Draft`, and moved `4` `null`/missing current statuses to `Draft`.
- **10:57** Updated `backend/src/services/voicebot/agentsRuntimeRecovery.ts` and focused recovery tests so `/root/.codex/auth.json -> agents/.codex/auth.json` sync also rewrites `agents/fastagent.config.yaml` based on `tokens.account_id`, forcing `codexspark` for account `d72d46e8-41f3-47c1-ba22-98c52b3f6448` and `codexplan` for all others.
- **22:02** Updated `app/src/store/voiceBotStore.ts` to thread optional refresh telemetry (`refresh_correlation_id`, `refresh_clicked_at_ms`) through `createPossibleTasksForSession -> saveSessionPossibleTasks`; updated `backend/src/api/routes/voicebot/sessions.ts` Zod contracts, persistence logs, and `emitSessionTaskflowRefreshHint` payload/logging to include correlation and click timing fields.

## 2026-03-15
### PROBLEM SOLVED
- **14:12** The ontology operator surface still exposed only the raw incremental alias and a monolithic full apply path, so there was no checked-in staged `core/enrichment` sync contract and no canonical full-from-scratch runner for benchmark DBs with schema recreation.
- **13:59** Telegram close-session updates sent through `tgbot__send_bot_message` could still waste the first live attempt on preventable MarkdownV2 escaping mistakes, producing `Can't parse entities` style failures even when the content itself was correct.
- **13:17** `AGENTS.md` still mixed constitutional instructions with a running session journal, and secondary taskflow plan files under `plan/` still looked like live working plans even after they had become historical references.
- **13:17** Voice session header actions were visually inconsistent after `Tasks` and `Summarize` moved right: two actions rendered without the same bordered icon-button contract as the rest of the header cluster.
- **13:17** `/api/crm/codex/issue` still returned `502` on valid issues like `copilot-x0xn` when `bd show` detected out-of-sync JSONL and `bd sync --import-only` failed with `bufio.Scanner: token too long`, even though direct JSONL fallback was already the correct recovery path.
- **13:03** The new supervised ontology rollout still treated cleanup and historical backfill as if they were one species of ingest, which was a category mistake: operators could measure the wrong thing, and `automation_voice_bot_sessions` cleanup kept paying for high-cost derived session projections that were not required by the `copilot-8wn1` hygiene objective.
- **11:44** Backend `create_tasks` could still fail indefinitely on quota-class MCP errors, because recovery remained a manual operator procedure: even when fresh Codex auth was already available on disk, the backend would not self-heal, and repeated retries risked pointless agent restarts.
- **11:44** Historical web-upload voice sessions with missing local `webm` files still blocked the last unnamed-session cleanup wave, because recovery surfaces on old Voice hosts were unknown and the batch state of zero-transcription file sessions had not been audited.
- **11:44** Ontology replay supervision still relied on stale detached-launcher archaeology instead of one canonical rollout surface, so operators could not distinguish current deadletters from old noise or safely restart a clean run.
- **10:21** Codex tab issue IDs in OperOps and Voice still lacked the standard copy affordance used on other Codex surfaces, and the first UI attempt could break inline formatting by pushing the copy icon below the issue token.
- **10:38** `/api/crm/codex/issues` could still fail with `502` for valid beads data when `bd list` reported `Database out of sync with JSONL` and the backend recovery path `bd sync --import-only` failed with `bufio.Scanner: token too long`, leaving the UI with the generic `Не удалось загрузить Codex issues` error.
- **02:16** The strict task-surface runtime was already clean, but the final draft-read deprecation wave was still incomplete: `/home/tools/voice` continued to expose `session_possible_tasks`, Copilot backend still served `POST /api/voicebot/possible_tasks`, and active prompts/docs still mixed the old draft-read name with the new unified surface.
- **02:16** Voice session taskflow still depended on a split naming model across repos, so even after the status-first rollout landed, assistant instructions, MCP docs, and actions examples could still reintroduce the removed draft alias as if it were the preferred path.

### FEATURE IMPLEMENTED
- **14:12** Added staged ontology sync entrypoints and the first `voice_message` projection-scope split: operators now have explicit `sync:core`, `sync:enrich`, and `full:from-scratch` commands, Mongo startup indexes cover watermark scans for the incremental safe-scope roots, and the ingest engine supports `projection_scope`, deferred sync-state writes, and empty-DB append-only loads.
- **13:59** Added a documented Telegram MarkdownV2 send discipline: executive updates must now be materialized and inspected as fully escaped payloads before the live `tgbot__send_bot_message` call.
- **13:17** Cleaned the doc surface so `AGENTS.md` is again a normative instruction document, archived stale taskflow plan docs under `plan/archive/`, and kept only the current task-surface specs as active sources of truth.
- **13:17** Unified the right-side Voice session header actions visually: `Tasks` and `Summarize` now use the same bordered icon-button styling as the other header actions and remain positioned before the custom prompt action.
- **13:17** Extended the single-issue Codex backend route with the same JSONL fallback resilience as the list route and verified `copilot-x0xn` live after redeploy.
- **13:03** Normalized the ontology rollout contract: `cleanup_apply` is now documented and executed as a core hygiene pass, `historical_backfill` remains the enrichment pass, and focused cleanup now skips session-derived projections that belong to backfill rather than to the current validation target.
- **11:44** Added backend-side quota self-heal for `create_tasks`: on quota-class MCP failures the backend now compares `/root/.codex/auth.json` with `agents/.codex/auth.json`, copies only when contents differ, restarts `copilot-agent-services` once, recreates the MCP session, and retries the tool call once.
- **11:44** Finished the unnamed-session cleanup wave end-to-end: recovered missing historical `webm` files from `p2` old Voice storage, replayed transcription/categorization for the affected sessions, reused the same quota-recovery guard in the session-title utility, and reduced unnamed active voice sessions in Mongo to `0`.
- **11:44** Landed canonical ontology rollout supervision: backend operator surface now exposes `ontology:typedb:rollout:{start,stop,clear-logs,status}`, writes run-scoped cleanup/backfill logs and deadletters, and enforces a single active supervised rollout instead of ad hoc detached shells.
- **10:21** Added the shared copy affordance to Codex tab issue IDs in `CodexIssuesTable` for both OperOps and Voice while preserving drawer-open and external-link behaviors, then tightened the inline layout so the issue token, copy icon, and link icon stay on one line after live Chrome verification.
- **10:38** Hardened Codex issue loading so the backend now falls back to direct `.beads/issues.jsonl` parsing when the out-of-sync `bd list` path cannot recover via `bd sync --import-only`, eliminating the observed transient `502` class for this failure mode.
- **02:29** Landed the unified replacement read surface in `/home/tools/voice`: `session_task_counts(session_id)` plus `session_tasks(session_id, bucket, status_keys=None)` now cover draft, accepted lifecycle, and codex reads, while the old draft-read method was reduced and then removed from active MCP/client surfaces.
- **03:00** Completed the deprecation wave end-to-end: Copilot backend now serves draft reads through `POST /api/voicebot/session_tasks`, the old `POST /api/voicebot/possible_tasks` route is removed, active prompts/docs prefer the unified replacement surface, and prod deploy plus live MCP verification confirmed that the Voice `Задачи` tab still renders correctly.

### CHANGES
- **14:12** Updated `backend/src/constants.ts`, `backend/package.json`, `ontology/typedb/scripts/{typedb-ontology-ingest,typedb-sync-chain,typedb-full-from-scratch}.sh`, `ontology/typedb/tests/test_ingest_modes.py`, and synced repo/ontology docs for the new staged sync operator contract; verified with Python unit tests, backend TypeScript build, staged sync dry-run smoke, and a `--limit 1` full-from-scratch scratch-DB smoke.
- **13:59** Updated `AGENTS.md`, `README.md`, and `CHANGELOG.md` to record the Telegram MarkdownV2 close-session rule and closed `copilot-t1tu`.
- **13:17** Updated `AGENTS.md`, `README.md`, `CHANGELOG.md`, `plan/voice-task-surface-normalization-spec.md`, and `plan/voice-operops-codex-taskflow-spec.md`; moved `plan/{live-possible-tasks-during-meeting-plan,mcp-voice-session-taskflow-plan}.md` into `plan/archive/*.legacy.md`, fixed stale status references, and closed `copilot-v9ba`, `copilot-1ssq`, `copilot-gwo0`, `copilot-ro0w`, and `copilot-eyr2`.
- **13:17** Updated `backend/src/api/routes/crm/codex.ts`, `backend/__tests__/api/crmCodexRouteRuntime.test.ts`, and `ontology/typedb/scripts/typedb-ontology-contract-check.py`; verified with focused runtime test and local/prod route checks, then reloaded the live `copilot-x0xn` page successfully.
- **13:17** Updated `app/src/components/voice/MeetingCard.tsx`, `app/__tests__/voice/{meetingCardTasksButtonContract,meetingCardSummarizeAndIconContract}.test.ts`; validated with focused Jest and `cd app && npm run build`, then pushed commit `d0753d7`.
- **13:03** Updated `ontology/typedb/scripts/typedb-ontology-ingest.py`, `ontology/typedb/scripts/typedb-rollout-chain.sh`, `ontology/typedb/tests/test_ingest_modes.py`, `ontology/typedb/{README.md,AGENTS.md,docs/rollout_plan_v1.md}`, repo docs `README.md` and `AGENTS.md`, and added `ontology/typedb/docs/ingest_performance_profile_2026-03-15.md`; verified cleanup+validate throughput on run `20260315T100242Z` (`automation_tasks=1639.2552 docs/s`, `automation_voice_bot_sessions=151.5289 docs/s`) before historical backfill continued.
- **11:44** Added `backend/src/services/voicebot/agentsRuntimeRecovery.ts`, updated `backend/src/services/voicebot/createTasksAgent.ts`, added focused tests `backend/__tests__/services/voicebot/{agentsRuntimeRecovery,createTasksAgentRecovery}.test.ts`, rebuilt backend, restarted `copilot-backend-{prod,local,dev}`, restarted `copilot-agent-services`, and updated `copilot-ub03` with the live mitigation state.
- **11:44** Updated `backend/scripts/voicebot-generate-session-titles.ts` to use the same compare-before-copy quota recovery path, recovered three missing `webm` files from `p2:/home/strato-space/voicebot/uploads/audio/sessions/*`, replayed direct worker transcription/categorization for the affected sessions, refreshed `output/copilot-7wbb-generated-session-titles.md`, and finished the naming wave for `copilot-7wbb`.
- **11:44** Added `ontology/typedb/scripts/{typedb-rollout-lib,typedb-rollout-chain,typedb-rollout-status}.sh`, updated `backend/package.json`, refined `ontology/typedb/scripts/typedb-ontology-ingest.py`, updated `ontology/typedb/mappings/mongodb_to_typedb_v1.yaml`, created/advanced beads issues `copilot-peg8*`, `copilot-4380`, and `copilot-qtk0`, and verified fresh contract-checks plus run-scoped deadletter behavior on the new rollout surface.
- **10:21** Updated `app/src/components/codex/CodexIssuesTable.tsx` and `app/__tests__/operops/codexIssuesTableContract.test.ts`; verified with Chrome MCP on live `OperOps -> Codex`, `cd app && npm run build`, and `cd app && npx jest __tests__/operops/codexIssuesTableContract.test.ts __tests__/operops/crmPageCodexTabContract.test.ts __tests__/voice/sessionPageCodexTabContract.test.ts --runInBand`.
- **10:38** Updated `backend/src/api/routes/crm/codex.ts` and `backend/__tests__/api/crmCodexRouteRuntime.test.ts` so `out-of-sync + failed import-only sync` now reuses the direct JSONL fallback; verified with `cd backend && NODE_OPTIONS='--experimental-vm-modules' npx jest --runInBand __tests__/api/crmCodexRouteRuntime.test.ts` and `cd backend && npm run build`.
- **10:38** Closed beads issues `copilot-kvdp` and `copilot-shdv` after verification, and closed `copilot-tpra` as not planned for implementation.
- **02:29** Updated `/home/tools/voice/src/lib/core.py`, `/home/tools/voice/src/mcp_voicebot/server.py`, and `/home/tools/voice/src/actions/main.py` to add `session_task_counts` / `session_tasks`, move draft reads onto `session_tasks(bucket="draft")`, and remove the deprecated `session_possible_tasks` MCP/action/client surface after replacement coverage was in place.
- **02:29** Updated `/home/tools/voice/{AGENTS.md,README.md}` plus `/home/tools/voice/tests/unit/{api,mcp,actions}/*` so the unified read surface is the preferred contract and focused venv tests continue to pass.
- **03:00** Updated `backend/src/api/routes/voicebot/sessions.ts`, `app/src/store/voiceBotStore.ts`, focused backend/app regression suites, `docs/VOICEBOT_API*.md`, `agents/README.md`, `agents/agent-cards/create_tasks.md`, and `plan/{voice-task-surface-normalization-spec.md,voice-session-possible-tasks-deprecation-plan.md}` to remove the deprecated backend alias, switch the frontend draft loader to `session_tasks`, mark the deprecation outcome as completed, and close `copilot-kdqs`, `.1`, `.2`, `.3`, and `.4` in beads.
- **03:13** Finalized the spec wording after the closure wave: clarified that the top ticket line in `plan/voice-task-surface-normalization-spec.md` is repo-global rather than scope-local, switched the top-level status framing from `in progress` to `implemented/verified`, and marked the deprecation plan as a completed reference.

## 2026-03-14
### PROBLEM SOLVED
- **02:04** The Voice/OperOps surface-normalization draft still read like a documentation overlay, so it mixed current runtime truth with next-wave target semantics and left key decisions (`mutable draft baseline`, `PERIODIC`, Voice tab replacement scope, Codex surface wording) underspecified.
- **02:04** Telegram knowledge seeding still resolved routing-project aliases through ad hoc topic parsing inside the seed script, which made checked-in routing coverage harder to reuse and left MediaGen legacy/active project-id parity under-tested.
- **10:34** The initial implementation/deploy wave still left the generic CRM status picker on the full legacy dictionary, left repo docs describing `BACKLOG_10`/possible-task-centric surfaces, and emitted noisy PM2 agent restart errors during rollout even though services came back online.
- **11:55** The Voice session `Summarize` button could fail with `500` when a session had no `project_id` and no active `PMO` project existed in Mongo, even though summarize notify can run without assigning a fallback project.
- **11:55** Voice and OperOps task UIs still leaked raw stored status labels (`Progress 10`, `Review / Ready`, `Backlog`) instead of the approved target labels (`Draft`, `Ready`, `In Progress`, `Review`, `Done`, `Archive`), and the `Загрузить аудио` control remained isolated in the lower status widget instead of the header action row.
- **21:48** Voice session pages still carried a separate top-level `Возможные задачи` tab on top of the new task counters contract, which duplicated the draft surface instead of treating `DRAFT_10` as just another status bucket inside unified `Задачи`.
- **21:48** Manual `Summarize` retries still kept the button disabled for three minutes even when the request failed immediately, creating avoidable operator dead time after backend or validation errors.
- **21:48** Repo-level docs (`README`, `AGENTS`, `VOICEBOT_API`, task-surface spec) still mixed the old separate `Возможные задачи` UI semantics with the new status-first target model, so implementation and documentation drifted again after the latest convergence edits.
- **23:13** The new `Задачи` subtab strip still undercounted drafts and could collapse into a zero-state mismatch: live `PossibleTasks` rows were visible in the `Draft` view while both the `Draft` badge and the parent `Задачи` badge could still show `0`.
- **23:13** OperOps still had duplicate lifecycle navigation in practice: counts lived in the tab contract, but the old top summary-widget row remained rendered alongside the tabs.
- **23:13** The task-surface spec and repo docs still lagged the latest beads state after the bug wave started, so `## 15. BD` / `## Status` and the current README/AGENTS/API notes did not mention the new bug-fix follow-ups.
- **23:44** The strict status-first contract still leaked through compatibility code paths: Voice Draft could still be hydrated from session payloads, `/voicebot/possible_tasks` could still fall back to session blobs, and `/api/crm/tickets` plus status counters were still rebucketing legacy states instead of filtering by exact canonical keys only.

### FEATURE IMPLEMENTED
- **02:04** Recast the Voice/OperOps surface-normalization document into an approved next-wave replacement contract with explicit `As Is` vs `To Be` sections, a mutable-baseline definition for `voice.session_possible_tasks`, an audited `PROGRESS_0 = Rejected` note, a full recurring-task inventory, and a deprecation path for the current draft route.
- **02:04** Added shared routing-project extraction for Telegram knowledge seeding and locked the routing/crosswalk contract with focused backend tests, including MediaGen legacy+active project coverage and StratoProject prompt expectations.
- **10:34** Landed the runtime wave for the new task surface model: accepted Voice tasks now materialize into `READY_10`, Voice session counters normalize legacy statuses into the target axis, OperOps main tabs are status-first, recurring tasks now travel through lifecycle work with recurring metadata, and CRM status pickers are constrained to the target editable subset.
- **10:34** Completed the rollout wave: production task-surface normalization was applied to live data, `dev/local/prod` PM2 runtimes were redeployed successfully, and the noisy `pm2-agents.sh` restart path was fixed and verified.
- **11:55** Removed the hard dependency on a default `PMO` project for manual summarize: the route now continues with `project_id=null`, returns a readable backend error payload only when something actually fails, and the frontend no longer collapses every summarize failure into a raw `AxiosError`.
- **11:55** Moved `Загрузить аудио` into the top voice header action toolbar and introduced a shared display-layer status mapping so Voice/OperOps surfaces render the approved labels without changing stored status values.
- **21:48** Unified the Voice session task surface under a single `Задачи` tab: backend `session_tab_counts` now includes `DRAFT_10`, the page renders `PossibleTasks` only inside the `Draft` status subtab, and the obsolete separate `Возможные задачи` top tab contract is gone.
- **21:48** Shortened manual `Summarize` debounce to 15 seconds and reset it immediately on failure, keeping only accidental double-click protection instead of a long post-error lockout.
- **21:48** Re-synchronized the repo docs around the implemented status-first contract: inline lifecycle counts on `Задачи`/OperOps filters, no separate target semantics for `Возможные задачи`, and `possible_tasks` routes explicitly framed as compatibility draft-baseline APIs.
- **23:13** Fixed the zero-state/count drift in Voice `Задачи`: the lifecycle filter axis is now always rendered, `Draft` count can fall back to the mutable draft baseline, and the parent `Задачи` count is computed as the sum of all lifecycle buckets including `Draft`.
- **23:13** Removed the duplicate OperOps lifecycle summary widgets and moved the lifecycle counters fully into the tab labels, matching the approved target contract.
- **23:13** Updated the spec and repo docs to the current beads picture, including the new open bug follow-ups and the revised convergence-wave status line.
- **23:21** Verified the exact production Voice session and OperOps pages through Chrome MCP, confirmed the lifecycle-axis/count fixes live, and closed the follow-up bugs plus `copilot-ojxy.4` in beads.
- **23:44** Switched the runtime to a strict no-fallback mode for task surfaces: canonical Draft reads are `DRAFT_10` only, session/OperOps counters and filters use exact canonical keys only, and session payloads are no longer valid Draft read sources.

### CHANGES
- **02:04** Rewrote `plan/voice-task-surface-normalization-spec.md` so it now documents the approved next-wave replacement contract, separates runtime truth from target semantics, moves `PERIODIC` into recurrence ontology, inventories all 10 current recurring tasks, records that live history contains no `PROGRESS_0 / Rejected` task usage, and scopes `voicebot/codex_tasks` separately from the broader `bd`-backed OperOps Codex surface.
- **02:04** Added `backend/src/utils/routingConfig.ts`, updated `backend/scripts/seed-telegram-knowledge.ts` to reuse extracted routing project sources and alias handling, and added regression coverage in `backend/__tests__/utils/routingConfig.test.ts`, `backend/__tests__/settings/mediaGenRoutingContract.test.ts`, and `backend/__tests__/prompt/stratoProjectVoiceRoutingContract.test.ts`.
- **10:34** Updated `backend/src/api/routes/voicebot/sessions.ts`, `backend/src/services/voicebot/{migrateVoiceTaskStatuses,repairSoftDeletedMaterializedTasks}.ts`, `backend/src/services/{taskStatusSurface,taskSurfaceNormalization}.ts`, `backend/scripts/task-surface-normalize.ts`, `backend/src/api/routes/crm/tickets.ts`, `backend/src/miniapp/routes/index.ts`, `app/src/pages/operops/CRMPage.tsx`, `app/src/components/crm/CRMKanban.tsx`, `app/src/pages/voice/SessionPage.tsx`, `miniapp/src/{constants.ts,pages/KanbanPage.tsx,store/kanban.ts,components/OneTicket.tsx,components/TicketHead.tsx,types/kanban.ts}`, and focused regression tests to implement the target status axis, recurring-task handling, and picker validation.
- **10:34** Updated `agents/pm2-agents.sh`, `README.md`, `AGENTS.md`, and `plan/voice-task-surface-normalization-spec.md`; closed `copilot-sc1b`, `copilot-ds1z`, and `copilot-oabx`; left `copilot-kdqs` open for the eventual `voice.session_possible_tasks` deprecation wave.
- **11:55** Updated `backend/src/api/routes/voicebot/sessions.ts`, `backend/__tests__/voicebot/runtime/triggerSummarizeRoute.test.ts`, `app/src/store/voiceBotStore.ts`, `app/src/components/voice/{MeetingCard,SessionStatusWidget}.tsx`, `app/src/utils/taskStatusSurface.ts`, `app/src/components/crm/CRMKanban.tsx`, `app/src/pages/{operops/CRMPage,operops/TaskPage,voice/SessionPage}.tsx`, and focused app/backend contract tests so manual summarize no longer depends on seeded `PMO`, upload moves to the top header actions, and task labels render through the target status display layer.
- **21:48** Updated `backend/src/api/routes/voicebot/sessions.ts`, `backend/__tests__/voicebot/session/sessionTabCountsRoute.test.ts`, `app/src/pages/voice/SessionPage.tsx`, and the Voice session tab contract tests so `status_counts` include `DRAFT_10`, the unified `Задачи` tab shows the processing dot, and `PossibleTasks` only renders inside the `Draft` subtab.
- **21:48** Simplified `app/src/pages/operops/CRMPage.tsx` by dropping the special draft-only Voice backlog/session cards, tightened `app/src/components/crm/CRMKanban.tsx` to filter by normalized target-status keys, and extended `app/src/utils/taskStatusSurface.ts` with reusable target-status matching.
- **21:48** Updated `app/src/components/voice/MeetingCard.tsx` and `app/__tests__/voice/meetingCardSummarizeAndIconContract.test.ts` so failed summarize attempts clear the cooldown immediately and successful retries only keep a 15-second anti-bounce lock.
- **21:48** Synchronized `README.md`, `AGENTS.md`, `docs/VOICEBOT_API.md`, and `plan/voice-task-surface-normalization-spec.md` to the unified `Задачи` / `Codex` contract and recorded the convergence-wave doc note on `copilot-ojxy`.
- **23:13** Updated `app/src/pages/voice/SessionPage.tsx` so fixed lifecycle subtabs are keyed by target status order, `Draft` count reconciles against the local mutable draft baseline, and the parent `Задачи` count is derived from the full lifecycle sum.
- **23:13** Updated `app/src/pages/operops/CRMPage.tsx` to remove the duplicate lifecycle widget row and keep lifecycle counts inline inside the main tab labels.
- **23:13** Refreshed `app/__tests__/voice/{sessionPageTabCountersContract,sessionPageOperOpsTasksTabContract}.test.ts`, `app/__tests__/operops/crmPageCodexTabContract.test.ts`, `README.md`, `AGENTS.md`, `docs/VOICEBOT_API.md`, and `plan/voice-task-surface-normalization-spec.md` for the new zero-safe lifecycle-axis/count contract and the latest `bd` bug set (`copilot-e5cj`, `copilot-7jdj`, `copilot-krp8`).
- **23:21** Updated `plan/voice-task-surface-normalization-spec.md` again so `## Status` and `## 15. BD` match the final bead state after live verification; closed `copilot-e5cj`, `copilot-7jdj`, `copilot-krp8`, and `copilot-ojxy.4`.
- **23:44** Updated `backend/src/api/routes/voicebot/{sessions,possibleTasksMasterModel}.ts`, `backend/src/api/routes/crm/tickets.ts`, `backend/src/services/taskStatusSurface.ts`, `app/src/{pages/voice/SessionPage,pages/operops/CRMPage,store/voiceBotStore,store/kanbanStore,utils/taskStatusSurface}.ts`, and focused backend/frontend tests so task reads, counters, and filters now honor exact canonical keys only and no longer fall back to session compatibility payloads.

## 2026-03-13
### PROBLEM SOLVED
- **22:01** Dense plan-fact currency cells could wrap placeholders or compact RUB values onto multiple lines, which made forecast/fact/value rows taller than their neighbors and reduced scanability in the monthly grid.
- **22:01** The checked-in Voice status contract still described `PROGRESS_0` as a reject bucket, and there was no follow-up spec explaining how Voice and OperOps task surfaces should converge on one status-first model after the `DRAFT_10 / BACKLOG_10` rollout.
- **02:42** MPIC process guidance still described evidence, business modeling, and UI artifacts as a single linear chain, which blurred authority boundaries and made downstream generation rules harder to reason about.
- **14:20** Voice task status normalization was still only half-finished on paper and in runtime assumptions: drafts and accepted Voice tasks had already been migrated conceptually, but some product surfaces and docs still behaved as if `READY_10` were the accepted Voice target and `NEW_0` remained the live draft bucket.
- **14:20** Voice session accepted-task visibility still broke when session linkage lived in `source_data.voice_sessions[]`: the page badge and backend count API could show accepted tasks, while the embedded `CRMKanban` grid still rendered an empty list for the same session.
- **14:20** Telegram knowledge integration still relied on historical stash framing, route-layer ID helpers, and missing focused coverage around `/voicebot/project_performers`, leaving the slice “mostly landed” but not cleanly hardened.
- **14:20** Ontology operator scripts still required manual `MONGODB_CONNECTION_STRING` shell exports even though the main backend already had a canonical production env path.

### FEATURE IMPLEMENTED
- **22:01** Locked compact plan-fact currency rendering to a single line and aligned the Voice task-status planning set around the current `Progress 0` meaning plus a new status-first surface-normalization proposal.
- **02:42** Added an MPIC process review that reframes the methodology as a layered artifact graph with explicit evidence normalization, authority layers, generation preconditions, and change-impact rules.
- **14:20** Completed the Voice status dictionary rollout: draft Voice tasks now persist as `DRAFT_10`, accepted Voice tasks materialize and recover as `BACKLOG_10`, and the production data migration path now converges to zero legacy Voice candidates on repeated dry-runs.
- **14:20** Fixed the final accepted-task visibility gap in Voice session `Задачи`: session-scoped matching now includes `source_data.voice_sessions[].session_id`, so the `Backlog` subtab and the grid agree with `/api/voicebot/session_tab_counts`.
- **14:20** Finished Telegram knowledge hardening: deduplicated `project_performer_links`, extracted neutral Mongo ID helpers, added focused service/route/ontology tests, and documented a prod-safe seed rollout/rollback contract.
- **14:20** Aligned ontology operator tooling with the main backend configuration so `contract-check`, `domain-inventory`, `entity-sampling`, and `ingest` auto-load `backend/.env.production` without ad hoc env bootstrapping.

### CHANGES
- **22:01** Updated `app/src/components/PlanFactGrid.tsx` to add `whitespace-nowrap` for compact value/forecast/fact RUB cells, updated `plan/voice-task-status-normalization-plan.md` so `PROGRESS_0` is documented as `Progress 0`, added `plan/voice-task-surface-normalization-spec.md` for epic `copilot-cux2`, and refreshed `README.md` plus `AGENTS.md` with the new plan references.
- **02:42** Added `ontology/plan/mpic-process-review.md` with the artifact-graph and authority-model review for the MPIC generation methodology.
- **14:20** Updated `backend/src/constants.ts`, `app/src/constants/crm.ts`, `backend/src/api/routes/voicebot/{possibleTasksMasterModel,sessions}.ts`, `backend/src/services/voicebot/{persistPossibleTasks,repairSoftDeletedMaterializedTasks,migrateVoiceTaskStatuses}.ts`, and `backend/scripts/voicebot-migrate-task-statuses.ts` to finish the `DRAFT_10 / BACKLOG_10` Voice taskflow split and migration workflow.
- **14:20** Updated `app/src/pages/operops/{CRMPage.tsx,voiceTabGrouping.ts}`, `app/src/utils/voiceSessionTaskSource.ts`, `app/src/store/kanbanStore.ts`, `backend/src/miniapp/routes/index.ts`, and `agents/agent-cards/create_tasks.md` so accepted Voice tasks remain visible in OperOps/Voice/miniapp surfaces after the status split.
- **14:20** Added/updated regression coverage in `backend/__tests__/voicebot/{migrateVoiceTaskStatuses,repairSoftDeletedMaterializedTasks,session/sessionTabCountsRoute,runtime/sessionUtilityRuntimeBehavior.validation}.test.ts`, `app/__tests__/voice/{createTasksPromptContract,sessionTaskSourceFilterBehavior,sessionPageTabCountersContract}.test.ts`, and `app/__tests__/operops/voiceTabGroupingBehavior.test.ts`.
- **14:20** Added `backend/src/utils/mongoIds.ts`, updated `backend/src/services/telegramKnowledge.ts`, and added focused tests `backend/__tests__/services/telegramKnowledge.test.ts`, `backend/__tests__/voicebot/projectPerformersRoute.test.ts`, and `ontology/typedb/tests/test_telegram_knowledge_contract.py`.
- **14:20** Added and synchronized ontology/Telegram docs and runbooks: `ontology/plan/{telegram-knowledge-stash-integration-plan,telegram-knowledge-seed-rollout}.md`, `ontology/typedb/{README.md,AGENTS.md}`, `ontology/typedb/scripts/{typedb-ontology-ingest,typedb-ontology-contract-check,typedb-ontology-domain-inventory,typedb-ontology-entity-sampling}.py`, plus repo docs `README.md` and `AGENTS.md`.

## 2026-03-12
### PROBLEM SOLVED
- **12:05** Voice `Possible Tasks` materialization still used the legacy destructive path: `process_possible_tasks` wrote selected rows back into `NEW_0 / Backlog`, then the cleanup logic soft-deleted those same rows immediately, so accepted tasks disappeared from `Возможные задачи` and never showed up in `Задачи` or CRM.
- **12:05** Voice session task counters still counted draft `voice_possible_task` rows inside `Задачи`, so operators could see a non-zero accepted-task badge while the actual accepted-task view stayed empty or misleading.
- **12:05** The `Possible Tasks` submit path had almost no structured browser diagnostics, which made it hard to localize whether a failure happened before submit, during request assembly, or after the backend response.
- **12:05** The repo still tracked generated `output/` artifacts, so one formatting-only commit accidentally bundled output de-tracking changes and made history noisier than intended.
- **22:01** Voice taskflow still relied on overloaded legacy labels (`NEW_0 / Backlog`, `READY_10 / Ready`) across persistence, materialization, OperOps grouping, and agent prompt guidance, so draft rows and accepted rows could drift between views and there was no canonical operator migration path.
- **22:01** Voice/OperOps session task filters still missed accepted tasks when linkage was stored in `source_data.voice_sessions[]` instead of only `source_ref` / `external_ref`.
- **22:01** The next follow-up scopes for Voice task edit parity and Telegram-knowledge stash reconciliation lived only in operator context, not in checked-in planning artifacts.
- **22:08** Sparse/mock Telegram-knowledge collections without `.find()` still crashed `/voicebot/persons/list_performers` and `/voicebot/projects`, so optional enrichment could turn into route-level `500` responses during tests and partial-environment runs.

### FEATURE IMPLEMENTED
- **12:05** Fixed Voice accepted-task materialization so `process_possible_tasks` now promotes selected rows into `READY_10` as the hotfix target, preserves the task document, stamps acceptance metadata, and no longer self-deletes the accepted row.
- **12:05** Added a dedicated repair path for already broken rows and verified it on the canonical production repro session `69b26496b771d8ccdee31f98`, restoring five soft-deleted materialized tasks back into live accepted-task state.
- **12:05** Added structured frontend diagnostics for `Possible Tasks` submit flow and verified the new logs in Chrome on production (`create_selected.submit`, `process_possible_tasks.request`, `process_possible_tasks.response`, `create_selected.result`).
- **12:05** Cleaned repository tracking for `output/` artifacts via `.gitignore`, while leaving the local files intact.
- **22:01** Promoted Voice task status normalization from hotfix to deployed runtime contract: draft possible tasks now persist as `DRAFT_10`, accepted materializations land in `BACKLOG_10`, and legacy `Backlog/Ready` values are treated as compatibility input only.
- **22:01** Added a dry-run/apply migration path for historical Voice task rows, so operators can convert legacy draft/accepted statuses into the current `DRAFT_10 / BACKLOG_10` split with optional session scoping.
- **22:01** Extended session-source matching to include `source_data.voice_sessions[].session_id` and added a dedicated Backlog subtab in OperOps CRM so accepted voice tasks stay visible after the status split.
- **22:01** Added checked-in follow-up specs for Voice session task edit parity with OperOps CRM and for reconciling the saved Telegram-knowledge stash workstream.
- **22:08** Hardened Telegram-knowledge enrichment to degrade to empty enrichment arrays when chat/user/link collections are absent or minimally stubbed, keeping existing Voice route payloads usable in sparse environments.

### CHANGES
- **12:05** Updated `backend/src/api/routes/voicebot/sessions.ts` so `process_possible_tasks` materializes selected rows into `READY_10`, stamps `accepted_from_possible_task` / `accepted_from_row_id` / `accepted_at` / `accepted_by`, and `session_tab_counts` excludes `source_kind=voice_possible_task` from accepted-task counts.
- **12:05** Added repair tooling in `backend/src/services/voicebot/repairSoftDeletedMaterializedTasks.ts` and `backend/scripts/voicebot-repair-softdeleted-materialized-tasks.ts`, plus npm scripts `voice:repair:softdeleted-materialized:{dry,apply}` in `backend/package.json`.
- **12:05** Added regression coverage in `backend/__tests__/voicebot/{runtime/sessionUtilityRuntimeBehavior.validation,session/sessionTabCountsRoute,repairSoftDeletedMaterializedTasks}.test.ts` and frontend logging coverage in `app/__tests__/voice/possibleTasksLoggingContract.test.ts`.
- **12:05** Updated `app/src/components/voice/PossibleTasks.tsx` and `app/src/store/voiceBotStore.ts` with structured submit-path console logging, refreshed `plan/voice-task-status-normalization-plan.md`, and synchronized `README.md`, `AGENTS.md`, and `docs/VOICEBOT_API.md` to the deployed hotfix contract.
- **12:05** Added `output/` to `.gitignore` and stopped tracking generated files under `output/`; the earlier local commit `13778bc` still mixed that cleanup with the `format.ts` ruble-spacing fix, so follow-up issue `copilot-m1ct` remains open for history cleanup if needed.
- **22:01** Updated `backend/src/constants.ts`, `app/src/constants/crm.ts`, `backend/src/api/routes/voicebot/possibleTasksMasterModel.ts`, `backend/src/services/voicebot/persistPossibleTasks.ts`, and `backend/src/api/routes/voicebot/sessions.ts` so draft reads/writes use `DRAFT_10`, accepted task creation uses `BACKLOG_10`, legacy `Backlog/NEW_0` rows remain readable through compatibility queries, and `create_tickets` / `process_possible_tasks` no longer target `READY_10`.
- **22:01** Added `backend/src/services/voicebot/migrateVoiceTaskStatuses.ts` and `backend/scripts/voicebot-migrate-task-statuses.ts`, plus npm scripts `voice:migrate-task-statuses:{dry,apply}` in `backend/package.json`.
- **22:01** Updated `app/src/pages/operops/{CRMPage.tsx,voiceTabGrouping.ts}`, `app/src/utils/voiceSessionTaskSource.ts`, `app/src/store/kanbanStore.ts`, `backend/src/miniapp/routes/index.ts`, and `agents/agent-cards/create_tasks.md` for the new draft/backlog split, the `source_data.voice_sessions[]` matcher, accepted-task visibility in Miniapp/OperOps filters, and prompt guidance aligned to `DRAFT_10`.
- **22:01** Added/updated regression coverage in `backend/__tests__/voicebot/{migrateVoiceTaskStatuses,repairSoftDeletedMaterializedTasks,runtime/sessionUtilityRuntimeBehavior.validation,session/sessionTabCountsRoute}.test.ts`, `app/__tests__/voice/{createTasksPromptContract,sessionTaskSourceFilterBehavior}.test.ts`, and `app/__tests__/operops/voiceTabGroupingBehavior.test.ts`.
- **22:01** Recast `plan/voice-task-status-normalization-plan.md` as the current as-built contract, added `plan/voice-session-task-edit-parity-spec.md`, added `ontology/plan/telegram-knowledge-stash-integration-plan.md`, updated `app/src/utils/format.ts` to keep the ruble suffix readable in plain text, and synchronized `README.md`, `AGENTS.md`, `docs/VOICEBOT_API.md`, and `docs/VOICEBOT_CREATE_TASKS_MIGRATION.md`.
- **22:08** Updated `backend/src/services/telegramKnowledge.ts` to use safe optional-enrichment lookups, refreshed `backend/__tests__/voicebot/{access/personsListPerformersRoute,projectsRouteParity}.test.ts` for the enriched response shape, and reran the full backend suite plus backend/app builds as green.

## 2026-03-11
### PROBLEM SOLVED
- **22:03** Plan-fact forecast edits could overwrite monthly values without a required rationale, and operators had no built-in history view to audit how a forecast changed over time.
- **22:03** Voice admin/person/project payloads lacked Telegram chat, Telegram user, and project-performer membership context, so project routing and performer discovery stayed fragmented across separate datasets.
- **22:03** The ontology and repo runtime layout still lacked first-class Telegram/project-membership modeling and a standalone Figma indexing subsystem, while the current workspace also contained undocumented runtime/debug artifacts that needed explicit closeout acceptance.

### FEATURE IMPLEMENTED
- **22:03** Enforced mandatory forecast comments for forecast edits and added a dedicated forecast-history drawer/API so plan-fact revisions are visible from the income grid.
- **22:03** Added Telegram knowledge enrichment for Voice project/person/performer surfaces, a permission-checked `project_performers` route, and a seed pipeline for Telegram/project membership data.
- **22:03** Expanded the TypeDB ontology for Telegram chats/users and canonical project-performer links, and added a standalone `figma/` module with indexer/webhook runtimes, CLI commands, PM2 packaging, tests, and operations docs.

### CHANGES
- **22:03** Updated `app/src/components/{PlanFactDrawer.tsx,PlanFactGrid.tsx,ForecastHistoryDrawer.tsx}`, `app/src/pages/PlanFactPage.tsx`, `app/src/services/types.ts`, `backend/src/api/routes/planFact.ts`, `backend/src/services/planFactService.ts`, `backend/src/models/types.ts`, `backend/src/constants.ts`, and `backend/src/services/runtimeScope.ts` to require trimmed forecast comments, increment row versions, persist `forecasts_project_month_history`, and expose `GET /api/plan-fact/forecast-history`.
- **22:03** Added `backend/src/services/telegramKnowledge.ts`, `backend/scripts/seed-telegram-knowledge.ts`, `POST /api/voicebot/project_performers`, Telegram/project enrichment in `backend/src/api/routes/voicebot/{permissions.ts,persons.ts,sessions.ts}`, new shared collection/index definitions in `backend/src/constants.ts`, and repo env visibility for `figma/.env.{development,production}` in `.gitignore` and `scripts/check-envs.sh`.
- **22:03** Extended `ontology/typedb/{schema,mappings,queries,scripts}` for `telegram_chat`, `telegram_user`, and `project_performer_link`, added the standalone `figma/` package (`README.md`, `OPERATIONS.md`, CLI/runtime/jobs/tests/PM2 scripts), normalized the new planning/docs surfaces back to English during closeout, and accepted the current workspace artifacts under `output/` together with placeholder files `page` and `section`.

## 2026-03-10
### PROBLEM SOLVED
- **11:45** Ontology authoring had flipped fully to TOON fragments, which removed the direct annotated TQL surface used for schema review and operator debugging.
- **18:37** Production Voice session pages were serving a mixed task-tab contract: live `session_tab_counts` responses still exposed legacy `tasks_work_count/tasks_review_count` without `status_counts`, while the current session UI expected `status_counts`, so `Задачи` could show a non-zero badge and still render `Нет задач для этой сессии.` for the same session.
- **18:37** Voice task-tab filtering still risked passing human-readable status labels into `CRMKanban`, even though Kanban filtering is keyed by canonical CRM status ids; this would keep task lists empty after backend rollout even when `status_counts` started arriving.
- **22:02** The Voice task-status normalization problem still lacked a shared repository plan, so the overloaded `NEW_0` draft/backlog semantics were documented only informally.

### FEATURE IMPLEMENTED
- **11:45** Restored annotated TQL as the editable ontology source and removed the TOON fragment layer from active authoring flow.
- **18:37** Standardized the Voice task-tab contract on the new `status_counts` shape only and removed legacy `tasks_work_count/tasks_review_count` handling from both frontend and backend.
- **18:37** Added deterministic status-label-to-CRM-key normalization in the Voice session page so `status_counts` drives the same task filters that `CRMKanban` expects.
- **22:02** Added a dedicated Voice task-status normalization planning draft with an AS-IS production snapshot, proposed `DRAFT` / `BACKLOG` split, and rollout sprints.

### CHANGES
- **11:45** Reverted ontology authoring back to annotated TQL source files and removed the intermediate TOON fragment layer from the active toolchain.
- **18:37** Updated `backend/src/api/routes/voicebot/sessions.ts` and `backend/__tests__/voicebot/session/sessionTabCountsRoute.test.ts` so `POST /api/voicebot/session_tab_counts` now returns only `tasks_count`, `codex_count`, and ordered `status_counts`.
- **18:37** Updated `app/src/pages/voice/SessionPage.tsx` and Voice frontend contract tests so the session `Задачи` tab is keyed by canonical CRM status ids derived from backend `status_counts`, with legacy `Work/Review` fallback code removed.
- **18:37** Refreshed `AGENTS.md` and `README.md` to document the new-contract-only requirement for Voice task subtabs and the mandatory status-label normalization before `CRMKanban` filtering.
- **22:02** Added `plan/voice-task-status-normalization-plan.md` and synchronized `README.md` / `AGENTS.md` references while explicitly keeping the approved `NEW_0` runtime contract in force until a replacement spec is accepted.

## 2026-03-09
### PROBLEM SOLVED
- **22:02** Ontology authoring still depended on legacy editable `.tql` fragments while generated outputs, plans, and inventory artifacts were spread across mixed root and `docs/` locations, which made the schema source of truth and operator workflow harder to validate and explain.
- **22:02** Domain-inventory and entity-sampling runs still wrote generated audit outputs into `ontology/typedb/docs/`, so generated data artifacts were mixed with maintained documentation and TOON-domain audits were harder to regenerate cleanly.

### FEATURE IMPLEMENTED
- **22:02** Migrated the ontology source-of-truth to canonical `*.toon.yaml` fragments, added dual generated outputs (`ontology/typedb/schema/str-ontology.yaml` and `ontology/typedb/schema/str-ontology.tql`), and introduced dedicated TOON bootstrap/validation tooling.
- **22:02** Normalized ontology project structure by moving the architecture and migration plans into `ontology/plan/` and relocating generated inventory/sampling artifacts into `ontology/typedb/inventory_latest/`.

### CHANGES
- **22:02** Added `ontology/typedb/scripts/{typedb_ontology_toon.py,typedb-ontology-bootstrap-toon.py,typedb-ontology-toon-validate.py}`, updated `ontology/typedb/scripts/build-typedb-schema.py`, and extended `backend/package.json` so ontology build now validates TOON fragments and emits both generated ontology artifacts.
- **22:02** Added editable TOON fragments under `ontology/typedb/schema/fragments/{00-kernel,10-as-is,20-to-be,30-bridges}/*.toon.yaml`, refreshed `ontology/typedb/schema/str-ontology.tql`, and expanded ontology test coverage for TOON parsing, validation, and generated-output assertions.
- **22:02** Moved generated inventory outputs into `ontology/typedb/inventory_latest/`, moved ontology planning docs into `ontology/plan/`, updated inventory scripts/tests/docs to the new locations, and removed legacy generated inventory files from `ontology/typedb/docs/`.
- **22:02** Refreshed repo and ontology documentation in `AGENTS.md`, `README.md`, `ontology/{AGENTS.md,README.md}`, `ontology/typedb/{AGENTS.md,README.md}`, and `ontology/typedb/docs/{bounded_context_bridge_rules_v1.md,rollout_plan_v1.md}` for the TOON source-of-truth and canonical path contract.

## 2026-03-08
### PROBLEM SOLVED
- **09:37** Voice session pages could miss a `possible_tasks` refresh after reconnect/resubscribe, transcript segment edit/delete/rollback did not requeue `CREATE_TASKS`, and live recompute still treated the latest LLM output as an authoritative replacement set, which made earlier candidate tasks disappear when row identities changed or dropped.
- **09:37** Local/prod `copilot-agent-services` still depended on the host-global Codex auth file, which made agent runtime profile pinning brittle for `codexspark`-based `create_tasks` execution.
- **22:01** `process_possible_tasks` still promoted saved possible-task rows into delivery-ready statuses, the session `Задачи` tab was still hardcoded to `Work/Review`, and the `create_tasks` / session-title prompt cards assumed richer payloads than the current runtime actually sends, which caused task-state drift and prompt-contract mismatch around live Voice workflows.
- **22:01** TypeDB ontology evolution still depended on a partially documented fragment workflow with no single operator-safe build/contract-check/sync path, and the semantic boundary between kernel ontology, project overlays, SemanticCards, and object-bound TO-BE models was not yet frozen against current MongoDB parity work.

### FEATURE IMPLEMENTED
- **09:37** Added incremental possible-task refresh semantics for live voice flows: reconnect now replays a `possible_tasks` refresh hint, transcript mutations automatically requeue `CREATE_TASKS`, and live/manual refresh can preserve unmatched candidate rows as stale instead of deleting them immediately.
- **09:37** Added repo-local Codex auth pinning for agents runtime through `CODEX_AUTH_JSON_PATH`, with the current PM2 setup pointing at `agents/.codex/auth.json`.
- **22:01** Preserved session-scoped materializations in `NEW_0`, exposed ordered per-status task counts for Voice session task tabs, and aligned `create_tasks` plus session-title prompts with compact current-runtime payloads and sparse Mongo-backed context.
- **22:01** Expanded the ontology toolchain into a kernel-first semantic layer with generated schema fragments, full/incremental sync operators, domain inventory and entity-sampling audits, explicit AS-IS/TO-BE bridges, and a documented SemanticCard/project-overlay contract for per-project extensions.

### CHANGES
- **09:37** Updated `backend/src/services/voicebot/persistPossibleTasks.ts`, `backend/src/workers/voicebot/handlers/{createTasksFromChunks,createTasksPostprocessing}.ts`, `backend/src/api/routes/voicebot/sessions.ts`, and `backend/src/api/socket/voicebot.ts` to support `refresh_mode={full_recompute|incremental_refresh}`, preserve stale possible-task rows during live refresh, replay `possible_tasks` fetch on `subscribe_on_session`, and requeue `CREATE_TASKS` after transcript edit/delete/rollback.
- **09:37** Updated `app/src/store/voiceBotStore.ts` so manual `create_tasks` saves use `refresh_mode=incremental_refresh`, and refreshed repo/operator docs in `README.md` and `AGENTS.md` for the new possible-task/runtime auth contracts.
- **09:37** Added/updated regression coverage in `backend/__tests__/voicebot/{runtime/sessionUtilityRuntimeBehavior.validation,socket/voicebotSocketDoneHandler,workers/workerCreateTasksFromChunksHandler,workers/workerCreateTasksPostprocessingRealtime,runtime/sessionsRuntimeCompatibilityRoute.deleteAndErrors}.test.ts`, `backend/__tests__/voicebot/runtime/sessionsRuntimeCompatibilityRoute.test.helpers.ts`, and `app/__tests__/voice/possibleTasksSaveCanonicalItemsContract.test.ts`.
- **22:01** Updated `backend/src/api/routes/voicebot/sessions.ts`, `app/src/pages/voice/SessionPage.tsx`, `agents/agent-cards/{create_tasks,generate_session_title,generate_session_title_send}.md`, `backend/package.json`, and related frontend/backend prompt-contract tests so `process_possible_tasks` writes `NEW_0`, `voicebot/session_tab_counts` returns ordered `status_counts`, the session `Задачи` tab follows real task statuses, and prompt contracts match plain-text/sparse-runtime inputs.
- **22:01** Replaced `ontology/typedb/schema/str_opsportal_v1.tql` with generated `ontology/typedb/schema/str-ontology.tql`, added `schema/fragments/{00-kernel,10-as-is,20-to-be,30-bridges}`, introduced `typedb-ontology-{build,contract-check,domain-inventory,entity-sampling}` tooling plus incremental sync support in `typedb-ontology-ingest.py`, refreshed mapping/validation parity, added ontology tests/docs/semantic-card templates, and updated `plan/ontology-and-operations.md`, `README.md`, and `AGENTS.md` for the kernel/overlay/operator contract.

## 2026-03-07
### PROBLEM SOLVED
- **23:34** TypeDB ontology still relied on a single mixed schema file and raw `source_ref` session linkage, which blurred AS-IS vs TO-BE semantics and broke lineage when task source refs became canonical voice session URLs.

### FEATURE IMPLEMENTED
- **23:34** Introduced fragment-based TypeDB schema assembly with canonical generated artifact `ontology/typedb/schema/str-ontology.tql`, added canonical voice-session-ref lookup in ingestion, and refreshed mapping/validation for current MongoDB parity.

### CHANGES
- **23:34** Added `ontology/typedb/scripts/build-typedb-schema.py`, introduced `schema/fragments/{00-kernel,10-as-is,20-to-be,30-bridges}`, pointed ontology ingest to generated `str-ontology.tql`, added mapping coverage for `summary_correlation_id`, `categorization_timestamp`, `transcription.provider/model/schema_version`, `task`, and normalized `voice_session_sources_oper_task` owner lookup via canonical voice URL -> session id transform.

### PROBLEM SOLVED
- **06:57** `create_tasks` agents still relied on stale runtime defaults and prompt context, so session-derived task generation could miss transcript metadata and explicit invoice-task intent.
- **08:27** Manual and automatic `create_tasks` flows still diverged in queue/realtime behavior, which produced stale notify symbols, unnecessary recomputation on session close, and delayed possible-task refresh after transcription.
- **10:27** Voice session tabs lacked reliable counters and activity indicators, and Codex badge counts could drift from the backend route, so operators saw inconsistent workload signals across tabs.
- **22:01** Local `desloppify` artifacts were stale against the current workspace, leaving the scorecard and next-step queue out of sync with the latest scan state.

### FEATURE IMPLEMENTED
- **06:57** Standardized `create_tasks` runtime/prompt inputs: the fast-agent default moved to `codexspark`, prompt prep now fetches transcript metadata first, and explicit invoice tasks are preserved in the prompt contract.
- **08:27** Unified the live `create_tasks` execution path: transcription now triggers possible-task refresh, manual task creation uses the same queue path, stale notify symbols were removed, and session-done no longer recomputes possible tasks.
- **10:27** Added voice session tab telemetry with per-tab counters, stage activity dots, split task subtabs, and Codex badge counts aligned to the canonical backend counts route.
- **22:01** Refreshed the `desloppify` workspace snapshot with a new plan queue, updated scanner state files, and a regenerated scorecard image.

### CHANGES
- **06:57** Updated agents/runtime and prompt contracts in `agents/{README.md,ecosystem.config.cjs,fastagent.config.yaml,agent-cards/create_tasks.md}` plus `backend/src/services/voicebot/createTasksAgent.ts`; refreshed prompt coverage in `app/__tests__/voice/createTasksPromptContract.test.ts`.
- **08:27** Realtime/taskflow updates landed across `backend/src/workers/voicebot/handlers/{transcribeHandler.ts,createTasksFromChunks.ts,createTasksPostprocessing.ts,doneMultiprompt.ts}`, `backend/src/api/socket/voicebot.ts`, `backend/src/constants.ts`, `app/src/components/voice/Categorization.tsx`, and `app/src/store/voiceBotStore.ts`, with matching docs/test refreshes in `README.md`, `docs/{VOICEBOT_API.md,VOICEBOT_API_TESTS.md,TESTING_PROCEDURE.md}`, and backend/frontend worker/socket suites.
- **10:27** Session-tab count/UI alignment updated `app/src/pages/voice/SessionPage.tsx`, `app/src/utils/voiceSessionTabs.ts`, `app/src/components/codex/CodexIssuesTable.tsx`, `backend/src/api/routes/voicebot/sessions.ts`, and related contract tests to keep counters and badge sources consistent.
- **22:01** Added `.desloppify/plan.json`, refreshed `.desloppify/{query.json,state-typescript.json,state-typescript.json.bak}`, and regenerated `scorecard.png`; current `desloppify next` starts with subjective re-review `contract_coherence`, and `desloppify show app/e2e --status open` reports two low-priority follow-ups (`app/e2e/auth.setup.ts` review coverage, `app/e2e/voice-fab-lifecycle.spec.ts` large-file split).

## 2026-03-06
### PROBLEM SOLVED
- **12:03** Possible tasks still depended on session-local `CREATE_TASKS` payloads and legacy CRM restart flow, so tasks discussed during an active meeting could not become first-class Mongo task records with stable links, dedupe, or status transitions.
- **12:03** Voice session UI had no direct `Tasks` action during the meeting, forcing operators to wait for later CRM-side processing instead of drafting possible tasks from the live transcript.
- **12:03** OperOps `Voice` tab was still session-centric and could not review `NEW_0` possible tasks as one backlog, nor distinguish orphan backlog rows from session-linked voice work.
- **12:03** CRM/Miniapp task attachments could preserve mojibake UTF-8 filenames from multipart uploads, so uploaded files lost readable Russian names in shared task flows.
- **12:03** Session taskflow mutations still treated `task_id_from_ai` as a first-class row locator in all write paths, which made canonical `row_id` migration brittle when both values diverged.
- **16:59** MCP socket requests could fail across transient reconnect windows, so live `create_tasks` runs were prone to disappearing pending state and opaque disconnect errors.
- **17:08** The paused FAB `Done` path could double-submit close attempts, which made embedded recording flows noisy and error-prone.
- **17:39** The post-meeting `create_tasks` debug loop still had weak reconnect/error handling and over-large payload contracts, making agent troubleshooting and operator retries harder than necessary.
- **20:04** Canonical persistence hardening made `NEW_0` rows too rigid: operators could not safely rewrite or re-show deleted possible tasks during a live taskflow iteration.

### FEATURE IMPLEMENTED
- **12:03** Added live possible-task generation during meetings: Voice session header now exposes `Tasks` before `Summarize`, the frontend calls MCP `create_tasks` with a structured envelope, and canonical persistence goes through Mongo-backed possible-task routes.
- **12:03** Promoted possible tasks to master records in `automation_tasks` with status `NEW_0`, voice session backlinks, and structured relation support (`parent-child`, `waits-for`, `blocks`, `relates_to`, `discovered-from`).
- **12:03** Redesigned OperOps `Voice` around possible-task review: orphan `NEW_0` tasks are grouped first, then newest session groups, with expanded possible-task tables and collapsed processed-task reference tables.
- **12:03** Added attachment filename normalization for mojibake UTF-8 multipart uploads and tightened taskflow row-locator fallback so `task_id_from_ai` remains metadata-first.
- **17:39** Hardened `create_tasks` transport/debug behavior with reconnect grace, deterministic disconnect failures, voice-fetch-first prompt guidance, clearer agent-error surfacing, and synchronized MCP server bindings.
- **20:43** Refined canonical possible-task persistence so `NEW_0` rows remain mutable, deleted rows can reappear when needed, task cursor stubs tolerate unsorted inputs, and the frontend sends a smaller create-tasks payload envelope.
- **21:22** Standardized agent runtime configuration by tracking the fast-agent upstream/fork state centrally and removing per-card model pins.

### CHANGES
- **12:03** Agents/runtime:
  - updated `agents/agent-cards/create_tasks.md` to accept structured input modes (`raw_text`, `session_id`, optional `session_url`) via JSON envelope carried in `message`,
  - added `gsh` MCP server to `agents/fastagent.config.yaml`,
  - updated `agents/README.md` to document direct MCP `voice`/`gsh` enrichment and the no-`StratoProject` execution rule.
- **12:03** Backend Voice:
  - added Mongo master-model helper `backend/src/api/routes/voicebot/possibleTasksMasterModel.ts`,
  - added routes `POST /api/voicebot/save_possible_tasks` and `POST /api/voicebot/process_possible_tasks`,
  - changed `POST /api/voicebot/possible_tasks` to prefer `automation_tasks` master rows and keep session `processors_data.CREATE_TASKS` as compatibility projection only,
  - updated `create_tickets` / `delete_task_from_session` to synchronize master possible-task rows with session operations.
- **12:03** Frontend Voice + OperOps:
  - updated `app/src/components/voice/MeetingCard.tsx`, `app/src/store/voiceBotStore.ts`, `app/src/utils/voicePossibleTasks.ts`, `app/src/components/voice/PossibleTasks.tsx`, and `app/src/pages/voice/SessionPage.tsx`,
  - added `app/src/pages/operops/voiceTabGrouping.ts` and redesigned the `Voice` tab in `app/src/pages/operops/CRMPage.tsx` around orphan/session-grouped `NEW_0` tasks.
- **12:03** Planning/docs:
  - added `plan/closed/2026-03-06-live-possible-tasks-during-meeting-plan.legacy.md`,
  - updated `docs/RUNTIME_TAG_DEPRECATION_PLAN_2026-03-04.md` with BD status/traceability formatting.
- **12:03** Attachment/taskflow robustness:
  - updated `backend/src/services/taskAttachments.ts` to decode UTF-8 filenames exposed as latin1 mojibake by multipart parsing,
  - expanded backend coverage in `backend/__tests__/api/{miniappTaskAttachments.contract,taskAttachments.service}.test.ts`,
  - refined canonical row-locator handling in `backend/src/api/routes/voicebot/sessions.ts` and `backend/__tests__/voicebot/runtime/sessionUtilityRuntimeBehavior.validation.test.ts` so `task_id_from_ai` is treated as a legacy fallback after canonical row-id fields.
- **16:59** MCP reconnect/error handling:
  - added reconnect grace coverage in `app/src/hooks/useMCPWebSocket.ts` and `app/src/store/mcpRequestStore.ts`,
  - failed lost tool requests deterministically in `backend/src/services/mcp/index.ts`,
  - added regression coverage in `app/__tests__/voice/mcpWebSocketReconnectGraceContract.test.ts` and `backend/__tests__/services/mcpProxySocketContract.test.ts`.
- **17:39** Voice/agent debug flow hardening:
  - updated `app/src/components/voice/MeetingCard.tsx`, `app/src/pages/operops/CRMPage.tsx`, `app/src/store/voiceBotStore.ts`, `app/src/services/socket.ts`, `app/src/store/sessionsUIStore.ts`, and `app/src/pages/voice/SessionsListPage.tsx` for reconnect-safe request handling and clearer create-tasks errors;
  - updated `agents/{README.md,agent-cards/create_tasks.md,ecosystem.config.cjs,fastagent.config.yaml,pyproject.toml}` to require `voice.fetch` context first, bind MCP servers explicitly, track upstream/fork revisions, and centralize model/runtime defaults.
- **20:43** Possible-task contract refinement:
  - updated `app/src/utils/voicePossibleTasks.ts`, `app/src/store/voiceBotStore.ts`, `app/src/types/voice.ts`, and `backend/src/api/routes/voicebot/sessions.ts` to shrink the payload envelope, allow mutable `NEW_0` rewrites, tolerate unsorted task-cursor stubs, and let deleted possible tasks reappear;
  - refreshed tests/docs in `app/__tests__/voice/{meetingCardTasksButtonContract.test.ts,possibleTasksPostCreateContract.test.ts,possibleTasksSaveCanonicalItemsContract.test.ts,voicePossibleTasksParser.test.ts}`, `docs/{VOICEBOT_API.md,VOICEBOT_API_TESTS.md,VOICEBOT_CREATE_TASKS_MIGRATION.md,TESTING_PROCEDURE.md}`, and `plan/voice-operops-codex-taskflow-spec.md`.
- **12:03** Validation:
  - `cd backend && NODE_OPTIONS='--experimental-vm-modules' npx jest --runInBand __tests__/voicebot/runtime/sessionUtilityRoutes.test.ts __tests__/voicebot/runtime/sessionUtilityRuntimeBehavior.validation.test.ts __tests__/voicebot/runtime/sessionUtilityValidationRoutes.test.ts`
  - `cd backend && npm run build`
  - `cd app && npx jest --runInBand __tests__/voice/meetingCardTasksButtonContract.test.ts __tests__/operops/voiceTabGroupingBehavior.test.ts __tests__/voice/sessionPagePossibleTasksTabContract.test.ts __tests__/voice/possibleTasksPostCreateContract.test.ts __tests__/voice/voiceSocketRealtimeContract.test.ts __tests__/voice/possibleTasksBackendValidationContract.test.ts`
  - `cd app && npm run build`

## 2026-03-05
### PROBLEM SOLVED
- **16:02** OperOps project create/edit only worked through inline tree modals, so deep links, browser navigation, and larger edit flows were cramped and hard to resume directly.
- **16:21** CRM and Miniapp tasks had no shared attachment contract, so operators and performers could not exchange the same task files across both surfaces with one storage and validation model.
- **22:01** Embedded WebRTC Settings/Monitor sessions could keep page `Done` disabled while paused, Mic 1 failures stayed implicit during active capture, and some browsers uploaded audio-only chunks as `video/webm`, creating avoidable backend rejection risk.

### FEATURE IMPLEMENTED
- **16:02** Added dedicated OperOps project management routes (`/operops/projects-tree/new`, `/operops/projects-tree/:projectId`) with a full-page editor and explicit back/cancel flow.
- **16:21** Added a shared CRM↔Miniapp task attachment flow with upload/download/delete support, normalized metadata, centralized storage rules, and performer-safe miniapp access checks.
- **22:01** Hardened WebRTC capture and upload compatibility: paused embedded sessions keep `Done` available, FAB raises a red `Mic 1 OFF` alert with deterministic fallback selection, and backend normalizes audio-only `video/webm` uploads to `audio/webm`.

### CHANGES
- **16:02** Frontend OperOps routing/page changes:
  - added `app/src/pages/operops/ProjectManagementPage.tsx` and routed `/operops/projects-tree/new` plus `/operops/projects-tree/:projectId` from `app/src/App.tsx`,
  - removed inline project create/edit modal flow from `app/src/pages/operops/ProjectsTree.tsx`,
  - extended `app/src/components/crm/projects/EditProject.tsx` with explicit cancel/back handling.
- **16:21** Attachment contract:
  - added shared backend attachment service `backend/src/services/taskAttachments.ts` with allowlist (`pdf/docx/xlsx/png/jpg/jpeg/txt/zip`), `100MB` limit, normalized metadata, and storage under `uploads/task-attachments` (`TASK_ATTACHMENTS_DIR` override),
  - added CRM endpoints `POST /api/crm/tickets/upload-attachment`, `GET /api/crm/tickets/attachment/:ticket_id/:attachment_id`, `POST /api/crm/tickets/delete-attachment`,
  - added Miniapp endpoints `POST /tickets/upload-attachment` and `GET /tickets/attachment/:ticket_id/:attachment_id` with performer access checks,
  - surfaced attachments in CRM ticket create/edit, OperOps TaskPage, Miniapp ticket view/store/types, and added backend regression suites `backend/__tests__/api/{miniappTaskAttachments.contract,taskAttachments.service}.test.ts`.
- **22:01** Voice WebRTC/upload hardening:
  - updated `app/public/webrtc/webrtc-voicebot-lib.js` plus FAB assets to keep page `Done` enabled from paused embedded contexts, show `Mic 1 OFF` critical state, and apply strict missing-Mic-1 fallback `LifeCam -> Microphone -> OFF`,
  - updated `backend/src/api/routes/voicebot/uploads.ts` to accept audio-only MediaRecorder blobs sent as `video/webm` and persist normalized `audio/webm`,
  - extended regression coverage in `app/__tests__/voice/{webrtcDoneFromPausedContract,webrtcMic1CriticalContract}.test.ts` and `backend/__tests__/voicebot/runtime/uploadAudioRoute.test.ts`.
- **22:01** Validation:
  - `cd app && npm run test:serial -- __tests__/voice/webrtcDoneFromPausedContract.test.ts __tests__/voice/webrtcMic1CriticalContract.test.ts`
  - `cd backend && npm run test -- __tests__/voicebot/runtime/uploadAudioRoute.test.ts __tests__/api/miniappTaskAttachments.contract.test.ts __tests__/api/taskAttachments.service.test.ts`
  - `cd app && npm run build`
  - `cd miniapp && npm run build`
  - `cd backend && npm run build`

## 2026-03-04
### PROBLEM SOLVED
- **22:00** Miniapp backend had no dedicated Telegram entrypoint for opening the WebApp from chat commands, so users needed manual links and operators lacked a fast in-chat diagnostics command for target chat metadata.
- **12:22** `CREATE_TASKS` realtime delivery still depended on `socket_id`-targeted emission, so session-room clients without explicit socket binding did not receive `tickets_prepared` updates.
- **12:22** Socket events worker treated payload as object-only data, which made array payload contracts (for `tickets_prepared`) brittle and caused silent delivery gaps.
- **12:22** Transcription fallback rows with quota errors lacked the metadata signature line (`mm:ss - mm:ss, file.webm, HH:mm:ss`), so operators could not map placeholders to source chunks while waiting for retries.
- **11:34** Voice runtime still depended on `runtime_tag` in core query/filter/write paths and queue/lock naming, which blocked the migration goal of environment isolation through separate DB/instance boundaries and kept transitional tag logic in operational flow.
- **11:34** Runtime-tag assumptions persisted in backend voice tests, so post-migration fail-fast/tag-agnostic behavior could regress without deterministic coverage.
- **11:34** Runtime-tag deprecation guidance was partially implicit across docs, leaving operators without one canonical statement that `runtime_tag` is transitional metadata and not a routing/isolation contract.
- **08:55** Voice Categorization still mixed per-row metadata noise and narrow typography, so large sessions became harder to scan and metadata traceability was duplicated across rows.
- **08:55** Voice sessions had no canonical persisted markdown summary API; summaries could not be saved with deterministic validation, session-log trace, and realtime refresh.
- **08:55** Done-flow summarize orchestration lacked explicit correlation/idempotency audit trail for downstream summarize notifications, making incident triage harder across retries.
- **08:55** Codex relationship rendering in OperOps details card did not fully normalize `waits-for/blocks/dependents` semantics into explicit dependency groups.

### FEATURE IMPLEMENTED
- **22:00** Added optional Miniapp Telegram bot bootstrap in miniapp runtime: `/start` and `/miniapp` now return an inline WebApp button, `/get_info` provides chat diagnostics, and launch/shutdown are logged with deterministic env-based Miniapp URL resolution.
- **12:22** Closed quota-recovery realtime fix wave `copilot-w8l0` (`.1`/`.2`/`.3`): `tickets_prepared` is now emitted for session-room delivery (with optional socket targeting), socket dispatch supports array payloads, and fallback quota rows render metadata signature while being replaceable in-place by realtime transcript updates.
- **11:34** Completed runtime-tag deprecation epic `copilot-f75b` (`T0..T8`) with swarm execution: runtime-tag behavior is neutralized in runtime scope/data-access, write paths stop emitting `runtime_tag`, queue/poller naming no longer relies on runtime tags, docs/env contract is updated, and final voice QA gate is green.
- **11:34** Added migration support for historical CREATE_TASKS payload normalization with a dedicated script and runbook (`backend/scripts/voicebot-migrate-create-tasks-schema.ts`, `docs/VOICEBOT_CREATE_TASKS_MIGRATION.md`) while keeping runtime strict canonical key contract.
- **11:34** Standardized agents runtime bootstrap to `uv run --directory ... fast-agent serve ... --model codex` and removed card-level model hardcoding for `create_tasks`.
- **08:55** Delivered Voice Categorization UX cleanup wave (`copilot-8gto` scope): metadata signature is rendered once per block footer, row selection remains blue-only, readability typography is increased, and a new `Summary` panel supports edit/save/conflict handling.
- **08:55** Added `POST /api/voicebot/save_summary` contract with strict payload checks, session persistence (`summary_md_text`, `summary_saved_at`), `summary_save` session-log event, and realtime `session_update.taskflow_refresh.summary` hint.
- **08:55** Added summarize correlation/idempotency propagation through done-flow (`summary_correlation_id`) and summary audit events (`summary_telegram_send`, `summary_save`) for queue-driven summarize routing.
- **08:55** Updated OperOps Codex relationship grouping to explicit `Parent`, `Children`, `Depends On (blocks/waits-for)`, `Blocks (dependents)` with shared issue-id token rendering.

### CHANGES
- **22:00** Miniapp Telegram bot integration:
  - updated `backend/src/miniapp/index.ts` to initialize Telegraf from `TG_MINIAPP_BOT_TOKEN`, resolve WebApp URL via `TG_MINIAPP_WEBAPP_URL` (with prod/dev defaults), register `/start`, `/miniapp`, `/get_info` handlers, and add structured error logging;
  - wired graceful shutdown to stop the miniapp bot before HTTP/DB shutdown flow;
  - updated `AGENTS.md` and `README.md` Miniapp contracts with the new bot/runtime behavior.
- **12:22** Voice realtime/taskflow and UI fallback updates:
  - updated worker/socket runtime contracts in `backend/src/workers/voicebot/handlers/createTasksFromChunks.ts` and `backend/src/services/voicebot/voicebotSocketEventsWorker.ts` (session-room `tickets_prepared` + array payload support);
  - updated fallback-row rendering in `app/src/components/voice/TranscriptionTableRow.tsx` (error signature footer via shared metadata formatter);
  - added regression suites `backend/__tests__/voicebot/workers/workerCreateTasksPostprocessingRealtime.test.ts` and `app/__tests__/voice/transcriptionFallbackErrorSignatureContract.test.ts`, plus extended existing worker/socket tests.
- **12:22** Added manual/automated verification checklist `docs/voicebot-plan-sync/quota-recovery-realtime-qa-checklist.md` for session `69a7cb2002566a3e76d2dc11` quota-recovery flow.
- **12:22** Validation:
  - `cd backend && npm run test -- __tests__/voicebot/workers/workerCreateTasksFromChunksHandler.test.ts __tests__/voicebot/workers/workerCreateTasksPostprocessingRealtime.test.ts __tests__/voicebot/socket/voicebotSocketEventsWorker.test.ts` passed (`98/98` suites from parallel-safe + `5/5` suites from serialized scope).
  - `cd app && npm run test:serial -- __tests__/voice/transcriptionFallbackErrorSignatureContract.test.ts` passed.
  - `cd backend && npm run build` passed.
  - `cd app && npm run build` passed.
- **11:43** Finalized post-deploy scanner snapshot artifacts after background `desloppify review` completion/interruption, including refreshed `.desloppify/state-typescript*.json`, new holistic packets/run summaries, merged findings payloads, and updated `scorecard.png`.
- **11:36** Refreshed local `desloppify` review artifacts for the latest scan cycle (`.desloppify/query.json`, `.desloppify/review_packet_blind.json`, `.desloppify/review_packets/*`, `.desloppify/subagents/runs/*`) to keep scanner state synchronized with post-deploy workspace.
- **11:34** Backend runtime-tag deprecation:
  - neutralized runtime-tag filter/injection helpers in `backend/src/services/{runtimeScope.ts,db.ts}`;
  - removed runtime-tag-scoped read/write branches in Voice routes/services (`backend/src/api/routes/voicebot/{sessions.ts,uploads.ts,transcription.ts,permissions.ts,messageHelpers.ts}`, `backend/src/api/routes/auth.ts`, `backend/src/services/voicebotObjectLocator.ts`, `backend/src/voicebot_tgbot/{activeSessionMapping.ts,commandHandlers.ts,ingressHandlers.ts}`, `backend/src/workers/voicebot/handlers/transcribeHandler.ts`);
  - updated queue/poller naming contract in `backend/src/{constants.ts,workers/voicebot/runner.ts,voicebot_tgbot/runtime.ts}` to env-stable suffixes.
- **11:34** Test contract refactor and QA gate:
  - refreshed runtime-tag-dependent backend tests across `backend/__tests__/services/*` and `backend/__tests__/voicebot/**/*` to runtime-agnostic query/write expectations;
  - added `backend/__tests__/voicebot/workers/queueLockNamingContract.test.ts`;
  - reran voice baseline via `./scripts/run-test-suite.sh voice` and type-safety gates (`cd backend && npm run build`, `cd app && npm run build`) as green.
- **11:34** Docs/env and migration assets:
  - updated `AGENTS.md`, `README.md`, `docs/VOICEBOT_API.md` to document fail-fast session resolution and runtime-tag deprecation as operational contract;
  - added `docs/RUNTIME_TAG_DEPRECATION_PLAN_2026-03-04.md` with contract freeze/addenda and readiness notes;
  - added CREATE_TASKS migration assets: `backend/scripts/voicebot-migrate-create-tasks-schema.ts`, `docs/VOICEBOT_CREATE_TASKS_MIGRATION.md`.
- **11:34** Agents runtime/config updates:
  - updated `agents/{README.md,ecosystem.config.cjs,fastagent.config.yaml,pm2-agents.sh,pyproject.toml}` and cards `agents/agent-cards/{create_tasks.md,codex_deferred_review.md}` to align runtime model/config and deferred-review flow docs.
- **08:55** Frontend Voice:
  - updated `app/src/components/voice/{Categorization.tsx,CategorizationTableHeader.tsx,CategorizationTableRow.tsx,CategorizationTableSummary.tsx}`.
  - added `app/src/utils/voiceMetadataSignature.ts` block-footer helper path (`buildCategorizationBlockMetadataSignature`).
  - updated `app/src/store/voiceBotStore.ts` + `app/src/types/voice.ts` for summary save/realtime refresh support.
  - simplified `app/src/components/voice/PossibleTasks.tsx` by removing editable `task_type_id`/`dialogue_tag` columns from the session table.
- **08:55** Backend Voice:
  - added route `POST /api/voicebot/save_summary` in `backend/src/api/routes/voicebot/sessions.ts`.
  - extended done pipeline/logging in `backend/src/services/{voicebotSessionDoneFlow.ts,voicebot/voicebotDoneNotify.ts,voicebotSessionLog.ts}` and `backend/src/workers/voicebot/handlers/doneMultiprompt.ts`.
  - added/updated tests: `backend/__tests__/voicebot/runtime/saveSummaryRoute.test.ts`, `backend/__tests__/voicebot/session/sessionDoneFlowService.test.ts`, `backend/__tests__/voicebot/{notify/doneNotifyService.test.ts,workers/workerDoneMultipromptHandler.test.ts,runtime/sessionUtilityRoutes.test.ts,session/sessionLogRouteContract.test.ts,session/sessionLogAppendOnlyContract.test.ts,session/sessionLogServiceMap.test.ts}`.
- **08:55** OperOps/CRM + Miniapp:
  - updated `app/src/components/codex/CodexIssueDetailsCard.tsx` (+ contract test) for relationship normalization.
  - updated miniapp debug ticket-read path in `backend/src/miniapp/routes/index.ts` to use raw DB in `IS_MINIAPP_DEBUG_MODE=true` for runtime-tag mismatch diagnostics.
  - minor FinOps label copy update in `app/src/components/PlanFactGrid.tsx` (`Заказчик` -> `Клиент`).
- **08:55** Agent/ontology/docs:
  - updated `agents/agent-cards/create_tasks.md` to canonical JSON output contract (`id/name/description/priority/...` keys).
  - synchronized ontology assets (`ontology/typedb/{schema,mappings,queries,scripts}` + ontology docs/changelog) with summary persistence and mapping-driven ingest updates.
  - expanded multi-agent distillation notes in `docs/MULTI_AGENT_DISTILLATION_2026-03-03.md`.
- **08:55** Validation:
  - `cd app && npm run build` passed.
  - `cd backend && npm run build` passed.

## 2026-03-03
### PROBLEM SOLVED
- **20:20** Multi-agent orchestration guidance for UI decomposition lived in fragmented chat notes, so role boundaries, dependency handling, and hierarchy contracts (`CJM -> BPMN -> UserFlow -> Screens -> Widgets -> Atoms/Tokens`) were not preserved as a reusable repository artifact.
- **20:20** Session closeout had undocumented local artifacts (`.agents/`, `output/`, `tmp/`) pending in the working tree; without explicit acceptance and changelog coverage this would leave close-session history incomplete.
- **15:20** Deleting all transcript segments from Voice UI could still leave orphan `categorization` rows on the session payload, so the `Категоризация` tab displayed stale tails even when transcription chunks were fully removed.
- **12:28** Voice session taskflow parity was fragmented across backend routes, Voice UI, and `mcp@voice`: assistants could not manage `CREATE_TASKS` rows by `session_id` with one canonical contract, and clients still needed manual refresh after list mutations.
- **12:28** Token-based automation via `tools/voice` Actions API had no parity path for session-scoped Possible Tasks / Tasks / Codex operations, which forced mixed MCP-only flows and increased drift risk.
- **12:28** Cross-repo taskflow behavior lacked explicit regression coverage for duplicate row locators, retry-safe local apply, and repeated realtime refresh hints, making partial-success and concurrency regressions harder to catch before rollout.
- **13:55** `notify_requested` session-log entries still stamped `metadata.source=socket_session_done` after REST-initiated closes, which polluted incident diagnostics by masking the real initiator path.
- **13:55** Documentation and operator-facing contract text still described a route-absence fallback to `/api/voicebot/close_session`, even though the desired close semantics are strict fail-fast.

### FEATURE IMPLEMENTED
- **20:20** Added canonical multi-agent distillation guidance to `docs/` with explicit `bd`-native forward-only dependency-graph workflow, context-isolated worker protocol, and hierarchy/domain-linking requirements for UI artifacts.
- **20:20** Completed close-session documentation sync across `AGENTS.md`, `README.md`, and `CHANGELOG.md` for the current documentation/artifact wave.
- **15:20** Added full-delete cleanup parity for session reads: when a message has no active transcript segments (`all is_deleted=true`), backend now clears categorization payload paths deterministically before returning data to UI.
- **12:28** Completed and closed epic `copilot-zktc`: session-scoped taskflow parity now spans backend, Voice UI consumers, `mcp@voice`, Actions API, regression coverage, and operator/assistant runbooks.
- **12:28** Added canonical backend support for session-scoped Possible Tasks list/create/delete with deterministic `row_id`, explicit `operation_status`, partial-success metadata, and websocket `taskflow_refresh` hints consumed by Voice `Возможные задачи` / `Задачи` / `Codex` tabs.
- **12:28** Added the assistant/taskflow runbook `discuss -> preview -> apply -> verify` to repository docs and aligned Voice/OperOps runtime notes with the new session-taskflow contract.
- **13:55** Fixed session-log source labeling for done-notify events so `metadata.source` now reflects the actual REST/socket/queue initiator.
- **13:55** Re-aligned the Voice close contract to explicit fail-fast semantics: clients close only through `POST /api/voicebot/session_done` and must not fall back to the legacy alias.

### CHANGES
- **20:20** Documentation:
  - added `docs/MULTI_AGENT_DISTILLATION_2026-03-03.md` (deduplicated final version with `bd`-native dependency operations, role-isolated handoff contract, and explicit hierarchy model `CJM -> BPMN -> UserFlow -> Screens -> Widgets -> Atoms/Tokens`);
  - updated `AGENTS.md` and `README.md` session-closeout notes for this wave.
- **20:20** Accepted working-tree artifacts into the close-session package:
  - `.agents/product-marketing-context.md`;
  - `output/copilot-marketing-discovery-2026-03-03.pptx`;
  - `tmp/copilot-marketing-ppt/**` (local build workspace with slides/toolchain snapshot).
- **15:20** Backend:
  - updated `backend/src/api/routes/voicebot/sessions.ts` (`categorizationCleanup.applyForDeletedSegments`) with a full-delete guard that wipes `categorization`, `categorization_data.data`, `processors_data.categorization.rows`, and `processors_data.CATEGORIZATION` when all transcript segments are deleted.
  - added regression test `POST /voicebot/session clears categorization when all transcript segments are deleted` in `backend/__tests__/voicebot/runtime/sessionsRuntimeCompatibilityRoute.sessionParity.test.ts`.
  - validated via `cd backend && npm run test:parallel-safe -- __tests__/voicebot/runtime/sessionsRuntimeCompatibilityRoute.sessionParity.test.ts`.
- **15:20** Documentation:
  - updated `AGENTS.md` and `README.md` with the full-delete categorization cleanup contract note.
- **12:28** Backend:
  - updated `backend/src/api/routes/voicebot/sessions.ts` with `POST /api/voicebot/possible_tasks`, extended `create_tickets`/`delete_task_from_session` contract, explicit `runtime_mismatch` / `ambiguous_row_locator`, and `session_update.taskflow_refresh` emission;
  - expanded runtime tests in `backend/__tests__/voicebot/runtime/{sessionUtilityRoutes.test.ts,sessionUtilityRuntimeBehavior.validation.test.ts,sessionUtilityRuntimeBehavior.codexSyncAndFilters.test.ts}`.
- **12:28** Frontend:
  - updated `app/src/store/voiceBotStore.ts`, `app/src/pages/voice/SessionPage.tsx`, `app/src/components/crm/CRMKanban.tsx`, `app/src/components/codex/CodexIssuesTable.tsx`, and `app/src/types/voice.ts` for additive realtime refresh-token handling;
  - updated contracts in `app/__tests__/voice/*` and `app/__tests__/operops/*`.
- **12:28** Documentation:
  - updated `AGENTS.md` and `README.md`;
  - added/updated plan artifact `plan/closed/2026-03-03-mcp-voice-session-taskflow-plan.legacy.md`.
- **13:55** Backend:
  - updated `backend/src/services/voicebot/voicebotDoneNotify.ts` to derive `metadata.source` from the actual close/worker path;
  - expanded `backend/__tests__/voicebot/notify/doneNotifyService.test.ts` for REST and queue source labels.
- **13:55** Documentation:
  - updated `AGENTS.md` and `README.md` to remove client-side fallback guidance and document fail-fast close semantics.

## 2026-03-01
### PROBLEM SOLVED
- **18:55** Visual recap Mermaid blocks were rendered with broken line-break semantics, so diagrams could fail to parse and made session handoff artifacts unreliable.

### FEATURE IMPLEMENTED
- **18:55** Added a corrected visual recap HTML artifact with Mermaid-safe line breaks to keep architecture/session diagrams readable in one self-contained document.

### CHANGES
- **18:55** Added `docs/copilot-repo-visual-recap.html` with fixed Mermaid line-break formatting and updated recap content.

## 2026-02-28
### PROBLEM SOLVED
- **19:10** `copilot-sxq1.14.8` could not be executed reliably as one scope because Codex subjective-review batch runs hit runner quota/usage limits, which blocked deterministic progress and left a high-risk single-task bottleneck.
- **19:10** Full-suite validation briefly produced conflicting outcomes for the same pipeline (`full` pass in one run and a voice-shard failure in another), creating ambiguity for close-session quality gates until the flaky shard was rechecked and the full suite was rerun.
- **18:18** Unified monorepo test execution remained partially sequential and undocumented by stage, which made runtime optimization hard to measure and caused hidden duplicate execution (notably overlapping app/voice e2e coverage).
- **17:18** Session closeout quality gate was blocked because `make test` is not defined in this repo and refactoring of Voice/CRM helpers left string-contract tests out of sync, causing initial `full` suite failures in app/backend checks.
- **14:12** Voice session inline Codex details (`Подробности Codex задачи`) used a narrower side panel and plain-text rendering, so Description/Notes paragraph breaks were collapsed and the layout diverged from OperOps Codex task view (`copilot-4o2c`).
- **13:52** Wave-1 technical debt from `desloppify` (`copilot-y9qy`) still left noisy runtime logs and duplicated helper logic across app/backend/voice-worker paths, which increased incident-triage time and made behavior changes harder to verify.
- **13:52** Security wave backlog (`copilot-6obm`) had 20 untriaged scanner findings mixed between exploitable issues and rule-level false positives, which blocked deterministic risk reporting and patch planning.
- **13:40** TypeDB ontology assets had contract drift after latest Voice/OperOps/Codex changes: task lineage/deferred-review fields were missing in schema/mapping, task runtime-tag diagnostics were absent, and validation tooling had non-compilable anchor checks in TypeDB 3 (`copilot-gym6.*` wave).
- **13:40** `ontology:typedb:ingest:dry` in dev could fail even with reachable Mongo host because replica-set responses contained internal hostnames not resolvable from this runtime; operator runbook lacked an explicit `directConnection=true` workaround.
- **10:52** `session_ready_to_summarize` automation still depended on manual host triage when summarize MCP prerequisites (`fs/tg-ro/call/seq/tm/tgbot`) drifted into inactive `mcp@` units or endpoint `502` states; there was no repo-owned watchdog with safe dry-run diagnostics (`copilot-lo1c`).
- **09:42** `POST /voicebot/create_tickets` still had edge paths where Codex-intended rows (`codex-system`, Codex-labeled performer payloads) could be rejected as malformed performer IDs before Codex routing, which risked inconsistent bd-only behavior (`copilot-g0bd`).
- **09:42** End-to-end validation for `copilot-ib30` revealed a runtime blocker: Voice UI could not activate page session (`POST /api/voicebot/activate_session` -> `ERR_EMPTY_RESPONSE`), preventing screenshot paste flow verification from the browser.
- **09:10** Production `POST /api/crm/codex/issue` and `POST /api/crm/codex/issues` could fail with `502` when `bd --no-daemon` returned `Database out of sync with JSONL`, so valid Codex issues were unavailable until manual CLI sync (`copilot-f7w7` follow-up).
- **09:04** OperOps Codex issue page could fail with `Не удалось загрузить задачу из BD/Codex` for valid IDs like `copilot-ib30` because frontend parsing expected a narrow response envelope while backend/route variants returned object/array wrappers (`copilot-f7w7`).
- **09:04** Voice session Codex task rows rendered an unintended one-character-width text artifact (`Открыть задачу в OperOps`) between Issue and Title, which degraded table readability (`copilot-oh19`).
- **07:10** Voice session tabs used different source-matching logic across OperOps and Voice views, so tasks linked from TaskPage `Source` could disappear in Voice `Задачи`/`Codex` tabs for the same session (`copilot-ztlv.7`, `copilot-ztlv.27`).
- **07:10** Telegram `@task` flow preserved attachment URLs inconsistently in created Codex tasks (public and reverse links were not normalized into a single payload contract), which reduced traceability from backlog task back to original message attachment (`copilot-ztlv.13`).
- **07:10** OperOps metadata resolvers still had edge-case gaps (duplicate short links, non-string project fallback, creator/source fallbacks), which complicated incident triage for cards opened from Kanban (`copilot-ztlv.3`, `copilot-ztlv.4`, `copilot-ztlv.5`, `copilot-ztlv.6`).
- **06:21** Short-link IDs were not telegra-like and not uniformly generated across all task create-paths: some flows still emitted ad-hoc IDs, while readability/consistency requirements expected slug-based links like `ping-02-28`.
- **06:12** Voice possible-task creation could fail with `No valid tasks to create tickets` when `performer_id` was empty, legacy synthetic (`codex-system`), or otherwise non-ObjectId; frontend only showed a generic error and did not identify which row must be fixed.
- **02:37** Performer lifecycle filtering was inconsistent across Voice/CRM selectors (`is_deleted`, `is_active`, legacy `active`), so inactive historical performers could disappear from edit flows while still being referenced in saved tasks.
- **02:37** Codex assignment had no hard project readiness guard, which allowed creating Codex tickets for projects without `git_repo` and broke downstream repo-linked automation assumptions.
- **02:37** Telegram `@task` ingest path attached payloads to sessions but did not guarantee Codex task creation from the same normalized payload, creating mismatch between voice evidence and OperOps backlog entries.
- **02:37** Performer dropdown in Voice possible tasks had limited popup height and required excessive scrolling when active performer count was high.
- **01:49** Categorization table still rendered `Src` and `Quick Summary` columns, which duplicated low-value metadata and reduced usable width for primary categorization content.
- **01:25** Performer selectors lacked system assignee `Codex`, which blocked assignment workflows that depend on explicit Codex performer visibility.
- **01:21** `/voice/session/:id` UI treated any `404` from `sessions/get` as runtime mismatch, masking true missing-session incidents and producing false diagnostics.
- **01:16** OperOps task card did not provide source traceability (voice/telegram/manual), forcing operators to inspect raw task payloads to locate original conversation context.
- **01:11** OperOps task card metadata did not expose who created the task, so operators had to inspect raw payloads/logs to identify task origin.
- **01:05** OperOps short-link behavior (generation, collision handling, lookup order) was implemented in code but not documented as a single operator/developer contract, which made incident triage and future integrations error-prone.

### FEATURE IMPLEMENTED
- **19:10** Decomposed `copilot-sxq1.14.8` into six independent remediation tracks to remove single-runner dependency and enable isolated execution by scope:
  - `copilot-sxq1.14.8.1` (`app/src/store/**`)
  - `copilot-sxq1.14.8.2` (`app/src/hooks/**`)
  - `copilot-sxq1.14.8.3` (`app/src/services/**`)
  - `copilot-sxq1.14.8.4` (`app/src/utils/**`)
  - `copilot-sxq1.14.8.5` (`app/src/types/**`)
  - `copilot-sxq1.14.8.6` (`app/src/constants/**`)
- **19:10** Completed close-session validation loop for the reorganized test pipeline with explicit rerun policy (targeted shard rerun + final `full --fail-fast`) and refreshed `desloppify next` triage output for follow-up execution.
- **18:18** Completed and closed test-pipeline epic `copilot-2gs1`:
  - implemented stage-based parallel runner in `scripts/run-test-suite.sh`,
  - introduced explicit backend split (`parallel-safe` + `serialized`) and bounded frontend/backend Jest worker strategy,
  - introduced shard-based Playwright execution for app non-voice e2e and dedicated voice e2e shards,
  - published benchmark history and operational defaults in testing documentation.
- **17:18** Completed closeout validation for current wave (`copilot-sxq1.8`): updated frontend/backend contract tests to match extracted helper boundaries (`voicebotHttp`, `voicebotRuntimeConfig`, `codexTaskTimeline`) and ESM-safe backend test runtime (`@jest/globals` `jest` import, `import.meta.url` path resolution).
- **14:12** Implemented shared Codex details presentation between OperOps and Voice:
  - introduced reusable `CodexIssueDetailsCard` and switched both OperOps Codex task page and Voice inline drawer to the same component;
  - expanded Voice secondary drawer width so the card is displayed at near full-size with side paddings.
- **13:52** Completed and closed `copilot-y9qy` end-to-end:
  - removed Tier-1 tagged debug logs in frontend/backend scripts (`y9qy.1-.8`);
  - unified exact-duplicate helper clusters in frontend, CRM/miniapp backend, and voice workers (`y9qy.9-.18`);
  - executed full final test gate (`y9qy.19`) with all suites green.
- **13:52** Completed and closed `copilot-6obm` security wave (`copilot-6obm.1`):
  - fixed high/medium findings for XSS rendering, sensitive logging, insecure randomness, and unguarded JSON parsing;
  - recorded explicit accepted-risk set (`6` scanner false positives / non-exploitable signals) and synced operator-facing scanner notes in `README.md`.
- **13:40** Completed ontology sync wave `copilot-gym6.1`..`copilot-gym6.5`:
  - added runtime gap baseline document (`ontology/typedb/docs/runtime_contract_gap_matrix_v1.md`),
  - expanded TypeDB schema/mapping for Codex/task runtime contracts (`git_repo`, task source lineage, deferred review fields, task runtime tags),
  - added `voice_session_sources_oper_task` relation and mapping linkage via `automation_tasks.source_ref`,
  - refreshed query-pack and Python validator with OperTask/Codex quality gates and TypeDB-3-safe anchor diagnostics.
- **13:40** Executed verification cycle for ontology tooling:
  - `npm run ontology:typedb:py:setup` passed,
  - `npm run ontology:typedb:ingest:dry` passed with explicit `MONGODB_CONNECTION_STRING` including `directConnection=true`,
  - `npm run ontology:typedb:ingest:apply -- --init-schema ...` used to resync local schema,
  - `npm run ontology:typedb:validate` passed (expected WARN counters preserved).
- **10:52** Added summarize MCP dependency watchdog for `session_ready_to_summarize`: typed service + CLI script now checks endpoint/service pairs, emits structured diagnostics, supports dry-run by default, and auto-heals only failed `mcp@` units in apply mode (`copilot-lo1c`).
- **09:42** Hardened Codex routing guard in `create_tickets`: Codex classification now runs before strict performer ObjectId validation, includes text-identity heuristics (`name/real_name/full_name/username/email/corporate_email`), and treats `codex_task=true` as Codex-safe bd-only path (`copilot-g0bd`).
- **09:42** Executed multi-agent wave processing for top-priority open/in-progress `bd` IDs and persisted verification findings into issue notes without unapproved code changes; closed placeholder/no-op `copilot-603`.
- **09:10** Added backend auto-recovery for Codex `bd` calls: when out-of-sync JSONL state is detected, route now runs `bd sync --import-only` and retries `bd list/show` once before returning failure.
- **09:04** Added resilient Codex issue page payload normalization: frontend now accepts direct issue objects plus wrapped payload variants (`issue`, `data`, array) and sends both `id` and `issue_id` for backward-compatible route contracts (`copilot-f7w7`).
- **09:04** Reworked Voice Codex row action rendering to icon+tooltip behavior so navigation remains available without inline stray text in the content flow (`copilot-oh19`).
- **07:10** Unified session-source matching via shared canonical matcher (`source_ref`, `external_ref`, `source_data.session_id`, `source_data.session_db_id`, canonical `/voice/session/:id` URL parsing) and reused it across Voice tabs and CRM Kanban filtering (`copilot-ztlv.7`, `copilot-ztlv.27`).
- **07:10** Enriched `@task` attachment contract with normalized `public_url` + reverse attachment links and persisted mirrored attachment payload in created Codex task `source_data` (`copilot-ztlv.13`).
- **07:10** Hardened OperOps card/short-link contracts: deterministic route-id selection, explicit duplicate-public-id handling, stronger creator/source/project fallback chains, and updated contract docs/tests (`copilot-ztlv.3`, `copilot-ztlv.4`, `copilot-ztlv.5`, `copilot-ztlv.6`).
- **06:21** Unified task public-id generation to telegra-like slug format with date suffix (`<slug>-MM-DD`) and enabled the same generator across CRM create, Voice `create_tickets`, Telegram `@task` ingress, and voice `Codex/Кодекс` trigger paths.
- **06:12** Canonicalized Codex performer identity in selectors to real Mongo `_id=69a2561d642f3a032ad88e7a`, and added backend/frontend row-level validation plumbing so invalid `performer_id` errors are returned and rendered per task row.
- **02:37** Canonicalized performer lifecycle contract around `is_deleted` with compatibility for legacy `is_active/active` flags and explicit historical-performer passthrough (`include_ids`) for selector edit safety.
- **02:37** Added project `git_repo` surface area (project CRUD/types/listing) and enforced Codex ticket guard: Codex performer assignment now requires non-empty project `git_repo`.
- **02:37** Extended Telegram `@task` ingress to create Codex tasks from the same normalized payload persisted to `processors_data.CODEX_TASKS.data`, with non-blocking ingest behavior and regression coverage.
- **02:37** Increased Voice possible-task performer popup height with responsive desktop/mobile values to improve dense selector usability without mobile layout regression.
- **01:49** Removed `Src` and `Quick Summary` columns from Categorization table layout, leaving status + sorted categorization content as the canonical view for this phase.
- **01:25** Added synthetic system performer `Codex` to assignment selector datasets (CRM + Voice possible tasks) with deduplication guard.
- **01:21** Added explicit `404` vs `409 runtime_mismatch` contract for `sessions/get` and aligned SessionPage/store diagnostics so runtime mismatch is shown only for `409`.
- **01:16** Added TaskPage source metadata block with canonical source-kind resolution and new-tab external links for voice sessions and telegram references, including robust fallbacks for legacy payload shapes.
- **01:11** Added explicit `Created by` metadata block in TaskPage with canonical creator-name resolution (`created_by_name` -> creator object labels -> performer lookup by `created_by` identity -> raw value -> `N/A`).
- **01:05** Added canonical short-link contract documentation for OperOps tasks, including public-id generation rules, collision suffix policy, deterministic lookup order, operator runbook, and developer checklist for new task-creation entry points.

### CHANGES
- **19:10** Close-session validation and triage updates:
  - `make test` confirmed absent (`No rule to make target 'test'`), so canonical runner remained `./scripts/run-test-suite.sh`.
  - reran flaky shard directly: `cd app && npm run test:e2e:voice:shard:1of2` -> pass (`13/13`).
  - reran canonical suite: `./scripts/run-test-suite.sh full --fail-fast` -> `10/10 PASS`.
  - refreshed triage pointer: `desloppify next` now reports top item `review::.::holistic::abstraction_fitness::overuse_unknown_in_core_contracts::5ff2ecc1` (Tier 1).
- **19:10** Updated `bd` tracking for `copilot-sxq1.14.8`:
  - appended execution note with quota blocker details and post-test gate status,
  - created six child issues as independent scope slices (`copilot-sxq1.14.8.1`..`.6`) with per-scope acceptance criteria.
- **18:18** Test platform/runtime contract updates:
  - `scripts/run-test-suite.sh`: stage-aware parallel execution with per-job logs, stage summaries, and fail-fast stage abort behavior.
  - `platforms.json`: explicit stage metadata, backend split jobs (`backend-unit-parallel` + `backend-unit-serial`), app e2e shard jobs, and voice e2e shard jobs.
  - `app/package.json`, `miniapp/package.json`: default Jest worker mode (`--maxWorkers=${JEST_MAX_WORKERS:-50%}`) and serial override scripts.
  - `backend/package.json`: split test commands (`test:parallel-safe`, `test:serialized`) and composed default `test` command.
  - `docs/TESTING_PROCEDURE.md`, `README.md`, `AGENTS.md`: synchronized canonical testing contract, worker knobs, shard model, benchmark table, and recommended local/CI defaults.
- **18:18** Final benchmark for `./scripts/run-test-suite.sh full` after stage 8:
  - baseline: `163.97s`;
  - final: `80.01s`;
  - improvement: `+51.20%` wall-clock with stable `163` suites (`641` executed tests after removing duplicate voice execution in non-voice app shards).
- **17:18** Test contract/runtime sync updates:
  - frontend contracts updated for refactored Voice store and sanitized task description rendering:
    - `app/__tests__/voice/{voiceImageAnchorGroupingContract,voiceSocketRealtimeContract,meetingCardSummarizeAndIconContract,accessUsersPerformerLifecycleContract,activateSessionResilienceContract,sessionPageRequestDiagnostics}.test.ts`
    - `app/__tests__/operops/taskPageDescriptionSanitizeContract.test.ts`
  - backend contracts/runtime tests updated for current Codex/voice route implementations and ESM execution:
    - `backend/__tests__/api/crmCodexRouteContract.test.ts`
    - `backend/__tests__/voicebot/rowMaterialTargetRouteContract.test.ts`
    - `backend/__tests__/voicebot/runtime/sessionUtilityRuntimeBehavior.validation.test.ts`
    - `backend/__tests__/entrypoints/orphanedEntrypointsContract.test.ts`.
- **17:18** Validation run:
  - `make test` -> `No rule to make target 'test'`;
  - `./scripts/run-test-suite.sh full` -> `10/10 PASS`;
  - type-safety gates passed: `cd app && npm run build`, `cd backend && npm run build`.
- **17:18** `desloppify next` current top open item (Tier 2): exact duplicate `renderSanitizedHtml` between `app/src/pages/operops/TaskPage.tsx` and `miniapp/src/components/OneTicket.tsx` (`dupes::app/src/pages/operops/TaskPage.tsx::renderSanitizedHtml::miniapp/src/components/OneTicket.tsx::renderSanitizedHtml`).
- **14:12** UI parity + contract test sync for `copilot-4o2c`:
  - added `app/src/components/codex/CodexIssueDetailsCard.tsx`;
  - updated `app/src/components/codex/CodexIssuesTable.tsx` to render shared card in drawer and set width `min(1180px, calc(100vw - 48px))`;
  - updated `app/src/pages/operops/CodexTaskPage.tsx` to reuse shared card;
  - updated contract tests: `app/__tests__/voice/codexTasksInlineDetailsContract.test.ts`, `app/__tests__/operops/codexTaskPageContract.test.ts`;
  - verification: `cd app && npm run build`; `cd app && npm run test -- __tests__/voice/codexTasksInlineDetailsContract.test.ts __tests__/operops/codexTaskPageContract.test.ts __tests__/operops/codexIssuesTableContract.test.ts`.
- **13:52** `copilot-y9qy` implementation set:
  - frontend dedupe helpers: `app/src/utils/{performerLifecycle.ts,voiceFabSync.ts,pinnedMonths.ts}`;
  - backend shared helpers: `backend/src/utils/crmMiniappShared.ts`;
  - voice worker shared helpers: `backend/src/workers/voicebot/handlers/{messageProcessors.ts,openAiErrors.ts}` and `customPromptsDir.ts` processor-name listing helper;
  - removed tagged log noise from target files in app hooks/services/stores and backend scripts;
  - added/updated regression tests in `app/__tests__` and `backend/__tests__` for new shared contracts.
- **13:52** `copilot-6obm` security hardening:
  - stricter sanitized HTML rendering paths in `app/src/pages/operops/TaskPage.tsx` and `miniapp/src/components/OneTicket.tsx` with new sanitizer contract tests;
  - auth/log redaction and safe diagnostics in `backend/src/api/routes/auth.ts`, `backend/src/api/routes/voicebot/sessions.ts`, and `backend/src/miniapp/routes/index.ts`;
  - crypto-safe MCP session id generation in `backend/src/services/mcp/sessionManager.ts`;
  - guarded JSON credential/config parsing in `backend/src/services/{google/sheets.ts,reports/googleDrive.ts}` and `backend/src/workers/voicebot/handlers/notify.ts`.
- **13:52** Validation and closeout evidence:
  - type gates passed: `app`, `miniapp`, `backend` builds;
  - full Jest pass: `app` `61/61` suites (`156/156` tests), `backend` `78/78` suites (`387/387` tests), total `139/139` suites and `543/543` tests;
  - updated `README.md` with dedicated `Desloppify` section documenting `Accepted risk / false-positive: 6`.
- **13:40** Ontology runtime-parity implementation (`copilot-gym6.*`):
  - Added docs baseline and rollout linkage:
    - `ontology/typedb/docs/runtime_contract_gap_matrix_v1.md`
    - `ontology/typedb/docs/rollout_plan_v1.md`
  - Updated schema contract:
    - `ontology/typedb/schema/str_opsportal_v1.tql` (`project.git_repo`, expanded `oper_task` Codex/runtime attributes, relation `voice_session_sources_oper_task`).
  - Updated mapping contract:
    - `ontology/typedb/mappings/mongodb_to_typedb_v1.yaml` (project `git_repo`, expanded `automation_tasks` fields, session-task relation mapping).
  - Updated validation artifacts:
    - `ontology/typedb/queries/validation_v1.tql` (task/codex gates),
    - `ontology/typedb/scripts/typedb-ontology-validate.py` (added aggregate checks, fixed anchor checks).
  - Updated ingestion behavior:
    - `ontology/typedb/scripts/typedb-ontology-ingest.py` now ingests `automation_tasks` via mapping-driven path.
  - Updated operator docs/runbook:
    - `ontology/README.md`, `ontology/AGENTS.md`, `ontology/typedb/README.md`, `ontology/typedb/AGENTS.md`.
- **10:52** Summarize MCP watchdog rollout (`copilot-lo1c`):
  - Added typed backend service `backend/src/services/summarizeMcpWatchdog.ts` with canonical dependency map (`fs`, `tg-ro`, `call`, `seq`, `tm`, `tgbot`), per-dependency health snapshots, remediation planner (`start` inactive / `restart` endpoint-failed), and structured result summary.
  - Added operational CLI wrapper `backend/scripts/summarize-mcp-watchdog.ts` with dry-run default, `--apply`, `--json`, `--jsonl`, timeout flags, and non-zero exit on unresolved unhealthy dependencies.
  - Added npm commands in `backend/package.json`: `voice:summarize-mcp-watchdog:dry` and `voice:summarize-mcp-watchdog:apply`.
  - Added regression tests `backend/__tests__/services/summarizeMcpWatchdog.test.ts` for targeted restart/start behavior and safe handling of service-check diagnostics.
  - Updated operational docs/contracts in `README.md` and `AGENTS.md` for watchdog usage and remediation semantics.
- **09:42** Codex performer routing hardening (`copilot-g0bd`):
  - Updated `backend/src/api/routes/voicebot/sessions.ts`:
    - added Codex text-key detection (`name`, `real_name`, `full_name`, `username`, `email`, `corporate_email`),
    - moved Codex classification ahead of strict ObjectId guard,
    - ensured alias IDs like `codex-system` route to bd sync without performer lookup/Mongo insert,
    - fail-closed unresolved non-Codex rows before `insertMany`.
  - Updated regression suite `backend/__tests__/voicebot/sessionUtilityRuntimeBehavior.test.ts` with alias/name-based Codex routing cases.
- **09:42** Swarm execution status updates:
  - Closed: `copilot-g0bd`, `copilot-603`.
  - Verified and documented (kept open per audit-only contract): `copilot-ztlv`, `copilot-ztlv.12`, `copilot-ztlv.15`, `copilot-ztlv.16`, `copilot-ztlv.17`, `copilot-ztlv.18`, `copilot-ztlv.19`, `copilot-ztlv.20`, `copilot-ztlv.21`, `copilot-ztlv.22`, `copilot-ztlv.23`, `copilot-ztlv.24`, `copilot-ztlv.25`, `copilot-ib30`.
- **09:10** Codex backend resilience hotfix:
  - Updated `backend/src/api/routes/crm/codex.ts` with out-of-sync detector, `bd sync --import-only` recovery path, and one-shot retry wrapper for `bd list/show`.
  - Updated contract guard in `backend/__tests__/api/crmCodexRouteContract.test.ts`.
- **09:04** Codex page loading/parsing hardening (`copilot-f7w7`):
  - Updated `app/src/pages/operops/CodexTaskPage.tsx` with broad payload parser support and dual request key contract (`id` + `issue_id`).
  - Added regression contract `app/__tests__/operops/codexTaskPageContract.test.ts`.
- **09:04** Voice Codex row artifact removal (`copilot-oh19`):
  - Updated `app/src/components/codex/CodexIssuesTable.tsx` and `app/src/components/voice/CodexTasks.tsx` to remove visible inline CTA artifact while preserving OperOps navigation action.
  - Updated regression contract `app/__tests__/voice/sessionCodexTasksFilterOrderContract.test.ts`.
- **07:10** Voice Tasks/Codex source-filter parity (`copilot-ztlv.7`, `copilot-ztlv.27`):
  - Added shared matcher utility `app/src/utils/voiceSessionTaskSource.ts`.
  - Reused matcher in `app/src/components/crm/CRMKanban.tsx`, `app/src/pages/voice/SessionPage.tsx`, and `app/src/store/voiceBotStore.ts` for OperOps/Voice tabs.
  - Added regression coverage:
    - `app/__tests__/voice/sessionTaskSourceFilterBehavior.test.ts`,
    - `app/__tests__/voice/sessionTaskSourceFilterIssueCopilotZtlv27.test.ts`,
    - `app/__tests__/voice/sessionPageOperOpsTasksTabContract.test.ts`,
    - `app/__tests__/voice/operopsTasksSourceFilterContract.test.ts`,
    - `app/__tests__/voice/sessionCodexTasksFilterOrderContract.test.ts`.
- **07:10** Telegram `@task` attachment traceability (`copilot-ztlv.13`):
  - `backend/src/voicebot_tgbot/ingressHandlers.ts`: attachment payload now includes normalized `public_url`, `reverse_uri`, `reverse_url`, `attachment_index`; task description appends both public + reverse links; `source_data.attachments` persisted alongside payload.
  - Added backend regression coverage in `backend/__tests__/voicebot/tgIngressHandlers.test.ts` for `@task + image` payload path.
- **07:10** OperOps metadata/short-link hardening (`copilot-ztlv.3`, `copilot-ztlv.4`, `copilot-ztlv.5`, `copilot-ztlv.6`):
  - `app/src/components/crm/CRMKanban.tsx`: deterministic `_id`-first route resolution and duplicate short-link guard for eye-link navigation.
  - `app/src/pages/operops/taskPageUtils.ts` + `TaskPage.tsx`: stronger `Created by` / `Source` / `Project` fallbacks and consistent new-tab source links.
  - `docs/OPEROPS_TASK_SHORT_LINKS.md` updated with explicit collision/runbook contract.
  - Added/updated tests:
    - `app/__tests__/operops/taskPageCanonicalTaskIdContract.test.ts`,
    - `app/__tests__/operops/taskPageProjectNameContract.test.ts`,
    - `app/__tests__/operops/taskPageCreatorContract.test.ts`,
    - `app/__tests__/operops/taskPageSourceContract.test.ts`,
    - `app/__tests__/operops/taskShortLinkRouteContract.test.ts`,
    - `backend/__tests__/services/taskPublicId.test.ts`.
- **06:21** Telegra-style short-link rollout (`copilot-br5s`):
  - `backend/src/services/taskPublicId.ts`: replaced simple slash-normalization with canonical slug builder (lowercase, transliteration, separator normalization) and date suffix (`MM-DD`) strategy; kept deterministic collision policy (`-2`, `-3`, ... + UUID fallback).
  - `backend/src/api/routes/crm/tickets.ts`, `backend/src/api/routes/voicebot/sessions.ts`: creation paths now pass task title as fallback seed to produce readable links when incoming IDs are generic.
  - `backend/src/voicebot_tgbot/ingressHandlers.ts`, `backend/src/workers/voicebot/handlers/transcribe.ts`: replaced ad-hoc `codex-<oid>` task IDs with canonical `ensureUniqueTaskPublicId(...)`.
  - Updated contract tests:
    - `backend/__tests__/services/taskPublicId.test.ts`,
    - `backend/__tests__/voicebot/tgIngressHandlers.test.ts`,
    - `backend/__tests__/voicebot/workerTranscribeHandler.test.ts`.
  - Updated short-link spec doc: `docs/OPEROPS_TASK_SHORT_LINKS.md`.
- **06:12** Voice task creation performer-id hardening (`copilot-ztlv.8`):
  - `app/src/utils/codexPerformer.ts`: switched Codex constant to canonical ObjectId and normalize legacy `codex-system` records to canonical id for selector payloads.
  - `backend/src/api/routes/voicebot/sessions.ts` (`POST /voicebot/create_tickets`): collect row-level `performer_id` rejections (`missing_performer_id`, `invalid_performer_id`, `performer_not_found`) and return them via `invalid_rows`/`rejected_rows` while preserving existing error text contract.
  - `app/src/utils/voiceTaskCreation.ts`, `app/src/store/voiceBotStore.ts`, `app/src/components/voice/PossibleTasks.tsx`: parse backend row errors and render actionable per-row performer validation messages in UI.
  - Added/updated regression tests:
    - `backend/__tests__/voicebot/sessionUtilityRuntimeBehavior.test.ts`,
    - `app/__tests__/voice/voiceTaskCreationErrorParser.test.ts`,
    - `app/__tests__/voice/possibleTasksBackendValidationContract.test.ts`,
    - `app/__tests__/voice/possibleTasksDesignContract.test.ts`,
    - `app/__tests__/operops/codexPerformerSelectorsContract.test.ts`.
- **02:37** Performer lifecycle canonicalization (`copilot-b1k5`):
  - Added backend lifecycle filter helper `backend/src/services/performerLifecycle.ts` and frontend selector helper `app/src/utils/performerLifecycle.ts`.
  - Updated selector-producing routes and consumers:
    - `backend/src/api/routes/voicebot/sessions.ts` (`/auth/list-users` with `include_ids` support),
    - `backend/src/api/routes/voicebot/persons.ts`,
    - `backend/src/api/routes/crm/dictionary.ts`,
    - `app/src/store/voiceBotStore.ts`,
    - `app/src/components/voice/PossibleTasks.tsx`,
    - `app/src/components/voice/AccessUsersModal.tsx`.
  - Added regression tests:
    - `backend/__tests__/voicebot/personsListPerformersRoute.test.ts`,
    - `backend/__tests__/api/crmDictionaryPerformerLifecycleContract.test.ts`,
    - `app/__tests__/voice/possibleTasksPerformerLifecycleContract.test.ts`,
    - `app/__tests__/voice/accessUsersPerformerLifecycleContract.test.ts`.
- **02:37** Project `git_repo` + Codex assignment guard (`copilot-s33e`):
  - Extended project contracts/types/forms:
    - `backend/src/api/routes/crm/projects.ts`,
    - `backend/src/permissions/permission-manager.ts` (project projection includes `git_repo`),
    - `app/src/types/crm.ts`,
    - `app/src/types/voice.ts`,
    - `app/src/components/crm/projects/EditProject.tsx`,
    - `backend/src/api/routes/voicebot/sessions.ts` (`/projects` projection includes `git_repo`).
  - Added Codex ticket creation guard in `POST /voicebot/create_tickets` (`backend/src/api/routes/voicebot/sessions.ts`): returns `400 Codex assignment requires project git_repo` when project repo is missing.
  - Added/updated tests:
    - `backend/__tests__/voicebot/projectsRouteParity.test.ts`,
    - `backend/__tests__/voicebot/sessionUtilityRuntimeBehavior.test.ts`.
- **02:37** Telegram `@task` -> Codex task parity (`copilot-xuec`):
  - `backend/src/voicebot_tgbot/ingressHandlers.ts` now persists normalized `@task` payload to session and creates Codex task from the same payload contract.
  - Added regression coverage: `backend/__tests__/voicebot/tgIngressHandlers.test.ts`.
- **02:37** Performer popup height usability (`copilot-u976`):
  - `app/src/components/voice/PossibleTasks.tsx` now uses responsive popup heights (`desktop: 520`, `mobile: 320`) via `listHeight`.
  - Updated regression contract: `app/__tests__/voice/possibleTasksDesignContract.test.ts`.
- **01:49** Categorization column contract update (`copilot-eejo`):
  - `app/src/components/voice/Categorization.tsx`: removed `Src` header/body cell rendering and removed `Quick Summary` header/body summary column rendering.
  - Added regression coverage `app/__tests__/voice/categorizationColumnsContract.test.ts` to lock absence of both removed columns.
- **01:25** Codex performer selector support:
  - Added `app/src/utils/codexPerformer.ts` (`ensureCodexPerformerForKanban`, `ensureCodexPerformerRecords`).
  - `app/src/store/kanbanStore.ts`: dictionary performers now pass through Codex injection helper before writing to store.
  - `app/src/store/voiceBotStore.ts`: `fetchPerformersForTasksList` now injects Codex into performer options payload.
  - Added regression coverage: `app/__tests__/operops/codexPerformerSelectorsContract.test.ts`.
- **01:21** Session get/runtime mismatch diagnostics:
  - `backend/src/api/routes/voicebot/sessions.ts`: `resolveSessionAccess` now checks raw DB when runtime-scoped lookup misses and returns `runtime_mismatch` signal for out-of-scope sessions.
  - `backend/src/api/routes/voicebot/sessions.ts`: `POST /voicebot/session` (`/sessions/get` alias) now returns `409 { error: 'runtime_mismatch' }` for runtime-only misses, keeps `404 Session not found` for true absence.
  - `app/src/pages/voice/SessionPage.tsx`: maps `409` to mismatch message and `404` to `Сессия не найдена`.
  - `app/src/store/voiceBotStore.ts`: request diagnostics now flag runtime mismatch for `409`/`error=runtime_mismatch` instead of `404`.
  - Updated tests:
    - `backend/__tests__/voicebot/sessionsRuntimeCompatibilityRoute.test.ts`
    - `app/__tests__/voice/sessionPageRequestDiagnostics.test.ts`
- **01:16** Task source traceability in OperOps card:
  - Added `resolveTaskSourceInfo(...)` and source parsing/link helpers in `app/src/pages/operops/taskPageUtils.ts`.
  - Updated `app/src/pages/operops/TaskPage.tsx` with dedicated `Source` metadata block and external link opening in a new tab.
  - Extended ticket contract in `app/src/types/crm.ts` with source fields (`source/source_data/source_kind/source_ref/external_ref`).
  - Added regression coverage: `app/__tests__/operops/taskPageSourceContract.test.ts`.
- **01:11** OperOps task creator metadata:
  - Added `resolveTaskCreator(...)` in `app/src/pages/operops/taskPageUtils.ts`.
  - Updated `app/src/pages/operops/TaskPage.tsx` to render `Created by` via canonical resolver.
  - Extended ticket type contract in `app/src/types/crm.ts` with optional creator fields.
  - Added regression coverage: `app/__tests__/operops/taskPageCreatorContract.test.ts`.
  - Persisted creator metadata on new task creation paths:
    - `backend/src/api/routes/crm/tickets.ts` (`created_by` / `created_by_name` from request actor when available),
    - `backend/src/api/routes/voicebot/sessions.ts` (`create_tickets` writes creator metadata from current performer).
- **01:05** Added `docs/OPEROPS_TASK_SHORT_LINKS.md` as the canonical short-link contract reference.
- **01:05** Updated `README.md` (OperOps/CRM notes) with direct link to the new short-link contract doc.

## 2026-02-27
### PROBLEM SOLVED
- **00:58** Categorization rows could surface missing or inconsistent time ranges (`start/end` empty strings, raw seconds without canonical formatting), causing invalid timeline labels in affected session chunks like `002-1.webm` and `009-*`.
- **00:47** OperOps task card could show `Project: N/A` while Kanban list displayed a valid project, because card rendering only used `task.project` and ignored `project_data`/`project_id` lookup sources.
- **00:41** OperOps task short links could collide because list/card links were opened by public `id` first while create flows accepted duplicate public IDs, causing ambiguous card resolution for repeated IDs like `task-1`.
- **23:59** OperOps task page header did not expose the canonical, copyable `Task ID` as the first metadata block, which made quick investigation/debug handoffs slower.
- **20:26** Voice session list behavior stayed inconsistent after repeated opens: stale list cache could survive between page visits, and filter state (including deleted-mode) was not fully persistent across navigation.
- **20:26** Session-list visual status used mixed legacy markers (including noisy red-dot semantics), which made quick status scanning harder and did not match the session-page state model.
- **20:26** Operators had no backend-native way to merge duplicate/fragmented voice sessions into one target session with explicit confirmation and audit payload.
- **20:26** TS transcribe handler still depended on pre-downloaded local file paths for Telegram audio in some cases; missing local transport path could leave messages without transcription progress.
- **20:26** Current Voice↔OperOps↔Codex taskflow requirements were distributed across chat context without a single agreed planning artifact for upcoming implementation waves.
- **21:58** ERD and TypeDB tooling artifacts were split across `plan/` and `backend/scripts`, which fragmented ownership and caused path drift in docs/commands.
- **21:58** Backend ontology npm scripts referenced legacy backend-local script paths and requirements file, creating migration risk after repository structure cleanup.
- **22:00** Backend TypeDB script locations were physically moved to `ontology/typedb/scripts`, so leaving old `backend/scripts` copies would now be stale and could cause accidental script drift.

### FEATURE IMPLEMENTED
- **00:58** Added dual-path timestamp normalization for categorization:
  - worker write-path now canonicalizes `start/end` to stable `MM:SS`/`HH:MM:SS` labels with non-empty fallback (`00:00`);
  - frontend read/render path now normalizes legacy/invalid ranges and renders timeline labels from normalized seconds.
- **00:47** Unified task-card project rendering with Kanban fallback chain: `project_data` name -> dictionary lookup by `project_id`/`project` -> direct `project` -> `N/A`.
- **00:41** Added deterministic short-link collision handling: Kanban task preview links now route by `_id` first, task creation reserves unique public ids with numeric suffix fallback, and `tickets/get-by-id` resolves ObjectId first with deterministic fallback ordering.
- **23:59** Added canonical Task ID rendering for OperOps task card header with copy action and deterministic resolver fallback (`id` -> route `taskId` -> `_id`).
- **20:26** Added persistent sessions-list UX model with tab expansion (`all`, `without_project`, `active`, `mine`), localStorage-backed filter restore, and include-deleted synchronization test coverage.
- **20:26** Added state-pictogram-driven session list rendering aligned to session lifecycle semantics (`recording/cutting/paused/final_uploading/closed/ready/error`) and removed legacy active-dot contract from date cell.
- **20:26** Added backend/API/store scaffolding for session merge workflow with explicit confirmation phrase support and dedicated merge-log collection constants.
- **20:26** Added Telegram transport recovery path in TS transcribe worker: resolve Telegram file metadata, download binary to local storage, persist file path, then continue transcription.
- **20:26** Added unified planning draft for Voice↔OperOps↔Codex taskflow and recorded confirmed defaults for Codex performer, `@task` auto-session behavior, deferred worker model, and tab filtering contracts.
- **21:58** Relocated ERD protocol/draft docs and TypeDB ingestion tooling into canonical ontology structure (`ontology/`, `ontology/typedb/scripts`) and switched backend npm commands to new paths (hard-switch, no wrappers).
- **22:00** Added explicit canonical path migration for TypeDB script assets:
  - deleted backend-local scripts at `backend/requirements-typedb.txt` and `backend/scripts/{run-typedb-python.sh,typedb-ontology-ingest.py,typedb-ontology-validate.py}`;
  - added corresponding files at `ontology/typedb/scripts/requirements-typedb.txt`, `ontology/typedb/scripts/{run-typedb-python.sh,typedb-ontology-ingest.py,typedb-ontology-validate.py}`;
  - moved ERD draft/protocol docs from `plan/` into `ontology/` with updated references in AGENTS/README.

### CHANGES
- **00:58** Categorization timestamp hardening:
  - `backend/src/workers/voicebot/handlers/categorize.ts` now normalizes timeline ranges before persisting categorization rows.
  - `app/src/utils/voiceTimeline.ts` added parse/normalize/format helpers for timeline values.
  - `app/src/store/voiceBotStore.ts` now maps categorization `start/end` through normalized range seconds.
  - `app/src/components/voice/CategorizationTableRow.tsx` now renders formatted timeline labels.
  - Added tests:
    - `app/__tests__/voice/categorizationTimelineNormalization.test.ts`
    - `backend/__tests__/voicebot/workerCategorizeHandler.test.ts` (timestamp normalization assertions).
- **00:47** Task card project-name consistency:
  - extended `app/src/pages/operops/taskPageUtils.ts` with canonical project resolver;
  - updated `app/src/pages/operops/TaskPage.tsx` to render `projectName` from resolver instead of direct `task.project`;
  - added regression coverage in `app/__tests__/operops/taskPageProjectNameContract.test.ts`.
- **00:41** Task short-link collision hardening:
  - Added `backend/src/services/taskPublicId.ts` and wired unique public-id reservation into `backend/src/api/routes/crm/tickets.ts` and `backend/src/api/routes/voicebot/sessions.ts`.
  - Updated `backend/src/api/routes/crm/tickets.ts` `get-by-id` path to resolve `_id` first and apply deterministic latest-first fallback for duplicate public IDs.
  - Updated `app/src/components/crm/CRMKanban.tsx` task-card link generation to `_id || id`.
  - Added regression tests: `backend/__tests__/services/taskPublicId.test.ts`, `app/__tests__/operops/taskShortLinkRouteContract.test.ts`.
- **23:59** OperOps task card ID contract:
  - `app/src/pages/operops/TaskPage.tsx` now renders explicit `Task ID` as the first header block and enables one-click copy.
  - Added resolver utility `app/src/pages/operops/taskPageUtils.ts` to prefer canonical public id before route/db fallbacks.
  - Added regression coverage in `app/__tests__/operops/taskPageCanonicalTaskIdContract.test.ts`.
- **20:26** Voice sessions list/front:
  - `app/src/pages/voice/SessionsListPage.tsx` updated for richer tab/filter model, state pictogram column, and persistence helpers.
  - `app/src/store/voiceBotStore.ts` removed stale list-cache short-circuit and added `mergeSessions(...)`.
  - `app/__tests__/voice/sessionsListIncludeDeletedSyncContract.test.ts` expanded with contracts for cache behavior, sorting, pictograms, and persisted filters.
- **20:26** Session controls / meeting card:
  - `app/src/components/voice/MeetingCard.tsx` added explicit "restart processing" control path wired through store actions.
- **20:26** Backend voice runtime:
  - `backend/src/api/routes/voicebot/sessions.ts` added merge-session schemas/helpers/routes and merge constants.
  - `backend/src/workers/voicebot/handlers/transcribe.ts` added Telegram file transport fallback download flow.
  - `backend/__tests__/voicebot/workerTranscribeHandler.test.ts` added Telegram fallback regression coverage.
- **20:26** Backend infra/runtime:
  - `backend/src/constants.ts`, `backend/src/services/runtimeScope.ts`, `backend/src/services/db.ts` extended with merge-log collection awareness and startup index scaffolding.
  - `backend/src/api/routes/crm/tickets.ts` simplified work-hours lookup matching on canonical `ticket_db_id`.
  - `backend/src/workers/README.md` updated to document Telegram transport recovery behavior.
- **20:26** Repo/planning updates:
  - `.gitignore` now excludes `backend/uploads/`.
  - Added planning artifact: `plan/voice-operops-codex-taskflow-spec.md`.
- **20:26** Build-env note:
  - `app/.env.production` currently includes explicit `VITE_BUILD_MINIFY` and `VITE_BUILD_SOURCEMAP` overrides as part of this checkpoint.
- **21:58** Ontology/ERD relocation:
  - moved `plan/str-opsportal-erd-draft-v0.md` -> `ontology/str-opsportal-erd-draft-v0.md`.
  - moved `plan/fpf-erd-extraction-protocol-str-opsportal.md` -> `ontology/fpf-erd-extraction-protocol-str-opsportal.md`.
  - moved TypeDB tools:
    - `backend/requirements-typedb.txt` -> `ontology/typedb/scripts/requirements-typedb.txt`
    - `backend/scripts/typedb-ontology-ingest.py` -> `ontology/typedb/scripts/typedb-ontology-ingest.py`
    - `backend/scripts/typedb-ontology-validate.py` -> `ontology/typedb/scripts/typedb-ontology-validate.py`
    - `backend/scripts/run-typedb-python.sh` -> `ontology/typedb/scripts/run-typedb-python.sh`
- **21:58** Hard-switch paths:
  - updated `backend/package.json` `ontology:typedb:*` scripts to run from `ontology/typedb/scripts` and use `../ontology/typedb/.venv`.
  - updated default ingest paths in `ontology/typedb/scripts/typedb-ontology-ingest.py` to script-relative schema/deadletter locations.
- **21:58** Documentation sync:
  - updated references in `README.md`, `AGENTS.md`, and `ontology/typedb/README.md` to canonical ontology paths.

## 2026-02-26
### PROBLEM SOLVED
- **12:22** In active recording sessions, Transcription tab could stay visually empty while chunks were already uploaded/queued, because rows without immediate text payload were filtered out from rendering.
- **12:22** Worker-side transcribe updates (success/error/retry) did not always trigger realtime `message_update`, so operators often needed manual refresh to see processing/error states.
- **12:22** Upload incident diagnostics lacked a stable correlation key between browser errors and backend logs, slowing down triage for `Failed to fetch` / transport issues.
- **12:22** Sessions list filters could show raw numeric identities (chat ids) in creator/participant dropdowns, and deleted sessions had no explicit opt-in list mode for operators.
- **12:22** Runtime accumulated stale empty sessions (no linked messages) with no autonomous cleanup path in TS workers.
- **12:39** Production deploy script was blocked by TypeScript compile errors introduced by strict type narrowing in voice/permission helper paths.
- **13:03** Voice Sessions list could remain in the previous `include_deleted` mode when filter intent changed during an in-flight fetch, because the store rejected concurrent list requests even for required mode sync.
- **13:13** FAB `Done` on `/voice/session/:id` could log `action=done` in browser but leave session open (`State: Ready`) when WebRTC socket namespace was resolved from a non-working base URL variant.
- **14:17** Session close initiation still depended on client-to-server Socket.IO `session_done` emits, so browser namespace/path variance could break close requests even when API auth/session state were valid.
- **14:17** Voice Sessions list ordering in UI was not deterministic across mixed timestamp formats (`Date`, seconds, ms, ISO strings), so active/newest conversations could appear below stale rows.
- **16:30** CRM/miniapp/reporting paths still mixed legacy `ticket_id` joins with current task storage, so work-hours could disappear from margins/payments/reports when only `ticket_db_id` was present.
- **16:30** WebRTC close failure diagnostics lacked stable `session_id` in warning payloads, which made FAB `Done` incident triage slower in shared logs.
- **22:01** Local notify hooks in TS worker had no per-run stdout/stderr artifact and no explicit failure event for hook spawn errors, which made post-mortem diagnostics dependent on transient process logs.

### FEATURE IMPLEMENTED
- **12:22** Added realtime-safe transcription visibility: frontend now renders pending/error/audio rows immediately, and worker transcribe flow emits `message_update` across success/failure branches.
- **12:22** Added upload correlation ids end-to-end (`request_id`): browser sends `X-Request-ID`, backend echoes/returns it in success and error payloads, and logs every upload stage with the same id.
- **12:22** Added worker-level empty-session cleanup pipeline: new `CLEANUP_EMPTY_SESSIONS` job + scheduler in TS runner with env-configurable interval/age/batch limits.
- **12:22** Added sessions list UX hardening: `include_deleted` fetch mode + `Показывать удаленные` toggle, and numeric placeholder suppression in creator/participant filters.
- **12:22** Added sessions list bulk delete flow for selected non-deleted rows with confirmation and clear result feedback.
- **12:39** Restored green backend build for deploy path by fixing strict TS typing regressions in voice routes/runtime integration contracts.
- **12:22** Added WebRTC monitor resilience UX: explicit chunk states (`local/uploading/uploaded/upload_failed`) and pending-upload snapshot hint after refresh.
- **13:03** Added forced include-deleted mode synchronization for voice sessions list: the page now detects `showDeletedSessions` vs store-mode mismatch and triggers a forced refetch that can bypass loading lock.
- **13:13** Added resilient `session_done` delivery in WebRTC runtime: namespace base fallback sequence (`origin`, stripped `/api`, full path) plus strict failure handling that keeps session active and surfaces retry instead of false-success reset.
- **14:17** Added canonical REST close path for Voice sessions: `POST /api/voicebot/session_done` (`/close_session` alias) now executes the shared done-flow and emits realtime `session_status`/`session_update` to room subscribers.
- **14:17** Switched all frontend close senders to REST (`voiceBotStore`, WebRTC FAB/page close, yesterday auto-close), keeping websocket as receive-only realtime channel for backend events.
- **14:17** Added deterministic Voice Sessions list sorting by active state, latest voice activity timestamp, and created time with mixed-format timestamp normalization.
- **16:30** Unified work-hours linkage on canonical `ticket_db_id` (`automation_tasks._id`) across CRM finances, performer payments, tickets API, miniapp routes, and week/jira reports.
- **16:30** Added migration utility to backfill missing `ticket_db_id` in historical work-hours rows from legacy `ticket_id`.
- **16:30** Added richer WebRTC REST close warnings with `session_id` for direct browser↔backend correlation.
- **22:01** Added hook-run log persistence for TS notify hooks with configurable log directory (`VOICE_BOT_NOTIFY_HOOKS_LOG_DIR`) and session-log coverage for spawn failures via `notify_hook_failed`.

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
- **13:03** Voice sessions `include_deleted` sync hardening:
  - `app/src/store/voiceBotStore.ts`: `fetchVoiceBotSessionsList` now permits forced refetch while loading (`if (isSessionsListLoading && !force) return;`).
  - `app/src/pages/voice/SessionsListPage.tsx`: computes `shouldForceSyncIncludeDeleted` and passes `force` when URL/user intent differs from loaded store mode.
  - `app/__tests__/voice/sessionsListIncludeDeletedSyncContract.test.ts`: new regression contract for forced-sync and loading-bypass behavior.
- **13:13** WebRTC `Done` close-path hardening:
  - `app/public/webrtc/webrtc-voicebot-lib.js`: added `buildSocketBaseCandidates(...)` + per-candidate `session_done` emit attempts; page/FAB close now treat `sessionDoneBrowser=false` as failure.
  - FAB error path now keeps control in `paused` state with toast `Failed to close session. Retry Done.` and does not clear active-session metadata on failed close.
  - `app/__tests__/voice/webrtcSessionDoneSocketContract.test.ts`: updated contract for fallback namespace attempts and non-silent close failure handling.
  - Verified by full frontend Jest run: `30` suites / `63` tests passed (`npm test -- --runInBand`).
- **14:17** REST-first session close migration:
  - `backend/src/api/routes/voicebot/sessions.ts`: added `POST /session_done` (Zod payload validation, permission/access checks, `completeSessionDoneFlow` execution, realtime `session_status` + `session_update` emit), and aliased `/close_session` to the same handler.
  - `backend/__tests__/voicebot/sessionDoneRoute.test.ts`: new regression coverage for `session_done` success, alias parity, and validation errors.
  - `app/src/store/voiceBotStore.ts`: `finishSession` now calls `voicebot/session_done` via HTTP and preserves optimistic close projection on success.
  - `app/public/webrtc/webrtc-voicebot-lib.js`: removed socket namespace close sender/fallback logic and introduced `closeSessionViaRest(...)` for FAB/page/yesterday close flows.
  - Updated frontend contracts: `app/__tests__/voice/{voiceSocketRealtimeContract,webrtcSessionDoneSocketContract}.test.ts`.
- **14:17** Voice Sessions list ordering hardening:
  - `app/src/pages/voice/SessionsListPage.tsx`: added timestamp normalization helper and stable sort (`is_active` desc, `last_voice_timestamp` desc, `created_at` desc), plus timestamp-safe time range rendering.
- **16:30** CRM/miniapp/reporting canonical ticket linkage:
  - `backend/src/api/routes/crm/{finances,performers-payments,tickets}.ts`
  - `backend/src/miniapp/routes/index.ts`
  - `backend/src/services/reports/{jiraStyleReport,performerWeeksReport}.ts`
  - switched joins/lookups/aggregations from legacy `ticket_id` to canonical `ticket_db_id` (`tasks._id`) with safe ObjectId/string normalization.
- **16:30** Added backfill script:
  - `backend/scripts/backfill-work-hours-ticket-db-id.ts` (`--apply` optional; default dry-run).
- **16:30** WebRTC close diagnostics polish:
  - `app/public/webrtc/webrtc-voicebot-lib.js` now logs `session_id` in `closeSessionViaRest` fail/reject/request warnings.
- **22:01** Notify hooks diagnostics hardening:
  - `backend/src/workers/voicebot/handlers/notify.ts`: per-hook log file creation (`stdout/stderr` redirection), configurable log directory, `log_path` metadata, and `notify_hook_failed` session-log write on spawn error.
  - `backend/__tests__/voicebot/notifyWorkerHooks.test.ts`: asserts hook log creation and detached `stdio` fd wiring.
  - `backend/src/workers/README.md`: documented `VOICE_BOT_NOTIFY_HOOKS_LOG_DIR` and updated notify event list.

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

## 2026-02-21
### PROBLEM SOLVED
- **22:00** Product and architecture research context was fragmented across ad-hoc notes, making follow-up design decisions and closeout reporting inconsistent.

### FEATURE IMPLEMENTED
- **10:49** Added an initial deep-research brief for OSS platform selection for OperOps/FinOps expansion.
- **22:00** Added a synchronized session-closeout update for the same research track to keep handoff continuity.

### CHANGES
- **10:49** Added `plan/deep-research-oss-platforms-operops-finops.report.draft.md`.
- **22:00** Updated session closeout artifacts and synced research references to repository docs.

## 2026-02-22
### PROBLEM SOLVED
- **22:01** STR OpsPortal ERD extraction workflow lacked a single documented protocol and baseline draft for cross-domain alignment.

### FEATURE IMPLEMENTED
- **22:01** Added an ERD extraction protocol and initial consolidated STR OpsPortal ERD draft.

### CHANGES
- **22:01** Added `ontology/fpf-erd-extraction-protocol-str-opsportal.md` and `ontology/str-opsportal-erd-draft-v0.md`.

## 2026-02-24
### PROBLEM SOLVED
- **22:04** Session finalization and idle-session handling were not unified, which caused delayed closure and operational drift for stale active sessions.
- **19:37** TypeDB ingestion scaffolding and voice transcription download flow lacked a canonical path and operator-ready scripts.

### FEATURE IMPLEMENTED
- **12:37** Refactored OperOps projects tree editing and added merge/audit-oriented workflows.
- **19:37** Added voice transcription download route support and TypeDB tooling scaffold.
- **22:04** Centralized done-flow handling and added idle session close tooling.

### CHANGES
- **12:37** Updated CRM/Projects tree modules for modal-first editing and merge/audit readiness.
- **19:37** Added `backend/src/api/routes/voicebot/transcription.ts` download contract coverage and initial `ontology/typedb` tooling hooks.
- **19:49** Added tracked TypeDB model package assets to `ontology/typedb/*`.
- **22:04** Added shared finalize flow integration and `backend/scripts/voicebot-close-inactive-sessions.ts` with dry/apply operational commands.

## 2026-02-25
### PROBLEM SOLVED
- **17:11** Upload outage handling and transcribe transport diagnostics were incomplete for Telegram/media edge cases.
- **22:05** Done-flow UX and performer normalization still had mixed identifier behavior in voice/CRM boundaries.

### FEATURE IMPLEMENTED
- **17:11** Added tighter upload outage handling, tgbot poller lock safety, and improved transcribe transport diagnostics.
- **22:05** Hardened done-flow UX semantics and performer normalization across affected voice/CRM flows.

### CHANGES
- **17:11** Updated voice worker/runtime diagnostics and locking paths for Telegram ingestion/transcription stability.
- **22:05** Updated done-flow and performer mapping logic with focused regression coverage.

## 2026-02-26
### PROBLEM SOLVED
- **12:28** Realtime session updates and cleanup scheduling had race conditions, producing stale session state in UI and workers.
- **13:22** WebRTC FAB `Done` flow was brittle across runtime/socket edge states.
- **14:25** Session close/read behavior and list ordering needed REST-first consistency and runtime-safe semantics.
- **16:34** CRM work-hour linkage and voice close diagnostics needed canonical identifiers for reliable joins and incident triage.
- **22:05** Notify hook parity and diagnostics still required production-grade observability.

### FEATURE IMPLEMENTED
- **00:30** Added notify hooks parity and done-flow notify coverage for TS runtime.
- **12:52** Allowed FAB `Done` from paused flow with deterministic transitions.
- **13:03** Added forced include-deleted synchronization under in-flight load.
- **14:25** Enforced REST-first close flow and hardened voice sessions ordering/runtime mismatch handling.

### CHANGES
- **00:30** Added notify parity coverage and local hook execution support in worker notify pipeline.
- **12:28** Updated worker loop/realtime emission logic and cleanup scheduling safeguards.
- **12:41** Finalized sessions-list operational contracts and unblocked prod build path.
- **13:22** Hardened WebRTC close retries and failure UX handling.
- **14:25** Switched close initiation semantics to REST-first across frontend/backend contracts and tests.
- **16:34** Unified CRM work-hour joins on `ticket_db_id` and expanded voice close diagnostics/logging.
- **22:05** Persisted hook-level notify diagnostics and standardized session-log events.

## 2026-02-27
### PROBLEM SOLVED
- **22:01** TypeDB ontology tooling paths were split across duplicate locations, increasing drift risk and operator confusion.

### FEATURE IMPLEMENTED
- **20:39** Added a consolidated voice session/runtime checkpoint and migration planning baseline for the next waves.
- **22:01** Refactored ontology tooling to canonical `ontology/typedb/scripts/*` paths.

### CHANGES
- **20:39** Updated checkpoint docs/plans for voice session UX/runtime contracts.
- **22:01** Moved/refactored TypeDB scripts and references to canonical ontology paths and removed backend-local duplication.

## 2026-02-28
### PROBLEM SOLVED
- **02:52** Voice-OperOps-Codex rollout still had unresolved gaps across task creation triggers, deferred review flow, tabs, and categorization material model.
- **03:28** Deferred Codex review lacked an executable worker pipeline with deterministic queue orchestration and summary generation.
- **03:39** Deferred review output was not persisted into issue notes and had no approval card routing for operator decisions.
- **04:07** Start/Cancel callback actions for deferred tasks were missing, so users could not complete deferred lifecycle from Telegram cards.
- **04:14** Categorization rows lacked final metadata/material UX contract (`Materials`, hidden `Unknown`, pale signature, row-group links, explicit row-targeted attachments).

### FEATURE IMPLEMENTED
- **02:52** Completed Wave 2 (`copilot-yqst`, `copilot-m2uw`, `copilot-8yuq`, `copilot-dkj6`, `copilot-aonw`, `copilot-su2v`, `copilot-grg4`, `copilot-upqs`): Copilot `git_repo` seeding, Codex `@task` session bootstrap, performer lifecycle filtering, ontology/runtime contract alignment, attachment link normalization, deferred task creation, and transcription trigger tasking.
- **03:28** Completed Wave 3 (`copilot-0t2c`, `copilot-03gp`): canonical `external_ref` and deferred review worker pipeline (`CODEX_DEFERRED_REVIEW` job + prompt card + manifest/loop integration).
- **03:41** Completed Wave 4 (`copilot-l3j6`, `copilot-c1xj`, `copilot-zwjl`): Voice `Задачи` and `Codex` tabs, backend `codex_tasks` route, deferred review note persistence, Telegram approval card dispatch.
- **04:09** Completed Wave 5 (`copilot-2psh`, `copilot-ex9q`, `copilot-gb72`): deferred Start/Cancel callbacks, OperOps Codex tab (latest 500 `bd` items), inline Codex task details in Voice tab.
- **04:36** Completed categorization-material chain (`copilot-hfvd`, `copilot-c4bd`, `copilot-a3k0`, `copilot-p31k`, `copilot-250m`): `Materials` column, unknown-speaker suppression, pale metadata signature, image/text group links, explicit row-targeted material attachment flow.
- **04:37** Closed coordinating epic `copilot-bq81` after all dependent IDs were completed and verified.

### CHANGES
- **02:52** Added/updated backend contracts in `backend/src/api/routes/voicebot/sessions.ts` and worker/runtime handlers for Codex task/deferred review orchestration.
- **03:12** Added Codex voice trigger processing in `backend/src/workers/voicebot/handlers/transcribe.ts` with `processors_data.CODEX_TASKS` persistence.
- **03:28** Added `backend/src/workers/voicebot/handlers/codexDeferredReview.ts`, updated `processingLoop.ts`, and registered `VOICEBOT_JOBS.common.CODEX_DEFERRED_REVIEW`.
- **03:39** Added approval-card persistence and Telegram dispatch integration in deferred review worker, plus new env knobs in `backend/.env.example`.
- **03:41** Added app voice tab components and contracts: `CodexTasks`, session tab wiring, and source/session filters in `SessionPage` + `CRMKanban`.
- **04:07** Added Telegram callback runtime path for `cdr:start:*` and `cdr:cancel:*` in `backend/src/voicebot_tgbot/codexReviewCallbacks.ts` and `runtimeNonCommandHandlers.ts`.
- **04:08** Added OperOps Codex backend route `POST /api/crm/codex/issues` and OperOps `Codex` UI tab in `CRMPage`.
- **04:35** Added explicit row-target material targeting across frontend state/UI and backend add routes (`image_anchor_linked_message_id` validation/persistence + realtime payload updates).
- **04:36** Validation run: targeted app/backend Jest suites for every wave (`voice tabs`, `codex routes`, `deferred callbacks`, `categorization/materials grouping`) passed; `app/backend` full builds remain blocked by pre-existing unrelated TypeScript errors in CRM and voicebot-persons files.
- **04:48** `/session_done` permission compatibility fix: replaced unavailable route middleware call with inline permission resolution (`PermissionManager.getUserPermissions`) and explicit `VOICEBOT_SESSIONS.UPDATE` guard in `backend/src/api/routes/voicebot/sessions.ts`.
- **04:49** Validation run (full): `cd app && npm test -- --runInBand` (`50 suites`, `113 tests`) and `cd backend && npm test -- --runInBand` (`76 suites`, `365 tests`) both passed.

## 2026-03-01
### PROBLEM SOLVED
- **18:55** Visual recap documentation had Mermaid formatting drift and close-session artifacts were not fully synchronized with repository docs.

### FEATURE IMPLEMENTED
- **22:02** Added close-session documentation synchronization for recap artifacts and handoff evidence.

### CHANGES
- **18:55** Fixed Mermaid line-break rendering and recap formatting in `docs/copilot-repo-visual-recap.html`.
- **22:02** Updated close-session documentation artifacts (`AGENTS.md`, `README.md`) to align with recap handoff context.

## 2026-03-02
### PROBLEM SOLVED
- **13:08** OperOps/Voice Codex details still rendered noisy placeholder metadata (`—`), lacked explicit relationship semantics from bd payload, and showed escaped newline literals in Description/Notes.
- **13:23** Relationship navigation was incomplete: parent/child issue IDs were visible but not directly navigable from the details card.
- **13:12** CRM Kanban lacked a one-click clone path for existing tasks, and Plan-Fact contract/subproject labels were overly forced to uppercase.
- **13:14** Task-create E2E close/cancel coverage was brittle in unauth/stubbed environments due to auth/CRM dependency and fullscreen spinner pointer capture.
- **13:44** Codex issues in OperOps mixed deferred tasks into `Open` without a dedicated deferred view, so active work and deferred backlog were not separable in UI.
- **13:44** Voice sessions list empty/loading state still surfaced generic AntD `No data` messaging, which produced false-empty perception while data was loading or filters were narrowing results.
- **13:43** FinOps scope discovery artifacts were scattered across canonical/mirror/sandbox sources without a single repository-owned inventory document.
- **16:54** Voice categorization still had block-level selection noise, image/text coupling, and no row-level mutation contract, so operators could not safely edit/delete categorization rows with deterministic realtime updates.
- **17:06** Codex details/list views lacked unified status semantics: relationship IDs did not show status pictograms, and list tabs did not separate `in_progress`/`blocked` from `open`.
- **21:58** Auth architecture alternatives and UX-video processing requirements were not captured as repository-owned execution plans, which blocked structured implementation planning.

### FEATURE IMPLEMENTED
- **13:19** Closed `copilot-9ifu`: Codex details card now hides empty metadata rows, normalizes escaped newlines, and renders grouped relationships (`parent-child`, `waits-for`, `blocks`, `discovered-from`, fallback dependencies).
- **13:24** Closed `copilot-x06u`: child relationship IDs in `Children (parent-child)` now deep-link to `/operops/codex/task/:id`.
- **13:27** Closed `copilot-2qne`: parent relationship IDs and top `Issue ID` now deep-link to `/operops/codex/task/:id` while preserving copy behavior.
- **13:14** Added ticket clone action in CRM Kanban with normalized payload generation for project/type/performer/date/notifications/description.
- **13:12** Relaxed visual casing in Plan-Fact project rows by removing forced uppercase styling for contract and subproject labels.
- **13:14** Strengthened task-create E2E workflow with explicit auth/CRM API mocks and deterministic close/cancel verification.
- **13:44** Closed `copilot-wtz7`: shared Codex table now exposes `Open / Deferred / Closed / All` tabs; deferred compatibility logic treats `status=deferred` and transitional `status=open + defer_until` as deferred while keeping `Open` active-only.
- **13:44** Closed `copilot-ai1b`: Voice sessions list now renders AI-style loading placeholder and domain-specific empty state with reset-filters CTA instead of generic `No data`.
- **13:43** Added FinOps discovery documentation (`copilot-081q` support): canonical spec inventory, mirror/sandbox references, and open product-scope questions are consolidated in one document.
- **16:54** Closed `copilot-7r94` epic and child tasks `copilot-7r94.1`..`copilot-7r94.11`: shipped stable categorization row identity, no-processing-column layout, materials-only rendering lane, shared metadata signature formatter, typed categorization edit/delete APIs, realtime mutation events, cascade transcript delete for last-row removal, and row-level Copy/Edit/Delete actions.
- **17:06** Closed `copilot-j54y`: Codex relationship tags now reuse Issue-ID link+copy token rendering with per-item status pictograms; Codex list tabs now expose `Open / In Progress / Deferred / Blocked / Closed / All` with counters.
- **21:58** Added auth strategy planning artifacts (Option A vs Option B) and a UX video-parser specification package (`videoparser/`) for implementation scoping.
- **22:00** Updated performer compensation coefficient baseline in Kanban finances: `basicBonus` now uses `payment * 0.05` instead of `0.15`.

### CHANGES
- **13:19** Updated `app/src/components/codex/CodexIssueDetailsCard.tsx` with relationship parsing/rendering, escaped-newline normalization, and clickable `copilot-*` issue links.
- **13:19** Updated `app/src/components/codex/CodexIssuesTable.tsx` to pass through raw relationship payload (`dependents`, `children`, `parent`, raw dependencies) to the details card.
- **13:19** Added `app/__tests__/operops/codexIssueDetailsCardContract.test.ts` and updated `app/__tests__/operops/codexIssuesTableContract.test.ts` for relationship/clickable-id contracts.
- **13:14** Updated `app/src/components/crm/CRMKanban.tsx` (`CopyOutlined` clone action + `createTicket` payload normalization) and `app/src/components/PlanFactGrid.tsx` (label typography casing).
- **13:14** Updated `app/e2e/task-create.spec.ts` for unauth close/cancel stability (mocked APIs + spinner click-through) and refreshed `docs/copilot-repo-visual-recap.html` with a MongoDB→TypeDB mapping-focused structure.
- **13:31** Validation run: `cd app && npm run test:serial -- __tests__/operops/codexIssueDetailsCardContract.test.ts __tests__/operops/codexIssuesTableContract.test.ts __tests__/voice/codexTasksInlineDetailsContract.test.ts __tests__/operops/codexTaskPageContract.test.ts` and `cd app && npm run build` passed.
- **13:44** Updated `app/src/components/codex/CodexIssuesTable.tsx`:
  - introduced `deferred` tab key and tab order `Open / Deferred / Closed / All`,
  - added deferred-compatibility predicates (`status=deferred` OR `status=open && defer_until`),
  - switched API fetch to `view=all` + local status segmentation to preserve transitional semantics.
- **13:44** Updated Codex contracts:
  - `app/__tests__/operops/codexIssuesTableContract.test.ts`,
  - `app/__tests__/voice/sessionCodexTasksFilterOrderContract.test.ts`.
- **13:44** Updated `app/src/pages/voice/SessionsListPage.tsx` with AI-style loading/empty placeholders, reset-filters CTA, and explicit table `emptyText` contract; added `app/__tests__/voice/sessionsListEmptyStateContract.test.ts`.
- **13:43** Added `docs/FINOPS_SPEC_DISCOVERY.md` and synchronized references in `README.md` and `AGENTS.md` to keep FinOps scope-alignment text current.
- **13:45** Validation run: `cd app && npm run test:serial -- __tests__/operops/codexIssuesTableContract.test.ts __tests__/voice/sessionCodexTasksFilterOrderContract.test.ts __tests__/voice/sessionsListEmptyStateContract.test.ts` and `cd app && npm run build` passed.
- **16:54** Voice categorization runtime/UI contract updates:
  - frontend: `app/src/components/voice/{Categorization.tsx,CategorizationTableRow.tsx,TranscriptionTableRow.tsx}`, `app/src/store/{sessionsUIStore.ts,voiceBotStore.ts}`, `app/src/types/voice.ts`, new utils `app/src/utils/{categorizationRowIdentity.ts,voiceMetadataSignature.ts}`;
  - backend: `backend/src/api/routes/voicebot/{messageHelpers.ts,sessions.ts}` with new routes `POST /api/voicebot/edit_categorization_chunk` and `POST /api/voicebot/delete_categorization_chunk`;
  - tests: updated/added frontend categorization contracts and backend runtime/session-log contracts, including `backend/__tests__/voicebot/runtime/sessionsRuntimeCompatibilityRoute.categorizationChunkValidation.test.ts`.
- **17:06** Codex status/UI parity updates:
  - `app/src/components/codex/CodexIssueDetailsCard.tsx` (shared Issue-ID token renderer + relationship status pictograms),
  - `app/src/components/codex/CodexIssuesTable.tsx` (strict status segmentation tabs with per-tab counters and disabled tree expansion controls),
  - updated contracts `app/__tests__/operops/codexIssueDetailsCardContract.test.ts`, `app/__tests__/operops/codexIssuesTableContract.test.ts`, and `app/__tests__/voice/sessionCodexTasksFilterOrderContract.test.ts`.
- **21:58** Added planning/spec artifacts:
  - `voice-categorization-ux-cleanup-plan.md`,
  - `plan/auth-option-a-copilot-oauth-provider-plan.md`,
  - `plan/auth-option-b-google-oauth-plan.md`,
  - `plan/auth-options-a-vs-b-comparison.md`,
  - `videoparser/specs/{ux_video_processing_guide.md,ux_video_processing_library_cli_spec.md}`.
- **22:00** Updated `app/src/store/kanbanStore.ts` performer payout formula (`basicBonus` coefficient `0.05`).
- **22:03** Type-safety gates passed: `cd app && npm run build`, `cd backend && npm run build`.

## 2026-03-03
### PROBLEM SOLVED
- **12:33** Voice session taskflow parity was incomplete across backend and UI, and session-close REST parity still lacked a fully closed documentation trail.
- **17:33** Project-group resolution could miss projects when `group.projects_ids` was empty, which broke FinOps/CRM project visibility in API-driven screens.

### FEATURE IMPLEMENTED
- **12:33** Completed session-scoped Voice taskflow parity across backend and UI.
- **13:11** Finalized the REST-first done-session documentation package and repository closeout artifacts for the Voice rollout.

### CHANGES
- **12:33** Landed canonical session taskflow wiring in Voice backend/UI (`02e6b45`).
- **13:11** Added/finalized REST parity docs and plans: `docs(voice)` / `docs(plan)` / `docs(copilot)` closeout artifacts.
- **17:33** Switched project resolution away from `group.projects_ids` to direct `project.project_group` links and synchronized reverse-link analysis docs.

## 2026-03-04
### PROBLEM SOLVED
- **08:55** Session summaries were not persisted through one canonical path, and categorization/Codex UX remained inconsistent.
- **11:35** `runtime_tag` still behaved like an operational routing concept in parts of the Voice migration story.
- **12:27** Voice close/session flows still needed realtime quota-recovery hardening.

### FEATURE IMPLEMENTED
- **22:02** Added optional Telegram WebApp bot bootstrap for the miniapp runtime.

### CHANGES
- **08:55** Added canonical session-summary persistence and aligned categorization/Codex UX (`f35f91c`).
- **11:35** Deprecated `runtime_tag` as an operational flow contract and finalized migration docs (`295431b`).
- **12:27** Hardened Voice close/session realtime quota-recovery path (`efc89ec`).
- **11:37** Captured desloppify scanner artifacts and post-deploy evidence for the cleanup wave.

## 2026-03-05
### PROBLEM SOLVED
- **16:02** OperOps project create/edit flow was still tied to inline modal behavior.
- **16:21** CRM and Miniapp task attachments lacked one canonical shared flow.
- **22:05** WebRTC paused `Done` and `webm` upload handling still had brittle edge cases.

### FEATURE IMPLEMENTED
- **16:21** Introduced a shared CRM↔Miniapp task attachment flow.
- **16:02** Moved OperOps project create/edit work onto dedicated page routes.

### CHANGES
- **16:02** Routed project create/edit to dedicated OperOps pages (`2c7f5b2`).
- **16:21** Implemented normalized task attachment upload/download flow across CRM and Miniapp (`54c99ce`).
- **22:05** Hardened paused `Done` and `webm` upload handling in Voice/WebRTC (`9030306`).

## 2026-03-06
### PROBLEM SOLVED
- **12:11** Live meetings still lacked a stable possible-task generation path.
- **17:39** `create_tasks` debug/reconnect behavior was noisy and fragile under MCP disconnects.
- **21:13** Agent-backed `create_tasks` errors were not surfaced clearly enough to operators.

### FEATURE IMPLEMENTED
- **12:11** Implemented live possible-task generation during meetings.
- **18:45** Bound `create_tasks` to explicit MCP server/runtime configuration and refreshed the fast-agent fork/update path.

### CHANGES
- **12:11** Added live possible-task generation for active meetings (`e2a795b`).
- **13:00** Normalized task-attachment filenames and row locators (`de3d038`).
- **16:59** Added reconnect grace for MCP socket requests and hardened debug flow (`caf0011`, `e27d977`, `e0a932c`).
- **17:44** Required `voice.fetch` first in the `create_tasks` prompt and shrank the `create_tasks` payload envelope (`8772fb0`, `b3f5beb`).
- **18:45** Refreshed fast-agent upstream wiring, MCP bindings, and model/runtime defaults (`d34e2c5`, `4c27992`, `6bfe5f4`, `030e732`, `c8209a2`).
- **21:45** Restored deleted possible tasks to live visibility and surfaced clearer agent error text (`5cff96d`, `1cbf0ba`).

## 2026-03-07
### PROBLEM SOLVED
- **08:27** Possible-task refresh was still tied to inconsistent triggers and stale session notify symbols.
- **10:27** Voice session tabs lacked stable counters/badges for `Задачи` and `Codex`.

### FEATURE IMPLEMENTED
- **06:57** Made `codexspark` the default fast-agent runtime model for the create_tasks path.
- **11:28** Preserved explicit invoice tasks in `create_tasks`.

### CHANGES
- **08:27** Auto-refreshed possible tasks after transcribe and unified the manual `create_tasks` queue path (`73d11ee`, `4db1f8f`).
- **08:45** Dropped stale `session_tasks_created` notify semantics and stopped recomputing possible tasks on session done (`1e4e24e`, `3526b10`).
- **10:27** Added stage activity dots and split task/codex tab counters (`a1494a7`, `d44a4aa`, `ae1fd1a`).
- **11:28** Updated create_tasks agent docs/runtime to preserve invoice-specific tasks and fetch transcript metadata (`bd4d167`, `4c755a2`).

## 2026-03-08
### PROBLEM SOLVED
- **10:33** Live refresh could still erase visible possible tasks during session updates.
- **22:08** Voice session contracts and TypeDB tooling were drifting apart.

### FEATURE IMPLEMENTED
- **22:08** Aligned Voice session contracts with canonical TypeDB tooling paths.

### CHANGES
- **10:33** Preserved possible tasks during live refresh (`a2b81d6`).
- **22:08** Synchronized voice/ontology contracts and tooling layout (`1062bfe`).

## 2026-03-09
### PROBLEM SOLVED
- **22:06** TypeDB source maintenance still depended on a fragmented handwritten layout, which blocked kernel-wide schema evolution.

### FEATURE IMPLEMENTED
- **22:06** Migrated TypeDB source management to TOON YAML.

### CHANGES
- **22:06** Reworked ontology source generation around TOON YAML (`614d837`).

## 2026-03-10
### PROBLEM SOLVED
- **18:43** Voice session task tabs still depended on non-canonical status count behavior.
- **11:45** Annotated TQL source had regressed after the TOON migration.

### FEATURE IMPLEMENTED
- **18:43** Enforced status-counts-only session task tabs in Voice.

### CHANGES
- **11:45** Restored annotated TQL source and removed the transient TOON fragment layer (`b56a8d1`).
- **18:43** Enforced status-counts-only task-tab behavior in Voice (`3cb88f6`).
- **22:11** Synchronized voice status-normalization planning docs (`ecde609`).

## 2026-03-11
### PROBLEM SOLVED
- **22:07** Forecast revision history and Figma indexing were both missing from the platform surface.

### FEATURE IMPLEMENTED
- **22:07** Added forecast history and Figma indexing support.

### CHANGES
- **22:07** Landed FinOps forecast history and Figma indexing updates across app/backend/docs (`ba3db32`).

## 2026-03-12
### PROBLEM SOLVED
- **12:31** Possible-task materialization and repair paths were still inconsistent.
- **22:09** Possible-task statuses/visibility still leaked legacy behavior.
- **11:43** RUB formatting could visually split the ruble sign from the amount.

### FEATURE IMPLEMENTED
- **12:31** Added repair path for possible-task materialization.
- **22:09** Normalized possible-task statuses and visibility.

### CHANGES
- **11:43** Kept the ruble symbol attached to the formatted amount (`13778bc`).
- **12:31** Fixed possible-task materialization and added a repair path (`08d9b98`).
- **22:09** Normalized possible-task statuses and visibility (`498e1ff`).

## 2026-03-13
### PROBLEM SOLVED
- **02:20** Voice/Telegram status migration still needed a finalized hardened path.
- **22:03** Plan-Fact and Voice UI follow-up status docs were still out of sync with live behavior.

### FEATURE IMPLEMENTED
- **02:35** Added and refined the MPIC process review planning package.

### CHANGES
- **02:20** Finalized Voice/Telegram status migration and Telegram hardening (`fd57aed`).
- **02:35** Added then refined the MPIC process review plan (`c735d71`, `01e62e7`).
- **22:03** Synchronized UI follow-up docs for Plan-Fact and Voice (`d9a5f1c`).

## 2026-03-14
### PROBLEM SOLVED
- **10:39** Voice/OperOps task surfaces were still split across incompatible semantics.
- **12:02** Manual summarize remained brittle and task labels were not fully normalized.
- **23:17** Lifecycle counters and spec/status tracking drifted after the task-surface rollout.

### FEATURE IMPLEMENTED
- **10:39** Landed the first full Voice/OperOps task-surface normalization wave.
- **02:08** Approved the next-wave Voice task-surface contract in docs.

### CHANGES
- **02:08** Approved next-wave task-surface docs (`6d76cf2`).
- **10:39** Landed Voice/OperOps task-surface normalization (`38056d7`, `d14ccc1`).
- **12:02** Hardened summarize trigger and normalized task labels (`46db2fe`).
- **23:17** Fixed lifecycle counters, enforced strict canonical task-status filtering, and synchronized spec/changelog status (`d4f3bea`, `ae5f8d7`, `569900f`).

## 2026-03-15
### PROBLEM SOLVED
- **03:08** Strict session taskflow replacement still had unfinished runtime/docs edges.
- **11:48** Backend recovery and ontology rollout supervision needed one coordinated operational path.
- **13:11** Header actions, codex issue loading, and Telegram MarkdownV2 send discipline still had UX/ops inconsistencies.

### FEATURE IMPLEMENTED
- **11:48** Added quota-recovery supervision and ontology rollout tooling.
- **14:00** Codified Telegram MarkdownV2 send discipline.

### CHANGES
- **03:08** Finalized strict session taskflow replacement and docs wording (`ba76c8f`, `0576f41`).
- **10:41** Closed session with Codex issue loading and UX refinements (`4c4136a`).
- **11:07** Added paused FAB double-click `Done` coverage (`ab5220e`).
- **11:48** Added backend quota recovery plus ontology rollout supervision (`07b9692`).
- **13:11** Aligned `Tasks`/`Summarize` header action styling and archived stale plans / hardened single-issue fallback (`d0753d7`, `7c95c57`).
- **14:00** Documented Telegram MarkdownV2 send discipline and staged typedb sync/full-load tooling (`a601a65`, `4f47254`).

## 2026-03-16
### PROBLEM SOLVED
- **11:00** Agent model fallback and status normalization still required one canonical runtime policy.
- **22:05** Possible-task refreshes lacked correlation telemetry across apply/refresh flows.

### FEATURE IMPLEMENTED
- **22:05** Added correlated possible-task refresh telemetry.

### CHANGES
- **11:00** Finalized task status normalization and agent model fallback (`ca82d08`).
- **22:05** Added correlated possible-task refresh telemetry (`132ecdf`).

## 2026-03-17
### PROBLEM SOLVED
- **11:54** Session `Tasks` reads could bypass the backend recovery path.
- **12:13** Agent restarts still retried too early, causing MCP readiness races.

### FEATURE IMPLEMENTED
- **22:02** Captured runtime OpenAI key/OAuth state and registered the company-creator card scaffold for future work.

### CHANGES
- **11:54** Routed session `Tasks` through backend recovery (`34f6ff5`).
- **12:13** Added MCP readiness waiting after quota-recovery restarts (`51681ab`).
- **22:02** Added runtime key-state docs and company card scaffold, then synced changelog/docs for the readiness fix (`e4f5237`, `3d1a2ad`).

## 2026-03-18
### PROBLEM SOLVED
- **22:08** Voice discussion-linked taskflow and comment contracts were still under-specified for multi-session linkage.

### FEATURE IMPLEMENTED
- **22:08** Normalized discussion-linked taskflow and comment contracts.

### CHANGES
- **22:08** Landed discussion-linked taskflow/comment contract normalization (`7418c55`).

## 2026-03-19
### PROBLEM SOLVED
- **22:03** The accepted Voice task bucket contract and host maintenance guardrails were still implicit rather than repository-owned.

### FEATURE IMPLEMENTED
- **22:03** Codified the accepted Voice task bucket and host cleanup guardrail.

### CHANGES
- **22:03** Added docs for the accepted Voice task bucket and host guardrail (`357e561`).

## 2026-03-21
### PROBLEM SOLVED
- **09:12** Executor-layer ontology terms and DB-side task constraints were still underspecified.
- **21:30** `create_tasks` still lacked exact payload profiling and a canonical Draft visibility policy.
- **22:02** Dual-stream execution semantics needed ontology-first normalization.

### FEATURE IMPLEMENTED
- **09:12** Formalized executor-layer ontology and DB-side task constraints.
- **21:30** Added `create_tasks` profiling and explicit Draft horizon semantics.
- **22:02** Normalized dual-stream execution semantics in docs/specs.

### CHANGES
- **09:12** Landed executor-layer ontology and DB-side task constraints (`55c268b`).
- **21:30** Added `create_tasks` profiling and formalized draft horizon policy (`3bf7fa9`).
- **22:02** Updated dual-stream execution semantics docs/specs (`2fc6211`).

## 2026-03-22
### PROBLEM SOLVED
- **00:23** Voice session title generation could leave the UI stuck in `Генерирую заголовок`, and task/session bucket drift still produced false counters, duplicate Draft exposure, or transient 400 noise after the bucket rename wave.
- **04:51** The ontology still had a split-brain task plane and a brittle validate-smoke path: `target_task_view` removal was incomplete, key goal/requirement ids and ingest normalization still drifted, and the orphan-task validation query could fail even when the deployed schema itself was coherent.
- **15:00** Voice session pages could fail to open after session-list sorting when the selected project resolved to zero active performer rows; backend `project_performers` enrichment built an empty Mongo logical selector and returned `500`.
- **16:42** The harness article content existed only as an unstructured local dump and had no adjacent Russian version for reuse or sharing.
- **22:04** Session-scoped Voice/OperOps follow-up flows still had traceability gaps: materialized tasks could disappear from Voice matching when `source_ref` was an OperOps self-link, multiple Codex tasks from one session shared one BD external ref, manual Draft refresh / summary save lacked end-to-end correlation reconciliation, CRM Archive did not share the bounded depth fast path, and transcription metadata could surface mojibake filenames.

### FEATURE IMPLEMENTED
- **00:58** Finalized the strict `Draft / Ready+ / Codex` session-task contract and split OperOps CRM into summary-list vs lazy-detail payloads with bounded Draft/Archive depth control and live status-count parity.
- **04:51** Landed the hard `task-only` TypeDB cutover end-to-end and restored green ontology smoke after the validate-query fix and post-ingest schema regeneration.
- **15:00** Hardened Voice Telegram/performer enrichment so project-performer reads now degrade to an empty performer list when lifecycle filtering removes every linked performer, keeping the session page load path alive for sorted navigation.
- **16:42** Added structured English and Russian harness article artifacts for reuse and sharing.
- **22:04** Finalized voice-source and Codex traceability contracts: session linkage prefers canonical voice refs, BD refs are unique per task, manual refresh/save flows carry correlation ids end-to-end, mojibake filenames are normalized in UI signatures, and live parity coverage now checks CRM/Voice tab counts against production APIs.

### CHANGES
- **00:23** Added frontend stage timeouts / `finally` cleanup for `generate_session_title`, backend MCP correlation logging, and verified successful title generation + Telegram summary delivery for session `69be49ea4ad7c397307d2d6f`.
- **00:41** Fixed Voice session `Задачи` counters so `Draft` rows are counted from the same canonical source as visible rows, and hardened `session_tasks(bucket='Ready+')` / `session_tab_counts` so Draft rows cannot leak into accepted-task reads (`copilot-f6z4`, `copilot-rdrq`).
- **00:58** Added `/api/crm/tickets/status-counts`, `response_mode=summary|detail`, lazy ticket-detail hydration for CRM drawers/editors, `Loading ...` state instead of false `No data`, request/profile instrumentation, and Draft/Archive bounded-depth handling; the fast surface now defaults to `1d`, while `∞` means no recency bound (`copilot-83r7`, `copilot-bn3f` plus current CRM refinements).
- **01:23** Cleaned the Voice session page console by adding explicit labels/names to MeetingCard/FAB fields, labeling the summary textarea, and removing AntD autosize’s hidden measurement textarea from the summary panel (`copilot-occa`).
- **04:51** Removed `target_task_view`, rebound task/process/product/execution relations directly onto `task`, added reasoning/evidence entities, restored missing goal/requirement id attributes, normalized ingest mapping for `task.status` / `task.priority`, regenerated `ontology/typedb/schema/str-ontology.tql`, and fixed `typedb-ontology-validate.py` to avoid the inference-unsafe orphan-task query (`ee5dda3`, `959afdd`, `7c4f32a`, `2b3d6e0`, `b11aa20`).
- **15:00** Updated `backend/src/services/telegramKnowledge.ts` plus root docs so `POST /api/voicebot/project_performers` short-circuits empty performer/Telegram selector batches instead of issuing invalid Mongo logical arrays (`c8a164b`).
- **16:42** Added `factory/harness.md` and `factory/harness.ru.md` as structured article artifacts (`7195877`).
- **22:04** Updated `app/src/utils/{voiceSessionTaskSource,voiceSourceFileName,voiceMetadataSignature}.ts`, `app/src/pages/operops/taskPageUtils.ts`, `backend/src/api/routes/voicebot/sessions.ts`, `backend/src/services/voicebot/{createTasksAgent,voicebotDoneNotify}.ts`, worker handlers, and focused tests/e2e so Voice session matching prefers `external_ref` when `source_ref` is an OperOps self-link (`copilot-ztlv.27`), Codex issue creation uses unique `#codex-task=` refs, manual Draft refresh and summary save carry/reconcile correlation ids, `runCreateTasksAgent(...)` injects bounded `project_crm_window`, mojibake filenames are normalized in metadata signatures, and live parity tests assert CRM/Voice tab counts against live APIs.
- **22:04** Updated root `AGENTS.md` with the subagent execution policy: subagents should start with clean history by default, while final integration verification and deploy/smoke remain parent-thread responsibilities.
- **22:26** Finalized the follow-up task-ref hotfix: accepted-row reuse now preserves original `created_at`, `create_tickets` no longer blanket-deletes unrelated `codex_task` docs before bd sync, and canonical task-source helpers no longer emit a bare `/operops/task` URL when the Mongo task id is missing (`copilot-jhvx`, `copilot-ji84`).

## 2026-03-23
### PROBLEM SOLVED
- **18:40** Voice task surfaces still drifted between session processors, review artifacts, and forensic tooling, which slowed down incident resolution.

### FEATURE IMPLEMENTED
- **18:40** Stabilized `CREATE_TASKS` parity, unified review surfaces, and added first-class voice session forensics tooling.

### CHANGES
- **18:40** Stabilized voice task surfaces and added inactive-session auto-close (`c48672e`).
- **19:12** Unified voice review surfaces and hardened composite task analysis (`19c2879`).
- **20:01** Hardened `CREATE_TASKS` parity and added voice forensics tooling (`392a724`).

## 2026-03-25
### PROBLEM SOLVED
- **23:20** Sessions list and task workspace behavior were too slow/noisy after recovery waves; retry/error paths for transcription and taskflow were inconsistent.

### FEATURE IMPLEMENTED
- **23:20** Landed a full voice reliability wave: faster sessions list, deterministic task workspace/footer flow, stricter transcription recovery, and ontology-backed draft persistence.

### CHANGES
- **12:04** Split persistence specs and rehomed dual-stream ontology docs (`254a1b7`).
- **13:27** Stabilized production voice-operops parity surfaces (`a97e745`).
- **15:03** Implemented ontology-backed Draft task persistence slice (`24b0370`).
- **16:41** Accelerated sessions list and stabilized Draft workspace layout (`9a6da86`).
- **17:10** Fixed backend sessions-list typing regression after deploy build failure (`294460b`).
- **21:33** Stabilized voice taskflow runtime and footer flow (`6872c70`).
- **23:20** Hardened transcription recovery and garbage gating (`74054ce`).

## 2026-03-26
### PROBLEM SOLVED
- **22:47** Voice stale-repair and temporal taskflow semantics were fragmented across routing paths; lifecycle and CRM refresh flows still had race-prone behavior.

### FEATURE IMPLEMENTED
- **22:47** Canonicalized stale-repair/temporal policy and hardened session lifecycle + CRM refresh contracts.

### CHANGES
- **09:41** Stabilized voice stale-repair and sessions parity test contracts (`ad90fca`).
- **11:18** Aligned recall-first temporal policy across spec and ontology (`0dbf64d`).
- **12:02** Added `copilot-xmcm` swarm execution plan docs (`898bc96`).
- **20:57** Hardened voice session lifecycle and CRM task refresh flows (`fda39a2`).
- **22:34** Normalized legacy Draft `updated_at` values on read compatibility (`8602d1c`).

## 2026-03-27
### PROBLEM SOLVED
- **10:10** Runtime recovery needed one strict path after restart: Codex/CRM transport drift, voice upload/session forensic trace continuity, noisy test warnings, and selector/task-pane deprecation fallout were still mixed in active diffs.
- **22:47** Media-bearing Telegram/document attachments could land in Voice as empty `legacy_attachment` placeholders, which blocked ASR, hid retry/classification state, and made restart/recovery flows non-deterministic.
- **22:47** Closed planning artifacts still had mixed live/archive paths, which left repo instructions and plan index entries inconsistent after the closure wave.

### FEATURE IMPLEMENTED
- **10:10** Delivered a recovery-focused hardening package with deterministic route behavior, warning suppression policy in tests, and UI selector/task-pane contract cleanups.
- **22:47** Added payload-first attachment transcription classification with operator resolution, stale-job-safe audio/video ASR, and legacy repair tooling for historical attachment placeholders.
- **22:47** Archived the closed media-attachment planning wave under canonical references while keeping the remaining test-noise follow-up explicitly open.

### CHANGES
- **09:32** Stabilized voice runtime recovery and temporal taskflow contracts (`1126f4f`).
- **10:10** Added CRM temporal/codex runtime route hardening and tests (`backend/src/api/routes/crm/{tickets.ts,codex.ts}`, `backend/__tests__/api/*`).
- **10:10** Added forensic trace continuity for `session_done` and `upload_audio` flows plus regression coverage (`backend/src/api/routes/voicebot/{sessions.ts,uploads.ts}`, `backend/__tests__/voicebot/*`, `backend/__tests__/smoke/voicebotApiSmoke.test.ts`).
- **10:10** Centralized backend test logger noise policy and test script warning suppression (`backend/src/utils/logger.ts`, `backend/__tests__/services/logger.test.ts`, `backend/package.json`).
- **10:10** Completed UI contract cleanup for shared selectors and OperOps `TaskPage` card API migration (`variant=\"borderless\"`) with parity test updates across `app/src/components/shared/*`, `app/src/pages/operops/*`, and `app/__tests__/*`.
- **22:47** Added attachment projection/orchestration utilities and wired them through Telegram ingress, transcription routes, session restarts, processing loop, worker ASR, and legacy repair (`backend/src/{voicebot_tgbot/ingressHandlers.ts,api/routes/voicebot/{messageHelpers.ts,sessions.ts,transcription.ts},workers/voicebot/handlers/{processingLoop.ts,transcribeHandler.ts,shared/{retryOrchestrationState.ts,transcriptionProjection.ts}},services/voicebot/legacyAttachmentMediaRepair.ts}`), including `POST /api/voicebot/transcription/resolve_classification` and `POST /api/voicebot/repair_legacy_attachment_media`.
- **22:47** Extended Voice UI/store typing to expose attachment-level transcription state, eligibility, skip reasons, and per-attachment details in the Transcription surface (`app/src/{types/voice.ts,store/voiceBotStore.ts,components/voice/{Transcription.tsx,TranscriptionTableRow.tsx}}`).
- **22:47** Added regression coverage for ingress classification, projection normalization/repair, pending-classification orchestration, retry/stale-job guards, and smoke-path validation (`backend/__tests__/voicebot/runtime/*`, `backend/__tests__/voicebot/workers/*`, `backend/__tests__/smoke/voicebotTranscriptionRetrySmoke.test.ts`).
- **22:47** Closed `copilot-qtcp` in the media-attachment spec, kept `copilot-8h9u` follow-up explicitly in progress, moved closed planning docs into canonical dated/`plan/closed` locations, synced repo references, and refreshed the plan index (`plan/{2026-03-27-voice-media-attachment-transcription-spec.md,2026-03-27-test-noise.md,index.md,closed/*}`, `README.md`, `AGENTS.md`).
- **22:47** Captured refreshed forensic bundles for the Telemost driver incident under `tmp/voice-investigation-artifacts/*`.

## 2026-03-28
### PROBLEM SOLVED
- **08:18** Phase I/II voice stabilization changes were still only in the local tree and needed a full closeout with deploy and production smoke evidence.

### FEATURE IMPLEMENTED
- **08:18** Closed and deployed the voice stabilization Phase I/II wave after green app/backend regression packs.

### CHANGES
- **08:18** Refreshed root docs, pushed `main`, deployed via `./scripts/pm2-backend.sh prod`, and verified production readiness for the voice stabilization closeout (`e6a903a`).

## 2026-03-29
### PROBLEM SOLVED
- **13:10** ACP `/agents` still relied on split route/runtime assumptions, which weakened deploy smoke coverage and deep-link recovery.

### FEATURE IMPLEMENTED
- **13:10** Added a shared ACP-only `/agents` surface with production smoke evidence and restored deep-link/session handoff behavior.

### CHANGES
- **13:10** Added the ACP-only `/agents` surface backed by the shared ACP UI package (`ab3107d`).
- **13:15** Recorded production deploy smoke for ACP `/agents` (`ccb20f1`).
- **22:48** Restored ACP deep links and preserved ACP session handoff behavior (`335008a`).

## 2026-03-30
### PROBLEM SOLVED
- **00:35** ACP `/agents` still lacked a hardened shell-verification and recovery-handoff contract.
- **13:07** Voice operator surfaces still exposed non-actionable transcription projection noise, draft tasks still implied a manual `Save` action, and silence hallucinations needed a deterministic local filter before LLM garbage classification.

### FEATURE IMPLEMENTED
- **00:35** Hardened ACP shell verification and recovery handoff.
- **13:07** Tightened voice garbage detection, simplified transcription operator UX, switched draft task materialization to autosave-first `Run`, and formalized `user wins` collision semantics for Draft rows.

### CHANGES
- **00:35** Hardened ACP shell verification and recovery handoff (`4f89ac6`).
- **13:07** Added a repeated-ngram local short-circuit to `backend/src/services/voicebot/transcriptionGarbageDetector.ts` and regression coverage in `backend/__tests__/services/voicebot/transcriptionGarbageDetector.test.ts`.
- **13:07** Simplified `app/src/components/voice/TranscriptionTableRow.tsx` to show actionable skip/error metadata only and removed raw attachment projection clutter from the default operator view.
- **13:07** Replaced the Possible Tasks primary `Save` action with autosave-first `Run` semantics in `app/src/components/voice/PossibleTasks.tsx`, including a hard stop when manual autosave fails before materialization.
- **13:07** Extended `plan/2026-03-21-voice-task-surface-normalization-spec-2.md` with machine-actionable row/field versioning and explicit `user wins` merge rules for user edits vs `CREATE_TASKS` recompute collisions.
- **13:07** Opened and claimed forensic bug `copilot-dzl7` for session `69ca2f47ac286716c761773e`: upload succeeded, async transcription failed with `insufficient_quota`, and the operator-visible error is currently misreported as an upload/server failure.

## 2026-03-31
### PROBLEM SOLVED
- **09:28** Voice metadata signatures had drifted across tabs, and summarize notify hooks could acknowledge upstream delivery without writing a deterministic timeout failure outcome.
- **22:46** Media-bearing video inputs could explode into dozens of ASR chunks, increasing latency/cost and risking silent tail loss when oversized splits exceeded the practical processing budget.

### FEATURE IMPLEMENTED
- **09:28** Restored post-text metadata signatures across Transcription/Categorization and finalized bounded notify-hook timeout handling.
- **22:46** Enforced video-to-audio staging, single-file-first ASR, low-bitrate re-encode before capped segmentation, and persisted forensic ASR fields for staging/cap outcomes.

### CHANGES
- **09:28** Landed `beced31` (`voice: restore post-text metadata signatures and notify hook timeout finalization`) covering the voice metadata-signature UI contract, notify timeout finalization, and synced root docs.
- **22:46** Updated `backend/src/workers/voicebot/handlers/transcribeHandler.ts` to stage video inputs to extracted audio, add hard chunk-cap enforcement with re-encode fallback, and persist `source_media_type` / `audio_extracted` / `asr_chunk_count` / `chunk_policy` / `chunk_cap_applied`.
- **22:46** Extended `backend/__tests__/voicebot/workers/workerTranscribeHandler.test.ts` with regression coverage for video staging and safe failure when split output exceeds the hard chunk cap.
- **22:46** Added the focused ASR contract spec in `plan/2026-03-31D-videoparser-video-input-efficiency-plan.md` and synced root/runtime docs (`AGENTS.md`, `README.md`, `RUNTIME.md`) to the new media-handling contract.

## 2026-04-03
### PROBLEM SOLVED
- **16:06** `CREATE_TASKS` extraction still drifted away from the ontology-first deliverable contract, and production deploys could still boot from non-authoritative env paths.

### FEATURE IMPLEMENTED
- **16:06** Re-anchored `CREATE_TASKS` extraction to ontology-first task semantics and made the production PM2 env path authoritative.

### CHANGES
- **16:06** Enforced ontology-first draft extraction for `CREATE_TASKS` (`11c6cfc`).
- **18:15** Made the backend production PM2 env authoritative (`0523be7`).
- **19:02** Repaired coordination-to-deliverable extraction drift (`5b03d67`).
- **19:10** Preserved numbered tasks as separate deliverables instead of collapsing them (`07e3485`).

## 2026-04-04
### PROBLEM SOLVED
- **23:07** The `CREATE_TASKS` transition wave still overfit transcript cues, leaked prompt-contract drift, and lacked a closed status trail across the ontology migration gates.

### FEATURE IMPLEMENTED
- **23:07** Completed the ontology migration gate closure wave and hardened `CREATE_TASKS` structural extraction, transition carry-over, and prompt-contract enforcement.

### CHANGES
- **08:04** Rejected empty composite `CREATE_TASKS` results and recovered missing deliverables from transcript cues (`614d304`, `2cfeb9e`, `7f81c28`).
- **11:36** Generalized anti-overfitting task extraction rules and simplified ontology-safe draft extraction (`e64748b`, `f206536`).
- **18:35** Kept structural repair cue variants aligned and restored missing structural walkthrough tasks (`098b0ca`, `686ecaf`, `0858466`).
- **22:51** Enforced transition contracts and carry-over convergence for `CREATE_TASKS` (`eea7f6b`).
- **22:56** Recorded production deploy smoke and closed the wave-8/9/10 ontology migration docs/status loop (`2ad8222`, `0af1a2d`, `be7a5fe`, `3c999d9`).

## 2026-04-05
### PROBLEM SOLVED
- **07:25** Replay determinism for `CREATE_TASKS` still produced unstable draft reuse and left the closeout without fresh deploy evidence.

### FEATURE IMPLEMENTED
- **07:25** Stabilized `CREATE_TASKS` replay determinism and completed the corresponding production close-session evidence.

### CHANGES
- **07:25** Stabilized replay determinism and closed `copilot-bzt6` (`8d93d9b`).
- **07:29** Recorded the production deploy/smoke closeout for that wave (`32ed667`).

## 2026-04-06
### PROBLEM SOLVED
- **22:50** Draft cleanup still relied on implicit stale deletion behavior, and the rollout needed an explicit production closeout record.

### FEATURE IMPLEMENTED
- **22:50** Made stale Draft cleanup explicit, ignored transient `.omx` state during cleanup decisions, and captured the production deploy evidence.

### CHANGES
- **22:50** Hardened stale Draft cleanup semantics and ignored `.omx` state during the cleanup path (`83646d5`).
- **22:54** Recorded the 2026-04-06 production deploy/smoke evidence (`d860562`).

## 2026-04-07
### PROBLEM SOLVED
- **11:49** The draft dedup/merge normalization rollout still had omission/CAS regressions immediately after landing.
- **12:02** Voice session `69d49daf094a4f1dd8741042` had reproducible task-extraction failure and transcript-hygiene anomalies, but no incident-grade forensic trail or tracked follow-ups.
- **18:08** The production voice incident package (`copilot-7fqt`, `copilot-bi99`, `copilot-w5sh`, `copilot-6ony`) still left `69d49daf094a4f1dd8741042` vulnerable to garbage-polluted extraction, contradictory garbage verdicts, and ffprobe duration blind spots.

### FEATURE IMPLEMENTED
- **11:49** Landed the canonical draft dedup/merge normalization rollout and restored omission/CAS guards in the possible-tasks surface.
- **12:04** Re-ran production deploy/smoke on the current `main` and registered the new voice forensic bug bundle without shipping additional runtime fixes.
- **18:58** Deployed the completed voice incident fix wave and replayed session `69d49daf094a4f1dd8741042` through the production backend so `CREATE_TASKS` now settles on a deterministic no-task decision instead of `create_tasks_empty_mcp_result`.

### CHANGES
- **11:39** Implemented the draft dedup/merge normalization rollout (`d05bd00`).
- **11:49** Restored possible-task CAS handling and retain-on-omission guards (`416059c`).
- **12:02** Added the forensic umbrella `copilot-uywf` plus follow-up bugs `copilot-7fqt`, `copilot-bi99`, `copilot-w5sh`, and `copilot-6ony` for session `69d49daf094a4f1dd8741042`.
- **12:04** Production redeploy/smoke passed via `./scripts/pm2-backend.sh prod`, `./scripts/pm2-runtime-readiness.sh prod`, `./scripts/voice-notify-healthcheck.sh --env-file backend/.env.production`, `curl -fsS http://127.0.0.1:3002/api/health`, and unauthenticated `POST /api/voicebot/generate_possible_tasks` returning `401`.
- **18:08** Hardened voice extraction against garbage and duration blind spots (`6a1f694`): create_tasks now filters garbage-tagged DB transcripts out of language sampling and recompute/retry contexts, semantically empty successful MCP composites normalize to the existing inferred `no_task_decision` contract, garbage detection catches repetitive multilingual loop hallucinations more aggressively, and ffprobe duration fallback now requests/reads format and stream tags.
- **18:08** Synced bd closure state for the incident execution/planning issues (`b2651ed`).
- **18:58** Production redeploy/smoke and replay passed for the completed incident wave via `./scripts/pm2-backend.sh prod`, `./scripts/pm2-runtime-readiness.sh prod`, `./scripts/voice-notify-healthcheck.sh --env-file backend/.env.production`, `curl -fsS http://127.0.0.1:3002/api/health`, unauthenticated `POST /api/voicebot/generate_possible_tasks` returning `401`, and `DOTENV_CONFIG_PATH=.env.production npx tsx -e "…handleCreateTasksFromChunksJob({ session_id: '69d49daf094a4f1dd8741042', chunks_to_process: [] })…"` returning `{ ok: true, tasks_count: 0, reason: 'no_tasks', no_task_decision.code: 'no_task_reason_missing' }` with persisted `CREATE_TASKS.is_processed=true`.
