# Plan: Voice Session Done REST Parity for mcp@voice and actions@voice

**Generated**: 2026-03-03

## Session Context
- Source session: `69a527c14b07162c36957e21`
- Source URL: `https://copilot.stratospace.fun/voice/session/69a527c14b07162c36957e21`

## BD Tracking
- Epic: `copilot-7b9y`
- T1: `copilot-7b9y.1`
- T2: `copilot-7b9y.2`
- T3: `copilot-7b9y.3`
- T4: `copilot-7b9y.4`
- T5: `copilot-7b9y.5`
- T6: `copilot-7b9y.6`
- T7: `copilot-7b9y.7`
- T8: `copilot-7b9y.8`
- T9: `copilot-7b9y.9`
- T10: `copilot-7b9y.10`

## Overview
The current state is split across two entrypoints:
- Copilot backend treats `POST /api/voicebot/session_done` (alias `POST /api/voicebot/close_session`) as the canonical close path for Voice UI `Done`, with permission/access checks in the REST route and shared execution through `completeSessionDoneFlow`.
- `tools/voice` still closes sessions by opening a Socket.IO client and emitting `session_done`, which reaches the backend socket handler. The socket handler already reuses `completeSessionDoneFlow`, so the business effect is close to the UI path, but the transport, auth surface, source metadata, timeout behavior, and failure semantics are not the same as the canonical REST contract.

Goal: make `VoicebotClient.done_session()` and `done_active_session()` call the backend REST close route, so `mcp@voice`, `actions@voice`, and the CLI all reuse the same backend code path as the Copilot UI. Preserve the current external `tools/voice` response shape (`ok`, `session_id`, `url`, `source`) unless an explicit API contract change is approved.

## Current Findings
- Canonical backend close route: `/home/strato-space/copilot/backend/src/api/routes/voicebot/sessions.ts`
- Shared backend close orchestration: `/home/strato-space/copilot/backend/src/services/voicebotSessionDoneFlow.ts`
- Backend socket fallback path still exists and also calls the same orchestration: `/home/strato-space/copilot/backend/src/api/socket/voicebot.ts`
- Current `tools/voice` transport is Socket.IO-based: `/home/tools/voice/src/lib/core.py`
- `mcp@voice` and `actions@voice` already delegate to `VoicebotClient`, so most behavioral change can be centralized in the client.

## Assumptions
- Preserve the public `tools/voice` output contract for `done_session` / `done_active_session` to avoid breaking MCP tools, Actions endpoints, and CLI scripts.
- Prefer `POST /voicebot/session_done` as the canonical upstream call.
- Legacy fallback to `POST /voicebot/close_session` is compatibility-only and must be attempted only for true route-absence signatures, not for normal backend business errors.
- Do not remove backend socket `session_done` handling in this scope; only stop relying on it from `tools/voice` clients.
- No automatic retry on timeout, connection reset, generic 5xx, or ambiguous failures, because `completeSessionDoneFlow` can mutate session state before returning an error.

## Prerequisites
- Access to `/home/tools/voice`
- Access to `/home/strato-space/copilot`
- Existing auth in `VoicebotClient` via `VOICEBOT_API_URL`, `VOICEBOT_LOGIN`, `VOICEBOT_PASSWORD`
- Targeted test execution in the `voice` repo (`pytest`)

## Dependency Graph

```text
T1 ── T2 ── T3 ── T4 ──┬── T5 ──┐
                       ├── T6 ──┼── T9 ── T10
                       ├── T7 ──┤
                       └── T8 ──┘
```

## Tasks

### T1: Freeze done-session parity contract
- **depends_on**: []
- **location**:
  - `/home/tools/voice/src/lib/core.py`
  - `/home/tools/voice/README.md`
  - `/home/strato-space/copilot/backend/src/api/routes/voicebot/sessions.ts`
