import os from 'node:os';

export type RuntimeFamily = 'prod' | 'dev';

export type RuntimeScopeOptions = {
  field?: string;
  strict?: boolean;
  includeLegacyInProd?: boolean;
  familyMatch?: boolean;
  runtimeTag?: string;
  runtimeFamily?: RuntimeFamily;
  prodRuntime?: boolean;
};

export type RuntimeScopeExprOptions = Omit<RuntimeScopeOptions, 'field'> & {
  fieldExpr?: string;
};

export function resolveBetaTag(rawValue: string | undefined): string {
  const value = typeof rawValue === 'string' ? rawValue.trim() : '';
  if (!value) return '';
  const lower = value.toLowerCase();
  if (lower === 'false') return '';
  if (lower === 'true') return 'beta';
  return value;
}

const normalizeToken = (value: string | undefined | null): string => {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  const normalized = raw.replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return normalized;
};

const resolveRuntimeFamily = (): RuntimeFamily => {
  const explicit = normalizeToken(process.env.VOICE_RUNTIME_ENV);
  if (explicit === 'prod' || explicit === 'dev') return explicit;

  const nodeEnv = normalizeToken(process.env.NODE_ENV);
  if (nodeEnv === 'production' || nodeEnv === 'prod') return 'prod';

  const legacy = normalizeToken(resolveBetaTag(process.env.VOICE_BOT_IS_BETA));
  if (legacy.startsWith('prod')) return 'prod';
  return 'dev';
};

const resolveRuntimeServerName = (): string => {
  const explicit = normalizeToken(process.env.VOICE_RUNTIME_SERVER_NAME);
  if (explicit) return explicit;

  const host = normalizeToken(process.env.HOSTNAME || os.hostname());
  if (host) return host;

  return 'unknown-host';
};

const resolveRuntimeTag = (): string => {
  const explicit = normalizeToken(process.env.VOICE_RUNTIME_TAG);
  if (explicit) return explicit;
  return `${resolveRuntimeFamily()}-${resolveRuntimeServerName()}`;
};

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const RUNTIME_FAMILY = resolveRuntimeFamily();
export const RUNTIME_SERVER_NAME = resolveRuntimeServerName();
export const RUNTIME_TAG = resolveRuntimeTag();
export const IS_PROD_RUNTIME = RUNTIME_FAMILY === 'prod';

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
  includeLegacyInProd = false,
  familyMatch = false,
  runtimeTag = RUNTIME_TAG,
  runtimeFamily = RUNTIME_FAMILY,
  prodRuntime = IS_PROD_RUNTIME,
}: RuntimeScopeOptions = {}): Record<string, unknown> => {
  if (strict) {
    return { [field]: runtimeTag };
  }

  if (familyMatch) {
    const familyFilter: Array<Record<string, unknown>> = [
      { [field]: { $regex: `^${escapeRegex(runtimeFamily)}(?:-|$)` } },
    ];

    if (prodRuntime && includeLegacyInProd) {
      familyFilter.push({ [field]: { $exists: false } });
      for (const legacyValue of LEGACY_VALUES) {
        familyFilter.push({ [field]: legacyValue });
      }
    }

    return familyFilter.length === 1
      ? (familyFilter[0] as Record<string, unknown>)
      : { $or: familyFilter };
  }

  return { [field]: runtimeTag };
};

const buildRuntimeFilterExpressionForPath = ({
  fieldExpr = '$runtime_tag',
  strict = false,
  includeLegacyInProd = false,
  familyMatch = false,
  runtimeTag = RUNTIME_TAG,
  runtimeFamily = RUNTIME_FAMILY,
  prodRuntime = IS_PROD_RUNTIME,
}: RuntimeScopeExprOptions = {}): Record<string, unknown> => {
  if (strict) {
    return { $eq: [fieldExpr, runtimeTag] };
  }

  if (familyMatch) {
    const familyExpr = {
      $regexMatch: {
        input: fieldExpr,
        regex: new RegExp(`^${escapeRegex(runtimeFamily)}(?:-|$)`),
      },
    } as const;

    if (prodRuntime && includeLegacyInProd) {
      return {
        $or: [
          familyExpr,
          { $eq: [fieldExpr, null] },
          { $eq: [fieldExpr, ''] },
        ],
      };
    }

    return familyExpr as Record<string, unknown>;
  }

  if (prodRuntime && includeLegacyInProd) {
    return {
      $or: [
        { $eq: [fieldExpr, runtimeTag] },
        { $eq: [fieldExpr, null] },
        { $eq: [fieldExpr, ''] },
      ],
    };
  }

  return { $eq: [fieldExpr, runtimeTag] };
};

export const buildRuntimeFilterExpression = (
  options: RuntimeScopeExprOptions = {}
): Record<string, unknown> => buildRuntimeFilterExpressionForPath(options);

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
    includeLegacyInProd = false,
    familyMatch = false,
    runtimeTag = RUNTIME_TAG,
    runtimeFamily = RUNTIME_FAMILY,
    prodRuntime = IS_PROD_RUNTIME,
  }: RuntimeScopeOptions = {}
): boolean => {
  if (!record || typeof record !== 'object') return false;

  const value = record[field];
  const normalized = typeof value === 'string' ? value.trim() : value;

  if (strict) return normalized === runtimeTag;

  if (familyMatch) {
    if (typeof normalized !== 'string') {
      return prodRuntime && includeLegacyInProd && (normalized === undefined || normalized === null || normalized === '');
    }
    if (normalized === runtimeFamily || normalized.startsWith(`${runtimeFamily}-`)) {
      return true;
    }
    if (prodRuntime && includeLegacyInProd) {
      return normalized === '';
    }
    return false;
  }

  if (prodRuntime && includeLegacyInProd) {
    if (normalized === undefined || normalized === null || normalized === '') {
      return true;
    }
  }

  return normalized === runtimeTag;
};
