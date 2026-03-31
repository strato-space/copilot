# Copilot Repository Governance Contract

This file is the binding governance and policy contract for the `copilot` repository. It records active product rules, critical interface contracts, core engineering principles, execution policy, and issue-tracking workflow. Runtime specifications, implementation constraints, current-state indexes, and service configuration live in `RUNTIME.md`. Keep historical delivery narrative in `CHANGELOG.md`, keep long operator manuals in dedicated docs, and treat `old_code/` as archive-only.

## Document Authority And Modalities

Keep the remainder of this document focused on active governance rules and binding policy. Runtime facts, implementation constraints, and service configuration belong in `RUNTIME.md`. Dated implementation history belongs in `CHANGELOG.md` and `docs/AGENTS_SESSION_HISTORY.md`; extended tool manuals belong in dedicated docs such as `docs/DESLOPPIFY_AGENT_GUIDE.md`.

Term normalization for this document:
- `authoritative` = source of truth that overrides summaries.
- `current` = as-built runtime state for this repository version.
- `preferred` = default choice when alternatives still exist.
- `legacy-compat` = incumbent compatibility behavior that must not be extended as new design.

Authority precedence (highest first):
1. `ontology/plan/*.md`, `ontology/typedb/docs/*_contract_v1.md`, `ontology/typedb/schema/fragments/*/*.tql`
2. This file's binding rule surfaces: `Hard Product Decisions`, `Critical Interfaces`, `Core Principles`, `Subagent Execution Policy`, `Issue Tracking with bd`, `Landing the Plane`
3. `RUNTIME.md` current-state and index surfaces: Technology Stack, Development Workflow, PM2 Services, Product Notes, Planning Artifacts, Deployment Endpoints, Portal Auth, Testing, and implementation constraints formerly in `Minimal Agent Context`
4. Historical records in `CHANGELOG.md` and `docs/AGENTS_SESSION_HISTORY.md`

Note: `Minimal Agent Context` has moved to `RUNTIME.md` as implementation constraints; it is not governance content.

Modality map:
- `[RULE]` = binding repo policy or contract.
- `[FACT]` = current runtime/product state that may change after an approved implementation/spec update.
- `[INDEX]` = pointer to a deeper runbook/spec/doc.
- `[LEGACY-COMPAT]` = active compatibility behavior preserved to avoid breaking integrations.

Use modality tags only when the whole section or bullet is intentionally homogeneous. If a section mixes descriptive runtime notes with binding instructions, leave the heading untagged and mark new binding bullets inline as `[RULE]` rather than pretending the whole section is purely `[FACT]` or `[INDEX]`.

Historical bullets below still contain some `canonical` phrasing. In new edits, prefer the precise terms above (`authoritative`, `current`, `preferred`, `legacy-compat`); when reading older bullets, interpret `canonical` contextually rather than as a separate governance class. The same `canonical` interpretation rule applies when reading `RUNTIME.md`.

## Hard Product Decisions (Do Not Reinterpret) [RULE]

These decisions are part of the current platform contract and must be preserved unless a new approved spec replaces them.

- Voice source of truth is Copilot:
  - UI: `https://copilot.stratospace.fun/voice/*`
  - API: local `/api/voicebot/*`
  - Legacy `voice.stratospace.fun` is not the implementation target for new changes.
- Session close is REST-first:
  - frontend/WebRTC closes via `POST /api/voicebot/session_done`,
  - legacy alias `POST /api/voicebot/close_session` may remain server-side for compatibility, but clients must not fall back to it,
  - browser must not be the source of `session_done` socket emits.
- Voice controls contract is fixed to `New / Rec / Cut / Pause / Done` with unified behavior between page toolbar and FAB.
- Full-track archive chunks are visible in monitor/runtime metadata but must not auto-upload until diarization rollout is enabled.
- ASR media handling is contract-bound:
  - video inputs must be staged to extracted audio before transcription,
  - transcription is single-file-first, with segmented fallback only after provider-limit checks,
  - segmentation must not exceed the hard `8`-chunk cap; low-bitrate re-encode is required before capped segmented fallback,
  - forensic fields `source_media_type`, `audio_extracted`, `asr_chunk_count`, `chunk_policy`, and `chunk_cap_applied` must persist on both success and deterministic failure paths.