- **description**:
  - Document the target contract for `tools/voice` close operations:
    - upstream transport switches from Socket.IO emit to backend REST `POST /voicebot/session_done`
    - external `tools/voice` return shape remains stable (`ok`, `session_id`, `url`, `source`)
    - backend `notify_preview.event_name` may be preserved as optional passthrough metadata if useful, but should not be required for callers
    - the close helper must use an explicit timeout budget (target: `5s`) to match current socket ack behavior, not the generic `_request()` default `30s`
    - HTTP errors and backend `{ error: ... }` responses must still raise deterministic, actionable client errors
  - Freeze fallback and retry rules:
    - fallback to `/voicebot/close_session` is allowed only for route-absence signatures (for example: `404/405` with non-JSON route-not-found body, or a `404` body that clearly indicates the route is missing)
    - do not fallback if the backend returned JSON with a known application error such as `session_not_found`, `forbidden`, `insufficient_permissions`, `invalid_session_id`, or `chat_id_missing`
    - do not automatically retry on timeout, transport errors, or 5xx
- **validation**:
  - The contract is reflected in tests and docs, and the implementation plan does not mix raw backend payloads with legacy client payloads.
- **status**: Completed
- **log**:
  - Added an explicit frozen close-path parity contract constant in `tools/voice` (`SESSION_DONE_REST_PARITY_CONTRACT`) covering target REST transport, 5s timeout, stable outward payload keys, narrow route-absence-only alias fallback, and no-retry rules.
  - Added a client-side payload assertion helper so `done_session()` / `done_active_session()` continue to enforce the stable external `ok/session_id/url/source` response shape without mixing in raw backend REST payload fields.
  - Documented the frozen contract in `tools/voice/README.md`.
  - Added `tools/voice` unit coverage that pins the contract constant and the stable payload assertion behavior.
  - Added a backend route-level contract constant (`SESSION_DONE_REST_CONTRACT`) to document canonical REST success/error semantics separately from the legacy `tools/voice` wrapper payload.
  - Extended backend tests to assert the REST route does not expose legacy client wrapper keys (`ok/session_id/url/source`) and to pin the route/client parity contract metadata in source.
  - Validation: `cd /home/tools/voice && pytest -o addopts='' tests/unit/api/test_done_session_contract.py` passed; `cd /home/strato-space/copilot/backend && npm run build` passed; backend Jest parity tests passed.
  - Validation gotcha: the existing legacy socket tests in `/home/tools/voice/tests/test_session_done.py` fail before T2 due stale fake Socket.IO test doubles that do not accept the current `auth` / `namespaces` kwargs; T1 intentionally did not refactor that transport.
- **files edited/created**:
  - `/home/tools/voice/src/lib/core.py`
  - `/home/tools/voice/README.md`
  - `/home/tools/voice/tests/unit/api/test_done_session_contract.py`
  - `/home/strato-space/copilot/backend/src/api/routes/voicebot/sessions.ts`
  - `/home/strato-space/copilot/backend/__tests__/voicebot/runtime/sessionUtilityRoutes.test.ts`
  - `/home/strato-space/copilot/backend/__tests__/voicebot/session/sessionDoneRoute.test.ts`
  - `/home/strato-space/copilot/plan/69a527c14b07162c36957e21-voice-session-done-rest-parity-plan.md`

### T2: Add client-level tests that codify the new transport contract first
- **depends_on**: [T1]
- **location**:
  - `/home/tools/voice/tests/unit/api/`
  - `/home/tools/voice/src/lib/core.py`
- **description**:
  - Add or extend unit tests for `VoicebotClient.done_session()` / `done_active_session()` before the refactor so the desired behavior is locked in:
    - canonical `POST /voicebot/session_done` request path and request body
    - explicit `timeout=5` usage
    - narrow compatibility fallback behavior (only for true route absence, if retained)
    - preservation of normalized outward response shape
    - deterministic error mapping for `400`, `403`, `404`, and `409 chat_id_missing`
    - no retry on timeout/network failure/5xx
    - rejection of empty, non-JSON, non-dict, `{}`, or `{ "success": false }` success payloads
    - proof that `socketio` is no longer required (for example, by making it unavailable in the test environment while REST close still succeeds)
  - If needed, split into “expected failure against old implementation” and “passes after refactor” assertions.
- **validation**:
  - New tests fail against the old socket-based implementation and pass once the REST helper is wired.
