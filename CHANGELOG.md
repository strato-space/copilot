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
- Removed redundant JS files in `admin_app/src` to enforce TypeScript-only sources.
- Added chart layout styles and table header tweaks; adjusted active-month divider color.
- Bumped `admin_app` version to 1.0.1 and added `jest-environment-jsdom` to devDependencies.
- Cleaned local JSON data stubs from `backend/app/data`.
- Added `fxStore` and wired it into FX, analytics, KPI cards, and plan-fact grid calculations.
- Reworked pinned-month summary positioning using shared width constants and sticky wrappers.
- Adjusted directory pages (Employees and Clients/Projects/Rates) layout and helper UI.

## 2026-01-23
### PROBLEM SOLVED
- Pinned-month totals in the plan-fact summary row slipped and appeared only after horizontal scroll → sticky positioning is now applied directly to summary cells so totals stay under pinned months.
- TypeScript builds could re-create JS duplicates inside `admin_app/src` → `noEmit` now prevents output into source folders.
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
- Introduced expense/category seed data and unified expense grid component in `finance-ops/admin_app`.
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
- Host Nginx config now serves the FinOps build from `finance-ops/admin_app/dist` with clean SPA routing.
