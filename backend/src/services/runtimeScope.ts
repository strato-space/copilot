export type RuntimeScopeOptions = {
  field?: string;
  strict?: boolean;
  includeLegacyInProd?: boolean;
  runtimeTag?: string;
  prodRuntime?: boolean;
};

export function resolveBetaTag(rawValue: string | undefined): string {
  const value = typeof rawValue === 'string' ? rawValue.trim() : '';
  if (!value) return '';
  const lower = value.toLowerCase();
  if (lower === 'false') return '';
  if (lower === 'true') return 'beta';
  return value;
}

const BETA_TAG = resolveBetaTag(process.env.VOICE_BOT_IS_BETA);
export const RUNTIME_TAG = BETA_TAG ? BETA_TAG : 'prod';
export const IS_PROD_RUNTIME = RUNTIME_TAG === 'prod';

const LEGACY_VALUES = [null, ''] as const;

const RUNTIME_SCOPED_COLLECTION_NAMES = [
  'automation_voice_bot_sessions',
  'automation_voice_bot_messages',
  'automation_voice_bot_topics',
  'automation_tg_voice_sessions',
  'automation_one_use_tokens',
  'automation_prompts_status',
  'automation_agents_status',
  'automation_agents_run_results',
  'automation_permissions_log',
  'automation_voice_bot_session_log',
  'automation_object_locator',
  'automation_object_types',
  'automation_tasks',
  'automation_tasks_histrory',
  'automation_comments',
  'automation_updates',
  'automation_work_hours',
  'automation_calendar_month_work_hours',
  'automation_execution_plans_items',
  'automation_epic_tasks',
  'automation_bot_commands',
  'automation_performer_payments',
  'finops_finances_expenses',
  'finops_finances_income',
  'finops_finances_income_types',
  'facts_project_month',
  'forecasts_project_month',
  'fx_monthly',
  'fund_comments',
  'finops_expense_categories',
  'finops_expense_operations',
  'finops_expense_operations_log',
  'finops_fx_rates',
  'finops_month_closures',
  'automation_reports_log',
  'automation_sync_files',
  'automation_google_drive_events_channels',
  'automation_google_drive_structure',
  'automation_design_data',
  'automation_figma_files_cache',
] as const;

export const RUNTIME_SCOPED_COLLECTIONS = new Set<string>(RUNTIME_SCOPED_COLLECTION_NAMES);

export const isRuntimeScopedCollection = (name: string): boolean =>
  RUNTIME_SCOPED_COLLECTIONS.has(String(name || '').trim());

export const buildRuntimeFilter = ({
  field = 'runtime_tag',
  strict = false,
  includeLegacyInProd = true,
  runtimeTag = RUNTIME_TAG,
  prodRuntime = IS_PROD_RUNTIME,
}: RuntimeScopeOptions = {}): Record<string, unknown> => {
  if (strict) {
    return { [field]: runtimeTag };
  }

  if (prodRuntime && includeLegacyInProd) {
    return {
      $or: [
        { [field]: runtimeTag },
        { [field]: { $exists: false } },
        ...LEGACY_VALUES.map((legacyValue) => ({ [field]: legacyValue })),
      ],
    };
  }

  return { [field]: runtimeTag };
};

export const mergeWithRuntimeFilter = (
  query: Record<string, unknown> = {},
  options: RuntimeScopeOptions = {}
): Record<string, unknown> => {
  const runtimeFilter = buildRuntimeFilter(options);
  if (!query || Object.keys(query).length === 0) {
    return runtimeFilter;
  }
  return { $and: [query, runtimeFilter] };
};

export const recordMatchesRuntime = (
  record: Record<string, unknown> | null | undefined,
  {
    field = 'runtime_tag',
    strict = false,
    includeLegacyInProd = true,
    runtimeTag = RUNTIME_TAG,
    prodRuntime = IS_PROD_RUNTIME,
  }: RuntimeScopeOptions = {}
): boolean => {
  if (!record || typeof record !== 'object') return false;

  const value = record[field];
  const normalized = typeof value === 'string' ? value.trim() : value;

  if (strict) return normalized === runtimeTag;

  if (prodRuntime && includeLegacyInProd) {
    if (normalized === undefined || normalized === null || normalized === '') {
      return true;
    }
  }

  return normalized === runtimeTag;
};
