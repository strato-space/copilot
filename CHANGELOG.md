# Changelog

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
- OperOps Voice session tasks rendered as dashes because agent output used human-friendly keys (for example, "Task Title", "Deadline", "Dialogue Reference") instead of the UI field names → normalized task objects before rendering the nested table so all columns display values.
- MCP calls to Copilot Agent Services on `:8722` failed with `ERR_SSL_PACKET_LENGTH_TOO_LONG` when the server URL used `https://` even though the service is plain HTTP → updated dev env to use `http://` for `VITE_AGENTS_API_URL`.

### FEATURE IMPLEMENTED
- None.

### CHANGES
- Added task normalization in `app/src/pages/operops/CRMPage.tsx` while keeping compatibility with `exactOptionalPropertyTypes`.
- Documented `/mcp` default path behavior for Streamable HTTP MCP servers in `backend/src/services/mcp/proxyClient.ts`.
- Updated `app/.env.development` to point the agents MCP URL to plain HTTP.
