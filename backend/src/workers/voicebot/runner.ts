import { Worker, type Job } from 'bullmq';
import { RUNTIME_TAG, VOICEBOT_QUEUES } from '../../constants.js';
import { connectDb, closeDb } from '../../services/db.js';
import { connectRedis, closeRedis, getBullMQConnection } from '../../services/redis.js';
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

  const queueNames = Object.values(VOICEBOT_QUEUES);
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
      await closeRedis();
      await closeDb();
      logger.info('[voicebot-workers] stopped', {
        runtime_tag: RUNTIME_TAG,
      });
    },
  };
};
