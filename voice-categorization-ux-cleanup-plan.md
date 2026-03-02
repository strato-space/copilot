# Plan: Voice Categorization UX Noise Cleanup + Row Actions

**Generated**: 2026-03-02

## Overview
Apply a strict UX contract for Voice session "Категоризация":
- remove visual noise,
- enforce independent row semantics,
- unify metadata/timestamp rendering with Transcription,
- add Copy/Edit/Delete for categorization text,
- delete linked transcription when the last categorization row in a block is removed,
- remove obsolete "Обработка" column and rendering path.

This revision incorporates subagent review: tighter dependency order, typed API boundaries, realtime update requirements, atomic cascade behavior, and explicit non-prod destructive validation.

## Prerequisites
- Access to `app` and `backend` repos in this workspace.
- `bd` CLI configured for current rig.
- Frontend and backend build/test commands available.
- MCP Chrome connectivity for final manual verification.
- Safe test target for destructive checks (dev/local clone session), while prod session remains read-safe.

## BD Tracking Links
- Epic: [`copilot-7r94`](https://copilot.stratospace.fun/operops/codex/task/copilot-7r94) (`bd show copilot-7r94`)
- T1: [`copilot-7r94.1`](https://copilot.stratospace.fun/operops/codex/task/copilot-7r94.1) (`bd show copilot-7r94.1`)
- T2: [`copilot-7r94.2`](https://copilot.stratospace.fun/operops/codex/task/copilot-7r94.2) (`bd show copilot-7r94.2`)
- T3: [`copilot-7r94.3`](https://copilot.stratospace.fun/operops/codex/task/copilot-7r94.3) (`bd show copilot-7r94.3`)
- T4: [`copilot-7r94.4`](https://copilot.stratospace.fun/operops/codex/task/copilot-7r94.4) (`bd show copilot-7r94.4`)
- T5: [`copilot-7r94.5`](https://copilot.stratospace.fun/operops/codex/task/copilot-7r94.5) (`bd show copilot-7r94.5`)
- T6: [`copilot-7r94.6`](https://copilot.stratospace.fun/operops/codex/task/copilot-7r94.6) (`bd show copilot-7r94.6`)
- T7: [`copilot-7r94.7`](https://copilot.stratospace.fun/operops/codex/task/copilot-7r94.7) (`bd show copilot-7r94.7`)
- T8: [`copilot-7r94.8`](https://copilot.stratospace.fun/operops/codex/task/copilot-7r94.8) (`bd show copilot-7r94.8`)
- T9: [`copilot-7r94.9`](https://copilot.stratospace.fun/operops/codex/task/copilot-7r94.9) (`bd show copilot-7r94.9`)
- T10: [`copilot-7r94.10`](https://copilot.stratospace.fun/operops/codex/task/copilot-7r94.10) (`bd show copilot-7r94.10`)
- T11: [`copilot-7r94.11`](https://copilot.stratospace.fun/operops/codex/task/copilot-7r94.11) (`bd show copilot-7r94.11`)
- Ready queue for this epic: `bd ready --parent copilot-7r94`

## Dependency Graph

```text
T1 ──┬── T2 ──┬── T5 ──┐
     │        │        │
     ├── T3 ──┤        │
     ├── T4 ──┤        ├── T10 ── T11
     └── T6 ── T7 ── T8 ── T9 ──┘
```

## Tasks

### T1: Canonical Categorization Contract + Stable Row Identity
- **depends_on**: []
- **location**:
  - `app/src/types/voice.ts`
  - `app/src/store/voiceBotStore.ts`
  - `app/src/store/sessionsUIStore.ts`
  - `backend/src/api/routes/voicebot/messageHelpers.ts`
- **description**:
  - define stable row identity key (not `message_id-timeStart-timeEnd`),
  - define backend locator priority (`segment_oid` first, strict fallback second),
  - align UI/backend payload contract for categorization row mutations.
- **validation**: contract documented in code/types; no identity collisions in selection/store logic.
- **status**: Not Completed
- **log**:
- **files edited/created**:

### T2: Remove "Обработка" Column + Dead Rendering Path
- **depends_on**: [T1]
- **location**:
  - `app/src/components/voice/Categorization.tsx`
  - `app/src/components/voice/CategorizationStatusColumn.tsx`
  - related imports/usages under `app/src/components/voice/*`
- **description**: remove Processing column from Categorization and eliminate code path/component usage fully.
- **validation**: no column/header/cell rendering for Processing; dead imports removed.
- **status**: Not Completed
- **log**:
- **files edited/created**:

### T3: Visual Noise Cleanup + Independent Row Selection
- **depends_on**: [T1]
- **location**:
  - `app/src/components/voice/CategorizationTableRow.tsx`
  - `app/src/store/sessionsUIStore.ts`
- **description**:
  - hide Unknown user label and avatar icon,
  - show timeline only when non-zero,
  - remove checkbox UI,
  - make row selection strictly row-local,
  - selected style = left vertical accent + full-row fill,
  - remove selection ring/frame styles.
- **validation**: one-row click affects only one row; visual style matches required semantics.
- **status**: Not Completed
- **log**:
- **files edited/created**:

### T4: Reuse Shared Metadata Signature Formatter (Transcription + Categorization)
- **depends_on**: [T1]
- **location**:
  - `app/src/components/voice/TranscriptionTableRow.tsx`
  - `app/src/components/voice/CategorizationTableRow.tsx`
  - shared formatter helper under `app/src/components/voice` or `app/src/utils`
- **description**: extract/reuse one metadata formatter so Categorization gets exact same signature style as Transcription (`2:59 - 2:59, 002-1.webm, 14:26:44`).
- **validation**: both tables use same formatter path; metadata parity verified.
- **status**: Not Completed
- **log**:
- **files edited/created**:

### T5: Materials Column Refactor (No Image-as-Row)
- **depends_on**: [T1, T2, T3, T4]
- **location**:
  - `app/src/store/voiceBotStore.ts`
  - `app/src/components/voice/Categorization.tsx`
  - `app/src/components/voice/CategorizationTableRow.tsx`
  - `app/src/components/voice/CategorizationTableHeader.tsx`
- **description**:
  - never render image as separate text row,
  - render materials only in Materials column,
  - keep free ordering within block,
  - preserve anchor/link semantics and dedupe for image-linked rows,
  - define behavior for image-only blocks (no text rows).
- **validation**: images appear only in Materials column; no dropped image-only blocks.
- **status**: Not Completed
- **log**:
- **files edited/created**:

### T6: Typed API Surface for Categorization Row Edit/Delete
- **depends_on**: [T1]
- **location**:
  - `backend/src/api/routes/voicebot/sessions.ts`
  - backend schema/validator modules used by voicebot routes
- **description**:
  - add typed request/response schemas for categorization row mutations,
  - validate invalid OID, cross-session mismatch, ambiguous locator, already-deleted target,
  - keep runtime filtering and access checks consistent with existing routes.
- **validation**: schema-validated handlers reject malformed payloads with deterministic errors.
- **status**: Not Completed
- **log**:
- **files edited/created**:

### T7: Implement Categorization Edit/Delete + Event Taxonomy + Realtime Emit
- **depends_on**: [T6]
- **location**:
  - `backend/src/api/routes/voicebot/sessions.ts`
  - `backend/src/api/routes/voicebot/messageHelpers.ts`
- **description**:
  - implement mutation handlers for categorization rows,
  - define event names/target path/entity_oid/rollback policy,
  - emit message update to realtime channel (queue/socket path), not just rely on caller refresh.
- **validation**: mutations visible to all live clients; session log contains complete event payloads.
- **status**: Not Completed
- **log**:
- **files edited/created**:

### T8: Atomic Cascade Rule for Single-Row Block Deletion
- **depends_on**: [T7]
- **location**:
  - `backend/src/api/routes/voicebot/sessions.ts`
  - `backend/src/api/routes/voicebot/messageHelpers.ts`
- **description**: when deleting the only categorization row in a block, atomically delete linked transcription and write corresponding log events; if atomic transaction unavailable, provide compensating rollback path.
- **validation**: no partial state after failures; cascade outcome and logs are consistent.
- **status**: Not Completed
- **log**:
- **files edited/created**:

### T9: Frontend Wiring for Categorization Copy/Edit/Delete
- **depends_on**: [T3, T4, T7, T8]
- **location**:
  - `app/src/components/voice/CategorizationTableRow.tsx`
  - `app/src/store/voiceBotStore.ts`
- **description**: connect row-level actions to backend API with proper busy/error states and no cross-row side effects.
- **validation**: Copy/Edit/Delete work for categorization rows; failures are user-visible and recoverable.
- **status**: Not Completed
- **log**:
- **files edited/created**:

### T10: Targeted Regression Test Pack + Build Gates
- **depends_on**: [T5, T9]
- **location**:
  - frontend tests under `app`
  - backend tests under `backend`
- **description**:
  - add focused tests for unknown speaker rendering, metadata signature parity, selection semantics, materials anchoring, row actions,
  - add backend tests for route validation, runtime guards, event logging, idempotency, cascade behavior,
  - enforce mandatory type gates.
- **validation**:
  - `cd app && npm run build`
  - `cd backend && npm run build`
  - new/updated tests pass.
- **status**: Not Completed
- **log**:
- **files edited/created**:

### T11: Manual Verification via MCP Chrome (Prod Read-Safe + Dev Destructive)
- **depends_on**: [T10]
- **location**:
  - `https://copilot.stratospace.fun/voice/session/69a572647f377b054f83d3dd` (read-safe checks)
  - dev/local cloned session for Edit/Delete/Cascade destructive checks
- **description**: execute final UI checklist in browser: tabs, materials, selection visuals, metadata labels, row actions, cascade behavior.
- **validation**: checklist signed off with screenshots/notes.
- **status**: Not Completed
- **log**:
- **files edited/created**:

## Parallel Execution Groups

| Wave | Tasks | Can Start When |
|------|-------|----------------|
| 1 | T1 | Immediately |
| 2 | T2, T3, T4, T6 | T1 complete |
| 3 | T5, T7 | T1+T2+T3+T4 and T6 complete |
| 4 | T8, T9 | T7 complete (+ T3,T4 for T9) |
| 5 | T10 | T5 + T9 complete |
| 6 | T11 | T10 complete |

## Testing Strategy
- Frontend:
  - row rendering/selection behavior tests,
  - metadata signature shared formatter tests,
  - materials placement + image-only block behavior,
  - row actions UX tests.
- Backend:
  - typed payload validation tests,
  - runtime/access scope tests,
  - event taxonomy/session-log shape tests,
  - cascade atomicity/idempotency tests.
- Build gates:
  - `cd app && npm run build`
  - `cd backend && npm run build`
- Manual:
  - MCP Chrome verification checklist on prod read-safe + dev destructive session.

## Risks & Mitigations
- Risk: missing stable segment identifiers in legacy rows.
  - Mitigation: explicit locator hierarchy + safe disable of Edit/Delete when unresolved.
- Risk: file-level merge conflicts across voice UI tasks.
  - Mitigation: enforce wave ordering from dependency graph.
- Risk: realtime mismatch between editing client and observers.
  - Mitigation: mandatory realtime emit in backend mutation flow.
- Risk: MCP Chrome/proxy connectivity issues.
  - Mitigation: mark manual verification as blocked until browser connectivity is restored.
