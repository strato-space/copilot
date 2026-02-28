# Unified Testing Procedure

This document defines the canonical, repository-level test workflow for Copilot.

## Source Of Truth
- Test platforms, test catalogs, and suite composition are declared in:
  - [platforms.json](/home/strato-space/copilot/platforms.json)
- Suite runner:
  - [scripts/run-test-suite.sh](/home/strato-space/copilot/scripts/run-test-suite.sh)

## Test Catalog Mapping
- `app`
  - unit/contract tests: `app/__tests__`
  - e2e tests: `app/e2e`
- `backend`
  - unit/integration tests: `backend/__tests__`
- `miniapp`
  - unit tests: `miniapp/__tests__`
  - e2e command exists (`npm run test:e2e`), currently configured with `--pass-with-no-tests`

## Canonical Suites
- `baseline`
  - installs Playwright Chromium binaries
  - runs default module tests (`app`, `backend`, `miniapp`) and default e2e
- `voice`
  - runs Voice-focused frontend/backend unit suites, smoke suites, and Voice e2e specs
- `full`
  - runs baseline plus explicit voice-focused suites

## How To Run
From repo root:

```bash
# baseline cross-module health check
./scripts/run-test-suite.sh baseline

# focused Voice validation
./scripts/run-test-suite.sh voice

# maximal suite (baseline + explicit voice)
./scripts/run-test-suite.sh full

# optional fail-fast mode
./scripts/run-test-suite.sh full --fail-fast
```

## Policy
- Any new test directory or test command must be reflected in `platforms.json`.
- `README.md` and `AGENTS.md` must reference this procedure when the testing contract changes.
- Parent and child agents must still run mandatory type-safety gates (`app`/`backend` build) for code changes.
