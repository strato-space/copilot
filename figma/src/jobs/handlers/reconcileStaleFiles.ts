import { getEnv } from '../../config/env.js';
import { listActiveFiles, listRateLimitedFiles } from '../../domain/files.js';
import { finishSyncRun, startSyncRun } from '../../domain/syncRuns.js';
import { enqueueSyncFileTree } from '../enqueue.js';
import { FIGMA_SYNC_SCOPE_TYPE, FIGMA_SYNC_STATUS } from '../../constants/sync.js';
import type { ReconcileStaleFilesJobData, RetryRateLimitedFilesJobData } from '../../types/jobs.js';
import { createChildLogger } from '../../utils/logger.js';

const logger = createChildLogger({ component: 'figma-indexer' });

const needsReconcile = (lastIndexedAt: number | null, thresholdMs: number): boolean => {
  if (!lastIndexedAt) return true;
  return Date.now() - lastIndexedAt >= thresholdMs;
};

export const handleReconcileStaleFiles = async (
  data: ReconcileStaleFilesJobData
): Promise<{ queued: number }> => {
  const startedAt = Date.now();
  const runId = await startSyncRun({
    scope_type: FIGMA_SYNC_SCOPE_TYPE.RECONCILE,
    scope_id: null,
    trigger: data.trigger,
  });

  try {
    const files = await listActiveFiles();
    const thresholdMs = getEnv().figmaReconcileIntervalMs;
    const staleFiles = files.filter((file) => needsReconcile(file.last_indexed_at, thresholdMs));
    await Promise.all(
      staleFiles.map((file) =>
        enqueueSyncFileTree({
          file_key: file.file_key,
          project_id: file.project_id,
          team_id: file.team_id,
          reason: 'reconcile',
          source: 'poll',
        })
      )
    );
    await finishSyncRun({
      id: runId,
      status: FIGMA_SYNC_STATUS.OK,
      stats: { queued_file_count: staleFiles.length },
    });
    logger.info('[figma-indexer] reconcile_stale_files_completed', {
      component: 'figma-indexer',
      job_type: 'RECONCILE_STALE_FILES',
      scope_type: 'reconcile',
      scope_id: 'stale-files',
      duration_ms: Date.now() - startedAt,
      result: 'ok',
      queued_file_count: staleFiles.length,
    });
    return { queued: staleFiles.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await finishSyncRun({
      id: runId,
      status: FIGMA_SYNC_STATUS.ERROR,
      error: message,
    });
    logger.error('[figma-indexer] reconcile_stale_files_failed', {
      component: 'figma-indexer',
      job_type: 'RECONCILE_STALE_FILES',
      scope_type: 'reconcile',
      scope_id: 'stale-files',
      duration_ms: Date.now() - startedAt,
      result: 'error',
      error_code: 'reconcile_stale_files_failed',
      error: message,
    });
    throw error;
  }
};

export const handleRetryRateLimitedFiles = async (
  data: RetryRateLimitedFilesJobData
): Promise<{ queued: number }> => {
  const startedAt = Date.now();
  const runId = await startSyncRun({
    scope_type: FIGMA_SYNC_SCOPE_TYPE.RECONCILE,
    scope_id: 'rate-limited-files',
    trigger: data.trigger,
  });

  try {
    const files = await listRateLimitedFiles();
    await Promise.all(
      files.map((file) =>
        enqueueSyncFileTree({
          file_key: file.file_key,
          project_id: file.project_id,
          team_id: file.team_id,
          reason: 'reconcile',
          source: 'poll',
        })
      )
    );
    await finishSyncRun({
      id: runId,
      status: FIGMA_SYNC_STATUS.OK,
      stats: { queued_file_count: files.length },
    });
    logger.info('[figma-indexer] retry_rate_limited_completed', {
      component: 'figma-indexer',
      job_type: 'RETRY_RATE_LIMITED_FILES',
      scope_type: 'reconcile',
      scope_id: 'rate-limited-files',
      duration_ms: Date.now() - startedAt,
      result: 'ok',
      queued_file_count: files.length,
    });
    return { queued: files.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await finishSyncRun({
      id: runId,
      status: FIGMA_SYNC_STATUS.ERROR,
      error: message,
    });
    logger.error('[figma-indexer] retry_rate_limited_failed', {
      component: 'figma-indexer',
      job_type: 'RETRY_RATE_LIMITED_FILES',
      scope_type: 'reconcile',
      scope_id: 'rate-limited-files',
      duration_ms: Date.now() - startedAt,
      result: 'error',
      error_code: 'retry_rate_limited_failed',
      error: message,
    });
    throw error;
  }
};
