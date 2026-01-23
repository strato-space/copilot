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

### FEATURE IMPLEMENTED
- Pinned months now allow unpinning the active month as long as at least one month remains pinned (still capped at 3).

### CHANGES
- Added a typed wrapper for summary cells to allow inline sticky styles with Ant Design typings.
- Removed conflicting relative positioning from summary cells to keep sticky offsets accurate.
