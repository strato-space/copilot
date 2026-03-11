import { Queue } from 'bullmq';
import { getEnv } from '../config/env.js';
import { FIGMA_JOBS, FIGMA_QUEUES } from '../constants/queues.js';
import { getBullMqConnection } from '../redis/connection.js';
import type {
  ProcessWebhookEventJobData,
  ReconcileStaleFilesJobData,
  RetryRateLimitedFilesJobData,
  SyncFileTreeJobData,
  SyncFilesForProjectJobData,
  SyncProjectsForTeamJobData,
  SyncTeamJobData,
} from '../types/jobs.js';

export type FigmaQueuesMap = Record<string, Queue>;

let queues: FigmaQueuesMap | null = null;

const attemptsForJob = (): number => getEnv().figmaRetryMaxAttempts;

const backoffForJob = () => ({
  type: 'exponential' as const,
  delay: getEnv().figmaRetryBaseDelayMs,
});

const sanitizeJobIdPart = (value: string): string =>
  value
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');

const makeJobId = (prefix: string, ...parts: string[]): string =>
  [prefix, ...parts.map((part) => sanitizeJobIdPart(part))]
    .filter(Boolean)
    .join('--');

export const deterministicJobId = {
  syncTeam: (teamId: string) => makeJobId('sync-team', teamId),
  syncProjects: (teamId: string) => makeJobId('sync-projects', teamId),
  syncFiles: (projectId: string) => makeJobId('sync-files', projectId),
  syncFileTree: (fileKey: string, reason: string) => makeJobId('sync-file', fileKey, reason),
  webhook: (eventId: string) => makeJobId('webhook', eventId),
  reconcile: () => makeJobId('reconcile', 'stale-files'),
  retryRateLimited: () => makeJobId('retry', 'rate-limited-files'),
};

export const initFigmaQueues = (): FigmaQueuesMap => {
  if (queues) return queues;
  const connection = getBullMqConnection();
  queues = Object.fromEntries(
    Object.values(FIGMA_QUEUES).map((queueName) => [queueName, new Queue(queueName, { connection })])
  );
  return queues;
};

const getQueue = (queueName: string): Queue => {
  const queue = initFigmaQueues()[queueName];
  if (!queue) {
    throw new Error(`figma_queue_not_initialized:${queueName}`);
  }
  return queue;
};

export const closeFigmaQueues = async (): Promise<void> => {
  if (!queues) return;
  await Promise.all(Object.values(queues).map((queue) => queue.close()));
  queues = null;
};

export const enqueueSyncTeam = async (data: SyncTeamJobData): Promise<void> => {
  await getQueue(FIGMA_QUEUES.SYNC_TEAMS).add(FIGMA_JOBS.SYNC_TEAM, data, {
    jobId: deterministicJobId.syncTeam(data.team_id),
    removeOnComplete: true,
    removeOnFail: 50,
    attempts: attemptsForJob(),
    backoff: backoffForJob(),
  });
};

export const enqueueSyncProjectsForTeam = async (data: SyncProjectsForTeamJobData): Promise<void> => {
  await getQueue(FIGMA_QUEUES.SYNC_PROJECTS).add(FIGMA_JOBS.SYNC_PROJECTS_FOR_TEAM, data, {
    jobId: deterministicJobId.syncProjects(data.team_id),
    removeOnComplete: true,
    removeOnFail: 50,
    attempts: attemptsForJob(),
    backoff: backoffForJob(),
  });
};

export const enqueueSyncFilesForProject = async (data: SyncFilesForProjectJobData): Promise<void> => {
  await getQueue(FIGMA_QUEUES.SYNC_PROJECT_FILES).add(FIGMA_JOBS.SYNC_FILES_FOR_PROJECT, data, {
    jobId: deterministicJobId.syncFiles(data.project_id),
    removeOnComplete: true,
    removeOnFail: 50,
    attempts: attemptsForJob(),
    backoff: backoffForJob(),
  });
};

export const enqueueSyncFileTree = async (data: SyncFileTreeJobData): Promise<void> => {
  await getQueue(FIGMA_QUEUES.SYNC_FILE_TREE).add(FIGMA_JOBS.SYNC_FILE_TREE, data, {
    jobId: deterministicJobId.syncFileTree(data.file_key, data.reason),
    removeOnComplete: true,
    removeOnFail: 100,
    attempts: attemptsForJob(),
    backoff: backoffForJob(),
  });
};

export const enqueueProcessWebhookEvent = async (data: ProcessWebhookEventJobData): Promise<void> => {
  await getQueue(FIGMA_QUEUES.PROCESS_WEBHOOKS).add(FIGMA_JOBS.PROCESS_WEBHOOK_EVENT, data, {
    jobId: deterministicJobId.webhook(data.event_id),
    removeOnComplete: true,
    removeOnFail: 100,
    attempts: attemptsForJob(),
    backoff: backoffForJob(),
  });
};

export const enqueueReconcileStaleFiles = async (data: ReconcileStaleFilesJobData): Promise<void> => {
  await getQueue(FIGMA_QUEUES.RECONCILE).add(FIGMA_JOBS.RECONCILE_STALE_FILES, data, {
    jobId: deterministicJobId.reconcile(),
    removeOnComplete: true,
    removeOnFail: 50,
  });
};

export const enqueueRetryRateLimitedFiles = async (data: RetryRateLimitedFilesJobData): Promise<void> => {
  await getQueue(FIGMA_QUEUES.RECONCILE).add(FIGMA_JOBS.RETRY_RATE_LIMITED_FILES, data, {
    jobId: deterministicJobId.retryRateLimited(),
    removeOnComplete: true,
    removeOnFail: 50,
  });
};