- Runtime isolation is mandatory for operational data:
  - use deployment/database separation (dedicated DB/instance per environment),
  - `runtime_tag` is deprecated as an isolation mechanism and must not be treated as source-of-truth routing input,
  - legacy rows may still contain `runtime_tag` during transition, but runtime behavior must remain fail-fast and tag-agnostic.
- Realtime UX is mandatory for voice:
  - upload must emit `new_message` + `session_update`,
  - processing must emit `message_update` for transcription/categorization progress.
  - summary notify flows for `SESSION_READY_TO_SUMMARIZE` and `summary_save` must preserve stable `correlation_id` / `idempotency_key` values through route, worker, and audit-log writes so retries dedupe against existing status rows.
- Retryable transcription failures must remain recoverable even for waiting sessions:
  - `is_waiting` is not a valid reason to skip message-level retry scans when rows carry canonical OpenAI recovery retry markers (for example `insufficient_quota` or `invalid_api_key`),
  - after balance/key recovery, the periodic processing loop must be able to requeue those rows without manual DB repair.
- Session list behavior is contract-bound:
  - quick filters: `Все`, `Без проекта`, `Активные`, `Мои`,
  - deleted mode toggle (`Показывать удаленные`) is part of persisted filter state,
  - filter state is restored after navigation/reload.
- Voice/OperOps integration remains canonical:
  - `CREATE_TASKS` payload shape is `id/name/description/priority/...`,
  - `task_type_id` is optional in Possible Tasks UI,
  - possible tasks are master records in `automation_tasks` with `task_status=DRAFT_10`,
  - Draft task editing is autosave-first across both inline row edits and the right-hand detail card; the primary manual action is `Run`, not `Save`, and `Run` must not materialize a row to `READY_10` if autosave failed,
  - `process_possible_tasks` now materializes selected rows into `READY_10`,
  - accepted materialized rows must not be soft-deleted by possible-task cleanup,
  - session `processors_data.CREATE_TASKS` is legacy historical payload only and must not be used as the source of truth for Draft reads,
  - canonical Draft reads come from session-linked `DRAFT_10` task docs and may expose `discussion_sessions[]` / `discussion_count`; `source_kind` and stale refresh markers are compatibility metadata, not the semantic draft gate,
  - user-owned Draft fields follow a `user wins` collision policy against concurrent `CREATE_TASKS` recompute writes until the user explicitly releases the override,
  - stale `CREATE_TASKS` repair marker precedence is explicit: processor-level timestamps (`job_queued_timestamp`, request timestamps, finish timestamps) dominate stale-age evaluation; session `_id` timestamp is fallback-only when explicit markers are absent.
  - the default Transcription/Categorization reading flow is operator-first: raw attachment projection/debug metadata does not belong in the normal row body; metadata signatures must render after the corresponding text block (never before it), and only actionable skip/error state may surface inline with the transcript/fallback body.

## Critical Interfaces To Preserve [RULE]

- Voice close: `POST /api/voicebot/session_done` (and alias `POST /api/voicebot/close_session`)
- Voice upload: `POST /api/voicebot/upload_audio`
- Voice summary save: `POST /api/voicebot/save_summary`
- Voice attachment upload: `POST /api/voicebot/upload_attachment` (alias `/api/voicebot/attachment`)
- Voice realtime namespace: Socket.IO `/voicebot` + `subscribe_on_session`
- Canonical voice session URL pattern: `https://copilot.stratospace.fun/voice/session/:session_id`

## Core Principles [RULE]

### I. Type Safety & Modern TypeScript
All frontend and backend code MUST be written in TypeScript with strict type checking enabled.

**Rules:**
- Functions SHOULD have explicit type signatures for parameters and return values.
- Avoid `any` unless there is a clear, documented reason.
- ES modules are the default in backend (`type: module`).

