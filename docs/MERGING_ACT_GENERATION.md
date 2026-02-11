# Plan: migrate FinancesPerformersPage to FinOps "Acts" tab

## 1. Goal and scope

**Goal:** move the FinancesPerformersPage functionality from automation/appkanban into copilot/app, and expose it as a new FinOps tab "Acts" (UI label should be `\u0410\u043a\u0442\u044b`).

**In scope:**
- Frontend: performer payments tree, performer payment settings, monthly work hours, payment stats, act generation flow, document preview.
- Backend: performers payments APIs (finances stats, payments tree, save settings, create payment) and month work hours API.
- Google Drive + Google Docs integration for act generation and document tree.

**Out of scope (unless explicitly requested):**
- Upload/download buttons in the folder view (currently no implementation in automation UI).
- Refactoring CRM/FinOps auth model beyond the endpoints involved here.
- New document types beyond the existing act template.

## 2. Current state

### 2.1 automation (source)

Frontend:
- Page: automation/appkanban/src/pages/FinancesPerformersPage.jsx
- Components: automation/appkanban/src/components/finances-performers/*
- Stores: automation/appkanban/src/store/kanban.js + crm store

Backend:
- Routes: automation/crm/routes/performers-payments.js, automation/crm/routes/finances.js
- Controllers: automation/crm/controllers/performers-payments.js, automation/crm/controllers/performer-payments-tree.js, automation/crm/controllers/finances.js

Key behaviors:
- Month/year selectors control metrics month/year in CRM store.
- Month work hours stored in CALENDAR_MONTH_WORK_HOURS.
- Payments tree is built from Google Drive (root folder + performer folders + templates + payments by year/month).
- Payment creation generates a Google Docs act from a template, updates placeholders, stores link in DB, and returns the link.

### 2.2 copilot (target)

Frontend:
- FinOps page: app/src/pages/PlanFactPage.tsx with Tabs (income, expense, bonus, fund).
- OperOps page: app/src/pages/operops/FinancesPerformersPage.tsx is now wired to real store calls.
- CRM store: kanbanStore has real methods for payments tree, performer finances, payment creation, payments settings.
- Components in app/src/components/crm/finances/ are still placeholders and do not match automation UI/logic.

Backend:
- CRM performers-payments endpoints are now migrated with Google Drive/Docs logic and finance stats calculations.
- CRM finances month-work-hours endpoints match automation behavior.
- CRM base path is /api/crm, requestStore points to VITE_CRM_API_URL or /api/crm.

### 2.3 Gap summary (current)

Missing in copilot UI after migration:
- PaymentForm: no works list, missing fields, no bonus calculation, no real document creation flow feedback.
- BonusCalculator: not present in copilot UI.
- PerformerForm: placeholder, does not save via store and lacks original field behavior.
- OperOps FinancesPerformersPage uses placeholder components from app/src/components/crm/finances/.

## 3. Target UX in copilot

Add a new FinOps tab "Acts" inside PlanFactPage Tabs:
- Tab content renders a migrated Acts UI (from FinancesPerformersPage).
- Keep the left tree (performer > templates > payments) and right content pane.
- Keep month/year controls and month work hours input in the top-right section.
- Payment creation flow opens the payment form (act generation) and shows stats.
- Document preview uses iframe when a document node is selected.

## 4. Backend target behavior and contracts

### 4.1 Endpoints to implement (CRM API)

**POST /api/crm/performers-payments/finances**
- Request: { performer_id: string, month: number, year: number }
- Response: { performer_id, month, year, works_statistic, tickets, dailyWorkHoursByDate }

**POST /api/crm/performers-payments/create-payment**
- Request: { performer_id, works, total, paymentData, month, year }
- Behavior: generate Google Doc from template, fill placeholders, store result in DB.
- Response: { documentId, documentLink, payment_folder_name, documentName }

**POST /api/crm/performers-payments/payments-tree**
- Response: { payments_tree } (same structure as automation)

**POST /api/crm/performers-payments/payments-settings**
- Response: array of performers (same fields as automation, incl. payments_settings)

**POST /api/crm/performers-payments/save-payments-settings**
- Request: { performer_id: string, payments_settings: object }
- Response: { result: "success", message: "..." }

**POST /api/crm/finances/month-work-hours**
- Request: { month, year }
- Response: number | null

**POST /api/crm/finances/save-month-work-hours**
- Request: { month, year, month_work_hours }
- Response: update result

### 4.2 Dependencies

Backend needs the same deps as automation:
- googleapis, google-auth-library
- number-to-words-ru
- dayjs (+ customParseFormat, isSameOrAfter, weekOfYear)
- lodash

### 4.3 Configuration

Reuse existing automation config semantics:
- PERFORMERS_PAYMENTS_ROOT_FOLDER_ID (root folder in Google Drive)
- google_service_account.json (service account credentials)

Define the path source (env vs repo file) and document it in copilot backend .env and docs.

## 5. Data and model notes

Collections in copilot constants already mirror automation:
- automation_performers
- automation_performer_payments
- automation_calendar_month_work_hours
- automation_work_hours
- automation_tasks

No schema changes required; migration uses existing collections.

## 6. Frontend migration tasks

1) Keep OperOps FinancesPerformersPage wired to store (done).
2) Replace placeholder components in app/src/components/crm/finances with full implementations from automation:
	- PaymentForm.tsx: restore all fields, works list table, stats panel, bonus calculation, and create payment call.
	- PerformerForm.tsx: restore all fields, dirty state, and save via store.
	- BonusCalculator.tsx: add from automation and wire to kanbanStore.calculateBonus.
3) Ensure PaymentForm uses:
	- fetchPerfrormerFinances on mount
	- metricsMonth from useCRMStore
	- createPayment with works/statistics payload
4) Add UI feedback for document creation:
	- show success message with link
	- optionally open the document in a new tab
5) Maintain input parity with automation:
	- payment_name, payment_date, payment_type, hourly_rate, monthly_rate, payment_method, tax, custom_bonus
6) Reuse ProjectTag component for works list grouping.
7) Add loading state and error handling for long requests.

## 7. Backend migration tasks

Status: completed for performers-payments endpoints and month work hours endpoints. Remaining: optional refactor into shared Google helpers and add richer error handling/metrics.

## 8. Access control

Decide role scope for:
- /api/crm/performers-payments/*
- /api/crm/finances/month-work-hours

Recommendation: Admin or SuperAdmin only, unless explicitly widened.

## 9. Testing plan

Backend:
- Unit test for getFinances stats calculations (work hours aggregation).
- Smoke test for createPayment with mocked Google APIs.

Frontend:
- Validate works list is visible and grouped by project.
- Validate bonus calculation matches automation for the same input.
- Validate payment creation returns link and opens document.

## 10. Rollout plan

1) Implement backend endpoints and verify with Postman or curl.
2) Implement frontend tab and components.
3) Compare output parity with automation appkanban in staging.
4) Enable in copilot dev, then prod.

## 11. Acceptance criteria

- FinOps "Acts" tab reproduces FinancesPerformersPage behavior from automation.
- Payments tree mirrors Google Drive structure and shows templates + payment docs.
- Payment creation generates a Google Doc act and returns a working link.
- Month work hours persist per month/year and affect stats.
- No regressions in other FinOps tabs.

## 12. Risks and mitigations

- Google Drive rate limits: add small delays and retry on 429.
- Missing or misconfigured Drive root folder: add startup checks and clear error message.
- Divergent data in copilot DB: compare with automation DB before cutover.

## 13. Open questions

1) Should the OperOps FinancesPerformersPage remain as-is, or be removed/redirected to FinOps "Acts"?
2) Should the Acts tab use its own month/year selectors (CRM-style) or reuse FinOps focusMonth?
3) Should upload/download actions be implemented for payment folders now, or left as no-op?
4) Confirm the Drive root folder ID and template file name (currently act_template.docx in performer/templates).
