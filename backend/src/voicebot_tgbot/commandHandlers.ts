import { randomBytes } from 'node:crypto';
import { ObjectId, type Db } from 'mongodb';
import { z } from 'zod';
import {
  VOICEBOT_COLLECTIONS,
  VOICEBOT_JOBS,
  VOICEBOT_PROCESSORS,
  VOICEBOT_SESSION_SOURCE,
  VOICEBOT_SESSION_TYPES,
  VOICE_BOT_SESSION_ACCESS,
  RUNTIME_TAG,
} from '../constants.js';
import { mergeWithRuntimeFilter } from '../services/runtimeScope.js';
import { formatTelegramSessionEventMessage, getPublicInterfaceBase } from './sessionTelegramMessage.js';
import { getSessionIdFromCommand, extractSessionIdFromText } from './sessionRef.js';
import {
  clearActiveVoiceSessionBySessionId,
  clearActiveVoiceSessionForUser,
  getActiveVoiceSessionForUser,
  setActiveVoiceSession,
} from './activeSessionMapping.js';

const commandContextSchema = z.object({
  telegram_user_id: z.union([z.string(), z.number()]),
  chat_id: z.union([z.string(), z.number()]),
  username: z.string().trim().optional().nullable(),
  text: z.string().optional().nullable(),
  reply_text: z.string().optional().nullable(),
});

const noActiveSessionMessage =
  'Активная сессия не найдена. Напишите /start, чтобы создать новую, или укажите id: /session <session_id>.';

const helpMessageLines = [
  'Доступные команды:',
  '/start — создать новую сессию',
  '/session — показать активную сессию или активировать по ID/ссылке',
  '/done — завершить активную сессию',
  '/login — получить одноразовую ссылку входа в web-интерфейс',
];

export type QueueLike = {
  add: (name: string, data: Record<string, unknown>, options?: Record<string, unknown>) => Promise<unknown>;
};

const normalizeTelegramId = (value: unknown): string | null => {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return null;
  return String(parsed);
};

const normalizeChatId = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const toObjectIdOrNull = (value: unknown): ObjectId | null => {
  if (value instanceof ObjectId) return value;
  const raw = String(value ?? '').trim();
  if (!raw || !ObjectId.isValid(raw)) return null;
  return new ObjectId(raw);
};

const resolvePerformerByTelegram = async ({
  db,
  telegram_user_id,
}: {
  db: Db;
  telegram_user_id: string | number;
}) => {
  const telegramId = normalizeTelegramId(telegram_user_id);
  if (!telegramId) return null;
  return db.collection(VOICEBOT_COLLECTIONS.PERFORMERS).findOne({
    telegram_id: telegramId,
    is_deleted: { $ne: true },
    is_banned: { $ne: true },
  }) as Promise<Record<string, unknown> | null>;
};

const hasSessionAccessForPerformer = ({
  session,
  performer,
  telegram_user_id,
}: {
  session: Record<string, unknown>;
  performer: Record<string, unknown> | null;
  telegram_user_id: string | number;
}) => {
  if (!performer) return false;
  const performerId = String(performer._id || '').trim();
  const sessionUserId = String(session.user_id || '').trim();
  const byOwner = Boolean(performerId && sessionUserId && performerId === sessionUserId);
  if (byOwner) return true;

  const performerTelegram = normalizeTelegramId(telegram_user_id);
  const sessionChat = normalizeTelegramId(session.chat_id);
  return Boolean(performerTelegram && sessionChat && performerTelegram === sessionChat);
};

const resolveActiveOpenSession = async ({
  db,
  telegram_user_id,
}: {
  db: Db;
  telegram_user_id: string | number;
}): Promise<Record<string, unknown> | null> => {
  const mapping = await getActiveVoiceSessionForUser({ db, telegram_user_id });
  const activeSessionId = toObjectIdOrNull(mapping?.active_session_id);
  if (!activeSessionId) return null;

  const session = await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).findOne(
    mergeWithRuntimeFilter(
      {
        _id: activeSessionId,
        is_deleted: { $ne: true },
        is_active: true,
      },
      { field: 'runtime_tag' }
    )
  ) as Record<string, unknown> | null;
  if (!session) {
    await clearActiveVoiceSessionForUser({ db, telegram_user_id });
    return null;
  }
  return session;
};

