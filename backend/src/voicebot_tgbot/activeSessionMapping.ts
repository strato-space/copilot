import { ObjectId, type Db } from 'mongodb';
import { VOICEBOT_COLLECTIONS, RUNTIME_TAG } from '../constants.js';
import { mergeWithRuntimeFilter } from '../services/runtimeScope.js';

type ActiveSessionDoc = {
  telegram_user_id?: string | number | null;
  chat_id?: number | null;
  username?: string | null;
  active_session_id?: ObjectId | null;
  runtime_tag?: string;
  created_at?: Date;
  updated_at?: Date;
};

const normalizeTelegramUserId = (value: unknown): string | null => {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const asNumber = Number(raw);
  if (!Number.isFinite(asNumber)) return null;
  return String(asNumber);
};

const normalizeChatId = (value: unknown): number | null => {
  const asNumber = Number(value);
  if (!Number.isFinite(asNumber)) return null;
  return asNumber;
};

const toObjectIdOrNull = (value: unknown): ObjectId | null => {
  if (value instanceof ObjectId) return value;
  const raw = String(value ?? '').trim();
  if (!raw || !ObjectId.isValid(raw)) return null;
  return new ObjectId(raw);
};

export const setActiveVoiceSession = async ({
  db,
  telegram_user_id,
  chat_id,
  session_id,
  username = null,
}: {
  db: Db;
  telegram_user_id: string | number;
  chat_id?: string | number | null;
  session_id: string | ObjectId;
  username?: string | null;
}) => {
  const telegramUserId = normalizeTelegramUserId(telegram_user_id);
  const sessionObjectId = toObjectIdOrNull(session_id);
  if (!telegramUserId || !sessionObjectId) return null;

  return db.collection(VOICEBOT_COLLECTIONS.TG_VOICE_SESSIONS).updateOne(
    mergeWithRuntimeFilter({ telegram_user_id: telegramUserId }, { field: 'runtime_tag' }),
    {
      $set: {
        telegram_user_id: telegramUserId,
        chat_id: normalizeChatId(chat_id),
        username: typeof username === 'string' ? username : null,
        active_session_id: sessionObjectId,
        runtime_tag: RUNTIME_TAG,
        updated_at: new Date(),
      },
      $setOnInsert: {
        created_at: new Date(),
      },
    },
    { upsert: true }
  );
};

export const getActiveVoiceSessionForUser = async ({
  db,
  telegram_user_id,
}: {
  db: Db;
  telegram_user_id: string | number;
}): Promise<ActiveSessionDoc | null> => {
  const telegramUserId = normalizeTelegramUserId(telegram_user_id);
  if (!telegramUserId) return null;

  return db.collection(VOICEBOT_COLLECTIONS.TG_VOICE_SESSIONS).findOne(
    mergeWithRuntimeFilter({ telegram_user_id: telegramUserId }, { field: 'runtime_tag' })
  ) as Promise<ActiveSessionDoc | null>;
};

export const clearActiveVoiceSessionForUser = async ({
  db,
  telegram_user_id,
}: {
  db: Db;
  telegram_user_id: string | number;
}) => {
  const telegramUserId = normalizeTelegramUserId(telegram_user_id);
  if (!telegramUserId) return null;

  return db.collection(VOICEBOT_COLLECTIONS.TG_VOICE_SESSIONS).updateMany(
    mergeWithRuntimeFilter({ telegram_user_id: telegramUserId }, { field: 'runtime_tag' }),
    {
      $unset: { active_session_id: '' },
      $set: { updated_at: new Date(), runtime_tag: RUNTIME_TAG },
    }
  );
};

export const clearActiveVoiceSessionBySessionId = async ({
  db,
  session_id,
}: {
  db: Db;
  session_id: string | ObjectId;
}) => {
  const sessionObjectId = toObjectIdOrNull(session_id);
  if (!sessionObjectId) return null;

  return db.collection(VOICEBOT_COLLECTIONS.TG_VOICE_SESSIONS).updateMany(
    mergeWithRuntimeFilter({ active_session_id: sessionObjectId }, { field: 'runtime_tag' }),
    {
      $unset: { active_session_id: '' },
      $set: { updated_at: new Date(), runtime_tag: RUNTIME_TAG },
    }
  );
};

