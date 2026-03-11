import { Queue, Worker, type Job } from 'bullmq';
import { getEnv } from '../config/env.js';
import { FIGMA_COLLECTIONS } from '../constants/collections.js';
import { connectMongo, closeMongo, getMongoDb } from '../db/mongo.js';
import { listActiveProjects } from '../domain/projects.js';
import { upsertSeedTeams } from '../domain/teams.js';
import { FIGMA_JOBS, FIGMA_QUEUES } from '../constants/queues.js';
import { connectRedis, closeRedis, getBullMqConnection } from '../redis/connection.js';
import { closeFigmaQueues, enqueueReconcileStaleFiles, enqueueRetryRateLimitedFiles, enqueueSyncFilesForProject, enqueueSyncTeam, initFigmaQueues } from '../jobs/enqueue.js';
import { handleProcessWebhookEvent } from '../jobs/handlers/processWebhookEvent.js';
import { handleReconcileStaleFiles, handleRetryRateLimitedFiles } from '../jobs/handlers/reconcileStaleFiles.js';
import { handleSyncFileTree } from '../jobs/handlers/syncFileTree.js';
import { handleSyncFilesForProject } from '../jobs/handlers/syncProjectFiles.js';
import { handleSyncProjectsForTeam } from '../jobs/handlers/syncProjects.js';
import { handleSyncTeam } from '../jobs/handlers/syncTeam.js';
import { initLogger } from '../utils/logger.js';

type QueueHandler = (data: unknown) => Promise<unknown>;

type RuntimeTimer = ReturnType<typeof setInterval>;

const buildWorkerProcessor = (handlerMap: Record<string, QueueHandler>) => {
  return async (job: Job<unknown, unknown, string>): Promise<unknown> => {
    const handler = handlerMap[job.name];
    if (!handler) {
      throw new Error(`figma_worker_handler_not_found:${job.name}`);
    }
    return handler(job.data);
  };
};

const queueConcurrency = (queueName: string): number => {
  const env = getEnv();
  switch (queueName) {
    case FIGMA_QUEUES.SYNC_PROJECTS:
      return env.figmaMaxConcurrentProjectSyncs;
    case FIGMA_QUEUES.SYNC_PROJECT_FILES:
    case FIGMA_QUEUES.SYNC_FILE_TREE:
      return env.figmaMaxConcurrentFileSyncs;
    case FIGMA_QUEUES.PROCESS_WEBHOOKS:
      return env.figmaMaxConcurrentWebhookJobs;
    default:
      return 1;
  }
};

const logger = initLogger('copilot-figma-indexer');

export interface FigmaIndexerRuntime {
  close: () => Promise<void>;
}

