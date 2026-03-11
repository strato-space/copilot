import { upsertSeedTeams } from '../../domain/teams.js';
import { enqueueSyncProjectsForTeam } from '../enqueue.js';
import type { SyncTeamJobData } from '../../types/jobs.js';
import { createChildLogger } from '../../utils/logger.js';

const logger = createChildLogger({ component: 'figma-indexer' });

export const handleSyncTeam = async (data: SyncTeamJobData): Promise<{ queued: string }> => {
  const startedAt = Date.now();
  await upsertSeedTeams([data.team_id]);
  await enqueueSyncProjectsForTeam({
    team_id: data.team_id,
    trigger: data.trigger,
  });
  logger.info('[figma-indexer] sync_team_completed', {
    component: 'figma-indexer',
    job_type: 'SYNC_TEAM',
    scope_type: 'team',
    scope_id: data.team_id,
    figma_team_id: data.team_id,
    duration_ms: Date.now() - startedAt,
    result: 'ok',
  });
  return { queued: data.team_id };
};
