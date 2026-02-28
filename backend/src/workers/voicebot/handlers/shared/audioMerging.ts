import { ObjectId } from 'mongodb';
import { VOICEBOT_COLLECTIONS, VOICE_MESSAGE_SOURCES } from '../../../../constants.js';
import { getDb } from '../../../../services/db.js';
import { IS_PROD_RUNTIME, mergeWithRuntimeFilter } from '../../../../services/runtimeScope.js';
import { getLogger } from '../../../../utils/logger.js';

const logger = getLogger();

export type AudioMergingJobData = {
  session_id?: string;
};

type SessionRecord = {
  _id: ObjectId;
};

type AudioMergingResult = {
  ok: boolean;
  session_id?: string;
  skipped?: boolean;
  reason?: string;
  telegram_chunks?: number;
  error?: string;
};

const runtimeQuery = (query: Record<string, unknown>) =>
  mergeWithRuntimeFilter(query, {
    field: 'runtime_tag',
    familyMatch: IS_PROD_RUNTIME,
    includeLegacyInProd: IS_PROD_RUNTIME,
  });

export const handleAudioMergingJob = async (
  payload: AudioMergingJobData
): Promise<AudioMergingResult> => {
  const session_id = String(payload.session_id || '').trim();
  if (!session_id || !ObjectId.isValid(session_id)) {
    return { ok: false, error: 'invalid_session_id' };
  }

  const db = getDb();
  const sessionObjectId = new ObjectId(session_id);
  const session = (await db
    .collection(VOICEBOT_COLLECTIONS.SESSIONS)
    .findOne(runtimeQuery({ _id: sessionObjectId, is_deleted: { $ne: true } }))) as SessionRecord | null;

  if (!session) {
    return { ok: false, error: 'session_not_found', session_id };
  }

  const telegramVoiceChunks = await db.collection(VOICEBOT_COLLECTIONS.MESSAGES).countDocuments(
    runtimeQuery({
      session_id: sessionObjectId,
      is_deleted: { $ne: true },
      source_type: VOICE_MESSAGE_SOURCES.TELEGRAM,
      file_unique_id: { $ne: null },
    })
  );

  if (telegramVoiceChunks < 2) {
    return {
      ok: true,
      skipped: true,
      reason: 'not_enough_telegram_voice_chunks',
      session_id,
      telegram_chunks: telegramVoiceChunks,
    };
  }

  logger.warn('[voicebot-worker] audio_merging skipped: telegram merge transport not available in TS runtime', {
    session_id,
    telegram_chunks: telegramVoiceChunks,
  });

  return {
    ok: true,
    skipped: true,
    reason: 'telegram_merge_transport_unavailable',
    session_id,
    telegram_chunks: telegramVoiceChunks,
  };
};
