export interface PlanFactMonthCell {
  fact_rub: number;
  fact_hours: number;
  forecast_rub: number;
  forecast_hours: number;
  fact_comment?: string;
  forecast_comment?: string;
}

export interface PlanFactProjectRow {
  project_id: string;
  project_name: string;
  subproject_name: string;
  contract_type: string;
  rate_rub_per_hour?: number | null;
  months: Record<string, PlanFactMonthCell>;
}

export interface PlanFactCustomerRow {
  customer_id: string;
  customer_name: string;
  totals_by_month: Record<string, PlanFactMonthCell>;
  projects: PlanFactProjectRow[];
}

export interface PlanFactGridResponse {
  forecast_version_id: string;
  customers: PlanFactCustomerRow[];
}

export interface PlanFactCellContext {
  customer_id: string;
  customer_name: string;
  project_id: string;
  project_name: string;
  subproject_name: string;
  contract_type: string;
  rate_rub_per_hour?: number | null;
  month: string;
  edit_mode?: 'fact' | 'forecast';
  values: PlanFactMonthCell;
}
