import { FIGMA_SYNC_SCOPE_TYPE, FIGMA_SYNC_STATUS, FIGMA_WEBHOOK_PROCESS_STATUS } from '../../constants/sync.js';
import { getFileByKey, markFileWebhookTouched } from '../../domain/files.js';
import { getWebhookSubscription } from '../../domain/webhookSubscriptions.js';
import { getWebhookEventById, updateWebhookEventStatus } from '../../domain/webhookEvents.js';
import { finishSyncRun, startSyncRun } from '../../domain/syncRuns.js';
import {
  enqueueSyncFileTree,
  enqueueSyncFilesForProject,
  enqueueSyncProjectsForTeam,
} from '../enqueue.js';
import type { ProcessWebhookEventJobData } from '../../types/jobs.js';

export const handleProcessWebhookEvent = async (
  data: ProcessWebhookEventJobData
): Promise<{ routed_to: string }> => {
  const runId = await startSyncRun({
    scope_type: FIGMA_SYNC_SCOPE_TYPE.WEBHOOK,
    scope_id: data.event_id,
    trigger: 'webhook',
  });

  try {
    const event = await getWebhookEventById(data.event_id);
    if (!event) {
      throw new Error(`figma_webhook_event_not_found:${data.event_id}`);
    }

    let routedTo = 'ignored';
    if (event.file_key) {
      const file = await getFileByKey(event.file_key);
      if (file) {
        await markFileWebhookTouched(file.file_key);
        await enqueueSyncFileTree({
          file_key: file.file_key,
          project_id: file.project_id,
          team_id: file.team_id,
          reason: 'webhook',
          source: 'webhook',
        });
        routedTo = 'file';
      }
    }

    const subscription =
      routedTo === 'ignored' && event.webhook_id
        ? await getWebhookSubscription(event.webhook_id)
        : null;

    const projectId = event.project_id ?? (subscription?.context === 'PROJECT' ? subscription.context_id : null);
    const teamId =
      event.team_id ??
      subscription?.team_id ??
      (subscription?.context === 'TEAM' ? subscription.context_id : null);

    if (routedTo === 'ignored' && subscription?.context === 'FILE') {
      const file = await getFileByKey(subscription.context_id);
      if (file) {
        await markFileWebhookTouched(file.file_key);
        await enqueueSyncFileTree({
          file_key: file.file_key,
          project_id: file.project_id,
          team_id: file.team_id,
          reason: 'webhook',
          source: 'webhook',
        });
        routedTo = 'file';
      }
    }

    if (routedTo === 'ignored' && projectId && teamId) {
      await enqueueSyncFilesForProject({
        team_id: teamId,
        project_id: projectId,
        trigger: 'webhook',
      });
      routedTo = 'project';
    }

    if (routedTo === 'ignored' && teamId) {
      await enqueueSyncProjectsForTeam({
        team_id: teamId,
        trigger: 'webhook',
      });
      routedTo = 'team';
    }

    await updateWebhookEventStatus({
      eventId: data.event_id,
      status: routedTo === 'ignored' ? FIGMA_WEBHOOK_PROCESS_STATUS.IGNORED : FIGMA_WEBHOOK_PROCESS_STATUS.OK,
    });
    await finishSyncRun({
      id: runId,
      status: FIGMA_SYNC_STATUS.OK,
      stats: { routed_to: routedTo },
    });
    return { routed_to: routedTo };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await updateWebhookEventStatus({
      eventId: data.event_id,
      status: FIGMA_WEBHOOK_PROCESS_STATUS.ERROR,
      error: errorMessage,
    });
    await finishSyncRun({
      id: runId,
      status: FIGMA_SYNC_STATUS.ERROR,
      error: errorMessage,
    });
    throw error;
  }
};
