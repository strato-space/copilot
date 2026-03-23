import { Queue, Worker, type Job } from 'bullmq';
import {
  RUNTIME_TAG,
  VOICEBOT_ENV_QUEUE_SUFFIX,
  VOICEBOT_JOBS,
  VOICEBOT_QUEUES,
} from '../../constants.js';
import { connectDb, closeDb } from '../../services/db.js';
import { connectRedis, closeRedis, getBullMQConnection } from '../../services/redis.js';
import { closeVoicebotQueues, initVoicebotQueues } from '../../services/voicebotQueues.js';
import { initLogger } from '../../utils/logger.js';
import {
  VOICEBOT_WORKER_MANIFEST,
  type VoicebotWorkerHandler,
} from './manifest.js';

type LoggerLike = {
  info: (message: string, meta?: Record<string, unknown>) => void;
  warn: (message: string, meta?: Record<string, unknown>) => void;
  error: (message: string, meta?: Record<string, unknown>) => void;
};

type VoicebotManifest = Record<string, VoicebotWorkerHandler>;

type WorkerJobLike = Pick<Job<unknown, unknown, string>, 'id' | 'name' | 'data'>;

type WorkerRunnerDeps = {
  manifest?: VoicebotManifest;
  logger?: LoggerLike;
};

const defaultLogger = initLogger('copilot-voicebot-workers');

const queueEnvKeys: Array<{ queueName: string; envKey: string; fallback: number }> = [
  {
    queueName: VOICEBOT_QUEUES.COMMON,
    envKey: 'VOICEBOT_WORKER_CONCURRENCY_COMMON',
    fallback: 2,
  },
  {
    queueName: VOICEBOT_QUEUES.VOICE,
    envKey: 'VOICEBOT_WORKER_CONCURRENCY_VOICE',
    fallback: 2,
  },
  {
    queueName: VOICEBOT_QUEUES.PROCESSORS,
    envKey: 'VOICEBOT_WORKER_CONCURRENCY_PROCESSORS',
    fallback: 1,
  },
  {
    queueName: VOICEBOT_QUEUES.POSTPROCESSORS,
    envKey: 'VOICEBOT_WORKER_CONCURRENCY_POSTPROCESSORS',
    fallback: 1,
  },
  {
    queueName: VOICEBOT_QUEUES.EVENTS,
    envKey: 'VOICEBOT_WORKER_CONCURRENCY_EVENTS',
    fallback: 1,
  },
  {
    queueName: VOICEBOT_QUEUES.NOTIFIES,
    envKey: 'VOICEBOT_WORKER_CONCURRENCY_NOTIFIES',
    fallback: 1,
  },
];

const queueConcurrency = new Map<string, number>(
  queueEnvKeys.map(({ queueName, envKey, fallback }) => {
    const raw = Number.parseInt(String(process.env[envKey] || ''), 10);
    return [queueName, Number.isFinite(raw) && raw > 0 ? raw : fallback];
  })
);

const resolveProcessingLoopIntervalMs = (): number => {
  const raw = Number.parseInt(String(process.env.VOICEBOT_PROCESSING_LOOP_INTERVAL_MS || ''), 10);
  if (!Number.isFinite(raw) || raw < 5_000) return 10_000;
  return raw;
};

const resolveEmptySessionCleanupIntervalMs = (): number => {
  const raw = Number.parseInt(
    String(process.env.VOICEBOT_EMPTY_SESSION_CLEANUP_INTERVAL_MS || ''),
    10
  );
  if (!Number.isFinite(raw) || raw < 60_000) return 60 * 60 * 1000;
  return raw;
};

const resolveEmptySessionCleanupMaxAgeHours = (): number => {
  const raw = Number.parseInt(
    String(process.env.VOICEBOT_EMPTY_SESSION_CLEANUP_AGE_HOURS || ''),
    10
  );
  if (!Number.isFinite(raw) || raw < 1) return 48;
  return raw;
};

const resolveEmptySessionCleanupBatchLimit = (): number => {
  const raw = Number.parseInt(
    String(process.env.VOICEBOT_EMPTY_SESSION_CLEANUP_BATCH_LIMIT || ''),
    10
  );
  if (!Number.isFinite(raw) || raw < 1) return 500;
  return raw;
};

const resolveCloseInactiveSessionsEnabled = (): boolean => {
  const raw = String(process.env.VOICEBOT_CLOSE_INACTIVE_SESSIONS_ENABLED || '').trim().toLowerCase();
  if (!raw) return true;
  return !['0', 'false', 'no', 'off'].includes(raw);
};