- **status**: Completed
- **log**:
  - Added direct unit coverage for public `VoicebotClient.done_session()` / `done_active_session()` in `tests/unit/api/test_done_session_client_methods.py`.
  - The new suite pins REST-first transport expectations: `POST /voicebot/session_done`, `timeout=5`, preserved outward payload shape, alias fallback only for true route absence, deterministic business-error surfacing, no retry on timeout/5xx, malformed success rejection, and no `socketio` dependency.
  - Validation was intentionally run before the refactor and failed against the legacy implementation because `done_session()` still touched `socketio.Client`; that expected fail established the contract boundary before T3/T4.
  - Validation after T3/T4: `cd /home/tools/voice && ./.venv/bin/python -m pytest -o addopts='' tests/unit/api/test_done_session_client_methods.py -q` passed (`13 passed`).
- **files edited/created**:
  - `/home/tools/voice/tests/unit/api/test_done_session_client_methods.py`

### T3: Add a REST-backed close helper in `VoicebotClient`
- **depends_on**: [T1, T2]
- **location**:
  - `/home/tools/voice/src/lib/core.py`
- **description**:
  - Add a private helper (for example `_done_session_via_rest(session_id)`) that:
    - validates `session_id`
    - calls `self._request("POST", "/voicebot/session_done", json={"session_id": sid}, timeout=5)`
    - optionally falls back to `POST /voicebot/close_session` only on route-absence signatures defined in T1
    - never retries on timeout, connection reset, generic 5xx, or ambiguous transport failures
    - rejects empty responses, non-JSON responses, non-dict JSON, malformed success payloads, and `{ "success": false }`
    - catches `requests.HTTPError`, inspects `exc.response`, extracts backend JSON `{ error: ... }` when available, and re-raises deterministic client errors instead of leaking generic HTTP messages
  - Explicitly treat `409 chat_id_missing` as a surfaced backend error with partial-success risk, not as a retry candidate.
- **validation**:
  - Client helper can successfully parse `{ success: true, notify_preview: ... }`, can distinguish route-missing vs business-error 404s, and surfaces backend errors deterministically.
- **status**: Completed
- **log**:
  - Added private REST close helpers in `VoicebotClient`: HTTP error extraction, route-absence detection, deterministic HTTP error mapping, success-payload validation, and `_done_session_via_rest(session_id)`.
  - The helper now calls `POST /voicebot/session_done` with `timeout=5`, allows fallback to `POST /voicebot/close_session` only for narrow route-absence signatures, and never retries on timeout/transport failures/5xx.
  - Empty, non-JSON, non-dict, empty-dict, and `{ "success": false }` success-path payloads now fail explicitly with structured client-side error messages.
  - Validation is covered by the client-level close test suite introduced in T2.
- **files edited/created**:
  - `/home/tools/voice/src/lib/core.py`

### T4: Rewire public client methods to the REST helper
- **depends_on**: [T3]
- **location**:
  - `/home/tools/voice/src/lib/core.py`
- **description**:
  - Update `done_session(session_ref)` to:
    - resolve `session_ref` to canonical `session_id`
    - invoke the REST close helper
    - return the existing normalized `tools/voice` payload (`ok`, `session_id`, `url`, `source: "explicit"`), optionally enriched with non-breaking metadata
  - Update `done_active_session()` to:
    - continue using `get_active_session(include_closed=False)`
    - close the resolved `session_id` through the same REST helper
    - return the existing normalized payload (`source: "active"`)
  - Ensure both methods no longer call `self.voicebot.sessions.session_done(...)`.
- **validation**:
  - Both public methods share one transport path and preserve current outward return keys for existing wrappers and scripts.
- **status**: Completed
- **log**:
  - Rewired public `done_session()` and `done_active_session()` to use the shared REST helper instead of `self.voicebot.sessions.session_done(...)`.
  - Preserved the stable outward client payload (`ok`, `session_id`, `url`, `source`) and now pass through `notify_preview` only as optional non-breaking metadata when present.
  - Public close methods no longer require `python-socketio`; the legacy low-level socket helper remains available but is no longer the transport used by the public wrappers.
  - Validation: `cd /home/tools/voice && ./.venv/bin/python -m pytest -o addopts='' tests/unit/api/test_done_session_client_methods.py tests/unit/api/test_done_session_contract.py -q` passed (`16 passed`).
