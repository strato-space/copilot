import { ObjectId } from 'mongodb';
import { VOICEBOT_COLLECTIONS } from '../../../constants.js';
import { getDb } from '../../../services/db.js';
import { mergeWithRuntimeFilter } from '../../../services/runtimeScope.js';
import { getLogger } from '../../../utils/logger.js';
import {
  buildDoneNotifyPreview,
  writeDoneNotifyRequestedLog,
} from '../../../services/voicebotDoneNotify.js';
import {
  clearActiveVoiceSessionBySessionId,
  clearActiveVoiceSessionForUser,
} from '../../../voicebot_tgbot/activeSessionMapping.js';

const logger = getLogger();

export type DoneMultipromptJobData = {
  session_id?: string;
  chat_id?: string | number | null;
  telegram_user_id?: string | number | null;
  notify_preview?: {
    event_name?: string;
    telegram_message?: string;
  };
};

export const handleDoneMultipromptJob = async (
  payload: DoneMultipromptJobData
): Promise<{ ok: boolean; session_id?: string; error?: string }> => {
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

  await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).updateOne(
    mergeWithRuntimeFilter({ _id: new ObjectId(session_id) }, { field: 'runtime_tag' }),
    {
      $set: {
        is_active: false,
        to_finalize: true,
        done_at: new Date(),
        updated_at: new Date(),
      },
      $inc: {
        done_count: 1,
      },
    }
  );

  await clearActiveVoiceSessionBySessionId({ db, session_id });
  if (payload.telegram_user_id !== undefined && payload.telegram_user_id !== null) {
    await clearActiveVoiceSessionForUser({ db, telegram_user_id: payload.telegram_user_id });
  }

  const preview =
    payload.notify_preview?.telegram_message && payload.notify_preview?.event_name
      ? {
          event_name: payload.notify_preview.event_name,
          telegram_message: payload.notify_preview.telegram_message,
        }
      : await buildDoneNotifyPreview({
          db,
          session,
          eventName: 'Сессия завершена',
        });

  await writeDoneNotifyRequestedLog({
    db,
    session_id: new ObjectId(session_id),
    session,
    actor: {
      type: 'worker',
      worker: 'done_multiprompt',
    },
    source: {
      type: 'queue',
      queue: 'voicebot--common',
      job: 'DONE_MULTIPROMPT',
    },
    preview,
  });

  logger.info('[voicebot-worker] done_multiprompt handled', { session_id });
  return { ok: true, session_id };
};