const resolveCloseInactiveSessionsIntervalMs = (): number => {
  const raw = Number.parseInt(
    String(process.env.VOICEBOT_CLOSE_INACTIVE_SESSIONS_INTERVAL_MS || ''),
    10
  );
  if (!Number.isFinite(raw) || raw < 30_000) return 60_000;
  return raw;
};

const resolveCloseInactiveSessionsTimeoutMinutes = (): number => {
  const raw = Number.parseInt(
    String(process.env.VOICEBOT_CLOSE_INACTIVE_SESSIONS_TIMEOUT_MINUTES || ''),
    10
  );
  if (!Number.isFinite(raw) || raw < 1) return 10;
  return raw;
};

const resolveCloseInactiveSessionsBatchLimit = (): number => {
  const raw = Number.parseInt(
    String(process.env.VOICEBOT_CLOSE_INACTIVE_SESSIONS_BATCH_LIMIT || ''),
    10
  );
  if (!Number.isFinite(raw) || raw < 1) return 100;
  return raw;
};

export const resolveQueueConcurrency = (queueName: string): number => {
  return queueConcurrency.get(queueName) ?? 1;
};

export const buildVoicebotWorkerProcessor = ({
  queueName,
  manifest = VOICEBOT_WORKER_MANIFEST,
  logger = defaultLogger,
}: {
  queueName: string;
  manifest?: VoicebotManifest;
  logger?: LoggerLike;
}) => {
  return async (job: WorkerJobLike): Promise<unknown> => {
    const startedAt = Date.now();
    const handler = manifest[job.name];

    if (!handler) {
      const error = new Error(`voicebot_worker_handler_not_found:${job.name}`);
      logger.error('[voicebot-workers] handler_not_found', {
        runtime_tag: RUNTIME_TAG,
        queue: queueName,
        job_name: job.name,
        job_id: job.id ?? null,
      });
      throw error;
    }

    try {
      const result = await handler(job.data);
      logger.info('[voicebot-workers] job_completed', {
        runtime_tag: RUNTIME_TAG,
        queue: queueName,
        job_name: job.name,
        job_id: job.id ?? null,
        duration_ms: Date.now() - startedAt,
      });
      return result;
    } catch (error) {
      logger.error('[voicebot-workers] job_failed', {
        runtime_tag: RUNTIME_TAG,
        queue: queueName,
        job_name: job.name,
        job_id: job.id ?? null,
        duration_ms: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  };
};

export type VoicebotWorkerRuntime = {
  workers: Worker[];
  close: () => Promise<void>;
};

export const startVoicebotWorkers = async ({
  manifest = VOICEBOT_WORKER_MANIFEST,
  logger = defaultLogger,
}: WorkerRunnerDeps = {}): Promise<VoicebotWorkerRuntime> => {
  await connectDb();
  connectRedis();
  initVoicebotQueues();

  const queueNames = Object.values(VOICEBOT_QUEUES).filter(
    (queueName) => queueName !== VOICEBOT_QUEUES.EVENTS
  );
  const commonQueue = new Queue(VOICEBOT_QUEUES.COMMON, {
    connection: getBullMQConnection(),
  });

  const processingLoopIntervalMs = resolveProcessingLoopIntervalMs();
  const processingSchedulerId = `processing-loop${VOICEBOT_ENV_QUEUE_SUFFIX}`;
  const cleanupEmptySessionsSchedulerId = `cleanup-empty-sessions${VOICEBOT_ENV_QUEUE_SUFFIX}`;
  const emptySessionCleanupIntervalMs = resolveEmptySessionCleanupIntervalMs();
  const emptySessionCleanupMaxAgeHours = resolveEmptySessionCleanupMaxAgeHours();
  const emptySessionCleanupBatchLimit = resolveEmptySessionCleanupBatchLimit();
  const closeInactiveSessionsSchedulerId = `close-inactive-sessions${VOICEBOT_ENV_QUEUE_SUFFIX}`;
  const closeInactiveSessionsEnabled = resolveCloseInactiveSessionsEnabled();
  const closeInactiveSessionsIntervalMs = resolveCloseInactiveSessionsIntervalMs();
  const closeInactiveSessionsTimeoutMinutes = resolveCloseInactiveSessionsTimeoutMinutes();
  const closeInactiveSessionsBatchLimit = resolveCloseInactiveSessionsBatchLimit();

  await commonQueue.upsertJobScheduler(
    processingSchedulerId,
    { every: processingLoopIntervalMs },
    {
      name: VOICEBOT_JOBS.common.PROCESSING,
      data: {},
      opts: {
        removeOnComplete: true,
        removeOnFail: 50,
      },
    }
  );
  logger.info('[voicebot-workers] processing_loop_scheduler_ready', {
    runtime_tag: RUNTIME_TAG,
    queue: VOICEBOT_QUEUES.COMMON,
    scheduler_id: processingSchedulerId,
    every_ms: processingLoopIntervalMs,
  });

  await commonQueue.upsertJobScheduler(
    cleanupEmptySessionsSchedulerId,
    { every: emptySessionCleanupIntervalMs },
    {
      name: VOICEBOT_JOBS.common.CLEANUP_EMPTY_SESSIONS,
      data: {
        max_age_hours: emptySessionCleanupMaxAgeHours,
        batch_limit: emptySessionCleanupBatchLimit,
      },
      opts: {
        removeOnComplete: true,
        removeOnFail: 50,
      },
    }
  );
  logger.info('[voicebot-workers] empty_sessions_cleanup_scheduler_ready', {
    runtime_tag: RUNTIME_TAG,
    queue: VOICEBOT_QUEUES.COMMON,
    scheduler_id: cleanupEmptySessionsSchedulerId,
    every_ms: emptySessionCleanupIntervalMs,
    max_age_hours: emptySessionCleanupMaxAgeHours,
    batch_limit: emptySessionCleanupBatchLimit,
  });

  if (closeInactiveSessionsEnabled) {
    await commonQueue.upsertJobScheduler(
      closeInactiveSessionsSchedulerId,
      { every: closeInactiveSessionsIntervalMs },
      {
        name: VOICEBOT_JOBS.common.CLOSE_INACTIVE_SESSIONS,
        data: {
          inactivity_minutes: closeInactiveSessionsTimeoutMinutes,
          batch_limit: closeInactiveSessionsBatchLimit,
          generate_missing_title: true,
        },
        opts: {
          removeOnComplete: true,
          removeOnFail: 50,
        },
      }
    );
    logger.info('[voicebot-workers] close_inactive_sessions_scheduler_ready', {
      runtime_tag: RUNTIME_TAG,
      queue: VOICEBOT_QUEUES.COMMON,
      scheduler_id: closeInactiveSessionsSchedulerId,
      every_ms: closeInactiveSessionsIntervalMs,
      inactivity_minutes: closeInactiveSessionsTimeoutMinutes,
      batch_limit: closeInactiveSessionsBatchLimit,
    });
  } else {
    await commonQueue.removeJobScheduler(closeInactiveSessionsSchedulerId).catch(() => undefined);
    logger.info('[voicebot-workers] close_inactive_sessions_scheduler_disabled', {
      runtime_tag: RUNTIME_TAG,
      queue: VOICEBOT_QUEUES.COMMON,
      scheduler_id: closeInactiveSessionsSchedulerId,
    });
  }

  const workers = queueNames.map(
    (queueName) =>
      new Worker(queueName, buildVoicebotWorkerProcessor({ queueName, manifest, logger }), {
        connection: getBullMQConnection(),
        concurrency: resolveQueueConcurrency(queueName),
      })
  );

  workers.forEach((worker, index) => {
    const queueName = queueNames[index];

    worker.on('error', (error) => {
      logger.error('[voicebot-workers] worker_error', {
        runtime_tag: RUNTIME_TAG,
        queue: queueName,
        error: error instanceof Error ? error.message : String(error),
      });
    });

    worker.on('failed', (job, error) => {
      logger.error('[voicebot-workers] worker_failed', {
        runtime_tag: RUNTIME_TAG,
        queue: queueName,
        job_name: job?.name ?? null,
        job_id: job?.id ?? null,
        error: error instanceof Error ? error.message : String(error),
      });
    });

    worker.on('completed', (job) => {
      logger.info('[voicebot-workers] worker_completed', {
        runtime_tag: RUNTIME_TAG,
        queue: queueName,
        job_name: job?.name ?? null,
        job_id: job?.id ?? null,
      });
    });
  });

  logger.info('[voicebot-workers] started', {
    runtime_tag: RUNTIME_TAG,
    queues: queueNames,
  });

  return {
    workers,
    close: async () => {
      await Promise.allSettled(workers.map((worker) => worker.close()));
      const schedulerIds = [processingSchedulerId, cleanupEmptySessionsSchedulerId];
      if (closeInactiveSessionsEnabled) {
        schedulerIds.push(closeInactiveSessionsSchedulerId);
      }
      await Promise.allSettled(
        schedulerIds.map((schedulerId) => commonQueue.removeJobScheduler(schedulerId))
      );
      await Promise.allSettled([commonQueue.close()]);
      await closeVoicebotQueues();
      await closeRedis();
      await closeDb();
      logger.info('[voicebot-workers] stopped', {
        runtime_tag: RUNTIME_TAG,
      });
    },
  };
};
