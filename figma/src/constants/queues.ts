const normalizeSuffix = (value: string | undefined): string => {
  const normalized = (value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized ? `-${normalized}` : '';
};

export const FIGMA_ENV_QUEUE_SUFFIX = normalizeSuffix(process.env.APP_ENV);

const baseQueues = {
  SYNC_TEAMS: 'figma--sync-teams',
  SYNC_PROJECTS: 'figma--sync-projects',
  SYNC_PROJECT_FILES: 'figma--sync-project-files',
  SYNC_FILE_TREE: 'figma--sync-file-tree',
  PROCESS_WEBHOOKS: 'figma--process-webhooks',
  RECONCILE: 'figma--reconcile',
} as const;

export const FIGMA_QUEUES = Object.fromEntries(
  Object.entries(baseQueues).map(([key, value]) => [key, `${value}${FIGMA_ENV_QUEUE_SUFFIX}`])
) as Record<keyof typeof baseQueues, string>;

export const FIGMA_JOBS = {
  SYNC_TEAM: 'SYNC_TEAM',
  SYNC_PROJECTS_FOR_TEAM: 'SYNC_PROJECTS_FOR_TEAM',
  SYNC_FILES_FOR_PROJECT: 'SYNC_FILES_FOR_PROJECT',
  SYNC_FILE_TREE: 'SYNC_FILE_TREE',
  PROCESS_WEBHOOK_EVENT: 'PROCESS_WEBHOOK_EVENT',
  RECONCILE_STALE_FILES: 'RECONCILE_STALE_FILES',
  RETRY_RATE_LIMITED_FILES: 'RETRY_RATE_LIMITED_FILES',
} as const;

export type FigmaJobName = (typeof FIGMA_JOBS)[keyof typeof FIGMA_JOBS];