- **files edited/created**:
  - `/home/tools/voice/src/lib/core.py`

### T5: Verify and update `actions@voice` parity
- **depends_on**: [T4]
- **location**:
  - `/home/tools/voice/src/actions/main.py`
  - `/home/tools/voice/tests/unit/actions/test_actions_api_unit.py`
- **description**:
  - Keep the existing Actions endpoints (`/voicebot/done_active_session`, `/voicebot/done_session`) but ensure they now inherit REST-backed close semantics through `VoicebotClient`.
  - Update unit tests to assert the externally visible response contract still matches expectations after the transport change.
  - If non-breaking metadata (such as `notify_preview`) is surfaced, add assertions for it only when stable.
- **validation**:
  - Actions endpoint tests remain green and no route schema drift is introduced.
- **status**: Not Completed
- **log**:
- **files edited/created**:

### T6: Verify and update `mcp@voice` parity
- **depends_on**: [T4]
- **location**:
  - `/home/tools/voice/src/mcp_voicebot/server.py`
  - `/home/tools/voice/tests/unit/mcp/test_voicebot_new_tools.py`
- **description**:
  - Keep the existing MCP tools (`done_active_session`, `done_session`) but ensure they now inherit REST-backed close semantics through `VoicebotClient`.
  - Update MCP unit tests only where the outward payload changes or newly guaranteed metadata is exposed.
  - Confirm no tool signature change is required.
- **validation**:
  - MCP tests still pass and tool signatures remain backward compatible.
- **status**: Not Completed
- **log**:
- **files edited/created**:

### T7: Add explicit CLI parity coverage
- **depends_on**: [T4]
- **location**:
  - `/home/tools/voice/src/cli/main.py`
  - `/home/tools/voice/tests/unit/test_cli_voice_sessions.py`
- **description**:
  - Keep CLI commands (`done-active-session`, `done-session`) on the same public client methods, but add explicit test coverage for:
    - preserved success output shape
    - surfaced deterministic exception/error messaging on backend failures
    - no hidden dependency on `python-socketio`
  - Confirm no CLI flag or output format change is required.
- **validation**:
  - CLI tests catch regressions in success and failure behavior before the final validation wave.
- **status**: Not Completed
- **log**:
- **files edited/created**:

### T8: Update operator-facing docs and contracts
- **depends_on**: [T4]
- **location**:
  - `/home/tools/voice/AGENTS.md`
  - `/home/tools/voice/README.md`
  - `/home/tools/voice/docs/SRS_VOICE_SESSION.md`
- **description**:
  - Replace the outdated claim that `done_active_session()` / `done_session()` close sessions via socket `session_done`.
  - Clarify that `tools/voice` now reuses the backend REST close path (`POST /api/voicebot/session_done`, alias `/close_session`) and that websocket is no longer the initiating transport for these automation surfaces.
  - Document the explicit timeout budget and no-retry rule.
  - Document any retained compatibility behavior (for example, alias fallback only for route absence).
- **validation**:
  - Repository docs no longer contradict the actual runtime behavior.
- **status**: Not Completed
- **log**:
- **files edited/created**:

### T9: Run the validation matrix and smoke the end-to-end close flow
- **depends_on**: [T5, T6, T7]
- **location**:
  - `/home/tools/voice/tests/unit/api/`
  - `/home/tools/voice/tests/unit/actions/test_actions_api_unit.py`
  - `/home/tools/voice/tests/unit/mcp/test_voicebot_new_tools.py`
  - `/home/tools/voice/tests/unit/test_cli_voice_sessions.py`
- **description**:
  - Run targeted automated validation in `tools/voice`, covering:
    - client-level close tests
    - Actions API unit tests
    - MCP unit tests
    - CLI unit tests for `done-active-session` and `done-session`
  - If environment and credentials allow, run a manual smoke against a disposable or test session:
    - create/activate a test session
    - close it through `VoicebotClient.done_session()` or `done_active_session()`
    - verify closure via a direct session read path (`get_session()`, `fetch()`, or an equivalent backend session-detail call), not `get_active_session(include_closed=False)`
    - confirm `is_active=false`, `to_finalize=true`, and `done_at` is populated