### II. State Management Discipline
Shared UI state MUST live in Zustand stores.

**Rules:**
- Shared or persistent UI state belongs in `app/src/store/*`.
- Components should stay focused on presentation and orchestration.

### III. API-First & Auth
Frontend and backend MUST communicate via documented REST endpoints.

**Rules:**
- `{ data, error }` is the canonical helper envelope for middleware-backed routes, but legacy Voice/CRM routes still return mixed raw payloads; callers must follow the per-route contract instead of assuming a universal envelope.
- Authentication uses http-only cookies set by the Copilot backend.
- Auth is validated locally against `automation_performers` with `password_hash` and JWT.

### IV. Component Modularity & UI System
React components MUST be functional and organized by domain.

**Rules:**
- Page components live in `app/src/pages/`.
- Reusable UI components live in `app/src/components/`.
- Ant Design provides the base UI system; Tailwind CSS handles custom layout/styling.

### V. Real-time Communication Standards
Socket.IO is the real-time layer for updates.

**Rules:**
- CRM/base Socket.IO event names are centralized in `backend/src/constants.ts`; VoiceBot still has legacy live event literals (`new_message`, `message_update`, `session_update`, `session_status`) that remain part of the runtime contract until unified.
- Clients should explicitly subscribe/unsubscribe to channels.

### VI. Coding Principles (TypeScript)
Preferred engineering principles for this repo:
- Favor KISS: keep solutions straightforward, remove dead fallbacks.
- Apply SOLID: explicit interfaces, dependency injection over global mutable state.
- Keep functions small and cohesive; extract utilities instead of growing branch-heavy handlers.
- Avoid hidden fallback paths that obscure control flow.
- Make failures explicit with structured errors; no silent recovery.
- Never suppress exceptions silently (`catch {}` without logging is forbidden in backend paths).
- Log I/O and external integration errors even when execution continues.

### VII. API Type Discipline
- Validate public API payloads with Zod at route boundaries.
- Derive TypeScript callback/input types from schemas (`z.input<typeof schema>`).
- Do not rely on untyped `any` payloads for voice/finops/crm route contracts.

### VIII. Versioning & Dependency Policy
- Follow SemVer (`MAJOR.MINOR.PATCH`) for externally visible changes.
- `MAJOR`: breaking API/contract changes; `MINOR`: backward-compatible features; `PATCH`: fixes/refactors.
- Keep dependencies aligned with current stable releases; avoid opportunistic downgrades unless explicitly required.
- `runtime_tag` may exist in historical records/logs, but new contracts must not rely on tag-family filtering for operational isolation.

### IX. Repo-Level Execution & Tracking Policy
- Default tracking surface is `bd`; work should be represented by claimed/created `bd` issues before changing repository artifacts.
- Bounded execution is the default delivery mode when practical: prefer swarm/subagents with narrow, independently verifiable write surfaces.
- Parent thread remains responsible for final integration, acceptance, and required verification gates.

## Host Maintenance Notes [RULE]

- Disk cleanup guardrail: do **not** delete or prune `/root/.codex/sessions` during routine free-space cleanup. Treat it as retained session history unless the user gives an explicit purge instruction for that path.

## Subagent Execution Policy [RULE]

### Subagent Execution Policy
- Default execution mode for this repo: track work in `bd` and prefer bounded swarm/subagent execution when practical; parent thread remains responsible for final integration and acceptance.
- Default Codex subagent model for this repo is `gpt-5.3-codex`; only use a different model when there is an explicit task-specific reason, and state that reason in the parent packet.
- Real implementation work should be delegated to subagents when practical; the parent thread should stay focused on discovery, coordination, integration, and final acceptance.
- When a subagent is assigned a `bd` issue, pass and execute `bd show <id> --json` up front so the child thread reads the full unfiltered ticket payload instead of relying on a paraphrased summary or a field-filtered projection.
- When implementation is governed by a spec, the parent packet must also include the literal spec path (for example `plan/<spec>.md` or an absolute path when cross-repo) and the child must read that spec before any repo reads/edits.
- Parent-to-subagent issue packets must include the literal first-step command sequence, not just a prose reminder. Required pattern for spec-governed execution:
  - `1. Run \`bd show <id> --json\` and read the full unfiltered payload before any repo reads/edits.`
  - `2. Read the governing spec at \`<path-to-spec.md>\` before any repo reads/edits.`
  - `3. Use the ticket as the bounded execution scope and the spec as the normative contract; if the parent summary conflicts with either, ignore the parent summary.`
  - `4. If the ticket and spec conflict materially, stop and report the mismatch to the parent instead of locally reinterpreting the contract.`
