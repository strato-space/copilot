import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

const loadEnvFile = (filePath: string): void => {
  if (!fs.existsSync(filePath)) return;
  const parsed = dotenv.parse(fs.readFileSync(filePath));
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
};

const resolveEnvMode = (): string => {
  const explicit = process.env.APP_ENV?.trim() || process.env.NODE_ENV?.trim();
  if (explicit) {
    return explicit;
  }
  const cwd = process.cwd();
  if (fs.existsSync(path.join(cwd, '.env.development'))) {
    return 'development';
  }
  if (fs.existsSync(path.join(cwd, '.env.production'))) {
    return 'production';
  }
  return 'development';
};

const bootstrapEnv = (): void => {
  const cwd = process.cwd();
  const mode = resolveEnvMode();
  const figmaModeFile = path.join(cwd, `.env.${mode}`);
  const backendModeFile = path.join(cwd, '..', 'backend', `.env.${mode}`);
  const figmaBaseFile = path.join(cwd, '.env');

  // Precedence: existing process env > figma mode env > backend mode env > figma base env.
  loadEnvFile(figmaModeFile);
  loadEnvFile(backendModeFile);
  loadEnvFile(figmaBaseFile);
};

bootstrapEnv();

const parseCsv = (value: string | undefined): string[] =>
  (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const parseBoolean = (value: string | undefined, fallback: boolean): boolean => {
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
};

const parsePositiveInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
};

const baseEnvSchema = z.object({
  APP_ENV: z.string().trim().optional(),
  LOGS_DIR: z.string().trim().optional(),
  LOGS_LEVEL: z.string().trim().optional(),
  MONGODB_CONNECTION_STRING: z.string().trim().min(1),
  DB_NAME: z.string().trim().min(1),
  REDIS_CONNECTION_HOST: z.string().trim().default('127.0.0.1'),
  REDIS_CONNECTION_PORT: z.string().trim().default('6379'),
  REDIS_CONNECTION_PASSWORD: z.string().trim().optional(),
  REDIS_DB_INDEX: z.string().trim().default('0'),
  FIGMA_PERSONAL_ACCESS_TOKEN: z.string().trim().optional(),
  FIGMA_TEAM_IDS: z.string().trim().default(''),
  FIGMA_INCLUDE_BRANCHES: z.string().trim().optional(),
  FIGMA_FILE_TREE_DEPTH: z.string().trim().optional(),
  FIGMA_SYNC_PROJECTS_INTERVAL_MS: z.string().trim().optional(),
  FIGMA_SYNC_FILES_INTERVAL_MS: z.string().trim().optional(),
  FIGMA_RECONCILE_INTERVAL_MS: z.string().trim().optional(),
  FIGMA_RETRY_RATE_LIMITED_INTERVAL_MS: z.string().trim().optional(),
  FIGMA_MAX_CONCURRENT_PROJECT_SYNCS: z.string().trim().optional(),
  FIGMA_MAX_CONCURRENT_FILE_SYNCS: z.string().trim().optional(),
  FIGMA_MAX_CONCURRENT_WEBHOOK_JOBS: z.string().trim().optional(),
  FIGMA_RETRY_MAX_ATTEMPTS: z.string().trim().optional(),
  FIGMA_RETRY_BASE_DELAY_MS: z.string().trim().optional(),
  FIGMA_REQUEST_TIMEOUT_MS: z.string().trim().optional(),
  FIGMA_WEBHOOK_PORT: z.string().trim().optional(),
  FIGMA_WEBHOOK_PUBLIC_BASE_URL: z.string().trim().optional(),
  FIGMA_WEBHOOK_VERIFY_SECRET: z.string().trim().optional(),
  FIGMA_ADMIN_API_KEY: z.string().trim().optional(),
  FIGMA_WEBHOOK_EVENT_RETENTION_DAYS: z.string().trim().optional(),
  FIGMA_SYNC_RUN_RETENTION_DAYS: z.string().trim().optional(),
  FIGMA_SNAPSHOT_HISTORY_LIMIT: z.string().trim().optional(),
});

export interface FigmaEnv {
  appEnv: string;
  logsDir?: string;
  logsLevel?: string;
  mongoUri: string;
  dbName: string;
  redisHost: string;
  redisPort: number;
  redisPassword?: string;
  redisDbIndex: number;
  figmaPersonalAccessToken?: string;
  figmaTeamIds: string[];
  figmaIncludeBranches: boolean;
  figmaFileTreeDepth: number;
  figmaSyncProjectsIntervalMs: number;
  figmaSyncFilesIntervalMs: number;
  figmaReconcileIntervalMs: number;
  figmaRetryRateLimitedIntervalMs: number;
  figmaMaxConcurrentProjectSyncs: number;
  figmaMaxConcurrentFileSyncs: number;
  figmaMaxConcurrentWebhookJobs: number;
  figmaRetryMaxAttempts: number;
  figmaRetryBaseDelayMs: number;
  figmaRequestTimeoutMs: number;
  figmaWebhookPort: number;
  figmaWebhookPublicBaseUrl?: string;
  figmaWebhookVerifySecret?: string;
  figmaAdminApiKey?: string;
  figmaWebhookEventRetentionDays: number;
  figmaSyncRunRetentionDays: number;
  figmaSnapshotHistoryLimit: number;
}

