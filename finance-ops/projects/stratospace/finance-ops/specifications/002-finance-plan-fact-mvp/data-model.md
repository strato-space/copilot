# Data Model — Finance Ops Console (MVP)

> Модель ориентирована на MongoDB, но отражает бизнес‑сущности и связи из спецификации.

## Сущности

### Client
- `client_id` (string/uuid)
- `client_name` (string, unique)

### Project
- `project_id` (string/uuid)
- `crm_project_id` (string)
- `client_id` (ref → Client)
- `project_name` (string)
- `subproject_name` (string)
- `contract_type` (`T&M` | `Fix`)
- `active` (bool)
- `fix_hour_cap_total` (number, optional)
- `default_fix_currency` (`RUB` | `USD`)
- `notes` (string)
- `row_version` (int)

### ProjectRate (history)
- `project_id` (ref → Project)
- `month` (YYYY‑MM)
- `rate_rub_per_hour` (int)
- `created_at`, `created_by`

### Employee
- `employee_id` (string/uuid)
- `crm_employee_id` (string)
- `full_name` (string)
- `active` (bool)

### EmployeeMonthCost
- `employee_id` (ref → Employee)
- `month` (YYYY‑MM)
- `salary_rub_month` (int, nullable)
- `working_hours_month` (number, nullable)
- `cost_rate_rub_per_hour` (number, nullable)
- `source_salary` (`manual` | `crm`)
- `row_version` (int)

### TimesheetMonth
- `project_id` (ref → Project)
- `employee_id` (ref → Employee)
- `month` (YYYY‑MM)
- `hours_actual` (number)
- `hours_billable` (number)
- `snapshot_date` (YYYY‑MM‑DD)

### FactProjectMonth
- `project_id` (ref → Project)
- `month` (YYYY‑MM)
- `type` (`T&M` | `Fix`)
- `billed_hours` (number, for T&M)
- `rate_rub_per_hour_snapshot` (int)
- `invoice_amount_original` (number, for Fix)
- `invoice_currency` (`RUB` | `USD`)
- `fx_used` (number)
- `fx_manual_used` (bool)
- `billed_amount_rub` (int)
- `comment` (string)
- `row_version` (int)
- `updated_at`, `updated_by`, `updated_source` (`user` | `agent` | `system`)

### ForecastVersion
- `forecast_version_id` (string/uuid)
- `year` (int)
- `name` (string)
- `type` (`manual` | `auto`)
- `is_active` (bool)
- `locked` (bool)
- `created_at`, `created_by`

### ForecastProjectMonth
- `forecast_version_id` (ref → ForecastVersion)
- `project_id` (ref → Project)
- `month` (YYYY‑MM)
- `type` (`T&M` | `Fix`)
- `forecast_hours` (number)
- `rate_rub_per_hour_snapshot` (int)
- `forecast_amount_original` (number)
- `forecast_currency` (`RUB` | `USD`)
- `fx_used` (number)
- `forecast_amount_rub` (int)
- `forecast_cost_rub` (int)
- `comment` (string)
- `row_version` (int)
- `updated_at`, `updated_by`, `updated_source`

### FxMonthly
- `month` (YYYY‑MM)
- `currency` (`USD`)
- `fx_avg` (number)
- `fx_is_final` (bool)
- `manual_override` (bool)
- `fx_manual` (number)
- `fx_forecast` (number)
- `comment` (string)

### Period
- `month` (YYYY‑MM)
- `status` (`open` | `closed`)
- `closed_at`, `closed_by`

### Attachment
- `attachment_id` (string/uuid)
- `storage_key` (string)
- `file_name` (string)
- `content_type` (string)
- `file_size` (int)
- `uploaded_at`, `uploaded_by`

### EntityAttachment
- `entity_type` (`FACT` | `FORECAST` | `AGENT_REQUEST`)
- `entity_key` (string)
- `attachment_id` (ref → Attachment)

### AuditEvent
- `event_id` (string/uuid)
- `timestamp`
- `actor_type` (`user` | `agent` | `system`)
- `actor_id`
- `action`
- `entity_type`
- `entity_key`
- `changes` (json array)
- `comment`
- `request_id`

### AgentRequest
- `agent_request_id` (string/uuid)
- `project_id` (ref → Project)
- `month` (YYYY‑MM)
- `scope_fact` (bool)
- `scope_forecast` (bool)
- `scope_attachments` (bool)
- `request_text` (string)
- `status` (`draft` | `sent` | `in_progress` | `completed` | `applied` | `failed` | `cancelled`)
- `context_snapshot` (json)
- `created_at`, `created_by`, `updated_at`

### AlertSettings
- `settings_id` (string/uuid)
- `scope` (`system`)
- `values` (json)
- `updated_at`, `updated_by`

## Валидации и правила
- Значения часов и сумм неотрицательные.
- Для `T&M` требуется ставка; для `Fix` вводятся суммы, `billed_hours = 0`.
- Для USD‑сумм требуется FX (auto или manual с комментарием).
- `Period.status=closed` блокирует изменения факта.
- `row_version` обязателен для оптимистичной блокировки.

## Связи
- Client 1‑N Project
- Project 1‑N FactProjectMonth / ForecastProjectMonth / TimesheetMonth
- ForecastVersion 1‑N ForecastProjectMonth
- Employee 1‑N EmployeeMonthCost / TimesheetMonth
- Attachment N‑N Fact/Forecast/AgentRequest через EntityAttachment
