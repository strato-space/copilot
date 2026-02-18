import { ObjectId, type Db } from 'mongodb';
import { z } from 'zod';
import {
  RUNTIME_TAG,
  VOICEBOT_COLLECTIONS,
  VOICEBOT_JOBS,
  VOICEBOT_PROCESSORS,
  VOICEBOT_QUEUES,
  VOICEBOT_SESSION_SOURCE,
  VOICEBOT_SESSION_TYPES,
  VOICE_BOT_SESSION_ACCESS,
} from '../constants.js';
import { mergeWithRuntimeFilter } from '../services/runtimeScope.js';
import {
  getActiveVoiceSessionForUser,
  setActiveVoiceSession,
} from './activeSessionMapping.js';
import { extractSessionIdFromText } from './sessionRef.js';

export type QueueLike = {
  add: (name: string, data: Record<string, unknown>, options?: Record<string, unknown>) => Promise<unknown>;
};

const ingressBaseSchema = z.object({
  telegram_user_id: z.union([z.string(), z.number()]),
  chat_id: z.union([z.string(), z.number()]),
  username: z.string().trim().optional().nullable(),
  message_id: z.union([z.string(), z.number()]).optional(),
  message_timestamp: z.number().optional(),
  timestamp: z.number().optional(),
  session_id: z.string().optional().nullable(),
  source_type: z.string().optional().nullable(),
  text: z.string().optional().nullable(),
  caption: z.string().optional().nullable(),
  reply_text: z.string().optional().nullable(),
  forwarded_context: z.record(z.string(), z.unknown()).optional().nullable(),
});

export const ingressVoiceSchema = ingressBaseSchema.extend({
  file_id: z.string().min(1),
  file_unique_id: z.string().optional().nullable(),
  duration: z.number().optional().nullable(),
  mime_type: z.string().optional().nullable(),
});

export const ingressTextSchema = ingressBaseSchema.extend({
  text: z.string().min(1),
  speaker: z.string().optional().nullable(),
});

const attachmentSchema = z.object({
  kind: z.string().min(1),
  source: z.string().optional().nullable(),
  file_id: z.string().optional().nullable(),
  file_unique_id: z.string().optional().nullable(),
  name: z.string().optional().nullable(),
  mimeType: z.string().optional().nullable(),
  size: z.number().optional().nullable(),
  width: z.number().optional().nullable(),
  height: z.number().optional().nullable(),
  url: z.string().optional().nullable(),
  uri: z.string().optional().nullable(),
});

export const ingressAttachmentSchema = ingressBaseSchema.extend({
  text: z.string().optional().nullable(),
  attachments: z.array(attachmentSchema).min(1),
  message_type: z.string().optional().nullable(),
});

type IngressSession = {
  _id: ObjectId;
  session_type?: string;
  chat_id?: number;
  user_id?: ObjectId | null;
  is_active?: boolean;
};

type IngressPerformer = {
  _id: ObjectId;
  telegram_id?: string;
};

type NormalizedIngressContext = {
  telegram_user_id: string;
  chat_id: number;
  username: string | null;
  message_id: string;
  message_timestamp: number;
  timestamp: number;
  source_type: string;
  session_id: string | null;
  text: string;
  caption: string;
  reply_text: string;
  forwarded_context: Record<string, unknown> | null;
};

type IngressDeps = {
  db: Db;
  commonQueue?: QueueLike;
  voiceQueue?: QueueLike;
  logger?: {
    info?: (msg: string, meta?: Record<string, unknown>) => void;
    warn?: (msg: string, meta?: Record<string, unknown>) => void;
    error?: (msg: string, meta?: Record<string, unknown>) => void;
  };
};

const getQueueByName = (
  queues: Partial<Record<string, QueueLike>> | undefined,
  queueName: string
): QueueLike | undefined => queues?.[queueName];

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

const normalizeString = (value: unknown): string => String(value ?? '').trim();

const normalizeRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
};

const toObjectIdOrNull = (value: unknown): ObjectId | null => {
  if (value instanceof ObjectId) return value;
  const raw = normalizeString(value);
  if (!raw || !ObjectId.isValid(raw)) return null;
  return new ObjectId(raw);
};

const runtimeQuery = (query: Record<string, unknown>) =>
  mergeWithRuntimeFilter(query, { field: 'runtime_tag' });

