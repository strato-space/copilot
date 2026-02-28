import { getLogger } from '../../../../utils/logger.js';
import { cleanupEmptySessions } from '../../../../services/voicebot/voicebotSessionCleanupService.js';

const logger = getLogger();

export type CleanupEmptySessionsJobData = {
  max_age_hours?: number;
  batch_limit?: number;
  dry_run?: boolean;
};

export const handleCleanupEmptySessionsJob = async (
  payload: CleanupEmptySessionsJobData
): Promise<Awaited<ReturnType<typeof cleanupEmptySessions>>> => {
  const options = {
    ...(typeof payload.max_age_hours === 'number' ? { maxAgeHours: payload.max_age_hours } : {}),
    ...(typeof payload.batch_limit === 'number' ? { batchLimit: payload.batch_limit } : {}),
    ...(payload.dry_run === true ? { dryRun: true } : {}),
  };
  const result = await cleanupEmptySessions({
    ...options,
  });
  logger.info('[voicebot-worker] cleanup_empty_sessions completed', result);
  return result;
};