let envCache: FigmaEnv | null = null;

export const readEnv = (source: NodeJS.ProcessEnv = process.env): FigmaEnv => {
  const raw = baseEnvSchema.parse(source);
  return {
    appEnv: raw.APP_ENV?.trim() || 'local',
    ...(raw.LOGS_DIR ? { logsDir: raw.LOGS_DIR } : {}),
    ...(raw.LOGS_LEVEL ? { logsLevel: raw.LOGS_LEVEL } : {}),
    mongoUri: raw.MONGODB_CONNECTION_STRING,
    dbName: raw.DB_NAME,
    redisHost: raw.REDIS_CONNECTION_HOST,
    redisPort: parsePositiveInt(raw.REDIS_CONNECTION_PORT, 6379),
    ...(raw.REDIS_CONNECTION_PASSWORD ? { redisPassword: raw.REDIS_CONNECTION_PASSWORD } : {}),
    redisDbIndex: parsePositiveInt(raw.REDIS_DB_INDEX, 0),
    ...(raw.FIGMA_PERSONAL_ACCESS_TOKEN
      ? { figmaPersonalAccessToken: raw.FIGMA_PERSONAL_ACCESS_TOKEN }
      : {}),
    figmaTeamIds: parseCsv(raw.FIGMA_TEAM_IDS),
    figmaIncludeBranches: parseBoolean(raw.FIGMA_INCLUDE_BRANCHES, false),
    figmaFileTreeDepth: parsePositiveInt(raw.FIGMA_FILE_TREE_DEPTH, 2),
    figmaSyncProjectsIntervalMs: parsePositiveInt(raw.FIGMA_SYNC_PROJECTS_INTERVAL_MS, 30 * 60 * 1000),
    figmaSyncFilesIntervalMs: parsePositiveInt(raw.FIGMA_SYNC_FILES_INTERVAL_MS, 15 * 60 * 1000),
    figmaReconcileIntervalMs: parsePositiveInt(raw.FIGMA_RECONCILE_INTERVAL_MS, 6 * 60 * 60 * 1000),
    figmaRetryRateLimitedIntervalMs: parsePositiveInt(
      raw.FIGMA_RETRY_RATE_LIMITED_INTERVAL_MS,
      30 * 60 * 1000
    ),
    figmaMaxConcurrentProjectSyncs: parsePositiveInt(raw.FIGMA_MAX_CONCURRENT_PROJECT_SYNCS, 1),
    figmaMaxConcurrentFileSyncs: parsePositiveInt(raw.FIGMA_MAX_CONCURRENT_FILE_SYNCS, 2),
    figmaMaxConcurrentWebhookJobs: parsePositiveInt(raw.FIGMA_MAX_CONCURRENT_WEBHOOK_JOBS, 4),
    figmaRetryMaxAttempts: parsePositiveInt(raw.FIGMA_RETRY_MAX_ATTEMPTS, 4),
    figmaRetryBaseDelayMs: parsePositiveInt(raw.FIGMA_RETRY_BASE_DELAY_MS, 60_000),
    figmaRequestTimeoutMs: parsePositiveInt(raw.FIGMA_REQUEST_TIMEOUT_MS, 30_000),
    figmaWebhookPort: parsePositiveInt(raw.FIGMA_WEBHOOK_PORT, 3802),
    ...(raw.FIGMA_WEBHOOK_PUBLIC_BASE_URL
      ? { figmaWebhookPublicBaseUrl: raw.FIGMA_WEBHOOK_PUBLIC_BASE_URL }
      : {}),
    ...(raw.FIGMA_WEBHOOK_VERIFY_SECRET
      ? { figmaWebhookVerifySecret: raw.FIGMA_WEBHOOK_VERIFY_SECRET }
      : {}),
    ...(raw.FIGMA_ADMIN_API_KEY ? { figmaAdminApiKey: raw.FIGMA_ADMIN_API_KEY } : {}),
    figmaWebhookEventRetentionDays: parsePositiveInt(raw.FIGMA_WEBHOOK_EVENT_RETENTION_DAYS, 30),
    figmaSyncRunRetentionDays: parsePositiveInt(raw.FIGMA_SYNC_RUN_RETENTION_DAYS, 90),
    figmaSnapshotHistoryLimit: parsePositiveInt(raw.FIGMA_SNAPSHOT_HISTORY_LIMIT, 3),
  };
};

export const getEnv = (): FigmaEnv => {
  envCache ??= readEnv();
  return envCache;
};

export const resetEnvForTests = (): void => {
  envCache = null;
};