const logInfo = (deps: IngressDeps, message: string, meta?: Record<string, unknown>) => {
  deps.logger?.info?.(message, meta);
};

const logWarn = (deps: IngressDeps, message: string, meta?: Record<string, unknown>) => {
  deps.logger?.warn?.(message, meta);
};

const findPerformerByTelegram = async (deps: IngressDeps, telegramUserId: string): Promise<IngressPerformer | null> =>
  deps.db.collection(VOICEBOT_COLLECTIONS.PERFORMERS).findOne(
    {
      telegram_id: telegramUserId,
      is_deleted: { $ne: true },
      is_banned: { $ne: true },
    },
    {
      projection: { _id: 1, telegram_id: 1 },
    }
  ) as Promise<IngressPerformer | null>;

const hasSessionAccessForPerformer = ({
  session,
  performer,
  telegram_user_id,
}: {
  session: Record<string, unknown>;
  performer: IngressPerformer | null;
  telegram_user_id: string;
}): boolean => {
  if (!performer) return false;
  const performerId = String(performer._id || '').trim();
  const sessionUserId = String(session.user_id || '').trim();
  if (performerId && sessionUserId && performerId === sessionUserId) return true;

  const sessionChatId = normalizeTelegramId(session.chat_id);
  return Boolean(sessionChatId && sessionChatId === telegram_user_id);
};

const findSessionById = async (deps: IngressDeps, sessionId: string): Promise<IngressSession | null> => {
  if (!ObjectId.isValid(sessionId)) return null;
  return deps.db.collection(VOICEBOT_COLLECTIONS.SESSIONS).findOne(
    runtimeQuery({
      _id: new ObjectId(sessionId),
      is_deleted: { $ne: true },
    })
  ) as Promise<IngressSession | null>;
};

const findActiveSession = async (
  deps: IngressDeps,
  telegram_user_id: string
): Promise<IngressSession | null> => {
  const mapping = await getActiveVoiceSessionForUser({ db: deps.db, telegram_user_id });
  const sessionId = toObjectIdOrNull(mapping?.active_session_id);
  if (!sessionId) return null;

  const session = await deps.db.collection(VOICEBOT_COLLECTIONS.SESSIONS).findOne(
    runtimeQuery({
      _id: sessionId,
      is_deleted: { $ne: true },
      is_active: true,
    })
  ) as IngressSession | null;

  return session || null;
};

