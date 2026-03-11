import { getProjectFiles } from '../../figma-api/endpoints.js';
import { upsertFilesForProject } from '../../domain/files.js';
import { enqueueSyncFileTree } from '../enqueue.js';
import { finishSyncRun, startSyncRun } from '../../domain/syncRuns.js';
import { FIGMA_SYNC_SCOPE_TYPE, FIGMA_SYNC_STATUS } from '../../constants/sync.js';
import type { SyncFilesForProjectJobData } from '../../types/jobs.js';
import { createChildLogger } from '../../utils/logger.js';

const logger = createChildLogger({ component: 'figma-indexer' });

export const handleSyncFilesForProject = async (
  data: SyncFilesForProjectJobData
): Promise<{ files: number; queued: number }> => {
  const startedAt = Date.now();
  const runId = await startSyncRun({
    scope_type: FIGMA_SYNC_SCOPE_TYPE.PROJECT,
    scope_id: data.project_id,
    trigger: data.trigger,
  });

  try {
    const files = await getProjectFiles(data.project_id);
    const result = await upsertFilesForProject({
      teamId: data.team_id,
      projectId: data.project_id,
      files,
    });
    await Promise.all(
      result.changedFiles.map((file) =>
        enqueueSyncFileTree({
          file_key: file.file_key,
          project_id: file.project_id,
          team_id: file.team_id,
          reason: 'poll',
          source: 'poll',
        })
      )
    );
    await finishSyncRun({
      id: runId,
      status: FIGMA_SYNC_STATUS.OK,
      stats: {
        file_count: files.length,
        queued_file_count: result.changedFiles.length,
      },
    });
    logger.info('[figma-indexer] sync_project_files_completed', {
      component: 'figma-indexer',
      job_type: 'SYNC_FILES_FOR_PROJECT',
      scope_type: 'project',
      scope_id: data.project_id,
      figma_team_id: data.team_id,
      figma_project_id: data.project_id,
      duration_ms: Date.now() - startedAt,
      result: 'ok',
      file_count: files.length,
      queued_file_count: result.changedFiles.length,
    });
    return {
      files: files.length,
      queued: result.changedFiles.length,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await finishSyncRun({
      id: runId,
      status: FIGMA_SYNC_STATUS.ERROR,
      error: message,
    });
    logger.error('[figma-indexer] sync_project_files_failed', {
      component: 'figma-indexer',
      job_type: 'SYNC_FILES_FOR_PROJECT',
      scope_type: 'project',
      scope_id: data.project_id,
      figma_team_id: data.team_id,
      figma_project_id: data.project_id,
      duration_ms: Date.now() - startedAt,
      result: 'error',
      error_code: 'sync_project_files_failed',
      error: message,
    });
    throw error;
  }
};
