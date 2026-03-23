import { getLogger } from '../../../../utils/logger.js';
import { closeInactiveVoiceSessions } from '../../../../services/voicebot/voicebotInactiveSessionService.js';
import { getVoicebotQueues, type VoicebotQueuesMap } from '../../../../services/voicebotQueues.js';
import { handleDoneMultipromptJob } from '../doneMultiprompt.js';
import type { CompleteSessionDoneFlowParams } from '../../../../services/voicebotSessionDoneFlow.js';

const logger = getLogger();

export type CloseInactiveSessionsJobData = {
  inactivity_minutes?: number;
  batch_limit?: number;
  dry_run?: boolean;
  generate_missing_title?: boolean;
};

const mapQueuesToDoneFlow = (
  queues: VoicebotQueuesMap | null
): CompleteSessionDoneFlowParams['queues'] => {
  if (!queues) return null;
  const mapped: NonNullable<CompleteSessionDoneFlowParams['queues']> = {};
  for (const [queueName, queue] of Object.entries(queues)) {
    mapped[queueName] = {
      add: (name: string, payload: unknown, opts?: unknown) =>
        queue.add(name, payload, opts as Parameters<typeof queue.add>[2]),
    };
  }
  return mapped;
};

export const handleCloseInactiveSessionsJob = async (
  payload: CloseInactiveSessionsJobData
): Promise<Awaited<ReturnType<typeof closeInactiveVoiceSessions>>> => {
  const result = await closeInactiveVoiceSessions({
    ...(typeof payload.inactivity_minutes === 'number'
      ? { inactivityMinutes: payload.inactivity_minutes }
      : {}),
    ...(typeof payload.batch_limit === 'number' ? { batchLimit: payload.batch_limit } : {}),
    ...(payload.dry_run === true ? { dryRun: true } : {}),
    ...(payload.generate_missing_title === false ? { generateMissingTitle: false } : {}),
    queues: mapQueuesToDoneFlow(getVoicebotQueues()),
    fallbackDoneHandler: handleDoneMultipromptJob,
    source: {
      type: 'worker',
      worker: 'voicebot-close-inactive-sessions',
      event: 'session_done',
    },
  });
  logger.info('[voicebot-worker] close_inactive_sessions completed', {
    inactivity_minutes: result.inactivity_minutes,
    candidates: result.candidates,
    closed: result.closed,
    failed: result.failed,
  });
  return result;
};