const createSession = async (
  deps: IngressDeps,
  context: NormalizedIngressContext,
  performer: IngressPerformer | null
): Promise<IngressSession> => {
  const createdAt = new Date();
  const sessionDoc: Record<string, unknown> = {
    chat_id: context.chat_id,
    session_type: VOICEBOT_SESSION_TYPES.MULTIPROMPT_VOICE_SESSION,
    session_source: VOICEBOT_SESSION_SOURCE.TELEGRAM,
    runtime_tag: RUNTIME_TAG,
    user_id: performer?._id || null,
    is_active: true,
    is_deleted: false,
    is_messages_processed: false,
    is_waiting: true,
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

  const op = await deps.db.collection(VOICEBOT_COLLECTIONS.SESSIONS).insertOne(sessionDoc);
  return {
    ...(sessionDoc as IngressSession),
    _id: op.insertedId,
  };
};

const normalizeIngressContext = (input: z.infer<typeof ingressBaseSchema>): NormalizedIngressContext => {
  const telegram_user_id = normalizeTelegramId(input.telegram_user_id);
  const chat_id = normalizeChatId(input.chat_id);
  if (!telegram_user_id) throw new Error('invalid_telegram_user_id');
  if (!Number.isFinite(chat_id)) throw new Error('invalid_chat_id');

  const nowTs = Date.now();
  return {
    telegram_user_id,
    chat_id: Number(chat_id),
    username: normalizeString(input.username) || null,
    message_id: normalizeString(input.message_id) || new ObjectId().toHexString(),
    message_timestamp: Number(input.message_timestamp) || Math.floor(nowTs / 1000),
    timestamp: Number(input.timestamp) || nowTs,
    source_type: normalizeString(input.source_type) || 'telegram',
    session_id: normalizeString(input.session_id) || null,
    text: String(input.text || ''),
    caption: String(input.caption || ''),
    reply_text: String(input.reply_text || ''),
    forwarded_context: normalizeRecord(input.forwarded_context),
  };
};

const resolveSessionForIngress = async (
  deps: IngressDeps,
  context: NormalizedIngressContext,
  performer: IngressPerformer | null
): Promise<{ session: IngressSession; created: boolean }> => {
  const explicitSessionRef =
    extractSessionIdFromText(context.text) ||
    extractSessionIdFromText(context.caption) ||
    extractSessionIdFromText(context.reply_text) ||
    context.session_id;

  if (explicitSessionRef) {
    const explicitSession = await findSessionById(deps, explicitSessionRef);
    if (explicitSession) {
      const allowed = hasSessionAccessForPerformer({
        session: explicitSession as unknown as Record<string, unknown>,
        performer,
        telegram_user_id: context.telegram_user_id,
      });
      if (allowed) {
        await setActiveVoiceSession({
          db: deps.db,
          telegram_user_id: context.telegram_user_id,
          chat_id: context.chat_id,
          session_id: explicitSession._id,
          username: context.username,
        });
        return { session: explicitSession, created: false };
      }
      logWarn(deps, '[voicebot-tgbot] explicit session rejected by permissions', {
        telegram_user_id: context.telegram_user_id,
        session_id: explicitSessionRef,
      });
    }
  }

  const activeSession = await findActiveSession(deps, context.telegram_user_id);
  if (activeSession) {
    return { session: activeSession, created: false };
  }

  const createdSession = await createSession(deps, context, performer);
  await setActiveVoiceSession({
    db: deps.db,
    telegram_user_id: context.telegram_user_id,
    chat_id: context.chat_id,
    session_id: createdSession._id,
    username: context.username,
  });

  return { session: createdSession, created: true };
};

const updateSessionAfterMessage = async (
  deps: IngressDeps,
  sessionId: ObjectId,
  context: NormalizedIngressContext,
  extras: Record<string, unknown> = {}
): Promise<void> => {
  await deps.db.collection(VOICEBOT_COLLECTIONS.SESSIONS).updateOne(
    runtimeQuery({ _id: sessionId }),
    {
      $set: {
        is_waiting: false,
        last_message_id: context.message_id,
        last_message_timestamp: context.message_timestamp,
        is_messages_processed: false,
        updated_at: new Date(),
        ...extras,
      },
    }
  );
};

const buildReadyTextTranscription = (text: string, messageTimestampSec: number) => {
  const transcriptionText = text.trim();
  const segmentId = `ch_${new ObjectId().toHexString()}`;
  return {
    transcription_text: transcriptionText,
    task: 'transcribe',
    text: transcriptionText,
    transcription_raw: {
      provider: 'legacy',
      model: 'ready_text',
      segmented: false,
      text: transcriptionText,
    },
    transcription: {
      schema_version: 1,
      provider: 'legacy',
      model: 'ready_text',
      task: 'transcribe',
      duration_seconds: 0,
      text: transcriptionText,
      segments: [
        {
          id: segmentId,
          source_segment_id: null,
          start: 0,
          end: 0,
          speaker: null,
          text: transcriptionText,
          is_deleted: false,
        },
      ],
      usage: null,
    },
    transcription_chunks: [
      {
        segment_index: 0,
        id: segmentId,
        text: transcriptionText,
        timestamp: new Date(messageTimestampSec * 1000),
        duration_seconds: 0,
      },
    ],
    is_transcribed: true,
    transcription_method: 'ready_text',
  };
};

export const handleVoiceIngress = async ({
  deps,
  input,
}: {
  deps: IngressDeps;
  input: unknown;
}): Promise<{ ok: boolean; session_id?: string; message_id?: string; created_session?: boolean; error?: string }> => {
  const parsed = ingressVoiceSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid_voice_payload' };

  const context = normalizeIngressContext(parsed.data);
  const performer = await findPerformerByTelegram(deps, context.telegram_user_id);
  if (!performer) return { ok: false, error: 'not_authorized' };

  const { session, created } = await resolveSessionForIngress(deps, context, performer);
  const sessionId = new ObjectId(session._id);

  const doc: Record<string, unknown> = {
    file_id: parsed.data.file_id,
    file_unique_id: normalizeString(parsed.data.file_unique_id) || null,
    duration: Number(parsed.data.duration || 0) || 0,
    mime_type: normalizeString(parsed.data.mime_type) || null,
    chat_id: context.chat_id,
    message_id: context.message_id,
    message_timestamp: context.message_timestamp,
    timestamp: context.timestamp,
    source_type: context.source_type,
    telegram_user_id: context.telegram_user_id,
    username: context.username,
    user_id: performer._id,
    ...(context.forwarded_context ? { forwarded_context: context.forwarded_context } : {}),
    message_type: 'voice',
    attachments: [],
    runtime_tag: RUNTIME_TAG,
    session_id: sessionId,
    session_type: session.session_type || VOICEBOT_SESSION_TYPES.MULTIPROMPT_VOICE_SESSION,
    is_transcribed: false,
    transcribe_timestamp: Date.now(),
    transcribe_attempts: 0,
    to_transcribe: deps.voiceQueue ? false : true,
    created_at: Date.now(),
  };

  const insert = await deps.db.collection(VOICEBOT_COLLECTIONS.MESSAGES).insertOne(doc);
  const messageObjectId = insert.insertedId;

  await updateSessionAfterMessage(deps, sessionId, context, {
    last_voice_timestamp: Date.now(),
  });

  if (deps.voiceQueue) {
    const message_id = messageObjectId.toHexString();
    const session_id = sessionId.toHexString();
    const jobId = `${session_id}-${message_id}-TRANSCRIBE`;
    await deps.voiceQueue.add(
      VOICEBOT_JOBS.voice.TRANSCRIBE,
      {
        message_id,
        message_db_id: message_id,
        session_id,
        chat_id: context.chat_id,
        job_id: jobId,
      },
      {
        deduplication: { key: jobId },
        attempts: 1,
      }
    );
  }

  logInfo(deps, '[voicebot-tgbot] voice ingress accepted', {
    session_id: sessionId.toHexString(),
    message_id: messageObjectId.toHexString(),
    created_session: created,
    queue: Boolean(deps.voiceQueue),
  });

  return {
    ok: true,
    session_id: sessionId.toHexString(),
    message_id: messageObjectId.toHexString(),
    created_session: created,
  };
};

export const handleTextIngress = async ({
  deps,
  input,
}: {
  deps: IngressDeps;
  input: unknown;
}): Promise<{ ok: boolean; session_id?: string; message_id?: string; created_session?: boolean; error?: string }> => {
  const parsed = ingressTextSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid_text_payload' };

  const context = normalizeIngressContext(parsed.data);
  const performer = await findPerformerByTelegram(deps, context.telegram_user_id);
  if (!performer) return { ok: false, error: 'not_authorized' };

  const { session, created } = await resolveSessionForIngress(deps, context, performer);
  const sessionId = new ObjectId(session._id);

  const transcriptionPayload = buildReadyTextTranscription(parsed.data.text, context.message_timestamp);

  const doc: Record<string, unknown> = {
    chat_id: context.chat_id,
    message_id: context.message_id,
    message_timestamp: context.message_timestamp,
    timestamp: context.timestamp,
    source_type: context.source_type,
    telegram_user_id: context.telegram_user_id,
    username: context.username,
    user_id: performer._id,
    ...(context.forwarded_context ? { forwarded_context: context.forwarded_context } : {}),
    message_type: 'text',
    attachments: [],
    runtime_tag: RUNTIME_TAG,
    session_id: sessionId,
    session_type: session.session_type || VOICEBOT_SESSION_TYPES.MULTIPROMPT_VOICE_SESSION,
    created_at: Date.now(),
    ...transcriptionPayload,
    ...(parsed.data.speaker ? { speaker: parsed.data.speaker } : {}),
  };

  const insert = await deps.db.collection(VOICEBOT_COLLECTIONS.MESSAGES).insertOne(doc);
  const messageObjectId = insert.insertedId;

  await updateSessionAfterMessage(deps, sessionId, context);

  logInfo(deps, '[voicebot-tgbot] text ingress accepted', {
    session_id: sessionId.toHexString(),
    message_id: messageObjectId.toHexString(),
    created_session: created,
  });

  return {
    ok: true,
    session_id: sessionId.toHexString(),
    message_id: messageObjectId.toHexString(),
    created_session: created,
  };
};

const normalizeAttachments = (attachments: z.infer<typeof attachmentSchema>[]) =>
  attachments.map((item) => ({
    kind: normalizeString(item.kind) || 'file',
    source: normalizeString(item.source) || 'telegram',
    ...(normalizeString(item.file_id) ? { file_id: normalizeString(item.file_id) } : {}),
    ...(normalizeString(item.file_unique_id)
      ? { file_unique_id: normalizeString(item.file_unique_id) }
      : {}),
    ...(normalizeString(item.name) ? { name: normalizeString(item.name) } : {}),
    ...(normalizeString(item.mimeType) ? { mimeType: normalizeString(item.mimeType) } : {}),
    ...(Number.isFinite(Number(item.size)) ? { size: Number(item.size) } : {}),
    ...(Number.isFinite(Number(item.width)) ? { width: Number(item.width) } : {}),
    ...(Number.isFinite(Number(item.height)) ? { height: Number(item.height) } : {}),
    ...(normalizeString(item.url) ? { url: normalizeString(item.url) } : {}),
    ...(normalizeString(item.uri) ? { uri: normalizeString(item.uri) } : {}),
  }));

export const handleAttachmentIngress = async ({
  deps,
  input,
}: {
  deps: IngressDeps;
  input: unknown;
}): Promise<{ ok: boolean; session_id?: string; message_id?: string; created_session?: boolean; error?: string }> => {
  const parsed = ingressAttachmentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid_attachment_payload' };

  const context = normalizeIngressContext(parsed.data);
  const performer = await findPerformerByTelegram(deps, context.telegram_user_id);
  if (!performer) return { ok: false, error: 'not_authorized' };

  const { session, created } = await resolveSessionForIngress(deps, context, performer);
  const sessionId = new ObjectId(session._id);

  const attachments = normalizeAttachments(parsed.data.attachments);
  const messageText = normalizeString(parsed.data.text || parsed.data.caption || '');

  const doc: Record<string, unknown> = {
    chat_id: context.chat_id,
    message_id: context.message_id,
    message_timestamp: context.message_timestamp,
    timestamp: context.timestamp,
    source_type: context.source_type,
    telegram_user_id: context.telegram_user_id,
    username: context.username,
    user_id: performer._id,
    ...(context.forwarded_context ? { forwarded_context: context.forwarded_context } : {}),
    message_type: normalizeString(parsed.data.message_type) || 'screenshot',
    attachments,
    runtime_tag: RUNTIME_TAG,
    session_id: sessionId,
    session_type: session.session_type || VOICEBOT_SESSION_TYPES.MULTIPROMPT_VOICE_SESSION,
    created_at: new Date(),
    ...(messageText ? buildReadyTextTranscription(messageText, context.message_timestamp) : {
      transcription_text: '',
      transcription_raw: {
        provider: 'legacy',
        model: 'legacy_attachment',
        segmented: false,
        text: '',
      },
      transcription_chunks: [],
      transcription: {
        schema_version: 1,
        provider: 'legacy',
        model: 'legacy_attachment',
        task: 'transcribe',
        duration_seconds: 0,
        text: '',
        segments: [],
        usage: null,
      },
    }),
  };

  const insert = await deps.db.collection(VOICEBOT_COLLECTIONS.MESSAGES).insertOne(doc);
  const messageObjectId = insert.insertedId;

  await updateSessionAfterMessage(deps, sessionId, context);

  logInfo(deps, '[voicebot-tgbot] attachment ingress accepted', {
    session_id: sessionId.toHexString(),
    message_id: messageObjectId.toHexString(),
    created_session: created,
    attachments: attachments.length,
  });

  return {
    ok: true,
    session_id: sessionId.toHexString(),
    message_id: messageObjectId.toHexString(),
    created_session: created,
  };
};

export const buildIngressDeps = ({
  db,
  queues,
  logger,
}: {
  db: Db;
  queues?: Partial<Record<string, QueueLike>>;
  logger?: IngressDeps['logger'];
}): IngressDeps => {
  const commonQueue = getQueueByName(queues, VOICEBOT_QUEUES.COMMON);
  const voiceQueue = getQueueByName(queues, VOICEBOT_QUEUES.VOICE);

  return {
    db,
    ...(commonQueue ? { commonQueue } : {}),
    ...(voiceQueue ? { voiceQueue } : {}),
    ...(logger ? { logger } : {}),
  };
};