- **validation**:
  - All targeted tests pass and the smoke demonstrates that `tools/voice` now triggers the same REST close path as the Copilot UI.
- **status**: Not Completed
- **log**:
- **files edited/created**:

### T10: Post-implementation validation on session `69a527c14b07162c36957e21`
- **depends_on**: [T1, T2, T3, T4, T5, T6, T7, T8, T9]
- **location**:
  - `/home/tools/voice/src/actions/main.py`
  - `https://copilot.stratospace.fun/voice/session/69a527c14b07162c36957e21`
- **description**:
  - After the full epic lands, execute the real validation against the source session:
    - close session `69a527c14b07162c36957e21` through `actions@voice` so the automation path uses the same REST-first close transport
    - verify that `Возможные задачи` refreshed after close/finalization processing
    - verify that summary/finalization was prepared
    - verify that the resulting summary was delivered to Telegram
  - Allow up to `3 minutes` for background processing before treating the run as failed.
- **validation**:
  - The session closes through the new path and all downstream side effects complete within the allowed wait window.
- **status**: Not Completed
- **log**:
- **files edited/created**:

## Parallel Execution Groups

| Wave | Tasks | Can Start When |
|------|-------|----------------|
| 1 | T1 | Immediately |
| 2 | T2 | T1 complete |
| 3 | T3 | T1, T2 complete |
| 4 | T4 | T3 complete |
| 5 | T5, T6, T7, T8 | T4 complete |
| 6 | T9 | T5, T6, T7 complete |
| 7 | T10 | T1-T9 complete |

## Testing Strategy
- Add direct client-level coverage for the transport change before the refactor lands; wrapper-only coverage is not sufficient.
- Re-run existing wrapper tests in Actions, MCP, and CLI to catch output-contract regressions.
- Preserve backward compatibility in tool outputs while changing only the internal transport.
- Use a real smoke session only after unit coverage passes, because the main risk is transport/response normalization, not the backend done-flow itself.
- Explicitly test `409 chat_id_missing`, route-missing compatibility fallback, timeout handling, malformed success responses, and the absence of `python-socketio`.
- Reserve a real post-implementation run against session `69a527c14b07162c36957e21`, because this is the only check that proves downstream finalization and Telegram delivery still work after the transport swap.

## Risks & Mitigations
- **Risk**: Returning raw backend REST payloads will break existing callers that expect `{ok, session_id, url, source}`.
  - **Mitigation**: Normalize backend response inside `VoicebotClient` and keep the public contract stable.
- **Risk**: A naive `404 => fallback` rule will misclassify real business errors such as `session_not_found`.
  - **Mitigation**: Only fallback on route-absence signatures; never fallback on JSON application errors.
- **Risk**: Automatic retries on timeout or ambiguous failures can double-close a session and increment `done_count` again.
  - **Mitigation**: No automatic retry except a strict route-absence compatibility fallback.
- **Risk**: Error semantics drift between HTTP exceptions and the old socket ack path.
  - **Mitigation**: Catch `HTTPError`, parse backend `{ error: ... }`, and re-raise deterministic client errors; cover these in tests.
- **Risk**: `409 chat_id_missing` can be returned after the backend already marked the session done.
  - **Mitigation**: Treat it as a surfaced backend error with partial-success risk, never as a retry case, and document it explicitly.
- **Risk**: Docs and tests continue to describe the old socket transport, causing future regressions.
  - **Mitigation**: Update AGENTS/README/SRS in the same change and keep transport assertions in tests.
- **Risk**: Backend socket path still exists, so future contributors may accidentally revert to it.
  - **Mitigation**: Document REST-first as the only initiating path for `tools/voice`, while leaving backend socket support as a compatibility/server-internal concern.

## Task Mapping

| Plan Task | BD Issue |
|-----------|----------|
| T1 | copilot-7b9y.1 |
| T2 | copilot-7b9y.2 |
| T3 | copilot-7b9y.3 |
| T4 | copilot-7b9y.4 |
| T5 | copilot-7b9y.5 |
| T6 | copilot-7b9y.6 |
| T7 | copilot-7b9y.7 |
| T8 | copilot-7b9y.8 |
| T9 | copilot-7b9y.9 |
| T10 | copilot-7b9y.10 |
