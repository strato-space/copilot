import { ObjectId } from 'mongodb';
import { VOICEBOT_COLLECTIONS } from '../../../constants.js';
import { getDb } from '../../../services/db.js';
import { mergeWithRuntimeFilter } from '../../../services/runtimeScope.js';
import { getLogger } from '../../../utils/logger.js';

const logger = getLogger();

export type FinalizationJobData = {
  session_id?: string;
  force?: boolean;
};

type FinalizationResult = {
  ok: boolean;
  session_id?: string;
  skipped?: boolean;
  reason?: string;
  error?: string;
};

export const handleFinalizationJob = async (
  payload: FinalizationJobData
): Promise<FinalizationResult> => {
  const session_id = String(payload.session_id || '').trim();
  if (!session_id || !ObjectId.isValid(session_id)) {
    return { ok: false, error: 'invalid_session_id' };
  }

  const db = getDb();
  const session = await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).findOne(
    mergeWithRuntimeFilter(
      { _id: new ObjectId(session_id), is_deleted: { $ne: true } },
      { field: 'runtime_tag' }
    )
  ) as Record<string, unknown> | null;

  if (!session) {
    return { ok: false, error: 'session_not_found' };
  }

  const isProcessed = Boolean(session.is_messages_processed);
  if (!isProcessed && !payload.force) {
    return {
      ok: true,
      skipped: true,
      reason: 'messages_not_processed',
      session_id,
    };
  }

  logger.info('[voicebot-worker] finalization scaffold accepted job', {
    session_id,
    mode: 'skeleton',
    action: 'deferred_to_external_worker',
  });

  return {
    ok: true,
    skipped: true,
    reason: 'engine_not_integrated',
    session_id,
  };
};

