# Runtime Isolation Audit (2026-02-18)

Scope: `/home/strato-space/copilot/backend/src`  
Goal: locate probable runtime-scope gaps for `runtime_tag` enforcement in runtime-scoped collections.

## Method
- Heuristic scan of `db.collection(...)` calls for runtime-scoped collections.
- Marked call as "potentially unguarded" when nearby lines did not contain obvious runtime helpers:
  - `mergeWithRuntimeFilter`
  - `runtimeSessionQuery`
  - `runtimeMessageQuery`
  - `recordMatchesRuntime`
  - `buildRuntimeFilter`
  - `runtime_tag`

## Summary
- Total runtime-scoped collection hits: `69`
- Potentially unguarded (heuristic): `51`

## Highest-priority candidates
- `backend/src/api/routes/voicebot/transcription.ts`
  - several direct `findOne/find/update` calls for `SESSIONS` and `MESSAGES`.
- `backend/src/api/routes/voicebot/uploads.ts`
  - direct writes/reads in legacy upload aliases and message attachment handlers.
- `backend/src/api/routes/voicebot/permissions.ts`
  - writes/reads from `PERMISSIONS_LOG` without explicit runtime helper nearby.
- `backend/src/services/voicebotObjectLocator.ts`
  - `OBJECT_LOCATOR` upsert/find without explicit runtime helper nearby.
- `backend/src/permissions/permission-manager.ts`
  - session reads for access checks likely need strict runtime scoping.

## Notes
- This is a fast static audit; false positives are expected.
- Next step for `copilot-2s0` / `copilot-3h6`:
  1. manually validate each candidate path,
  2. apply runtime helper wrappers where missing,
  3. add focused regression tests for cross-runtime leakage (`404`/`409` contracts).