const resolveExplicitSessionForCommand = async ({
  db,
  context,
}: {
  db: Db;
  context: z.infer<typeof commandContextSchema>;
}): Promise<Record<string, unknown> | null> => {
  const explicitFromCommand = getSessionIdFromCommand(context.text);
  const explicitFromReply = extractSessionIdFromText(context.reply_text);
  const sessionId = explicitFromCommand || explicitFromReply;
  if (!sessionId || !ObjectId.isValid(sessionId)) return null;

  return db.collection(VOICEBOT_COLLECTIONS.SESSIONS).findOne(
    mergeWithRuntimeFilter(
      {
        _id: new ObjectId(sessionId),
        is_deleted: { $ne: true },
      },
      { field: 'runtime_tag' }
    )
  ) as Promise<Record<string, unknown> | null>;
};

const createTelegramSession = async ({
  db,
  performer,
  chat_id,
}: {
  db: Db;
  performer: Record<string, unknown>;
  chat_id: string | number;
}) => {
  const createdAt = new Date();
  const sessionDoc: Record<string, unknown> = {
    chat_id: normalizeChatId(chat_id),
    session_type: VOICEBOT_SESSION_TYPES.MULTIPROMPT_VOICE_SESSION,
    session_source: VOICEBOT_SESSION_SOURCE.TELEGRAM,
    runtime_tag: RUNTIME_TAG,
    user_id: performer._id || null,
    is_active: true,
    is_deleted: false,
    is_messages_processed: false,
    access_level: VOICE_BOT_SESSION_ACCESS.PRIVATE,
    created_at: createdAt,
    updated_at: createdAt,
    processors: [
      VOICEBOT_PROCESSORS.TRANSCRIPTION,
      VOICEBOT_PROCESSORS.CATEGORIZATION,
      VOICEBOT_PROCESSORS.FINALIZATION,
    ],
    session_processors: [VOICEBOT_JOBS.postprocessing.CREATE_TASKS],
  };

  const op = await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).insertOne(sessionDoc);
  return {
    ...sessionDoc,
    _id: op.insertedId,
  };
};

export const handleLoginCommand = async ({
  db,
  telegram_user_id,
}: {
  db: Db;
  telegram_user_id: string | number;
}): Promise<{ ok: boolean; message: string; token?: string }> => {
  const telegramId = normalizeTelegramId(telegram_user_id);
  if (!telegramId) {
    return { ok: false, message: 'invalid_telegram_user_id' };
  }

  const token = randomBytes(32).toString('hex');
  await db.collection(VOICEBOT_COLLECTIONS.ONE_USE_TOKENS).insertOne({
    token,
    chat_id: telegramId,
    created_at: new Date(),
    is_used: false,
    runtime_tag: RUNTIME_TAG,
  });

  return {
    ok: true,
    token,
    message: `${getPublicInterfaceBase()}/tg_auth?token=${token}`,
  };
};

export const handleStartCommand = async ({
  db,
  context,
  commonQueue,
}: {
  db: Db;
  context: unknown;
  commonQueue?: QueueLike;
}): Promise<{ ok: boolean; message: string; session_id?: string }> => {
  const parsed = commandContextSchema.safeParse(context);
  if (!parsed.success) return { ok: false, message: 'invalid_context' };

  const performer = await resolvePerformerByTelegram({
    db,
    telegram_user_id: parsed.data.telegram_user_id,
  });
  if (!performer) return { ok: false, message: 'You are not authorized to use this bot.' };

  const session = await createTelegramSession({
    db,
    performer,
    chat_id: parsed.data.chat_id,
  });
  const session_id = String(session._id);

  await setActiveVoiceSession({
    db,
    telegram_user_id: parsed.data.telegram_user_id,
    chat_id: parsed.data.chat_id,
    session_id,
    username: parsed.data.username || null,
  });

  if (commonQueue) {
    await commonQueue.add(
      VOICEBOT_JOBS.common.START_MULTIPROMPT,
      { ...session, _id: session_id },
      {
        attempts: 1,
        removeOnComplete: true,
      }
    );
  }

  const message = await formatTelegramSessionEventMessage({
    db,
    session,
    eventName: 'Сессия создана',
  });

  return { ok: true, message, session_id };
};

