import { ObjectId } from 'mongodb';
import { VOICEBOT_COLLECTIONS } from '../../../constants.js';
import { getDb } from '../../../services/db.js';
import { getLogger } from '../../../utils/logger.js';

const logger = getLogger();

export type StartMultipromptJobData = {
  _id?: string;
  session_id?: string;
  chat_id?: string | number | null;
};

const resolveSessionId = (payload: StartMultipromptJobData): string =>
  String(payload.session_id || payload._id || '').trim();

export const handleStartMultipromptJob = async (
  payload: StartMultipromptJobData
): Promise<{ ok: boolean; session_id?: string; error?: string; updated?: boolean }> => {
  const session_id = resolveSessionId(payload);
  if (!session_id || !ObjectId.isValid(session_id)) {
    return { ok: false, error: 'invalid_session_id' };
  }

  const db = getDb();
  const result = await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).updateOne(
    {
      _id: new ObjectId(session_id),
      is_deleted: { $ne: true },
    },
    {
      $set: {
        is_waiting: true,
        updated_at: new Date(),
      },
    }
  );

  if (!result.matchedCount) {
    return { ok: false, error: 'session_not_found', session_id };
  }

  logger.info('[voicebot-worker] start_multiprompt handled', {
    session_id,
    chat_id: payload.chat_id ?? null,
  });

  return {
    ok: true,
    session_id,
    updated: result.modifiedCount > 0,
  };
};
