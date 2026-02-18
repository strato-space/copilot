import { ObjectId } from 'mongodb';
import { VOICEBOT_COLLECTIONS } from '../../../constants.js';
import { getDb } from '../../../services/db.js';
import { mergeWithRuntimeFilter } from '../../../services/runtimeScope.js';
import { getLogger } from '../../../utils/logger.js';

const logger = getLogger();

export type ProcessingLoopJobData = {
  session_id?: string;
  limit?: number;
};

type ProcessingLoopResult = {
  ok: boolean;
  scanned_sessions: number;
  pending_transcriptions: number;
  pending_categorizations: number;
  mode: 'skeleton';
};

const clampLimit = (value: unknown): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 50;
  if (parsed < 1) return 1;
  if (parsed > 200) return 200;
  return Math.floor(parsed);
};

export const handleProcessingLoopJob = async (
  payload: ProcessingLoopJobData
): Promise<ProcessingLoopResult> => {
  const db = getDb();
  const sessionLimit = clampLimit(payload.limit);
  const rawSessionId = String(payload.session_id || '').trim();
  const sessionScope = rawSessionId
    ? mergeWithRuntimeFilter({
        ...(ObjectId.isValid(rawSessionId) ? { _id: new ObjectId(rawSessionId) } : { _id: null }),
        is_deleted: { $ne: true },
      }, { field: 'runtime_tag' })
    : mergeWithRuntimeFilter(
        { is_deleted: { $ne: true }, session_type: 'multiprompt_voice_session' },
        { field: 'runtime_tag' }
      );

  const sessions = await db
    .collection(VOICEBOT_COLLECTIONS.SESSIONS)
    .find(sessionScope)
    .limit(sessionLimit)
    .toArray();

  const pendingTranscriptions = await db.collection(VOICEBOT_COLLECTIONS.MESSAGES).countDocuments(
    mergeWithRuntimeFilter(
      { is_deleted: { $ne: true }, to_transcribe: true, is_transcribed: { $ne: true } },
      { field: 'runtime_tag' }
    )
  );
  const pendingCategorizations = await db.collection(VOICEBOT_COLLECTIONS.MESSAGES).countDocuments(
    mergeWithRuntimeFilter(
      { is_deleted: { $ne: true }, to_categorize: true },
      { field: 'runtime_tag' }
    )
  );

  logger.info('[voicebot-worker] processing_loop scaffold snapshot', {
    scanned_sessions: sessions.length,
    pending_transcriptions: pendingTranscriptions,
    pending_categorizations: pendingCategorizations,
    mode: 'skeleton',
  });

  return {
    ok: true,
    scanned_sessions: sessions.length,
    pending_transcriptions: pendingTranscriptions,
    pending_categorizations: pendingCategorizations,
    mode: 'skeleton',
  };
};
