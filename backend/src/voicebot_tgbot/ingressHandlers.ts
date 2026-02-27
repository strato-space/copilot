import { ObjectId, type Db } from 'mongodb';
import { z } from 'zod';
import {
  COLLECTIONS,
  RUNTIME_TAG,
  TASK_STATUSES,
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
import { buildSessionLink } from './sessionTelegramMessage.js';

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
  project_id?: ObjectId | string | null;
  project?: string | null;
  session_name?: string | null;
  is_active?: boolean;
};

type IngressPerformer = {
  _id: ObjectId;
  telegram_id?: string;
  id?: string;
  name?: string;
  real_name?: string;
};

type CodexProject = {
  _id: ObjectId;
  name?: string;
  title?: string;
  git_repo?: string | null;
};

type CodexTaskPayload = {
  trigger: '@task';
  text: string;
  normalized_text: string;
  session_id: string;
  message_db_id: string;
  telegram_user_id: string;
  chat_id: number;
  telegram_message_id: string;
  source_type: string;
  message_type: string;
  attachments: Array<Record<string, unknown>>;
  external_ref: string;
  source_ref: string | null;
  created_at: string;
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

const TASK_SIGNATURE_PATTERN = /(^|\s)@task\b/i;
const TASK_SIGNATURE_REPLACE_PATTERN = /(^|\s)@task\b/gi;
const DEFAULT_CODEX_TASK_TITLE = 'Telegram @task';
const DEFAULT_CODEX_TASK_DESCRIPTION = 'Created from @task payload.';

const hasTaskSignature = (value: string): boolean => TASK_SIGNATURE_PATTERN.test(value);

const stripTaskSignature = (value: string): string =>
  value.replace(TASK_SIGNATURE_REPLACE_PATTERN, ' ').replace(/\s+/g, ' ').trim();

const toTaskTitle = (normalizedText: string): string => {
  const firstLine = normalizedText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  const title = firstLine || DEFAULT_CODEX_TASK_TITLE;
  return title.slice(0, 180);
};

const buildTelegramMessageLink = (chatId: number, messageId: string): string | null => {
  const normalizedMessageId = String(Math.trunc(Number(messageId))).trim();
  if (!normalizedMessageId || !Number.isFinite(Number(normalizedMessageId)) || Number(normalizedMessageId) <= 0) {
    return null;
  }

  const rawChatId = String(chatId).trim();
  if (!rawChatId) return null;
  if (rawChatId.startsWith('-100')) {
    const channelId = rawChatId.slice(4);
    if (!channelId) return null;
    return `https://t.me/c/${channelId}/${normalizedMessageId}`;
  }

  const directId = rawChatId.replace(/^-/, '');
  if (!directId) return null;
  return `https://t.me/${directId}/${normalizedMessageId}`;
};

const normalizeTaskAttachments = (attachments: Array<Record<string, unknown>>): Array<Record<string, unknown>> =>
  attachments.map((attachment) => ({
    ...(normalizeString(attachment.kind) ? { kind: normalizeString(attachment.kind) } : {}),
    ...(normalizeString(attachment.source) ? { source: normalizeString(attachment.source) } : {}),
    ...(normalizeString(attachment.file_id) ? { file_id: normalizeString(attachment.file_id) } : {}),
    ...(normalizeString(attachment.file_unique_id)
      ? { file_unique_id: normalizeString(attachment.file_unique_id) }
      : {}),
    ...(normalizeString(attachment.name) ? { name: normalizeString(attachment.name) } : {}),
    ...(normalizeString(attachment.mimeType) ? { mimeType: normalizeString(attachment.mimeType) } : {}),
    ...(normalizeString(attachment.url) ? { url: normalizeString(attachment.url) } : {}),
    ...(normalizeString(attachment.uri) ? { uri: normalizeString(attachment.uri) } : {}),
    ...(Number.isFinite(Number(attachment.size)) ? { size: Number(attachment.size) } : {}),
    ...(Number.isFinite(Number(attachment.width)) ? { width: Number(attachment.width) } : {}),
    ...(Number.isFinite(Number(attachment.height)) ? { height: Number(attachment.height) } : {}),
  }));

const resolveAttachmentReference = (attachment: Record<string, unknown>): string | null => {
  const url = normalizeString(attachment.url);
  if (url.startsWith('http://') || url.startsWith('https://')) return url;

  const uri = normalizeString(attachment.uri);
  if (uri.startsWith('http://') || uri.startsWith('https://')) return uri;

  const fileId = normalizeString(attachment.file_id);
  if (fileId) return `telegram_file_id:${fileId}`;

  return null;
};

const buildTaskDescription = ({
  normalizedText,
  payload,
}: {
  normalizedText: string;
  payload: CodexTaskPayload;
}): string => {
  const baseText = normalizedText || DEFAULT_CODEX_TASK_DESCRIPTION;
  const attachmentRefs = payload.attachments.map(resolveAttachmentReference).filter((value): value is string => Boolean(value));
  if (attachmentRefs.length === 0) return baseText;
  return `${baseText}\n\nAttachments:\n${attachmentRefs.map((ref) => `- ${ref}`).join('\n')}`;
};

const buildCodexTaskPayload = ({
  context,
  sessionId,
  messageDbId,
  text,
  messageType,
  attachments,
}: {
  context: NormalizedIngressContext;
  sessionId: ObjectId;
  messageDbId: ObjectId;
  text: string;
  messageType: string;
  attachments: Array<Record<string, unknown>>;
}): CodexTaskPayload => {
  const normalizedText = stripTaskSignature(text);
  return {
    trigger: '@task',
    text,
    normalized_text: normalizedText,
    session_id: sessionId.toHexString(),
    message_db_id: messageDbId.toHexString(),
    telegram_user_id: context.telegram_user_id,
    chat_id: context.chat_id,
    telegram_message_id: context.message_id,
    source_type: context.source_type,
    message_type: messageType,
    attachments: normalizeTaskAttachments(attachments),
    external_ref: buildSessionLink(sessionId.toHexString()),
    source_ref: buildTelegramMessageLink(context.chat_id, context.message_id),
    created_at: new Date().toISOString(),
  };
};

const findProjectByName = async ({
  deps,
  name,
  requireGitRepo,
}: {
  deps: IngressDeps;
  name: 'codex' | 'copilot';
  requireGitRepo: boolean;
}): Promise<CodexProject | null> =>
  deps.db.collection(VOICEBOT_COLLECTIONS.PROJECTS).findOne(
    runtimeQuery({
      name: { $regex: new RegExp(`^${name}$`, 'i') },
      is_deleted: { $ne: true },
      ...(requireGitRepo
        ? {
          git_repo: { $type: 'string', $nin: [''] },
        }
        : {}),
    })
  ) as Promise<CodexProject | null>;

const findSessionBootstrapCodexProject = async (deps: IngressDeps): Promise<CodexProject | null> => {
  const codexProject = await findProjectByName({
    deps,
    name: 'codex',
    requireGitRepo: false,
  });
  if (codexProject) return codexProject;

  return findProjectByName({
    deps,
    name: 'copilot',
    requireGitRepo: true,
  });
};

const findCodexProject = async ({
  deps,
  session,
}: {
  deps: IngressDeps;
  session: IngressSession;
}): Promise<CodexProject | null> => {
  const sessionProjectId = toObjectIdOrNull(session.project_id);
  if (sessionProjectId) {
    const sessionProject = await deps.db.collection(VOICEBOT_COLLECTIONS.PROJECTS).findOne(
      runtimeQuery({
        _id: sessionProjectId,
        is_deleted: { $ne: true },
      })
    ) as CodexProject | null;
    if (sessionProject && normalizeString(sessionProject.git_repo)) {
      return sessionProject;
    }
  }

  const codexProject = await findProjectByName({
    deps,
    name: 'codex',
    requireGitRepo: true,
  });
  if (codexProject) return codexProject;

  return findProjectByName({
    deps,
    name: 'copilot',
    requireGitRepo: true,
  });
};

const findCodexPerformer = async (deps: IngressDeps): Promise<IngressPerformer | null> =>
  deps.db.collection(VOICEBOT_COLLECTIONS.PERFORMERS).findOne(
    {
      is_deleted: { $ne: true },
      is_banned: { $ne: true },
      $or: [
        { id: { $regex: /^codex$/i } },
        { name: { $regex: /^codex$/i } },
        { real_name: { $regex: /^codex$/i } },
      ],
    },
    {
      projection: { _id: 1, id: 1, name: 1, real_name: 1 },
    }
  ) as Promise<IngressPerformer | null>;

const attachCodexPayloadToSession = async ({
  deps,
  sessionId,
  payload,
}: {
  deps: IngressDeps;
  sessionId: ObjectId;
  payload: CodexTaskPayload;
}): Promise<void> => {
  const updatePayload: Record<string, unknown> = {
    $push: {
      'processors_data.CODEX_TASKS.data': payload,
    },
    $set: {
      'processors_data.CODEX_TASKS.is_processing': false,
      'processors_data.CODEX_TASKS.is_processed': true,
      'processors_data.CODEX_TASKS.job_finished_timestamp': Date.now(),
      updated_at: new Date(),
    },
  };

  await deps.db.collection(VOICEBOT_COLLECTIONS.SESSIONS).updateOne(
    runtimeQuery({ _id: sessionId }),
    updatePayload
  );
};

const createCodexTaskFromPayload = async ({
  deps,
  session,
  actor,
  payload,
}: {
  deps: IngressDeps;
  session: IngressSession;
  actor: IngressPerformer;
  payload: CodexTaskPayload;
}): Promise<ObjectId | null> => {
  const project = await findCodexProject({ deps, session });
  if (!project) {
    logWarn(deps, '[voicebot-tgbot] @task codex task skipped: project not found', {
      session_id: payload.session_id,
      message_id: payload.message_db_id,
    });
    return null;
  }

  const codexPerformer = await findCodexPerformer(deps);
  const normalizedText = payload.normalized_text;
  const now = new Date();
  const deferredUntil = new Date(now.getTime() + 15 * 60 * 1000);

  const taskDoc: Record<string, unknown> = {
    id: `codex-${new ObjectId().toHexString()}`,
    name: toTaskTitle(normalizedText),
    description: buildTaskDescription({ normalizedText, payload }),
    priority: 'P2',
    priority_reason: '@task',
    project_id: project._id,
    project: normalizeString(project.name) || normalizeString(project.title) || 'Copilot',
    performer_id: codexPerformer?._id || null,
    ...(codexPerformer
      ? {
        performer: {
          _id: codexPerformer._id,
          id: codexPerformer.id || codexPerformer._id.toHexString(),
          name: codexPerformer.name || codexPerformer.real_name || 'Codex',
          real_name: codexPerformer.real_name || codexPerformer.name || 'Codex',
        },
      }
      : {}),
    created_by_performer_id: actor._id,
    source_kind: 'telegram',
    source_ref: payload.source_ref || payload.session_id,
    external_ref: payload.external_ref,
    source: 'VOICE_BOT',
    source_data: {
      session_id: new ObjectId(payload.session_id),
      message_id: payload.telegram_message_id,
      message_db_id: new ObjectId(payload.message_db_id),
      trigger: payload.trigger,
      payload,
    },
    codex_task: true,
    codex_review_state: 'deferred',
    codex_review_due_at: deferredUntil,
    task_status: TASK_STATUSES.NEW_10,
    task_status_history: [],
    last_status_update: now,
    status_update_checked: false,
    is_deleted: false,
    created_at: now,
    updated_at: now,
    runtime_tag: RUNTIME_TAG,
  };

  const insert = await deps.db.collection(COLLECTIONS.TASKS).insertOne(taskDoc);
  await deps.db.collection(VOICEBOT_COLLECTIONS.SESSIONS).updateOne(
    runtimeQuery({ _id: new ObjectId(payload.session_id) }),
    {
      $set: {
        'processors_data.CODEX_TASKS.last_task_id': insert.insertedId.toHexString(),
        updated_at: new Date(),
      },
    }
  );

  return insert.insertedId;
};

const processTaskSignatureIngress = async ({
  deps,
  context,
  session,
  actor,
  messageObjectId,
  text,
  messageType,
  attachments,
}: {
  deps: IngressDeps;
  context: NormalizedIngressContext;
  session: IngressSession;
  actor: IngressPerformer;
  messageObjectId: ObjectId;
  text: string;
  messageType: string;
  attachments: Array<Record<string, unknown>>;
}): Promise<void> => {
  const rawText = String(text || '').trim();
  if (!rawText || !hasTaskSignature(rawText)) return;

  const payload = buildCodexTaskPayload({
    context,
    sessionId: new ObjectId(session._id),
    messageDbId: messageObjectId,
    text: rawText,
    messageType,
    attachments,
  });

  await attachCodexPayloadToSession({
    deps,
    sessionId: new ObjectId(session._id),
    payload,
  });

  const taskId = await createCodexTaskFromPayload({
    deps,
    session,
    actor,
    payload,
  });

  if (taskId) {
    logInfo(deps, '[voicebot-tgbot] @task codex task created', {
      session_id: payload.session_id,
      message_id: payload.message_db_id,
      task_id: taskId.toHexString(),
    });
  }
};

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
  performer: IngressPerformer | null,
  initialProject: CodexProject | null = null
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
    ...(initialProject ? { project_id: initialProject._id } : {}),
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
  performer: IngressPerformer | null,
  options: {
    preferCodexProjectForCreatedSession?: boolean;
  } = {}
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

  const initialProject = options.preferCodexProjectForCreatedSession
    ? await findSessionBootstrapCodexProject(deps)
    : null;

  const createdSession = await createSession(deps, context, performer, initialProject);
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
        deduplication: { id: jobId },
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

  const shouldPreferCodexProject = hasTaskSignature(String(parsed.data.text || ''));
  const { session, created } = await resolveSessionForIngress(deps, context, performer, {
    preferCodexProjectForCreatedSession: shouldPreferCodexProject,
  });
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

  try {
    await processTaskSignatureIngress({
      deps,
      context,
      session,
      actor: performer,
      messageObjectId,
      text: parsed.data.text,
      messageType: 'text',
      attachments: [],
    });
  } catch (error) {
    logWarn(deps, '[voicebot-tgbot] @task processing failed for text ingress', {
      session_id: sessionId.toHexString(),
      message_id: messageObjectId.toHexString(),
      error: error instanceof Error ? error.message : String(error),
    });
  }

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

  const messageText = normalizeString(parsed.data.text || parsed.data.caption || '');
  const shouldPreferCodexProject = hasTaskSignature(messageText);
  const { session, created } = await resolveSessionForIngress(deps, context, performer, {
    preferCodexProjectForCreatedSession: shouldPreferCodexProject,
  });
  const sessionId = new ObjectId(session._id);

  const attachments = normalizeAttachments(parsed.data.attachments);

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

  try {
    await processTaskSignatureIngress({
      deps,
      context,
      session,
      actor: performer,
      messageObjectId,
      text: messageText,
      messageType: normalizeString(parsed.data.message_type) || 'screenshot',
      attachments,
    });
  } catch (error) {
    logWarn(deps, '[voicebot-tgbot] @task processing failed for attachment ingress', {
      session_id: sessionId.toHexString(),
      message_id: messageObjectId.toHexString(),
      error: error instanceof Error ? error.message : String(error),
    });
  }

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