- `spec_id` remains the bd-native issue field for linking a governing specification document. In this repo, spec-governed execution should also duplicate the literal full path in `metadata.source_ref` for machine-friendly consumption.
- When `bd show <id> --json` returns `metadata.source_ref`, that field is the authoritative governing spec full path for the issue.
- If `metadata.source_ref` is absent, fall back to `spec_id` as the governing spec reference.
- If the parent packet provides a different spec path than `metadata.source_ref` (or `spec_id` when no full-path duplicate exists), the child must stop and report the mismatch before any repo reads/edits beyond loading the ticket and the competing spec references.
- Subagents MUST start with a clean history by default (`fork_context=false`); do not spawn child agents with inherited conversation history unless there is an explicit, narrow reason to preserve prior thread state.
- Parent prompts for subagents must be short, decision-complete, and scoped to one bounded write surface.
- Targeted verification can be delegated to subagents, but final integration verification and production deploy/smoke remain the responsibility of the parent thread after all patches are merged.
- Browser-based acceptance is part of the canonical verification flow for UI work; restart `mcp@chrome-devtools.service` before each live browser test cycle so MCP/CDP state is fresh.
- Browser-based acceptance for layout work must include screenshot-level overlap checks; DOM/CSS assertions alone are not enough when footer/status widgets or task panes can visually collide.
- For ACP `/agents`, do not treat the deterministic harness route as a substitute for the real host shell: acceptance must include the actual `/agents` surface inside `MainLayout`, plus focused runtime-contract coverage for the auth-token -> ACP socket -> host-bridge lifecycle.

### Subagent Type Contract
- `worker_*` — bounded implementation agent for one write surface.
- `postreview_*` — independent code-review agent for implemented diffs (must not be the same thread as the worker).
- `fix_*` — focused incident/bugfix implementation worker when the issue scope is already forensics-backed.
- `scholastic_*` — spec/reasoning reviewer that runs ontology-first critique using `greek-scholastic`.

### Scholastic Spec-Review Agent (`scholastic_*`)
- Use this type for spec/prompt/requirements review where ontology correctness and category-mistake detection are required before implementation.
- Mandatory skill: `greek-scholastic: /root/.agents/skills/greek-scholastic/SKILL.md`.
- Default model remains `gpt-5.3-codex` unless explicitly overridden by the parent with rationale.

### Digital Forensics + Swarm Delivery Protocol
- This protocol is mandatory for bug-fix waves and QA-first execution.
- Step 1: **Digital forensics first** (before edits):
  - reproduce the bug in browser/runtime (prefer MCP Chrome tunnel for UI/console/network evidence),
  - inspect related code paths and check `bd` issues/changes for the previous 48h to avoid duplicate/fixed incidents,
  - record forensic evidence in `bd` (symptoms, repro steps, logs, affected endpoints/files, candidate root-cause).
- Step 2: **Implementation swarm**:
  - delegate bounded write-scope fixes to worker subagents (default `gpt-5.3-codex`),
  - each worker packet must start with `bd show <id> --json`,
  - parent thread integrates patches and resolves cross-file conflicts.
- Step 3: **Independent code-review swarm**:
  - run separate review subagents (not the same worker thread) on implemented changes,
  - require severity-ordered findings with file/line references and deploy readiness verdict.
- Step 4: **Verification gates**:
  - run isolated/targeted tests for each fixed bug first,
  - then run full relevant test packs (`backend` and/or `app`),
  - for UI bugs, include screenshot-based overlap/layout validation.
