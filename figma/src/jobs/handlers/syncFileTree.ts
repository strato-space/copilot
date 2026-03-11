import { getEnv } from '../../config/env.js';
import { FIGMA_INDEX_STATUS, FIGMA_SYNC_SCOPE_TYPE, FIGMA_SYNC_STATUS } from '../../constants/sync.js';
import { getFileByKey, setFileIndexState } from '../../domain/files.js';
import { saveSnapshotIfNeeded } from '../../domain/snapshots.js';
import { finishSyncRun, startSyncRun } from '../../domain/syncRuns.js';
import { getFileTree } from '../../figma-api/endpoints.js';
import { FigmaApiError } from '../../figma-api/rateLimit.js';
import { extractFileTreeSnapshot } from '../../services/treeExtractor.js';
import type { SyncFileTreeJobData } from '../../types/jobs.js';
import { createChildLogger } from '../../utils/logger.js';

const logger = createChildLogger({ component: 'figma-indexer' });

export const handleSyncFileTree = async (
  data: SyncFileTreeJobData
): Promise<{ createdSnapshot: boolean; pages: number; sections: number }> => {
  const startedAt = Date.now();
  const runId = await startSyncRun({
    scope_type: FIGMA_SYNC_SCOPE_TYPE.FILE,
    scope_id: data.file_key,
    trigger: data.reason === 'manual' ? 'manual' : data.reason === 'webhook' ? 'webhook' : 'interval',
  });

  try {
    const file = await getFileByKey(data.file_key);
    if (!file) {
      throw new Error(`figma_file_not_found:${data.file_key}`);
    }
    const response = await getFileTree(data.file_key, getEnv().figmaFileTreeDepth);
    const snapshot = extractFileTreeSnapshot({
      fileKey: data.file_key,
      fileName: file.name,
      depth: getEnv().figmaFileTreeDepth,
      response,
    });
    const result = await saveSnapshotIfNeeded({
      fileKey: data.file_key,
      projectId: data.project_id,
      teamId: data.team_id,
      depth: getEnv().figmaFileTreeDepth,
      source: data.source,
      snapshot,
    });
    await setFileIndexState({
      fileKey: data.file_key,
      status: FIGMA_INDEX_STATUS.OK,
      error: null,
      version: snapshot.version,
    });
    await finishSyncRun({
      id: runId,
      status: FIGMA_SYNC_STATUS.OK,
      stats: {
        created_snapshot: result.created,
        pages_count: result.pagesCount,
        sections_count: result.sectionsCount,
      },
    });
    logger.info('[figma-indexer] sync_file_tree_completed', {
      component: 'figma-indexer',
      job_type: 'SYNC_FILE_TREE',
      scope_type: 'file',
      scope_id: data.file_key,
      figma_team_id: data.team_id,
      figma_project_id: data.project_id,
      figma_file_key: data.file_key,
      duration_ms: Date.now() - startedAt,
      result: 'ok',
      created_snapshot: result.created,
      pages_count: result.pagesCount,
      sections_count: result.sectionsCount,
    });
    return {
      createdSnapshot: result.created,
      pages: result.pagesCount,
      sections: result.sectionsCount,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const isRateLimited = error instanceof FigmaApiError && error.status === 429;
    await setFileIndexState({
      fileKey: data.file_key,
      status: isRateLimited ? FIGMA_INDEX_STATUS.RATE_LIMITED : FIGMA_INDEX_STATUS.ERROR,
      error: errorMessage,
    });
    await finishSyncRun({
      id: runId,
      status: FIGMA_SYNC_STATUS.ERROR,
      error: errorMessage,
    });
    logger.error('[figma-indexer] sync_file_tree_failed', {
      component: 'figma-indexer',
      job_type: 'SYNC_FILE_TREE',
      scope_type: 'file',
      scope_id: data.file_key,
      figma_team_id: data.team_id,
      figma_project_id: data.project_id,
      figma_file_key: data.file_key,
      duration_ms: Date.now() - startedAt,
      result: 'error',
      error_code: isRateLimited ? 'figma_rate_limited' : 'sync_file_tree_failed',
      error: errorMessage,
    });
    throw error;
  }
};
