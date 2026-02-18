import { ObjectId } from 'mongodb';
import { VOICEBOT_COLLECTIONS } from '../../../constants.js';
import { getDb } from '../../../services/db.js';
import { mergeWithRuntimeFilter } from '../../../services/runtimeScope.js';
import { getLogger } from '../../../utils/logger.js';

const logger = getLogger();

export type TranscribeJobData = {
  message_id?: string;
  session_id?: string;
  force?: boolean;
};

type TranscribeResult = {
  ok: boolean;
  message_id?: string;
  session_id?: string;
  skipped?: boolean;
  reason?: string;
  error?: string;
};

export const handleTranscribeJob = async (
  payload: TranscribeJobData
): Promise<TranscribeResult> => {
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
  const alreadyTranscribed = Boolean(message.is_transcribed);
  if (alreadyTranscribed && !payload.force) {
    return {
      ok: true,
      skipped: true,
      reason: 'already_transcribed',
      message_id,
      ...(session_id ? { session_id } : {}),
    };
  }

  // NOTE: real STT execution (OpenAI/Whisper) remains in dedicated worker service.
  logger.info('[voicebot-worker] transcribe scaffold accepted job', {
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