- Step 5: **BD synchronization**:
  - update each `bd` issue with what was reproduced, what was changed, review verdict, and exact test commands/results,
  - only mark as ready/closed after all gates pass; if not reproducible, log "not reproduced" with evidence and keep decision trace.

<!-- BEGIN BEADS INTEGRATION -->
## Issue Tracking with bd (beads) [RULE]

**IMPORTANT**: This project uses **bd (beads)** for ALL issue tracking. Do NOT use markdown TODOs, task lists, or comment-based checklists.

### Why bd?

- Dependency-aware: Track blockers and relationships between issues
- Git-friendly: Auto-syncs to JSONL for version control
- Agent-optimized: JSON output, ready work detection, discovered-from links
- Prevents duplicate tracking systems and confusion

### Quick Start

Issue IDs in this repo look like `copilot-<hash>`.

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
bd update <issue-id> --claim --json
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
2. **Claim your task**: `bd update <id> --claim`
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
- ✅ `bd` is the default tracking surface for everyday work; do not rely on ad hoc side lists as primary planning
- ✅ Prefer bounded swarm/subagent execution when practical, keeping scopes narrow and independently verifiable
- ✅ Before any task that changes project artifacts, ensure there is a bd issue covering that work
- ✅ Treat project artifacts broadly: code, documentation, tests, configs, scripts, migrations, generated project artifacts, and any checked-in file changes all require a bd issue
- ✅ Always use `--json` flag for programmatic use
- ✅ Link discovered work with `discovered-from` dependencies
- ✅ Check `bd ready` before asking "what should I work on?"
- ✅ Create only user-scoped or implementation-scoped issues; keep parser/orchestration probes in memory/logs
- ✅ Keep dated implementation history in `CHANGELOG.md` or `docs/AGENTS_SESSION_HISTORY.md`, not in root `AGENTS.md`
- ✅ Preserve recovered session-handoff notes in dedicated `plan/*-session-resume.md` artifacts or other scoped docs, not in root `AGENTS.md`
- ❌ Do NOT create markdown TODO lists
- ❌ Do NOT use external issue trackers
- ❌ Do NOT duplicate tracking systems
- ❌ Do NOT create synthetic temporary issues in bd (for example `tmp-*`, `*parse-check*`), including `--ephemeral` probe issues

For more details, see `.beads/README.md`, run `bd quickstart`, or use `bd --help`.

### Artifact Change Rule

- If a task will modify any repository artifact, do not start from implicit context alone; create or claim the corresponding `bd` issue first.
- "Artifact change" includes:
  - source code
  - tests
  - documentation
  - configs/env examples
  - scripts/runbooks
  - schemas/migrations
  - checked-in generated artifacts
- If the user asks for a direct file change and no suitable issue exists yet, create a focused `bd` task before editing.

### Telegram MarkdownV2 Rule

- When sending Telegram messages through `tgbot__send_bot_message` with `parse_mode=MARKDOWNV2`, do not send the first draft directly from ad hoc inline text.
- First materialize the message as a fully escaped payload (prefer a local temp file or a clearly inspectable local string), then verify the final escaped text before calling the tool.
- Treat Telegram MarkdownV2 as a strict output format, not a forgiving renderer:
  - escape all dynamic text,
  - especially `>`, `_`, `*`, `[`, `]`, `(`, `)`, `-`, `.`, `!`, and backslashes.
- Goal: avoid repeated live-send failures such as "Can\\'t parse entities" caused by first-draft escaping mistakes.

<!-- END BEADS INTEGRATION -->

## Landing the Plane (Session Completion) [RULE]

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

## Runtime Reference

Runtime specifications, implementation constraints, current-state indexes, and service configuration live in `RUNTIME.md`. That file covers Technology Stack, Development Workflow, PM2 Services, Product Notes, Planning Artifacts, Deployment Endpoints, Portal Auth, Testing, and the implementation constraints formerly maintained in this file under `Minimal Agent Context`.