export const startIndexerRuntime = async (): Promise<FigmaIndexerRuntime> => {
  const env = getEnv();
  await connectMongo();
  connectRedis();
  initFigmaQueues();

  await upsertSeedTeams(env.figmaTeamIds);

  const workerConfigs: Array<{ queueName: string; handlerMap: Record<string, QueueHandler> }> = [
    {
      queueName: FIGMA_QUEUES.SYNC_TEAMS,
      handlerMap: {
        [FIGMA_JOBS.SYNC_TEAM]: handleSyncTeam as QueueHandler,
      },
    },
    {
      queueName: FIGMA_QUEUES.SYNC_PROJECTS,
      handlerMap: {
        [FIGMA_JOBS.SYNC_PROJECTS_FOR_TEAM]: handleSyncProjectsForTeam as QueueHandler,
      },
    },
    {
      queueName: FIGMA_QUEUES.SYNC_PROJECT_FILES,
      handlerMap: {
        [FIGMA_JOBS.SYNC_FILES_FOR_PROJECT]: handleSyncFilesForProject as QueueHandler,
      },
    },
    {
      queueName: FIGMA_QUEUES.SYNC_FILE_TREE,
      handlerMap: {
        [FIGMA_JOBS.SYNC_FILE_TREE]: handleSyncFileTree as QueueHandler,
      },
    },
    {
      queueName: FIGMA_QUEUES.PROCESS_WEBHOOKS,
      handlerMap: {
        [FIGMA_JOBS.PROCESS_WEBHOOK_EVENT]: handleProcessWebhookEvent as QueueHandler,
      },
    },
    {
      queueName: FIGMA_QUEUES.RECONCILE,
      handlerMap: {
        [FIGMA_JOBS.RECONCILE_STALE_FILES]: handleReconcileStaleFiles as QueueHandler,
        [FIGMA_JOBS.RETRY_RATE_LIMITED_FILES]: handleRetryRateLimitedFiles as QueueHandler,
      },
    },
  ];

  const workers = workerConfigs.map(
    ({ queueName, handlerMap }) =>
      new Worker(queueName, buildWorkerProcessor(handlerMap), {
        connection: getBullMqConnection(),
        concurrency: queueConcurrency(queueName),
      })
  );

  workers.forEach((worker, index) => {
    const { queueName } = workerConfigs[index]!;
    worker.on('failed', (job, error) => {
      logger.error('[figma-indexer] worker_failed', {
        component: 'figma-indexer',
        queue: queueName,
        job_name: job?.name ?? null,
        error: error.message,
      });
    });
  });

  const bootstrap = async (): Promise<void> => {
    await Promise.all(
      env.figmaTeamIds.map((teamId) =>
        enqueueSyncTeam({
          team_id: teamId,
          trigger: 'startup',
        })
      )
    );
  };

  const enqueueProjectFileRefresh = async (trigger: 'interval' | 'manual'): Promise<void> => {
    const projects = await listActiveProjects();
    await Promise.all(
      projects.map((project) =>
        enqueueSyncFilesForProject({
          team_id: project.team_id,
          project_id: project.project_id,
          trigger,
        })
      )
    );
  };

  await bootstrap();
  const timers: RuntimeTimer[] = [
    setInterval(() => {
      void Promise.all(
        env.figmaTeamIds.map((teamId) =>
          enqueueSyncTeam({
            team_id: teamId,
            trigger: 'interval',
          })
        )
      );
    }, env.figmaSyncProjectsIntervalMs),
    setInterval(() => {
      void enqueueProjectFileRefresh('interval');
    }, env.figmaSyncFilesIntervalMs),
    setInterval(() => {
      void enqueueReconcileStaleFiles({ trigger: 'interval' });
    }, env.figmaReconcileIntervalMs),
    setInterval(() => {
      void enqueueRetryRateLimitedFiles({ trigger: 'interval' });
    }, env.figmaRetryRateLimitedIntervalMs),
  ];

  logger.info('[figma-indexer] runtime_started', {
    component: 'figma-indexer',
    figma_team_count: env.figmaTeamIds.length,
    queues: Object.values(FIGMA_QUEUES),
  });

  return {
    close: async () => {
      timers.forEach((timer) => clearInterval(timer));
      await Promise.all(workers.map((worker) => worker.close()));
      await closeFigmaQueues();
      await closeMongo();
      await closeRedis();
    },
  };
};

export const collectIndexerStats = async () => {
  const db = getMongoDb();
  const queues = initFigmaQueues();
  const syncRunsByStatus = await db
    .collection(FIGMA_COLLECTIONS.SYNC_RUNS)
    .aggregate([
      {
        $group: {
          _id: {
            scope_type: '$scope_type',
            status: '$status',
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { '_id.scope_type': 1, '_id.status': 1 } },
    ])
    .toArray();

  const filesByIndexStatus = await db
    .collection(FIGMA_COLLECTIONS.FILES)
    .aggregate([
      {
        $group: {
          _id: '$last_index_status',
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ])
    .toArray();

  return {
    counts: {
      teams: await db.collection(FIGMA_COLLECTIONS.TEAMS).countDocuments(),
      projects: await db.collection(FIGMA_COLLECTIONS.PROJECTS).countDocuments(),
      files: await db.collection(FIGMA_COLLECTIONS.FILES).countDocuments(),
    },
    queues: Object.fromEntries(
      await Promise.all(
        Object.entries(queues).map(async ([queueName, queue]) => [queueName, await queue.getJobCounts()])
      )
    ),
    sync_runs_by_status: syncRunsByStatus,
    files_by_index_status: filesByIndexStatus,
  };
};
