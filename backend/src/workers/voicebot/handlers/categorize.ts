import { ObjectId } from 'mongodb';
import { VOICEBOT_COLLECTIONS } from '../../../constants.js';
import { getDb } from '../../../services/db.js';
import { mergeWithRuntimeFilter } from '../../../services/runtimeScope.js';
import { getLogger } from '../../../utils/logger.js';

const logger = getLogger();

export type CategorizeJobData = {
  message_id?: string;
  session_id?: string;
  force?: boolean;
};

type CategorizeResult = {
  ok: boolean;
  message_id?: string;
  session_id?: string;
  skipped?: boolean;
  reason?: string;
  error?: string;
};

export const handleCategorizeJob = async (
  payload: CategorizeJobData
): Promise<CategorizeResult> => {
  const message_id = String(payload.message_id || '').trim();
  if (!message_id || !ObjectId.isValid(message_id)) {
    return { ok: false, error: 'invalid_message_id' };
  }

  const db = getDb();
  const message = await db.collection(VOICEBOT_COLLECTIONS.MESSAGES).findOne(
    mergeWithRuntimeFilter(
      { _id: new ObjectId(message_id), is_deleted: { $ne: true } },
      { field: 'runtime_tag' }
    )
  ) as Record<string, unknown> | null;

  if (!message) {
    return { ok: false, error: 'message_not_found' };
  }

  const session_id = String(message.session_id || payload.session_id || '').trim() || undefined;
  const hasTranscriptionText = String(message.transcription_text || '').trim().length > 0;
  if (!hasTranscriptionText && !payload.force) {
    return {
      ok: true,
      skipped: true,
      reason: 'missing_transcription_text',
      message_id,
      ...(session_id ? { session_id } : {}),
    };
  }

  logger.info('[voicebot-worker] categorize scaffold accepted job', {
    message_id,
    session_id,
    mode: 'skeleton',
    action: 'deferred_to_external_worker',
  });

  return {
    ok: true,
    skipped: true,
    reason: 'engine_not_integrated',
    message_id,
    ...(session_id ? { session_id } : {}),
  };
};
