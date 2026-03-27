# Completed Reference: Full removal of `voice.session_possible_tasks`

## Status ✅Closed
- Task-surface deprecation ticket line: ⚪Open 0  🟡In Progress 0  💤Deferred 0  ⛔Blocked 0  ✅Closed 5
- Runtime state: implemented, deployed, live-verified
- Parent issue: `copilot-kdqs`

## Goal
Remove `voice.session_possible_tasks(session_id)` from active MCP/client/agent contracts after replacing it with a unified session-task surface that preserves:
- mutable draft-baseline semantics
- exact-key lifecycle filtering
- current taskflow refresh behavior

## Replacement contract

Introduce one unified read surface:
- `voice.session_tasks(session_id, bucket, status_keys=None)`

Required buckets:
- `Draft`
  - exact canonical filter: `DRAFT_10`
  - mutable baseline semantics preserved
- `Ready+`
  - exact canonical filters over accepted lifecycle keys:
    - `READY_10`
    - `PROGRESS_10`
    - `REVIEW_10`
    - `DONE_10`
    - `ARCHIVE`
- `Codex`
  - `codex_task = true`

Optional companion read tool:
- `voice.session_task_counts(session_id)`
  - grouped counts for:
    - `Draft`
    - accepted lifecycle keys
    - `Codex`

Mutation contract remains separate:
- `create_session_tasks(session_id, tickets, preview=False)`
- `create_session_codex_tasks(session_id, tickets, preview=False)`
- `delete_session_task(session_id, row_id, bucket='Draft')`

## Consumer inventory

### External active consumers in `/home/tools/voice`
- `src/lib/core.py`
- `src/mcp_voicebot/server.py`
- `src/actions/main.py`
- `AGENTS.md`
- `README.md`
- tests under:
  - `tests/unit/api`
  - `tests/unit/mcp`
  - `tests/unit/actions`

### Active consumers in this repo
- `agents/agent-cards/create_tasks.md`
- `docs/VOICEBOT_API.md`
- `plan/closed/voice-task-surface-normalization-spec.md`

### Runtime route removed in this repo
- `backend/src/api/routes/voicebot/sessions.ts`
  - deprecated `POST /voicebot/possible_tasks` removed

## Migration order completed
1. Added replacement read methods/tools in `/home/tools/voice`
2. Migrated prompts and agent-card instructions to unified read surface
3. Migrated MCP docs and tests in `/home/tools/voice`
4. Migrated docs/spec references in this repo
5. Removed `voice.session_possible_tasks` MCP/client method
6. Removed backend HTTP route after consumers were migrated

## Gates satisfied
- unified replacement tool exists and is documented
- `create_tasks` agent-card uses unified read tool
- `/home/tools/voice` tests are green after migration
- live smoke confirms Voice UI and taskflow refresh still work
- deprecated MCP/client method removed
- deprecated backend HTTP route removed

## Non-goals
- This plan does not remove `create_session_tasks` or `create_session_codex_tasks`
- This plan does not redesign the draft mutability model
- This plan does not reintroduce any session-payload fallback
