import { getTeamProjects } from '../../figma-api/endpoints.js';
import { upsertProjectsForTeam } from '../../domain/projects.js';
import { markTeamSynced } from '../../domain/teams.js';
import { enqueueSyncFilesForProject } from '../enqueue.js';
import { finishSyncRun, startSyncRun } from '../../domain/syncRuns.js';
import { FIGMA_SYNC_SCOPE_TYPE, FIGMA_SYNC_STATUS } from '../../constants/sync.js';
import type { SyncProjectsForTeamJobData } from '../../types/jobs.js';
import { createChildLogger } from '../../utils/logger.js';

const logger = createChildLogger({ component: 'figma-indexer' });

export const handleSyncProjectsForTeam = async (
  data: SyncProjectsForTeamJobData
): Promise<{ projects: number }> => {
  const startedAt = Date.now();
  const runId = await startSyncRun({
    scope_type: FIGMA_SYNC_SCOPE_TYPE.TEAM,
    scope_id: data.team_id,
    trigger: data.trigger,
  });

  try {
    const projects = await getTeamProjects(data.team_id);
    const result = await upsertProjectsForTeam({ teamId: data.team_id, projects });
    await markTeamSynced(data.team_id);
    await Promise.all(
      result.projectIds.map((projectId) =>
        enqueueSyncFilesForProject({
          team_id: data.team_id,
          project_id: projectId,
          trigger: data.trigger,
        })
      )
    );
    await finishSyncRun({
      id: runId,
      status: FIGMA_SYNC_STATUS.OK,
      stats: { project_count: projects.length },
    });
    logger.info('[figma-indexer] sync_projects_completed', {
      component: 'figma-indexer',
      job_type: 'SYNC_PROJECTS_FOR_TEAM',
      scope_type: 'team',
      scope_id: data.team_id,
      figma_team_id: data.team_id,
      duration_ms: Date.now() - startedAt,
      result: 'ok',
      project_count: projects.length,
    });
    return { projects: projects.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await finishSyncRun({
      id: runId,
      status: FIGMA_SYNC_STATUS.ERROR,
      error: message,
    });
    logger.error('[figma-indexer] sync_projects_failed', {
      component: 'figma-indexer',
      job_type: 'SYNC_PROJECTS_FOR_TEAM',
      scope_type: 'team',
      scope_id: data.team_id,
      figma_team_id: data.team_id,
      duration_ms: Date.now() - startedAt,
      result: 'error',
      error_code: 'sync_projects_failed',
      error: message,
    });
    throw error;
  }
};
