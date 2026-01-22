export type MonthString = string;
export type Currency = 'RUB' | 'USD';
export type ContractType = 'T&M' | 'Fix';
export type ActorType = 'user' | 'agent' | 'system';

export interface Client {
  client_id: string;
  client_name: string;
  created_at: Date;
}

export interface Project {
  project_id: string;
  crm_project_id: string;
  client_id: string;
  project_name: string;
  subproject_name: string;
  contract_type: ContractType;
  active: boolean;
  fix_hour_cap_total?: number | null;
  default_fix_currency: Currency;
  notes?: string | null;
  row_version: number;
  created_at: Date;
  updated_at: Date;
}

export interface ProjectRate {
  project_id: string;
  month: MonthString;
  rate_rub_per_hour: number;
  created_at: Date;
  created_by: string;
}

export interface Employee {
  employee_id: string;
  crm_employee_id: string;
  full_name: string;
  active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface EmployeeMonthCost {
  employee_id: string;
  month: MonthString;
  salary_rub_month?: number | null;
  working_hours_month?: number | null;
  cost_rate_rub_per_hour?: number | null;
  source_salary: 'manual' | 'crm';
  row_version: number;
  updated_at: Date;
  updated_by: string;
}

export interface TimesheetMonth {
  project_id: string;
  employee_id: string;
  month: MonthString;
  hours_actual: number;
  hours_billable: number;
  snapshot_date: string;
}

export interface FactProjectMonth {
  project_id: string;
  month: MonthString;
  type: ContractType;
  billed_hours: number;
  rate_rub_per_hour_snapshot?: number | null;
  invoice_amount_original?: number | null;
  invoice_currency?: Currency | null;
  fx_used?: number | null;
  fx_manual_used: boolean;
  billed_amount_rub: number;
  comment?: string | null;
  row_version: number;
  updated_at: Date;
  updated_by: string;
  updated_source: ActorType;
}

export interface ForecastVersion {
  forecast_version_id: string;
  year: number;
  name: string;
  type: 'manual' | 'auto';
  is_active: boolean;
  locked: boolean;
  created_at: Date;
  created_by: string;
}

export interface ForecastProjectMonth {
  forecast_version_id: string;
  project_id: string;
  month: MonthString;
  type: ContractType;
  forecast_hours: number;
  rate_rub_per_hour_snapshot?: number | null;
  forecast_amount_original?: number | null;
  forecast_currency?: Currency | null;
  fx_used?: number | null;
  forecast_amount_rub: number;
  forecast_cost_rub: number;
  comment?: string | null;
  row_version: number;
  updated_at: Date;
  updated_by: string;
  updated_source: ActorType;
}

export interface FxMonthly {
  month: MonthString;
  currency: Currency;
  fx_avg?: number | null;
  fx_is_final: boolean;
  manual_override: boolean;
  fx_manual?: number | null;
  fx_forecast?: number | null;
  comment?: string | null;
  updated_at: Date;
  updated_by?: string | null;
}

export interface Period {
  month: MonthString;
  status: 'open' | 'closed';
  closed_at?: Date | null;
  closed_by?: string | null;
}

export interface Attachment {
  attachment_id: string;
  storage_key: string;
  file_name: string;
  content_type: string;
  file_size: number;
  uploaded_at: Date;
  uploaded_by: string;
}

export interface EntityAttachment {
  entity_type: 'FACT' | 'FORECAST' | 'AGENT_REQUEST';
  entity_key: string;
  attachment_id: string;
  created_at: Date;
  created_by: string;
}

export interface AuditEvent {
  event_id: string;
  timestamp: Date;
  actor_type: ActorType;
  actor_id?: string | null;
  action: string;
  entity_type: string;
  entity_key: string;
  changes: unknown[];
  comment?: string | null;
  request_id?: string | null;
}

export interface AgentRequest {
  agent_request_id: string;
  project_id: string;
  month: MonthString;
  scope_fact: boolean;
  scope_forecast: boolean;
  scope_attachments: boolean;
  request_text: string;
  status: 'draft' | 'sent' | 'in_progress' | 'completed' | 'applied' | 'failed' | 'cancelled';
  context_snapshot: Record<string, unknown>;
  created_at: Date;
  created_by: string;
  updated_at: Date;
}

export interface AlertSettings {
  settings_id: string;
  scope: 'system';
  values: Record<string, number>;
  updated_at: Date;
  updated_by: string;
}
