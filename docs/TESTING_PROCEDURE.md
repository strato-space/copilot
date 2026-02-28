# Unified Testing Procedure

This document defines the canonical, repository-level test workflow for Copilot.

## Source Of Truth
- Test platforms, test catalogs, and suite composition are declared in:
  - [platforms.json](/home/strato-space/copilot/platforms.json)
- Suite runner:
  - [scripts/run-test-suite.sh](/home/strato-space/copilot/scripts/run-test-suite.sh)

Suite item orchestration metadata (forward-compatible contract):
- `stage` - execution wave index for planned parallel orchestration.
- `resource_lock` - shared resource key (for example Playwright target) to prevent unsafe overlap.

Current shell runner ignores unknown fields and remains backward-compatible while metadata is phased in.

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
  - app e2e runs as two shards (`app-e2e-shard-1of2`, `app-e2e-shard-2of2`)
- `voice`
  - runs Voice-focused frontend/backend unit suites, smoke suites, and Voice e2e specs
  - Voice e2e runs as two shards (`app-voice-e2e-shard-1of2`, `app-voice-e2e-shard-2of2`)
- `full`
  - runs baseline plus dedicated Voice unauth e2e smoke shards
  - does not duplicate Voice unit/backend subsets already covered by `app-unit`, `backend-unit-parallel`, and `backend-unit-serial`
  - backend unit checks are split into `backend-unit-parallel` and `backend-unit-serial`

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

Jest worker knobs for frontend modules:
- `app` and `miniapp` use bounded parallelism by default: `npm run test` runs Jest with `--maxWorkers=${JEST_MAX_WORKERS:-50%}`.
- Override worker count per run: `JEST_MAX_WORKERS=75% npm run test` (or fixed integer, for example `JEST_MAX_WORKERS=4`).
- Use deterministic serial mode for debugging/flaky isolation: `npm run test:serial`.

Backend split execution contract:
- `backend` default `npm run test` now executes two explicit groups: `test:parallel-safe` then `test:serialized`.
- `test:parallel-safe` runs with bounded workers (`BACKEND_JEST_MAX_WORKERS`, default `50%`) and excludes `/__tests__/smoke/`.
- `test:serialized` runs only `/__tests__/smoke/` via `--runInBand`.

Playwright sharding contract:
- `app` non-voice e2e set is split in suites via `test:e2e:shard:1of2` and `test:e2e:shard:2of2`.
- Voice smoke e2e command is split via `test:e2e:voice:shard:1of2` and `test:e2e:voice:shard:2of2`.

## Stage Benchmark Template
For test-pipeline optimization stages, record one full-suite benchmark after each stage using:

```bash
/usr/bin/time -p ./scripts/run-test-suite.sh full 2>&1 | tee /tmp/<stage-id>-full.log
```

Store the following fields in the corresponding `bd` issue notes:
- `stage_id`
- `command`
- `status` (`passed` / `failed`)
- `wall_clock_real_sec` (from `real` line)
- `total_tests_executed`
- `total_test_suites_executed`
- `tests_count_method` (for example: `sum(jest Tests:) + sum(playwright "<n> passed (...)")`)
- `delta_vs_previous_stage_sec` (for stages after baseline)
- `log_path`

## Benchmark History (`full` suite)
| Stage | Change | Wall clock (`real`, s) | Tests | Suites | Delta vs previous | Delta vs baseline |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| `copilot-2gs1.1` | Baseline | 163.97 | 1096 | 284 | n/a | baseline |
| `copilot-2gs1.2` | Removed duplicate Voice subset commands in `full` | 126.82 | 665 | 163 | `+22.66%` | `+22.66%` |
| `copilot-2gs1.3` | Added stage metadata in `platforms.json` | 121.47 | 665 | 163 | `+4.22%` | `+25.92%` |
| `copilot-2gs1.4` | Stage-based parallel executor in unified runner | 108.74 | 665 | 163 | `+10.48%` | `+33.68%` |
| `copilot-2gs1.5` | Frontend Jest workers (`app/miniapp`) | 116.49 | 665 | 163 | `-7.13%` | `+28.96%` |
| `copilot-2gs1.6` | Backend split: parallel-safe + serialized | 89.36 | 665 | 163 | `+23.29%` | `+45.50%` |
| `copilot-2gs1.7` | Playwright shard strategy (app + voice) | 90.00 | 665 | 163 | `-0.72%` | `+45.11%` |
| `copilot-2gs1.8` | Final contract sync + non-voice app shard split | 80.01 | 641 | 163 | `+11.10%` | `+51.20%` |

Notes:
- Stage 8 test count decreased because app shard commands were scoped to non-voice specs; voice specs stay in dedicated voice shard jobs, removing duplicate execution.

## Recommended Defaults
- Local fast iteration:
  - `./scripts/run-test-suite.sh baseline`
- Local focused voice validation:
  - `./scripts/run-test-suite.sh voice`
- CI/merge gate:
  - `./scripts/run-test-suite.sh full --fail-fast`
- Optional worker tuning:
  - frontend Jest: `JEST_MAX_WORKERS=<value|percent>`
  - backend Jest: `BACKEND_JEST_MAX_WORKERS=<value|percent>`

## Policy
- Any new test directory or test command must be reflected in `platforms.json`.
- `README.md` and `AGENTS.md` must reference this procedure when the testing contract changes.
- Parent and child agents must still run mandatory type-safety gates (`app`/`backend` build) for code changes.