export const handleSessionCommand = async ({
  db,
  context,
}: {
  db: Db;
  context: unknown;
}): Promise<{ ok: boolean; message: string; session_id?: string }> => {
  const parsed = commandContextSchema.safeParse(context);
  if (!parsed.success) return { ok: false, message: 'invalid_context' };

  const performer = await resolvePerformerByTelegram({
    db,
    telegram_user_id: parsed.data.telegram_user_id,
  });
  if (!performer) return { ok: false, message: 'You are not authorized to use this bot.' };

  const explicitSession = await resolveExplicitSessionForCommand({
    db,
    context: parsed.data,
  });

  if (explicitSession) {
    const allowed = hasSessionAccessForPerformer({
      session: explicitSession,
      performer,
      telegram_user_id: parsed.data.telegram_user_id,
    });
    if (!allowed) return { ok: false, message: 'Сессия не найдена или недоступна.' };

    const session_id = String(explicitSession._id || '').trim();
    await setActiveVoiceSession({
      db,
      telegram_user_id: parsed.data.telegram_user_id,
      chat_id: parsed.data.chat_id,
      session_id,
      username: parsed.data.username || null,
    });
    return {
      ok: true,
      session_id,
      message: await formatTelegramSessionEventMessage({
        db,
        session: explicitSession,
        eventName: 'Сессия активирована',
      }),
    };
  }

  const activeSession = await resolveActiveOpenSession({
    db,
    telegram_user_id: parsed.data.telegram_user_id,
  });
  if (!activeSession) {
    return { ok: false, message: noActiveSessionMessage };
  }

  return {
    ok: true,
    session_id: String(activeSession._id || '').trim(),
    message: await formatTelegramSessionEventMessage({
      db,
      session: activeSession,
      eventName: 'Активная сессия',
    }),
  };
};

export const handleDoneCommand = async ({
  db,
  context,
  commonQueue,
}: {
  db: Db;
  context: unknown;
  commonQueue?: QueueLike;
}): Promise<{ ok: boolean; message: string; session_id?: string }> => {
  const parsed = commandContextSchema.safeParse(context);
  if (!parsed.success) return { ok: false, message: 'invalid_context' };

  const session = await resolveActiveOpenSession({
    db,
    telegram_user_id: parsed.data.telegram_user_id,
  });
  if (!session) {
    return { ok: false, message: noActiveSessionMessage };
  }
  const session_id = String(session._id || '').trim();

  if (commonQueue) {
    await commonQueue.add(
      VOICEBOT_JOBS.common.DONE_MULTIPROMPT,
      {
        chat_id: normalizeChatId(parsed.data.chat_id),
        telegram_user_id: normalizeTelegramId(parsed.data.telegram_user_id),
        session_id,
      },
      {
        attempts: 1,
        removeOnComplete: true,
      }
    );
  } else {
    await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).updateOne(
      mergeWithRuntimeFilter({ _id: new ObjectId(session_id) }, { field: 'runtime_tag' }),
      {
        $set: {
          is_active: false,
          to_finalize: true,
          done_at: new Date(),
          updated_at: new Date(),
        },
        $inc: { done_count: 1 },
      }
    );
  }

  await clearActiveVoiceSessionBySessionId({ db, session_id });
  await clearActiveVoiceSessionForUser({
    db,
    telegram_user_id: parsed.data.telegram_user_id,
  });

  return {
    ok: true,
    session_id,
    message: await formatTelegramSessionEventMessage({
      db,
      session: {
        ...session,
        is_active: false,
      },
      eventName: 'Сессия завершена',
    }),
  };
};

export const getHelpMessage = (): string => helpMessageLines.join('\n');

export const NO_ACTIVE_SESSION_MESSAGE = noActiveSessionMessage;

