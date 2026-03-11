import { Router, type RequestHandler } from 'express';
import { getEnv } from '../../config/env.js';
import { getMongoDb } from '../../db/mongo.js';
import { FIGMA_COLLECTIONS } from '../../constants/collections.js';
import { upsertWebhookSubscription } from '../../domain/webhookSubscriptions.js';
import {
  enqueueReconcileStaleFiles,
  enqueueSyncFileTree,
  enqueueSyncFilesForProject,
  enqueueSyncProjectsForTeam,
} from '../../jobs/enqueue.js';
import { getProjectById } from '../../domain/projects.js';
import { getFileByKey } from '../../domain/files.js';
import type {
  AdminRegisterWebhookBody,
  AdminSyncFileBody,
  AdminSyncProjectBody,
  AdminSyncTeamBody,
} from '../../types/api.js';
import { initFigmaQueues } from '../../jobs/enqueue.js';

const requireAdminKey: RequestHandler = (req, res, next) => {
  const env = getEnv();
  if (!env.figmaAdminApiKey) {
    res.status(503).json({ ok: false, error: 'figma_admin_api_key_not_configured' });
    return;
  }

  const provided = req.header('x-api-key')?.trim();
  if (!provided || provided !== env.figmaAdminApiKey) {
    res.status(401).json({ ok: false, error: 'figma_admin_api_key_invalid' });
    return;
  }

  next();
};

export const createAdminRouter = (): Router => {
  const router = Router();
  router.use('/admin', requireAdminKey);

  router.post('/admin/sync/team', async (req, res) => {
    const body = req.body as Partial<AdminSyncTeamBody>;
    if (!body.team_id?.trim()) {
      res.status(400).json({ ok: false, error: 'team_id_required' });
      return;
    }
    await enqueueSyncProjectsForTeam({ team_id: body.team_id.trim(), trigger: 'manual' });
    res.json({ ok: true, queued: 'team', team_id: body.team_id.trim() });
  });

  router.post('/admin/sync/project', async (req, res) => {
    const body = req.body as Partial<AdminSyncProjectBody>;
    if (!body.project_id?.trim()) {
      res.status(400).json({ ok: false, error: 'project_id_required' });
      return;
    }
    const project = await getProjectById(body.project_id.trim());
    if (!project) {
      res.status(404).json({ ok: false, error: 'project_not_found' });
      return;
    }
    await enqueueSyncFilesForProject({
      team_id: project.team_id,
      project_id: project.project_id,
      trigger: 'manual',
    });
    res.json({ ok: true, queued: 'project', project_id: project.project_id });
  });

  router.post('/admin/sync/file', async (req, res) => {
    const body = req.body as Partial<AdminSyncFileBody>;
    if (!body.file_key?.trim()) {
      res.status(400).json({ ok: false, error: 'file_key_required' });
      return;
    }
    const file = await getFileByKey(body.file_key.trim());
    if (!file) {
      res.status(404).json({ ok: false, error: 'file_not_found' });
      return;
    }
    await enqueueSyncFileTree({
      file_key: file.file_key,
      project_id: file.project_id,
      team_id: file.team_id,
      reason: 'manual',
      source: 'manual',
    });
    res.json({ ok: true, queued: 'file', file_key: file.file_key });
  });

  router.post('/admin/reconcile', async (_req, res) => {
    await enqueueReconcileStaleFiles({ trigger: 'manual' });
    res.json({ ok: true, queued: 'reconcile' });
  });

  router.post('/admin/webhooks/register', async (req, res) => {
    const body = req.body as Partial<AdminRegisterWebhookBody>;
    if (!body.webhook_id?.trim() || !body.context_id?.trim() || !body.context) {
      res.status(400).json({ ok: false, error: 'webhook_id_context_context_id_required' });
      return;
    }
    if (!['TEAM', 'PROJECT', 'FILE'].includes(body.context)) {
      res.status(400).json({ ok: false, error: 'invalid_context' });
      return;
    }

    await upsertWebhookSubscription({
      webhook_id: body.webhook_id.trim(),
      context: body.context,
      context_id: body.context_id.trim(),
      team_id: body.team_id?.trim() || null,
      notes: body.notes?.trim() || null,
    });

    res.json({
      ok: true,
      webhook_id: body.webhook_id.trim(),
      context: body.context,
      context_id: body.context_id.trim(),
    });
  });

  router.get('/admin/stats', async (_req, res) => {
    const db = getMongoDb();
    const queues = initFigmaQueues();
    const [teams, projects, files, snapshots, webhookSubscriptions, webhookEvents, syncRuns] = await Promise.all([
      db.collection(FIGMA_COLLECTIONS.TEAMS).countDocuments(),
      db.collection(FIGMA_COLLECTIONS.PROJECTS).countDocuments(),
      db.collection(FIGMA_COLLECTIONS.FILES).countDocuments(),
      db.collection(FIGMA_COLLECTIONS.FILE_SNAPSHOTS).countDocuments(),
      db.collection(FIGMA_COLLECTIONS.WEBHOOK_SUBSCRIPTIONS).countDocuments(),
      db.collection(FIGMA_COLLECTIONS.WEBHOOK_EVENTS).countDocuments(),
      db.collection(FIGMA_COLLECTIONS.SYNC_RUNS).countDocuments(),
    ]);
    const queueStats = Object.fromEntries(
      await Promise.all(
        Object.entries(queues).map(async ([queueName, queue]) => [queueName, await queue.getJobCounts()])
      )
    );

    res.json({
      ok: true,
      counts: {
        teams,
        projects,
        files,
        snapshots,
        webhook_subscriptions: webhookSubscriptions,
        webhook_events: webhookEvents,
        sync_runs: syncRuns,
      },
      queues: queueStats,
      webhook_registration: {
        mode: 'manual',
        public_base_url: getEnv().figmaWebhookPublicBaseUrl ?? null,
      },
    });
  });

  return router;
};
