import { ObjectId, type Db } from 'mongodb';
import { z } from 'zod';
import {
  COLLECTIONS,
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
import { buildCanonicalSessionLink, getPublicInterfaceOrigin } from './sessionTelegramMessage.js';
import { ensureUniqueTaskPublicId } from '../services/taskPublicId.js';
import { buildCanonicalTaskSourceRef } from '../services/taskSourceRef.js';
import { enqueueTranscribeJob } from '../services/voicebot/transcriptionQueue.js';
import {
  buildCanonicalReadyTextTranscription,
  buildVoiceMessageDeletionFields,
  VOICE_DELETION_REASONS,
} from '../api/routes/voicebot/messageHelpers.js';
import {
  detectGarbageTranscription,
  type GarbageDetectionResult,
} from '../services/voicebot/transcriptionGarbageDetector.js';
import {
  buildCreateTasksCategorizationNotQueuedDecision,
  persistCreateTasksNoTaskDecision,
} from '../services/voicebot/createTasksCompositeSessionState.js';

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
  duration: z.number().optional().nullable(),
  duration_ms: z.number().optional().nullable(),
  width: z.number().optional().nullable(),
  height: z.number().optional().nullable(),
  has_audio: z.boolean().optional().nullable(),
  audio_track_state: z.string().optional().nullable(),
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
  processors?: unknown[];
  session_processors?: unknown[];
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
  attachments: CodexTaskAttachment[];
  external_ref: string;
  source_ref: string | null;
  created_at: string;
};

type CodexTaskAttachment = {
  kind?: string;
  source?: string;
  file_id?: string;
  file_unique_id?: string;
  name?: string;
  mimeType?: string;
  url?: string;
  uri?: string;
  size?: number;
  width?: number;
  height?: number;
  attachment_index?: number;
  public_url?: string;
  reverse_url?: string;
  reverse_uri?: string;
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
  processorsQueue?: QueueLike;
  postprocessorsQueue?: QueueLike;
  garbageDetector?: (params: { transcriptionText: string }) => Promise<GarbageDetectionResult>;
  logger?: {
    info?: (msg: string, meta?: Record<string, unknown>) => void;
    warn?: (msg: string, meta?: Record<string, unknown>) => void;
    error?: (msg: string, meta?: Record<string, unknown>) => void;
  };
};

type OpenAiResponsesClient = {
  responses?: {
    create: (params: Record<string, unknown>) => Promise<unknown>;
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
const CANONICAL_PUBLIC_ATTACHMENT_PREFIX = '/api/voicebot/public_attachment/';
const OPENAI_KEY_ENV_NAMES = ['OPENAI_API_KEY'] as const;
const LEGACY_PUBLIC_ATTACHMENT_PREFIXES = [
  CANONICAL_PUBLIC_ATTACHMENT_PREFIX,
  '/voicebot/public_attachment/',
  '/voicebot/uploads/public_attachment/',
] as const;

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

const buildMessageAttachmentPath = (messageDbId: string, attachmentIndex: number): string => {
  const normalizedMessageDbId = normalizeString(messageDbId);
  if (!normalizedMessageDbId) return '';
  const normalizedIndex = Number.isFinite(Number(attachmentIndex)) ? Number(attachmentIndex) : 0;
  return `${CANONICAL_PUBLIC_ATTACHMENT_PREFIX.replace('/public_attachment/', '/message_attachment/')}${encodeURIComponent(
    normalizedMessageDbId
  )}/${Math.max(0, normalizedIndex)}`;
};

const toAbsoluteVoicebotUrl = (path: string): string | null => {
  const normalizedPath = normalizeString(path);
  if (!normalizedPath.startsWith('/')) return null;
  return `${getPublicInterfaceOrigin()}${normalizedPath}`;
};

const buildCanonicalPublicAttachmentUrl = ({
  sessionId,
  fileUniqueId,
}: {
  sessionId: string;
  fileUniqueId: string;
}): string | null => {
  const normalizedSessionId = normalizeString(sessionId);
  const normalizedFileUniqueId = normalizeString(fileUniqueId);
  if (!normalizedSessionId || !normalizedFileUniqueId) return null;
  return `${getPublicInterfaceOrigin()}${CANONICAL_PUBLIC_ATTACHMENT_PREFIX}${encodeURIComponent(
    normalizedSessionId
  )}/${encodeURIComponent(normalizedFileUniqueId)}`;
};

const extractPublicAttachmentPathParts = (value: string): { sessionId: string; fileUniqueId: string } | null => {
  const normalizedValue = normalizeString(value);
  if (!normalizedValue) return null;

  let path = normalizedValue;
  if (normalizedValue.startsWith('http://') || normalizedValue.startsWith('https://')) {
    try {
      path = new URL(normalizedValue).pathname;
    } catch {
      return null;
    }
  }

  for (const prefix of LEGACY_PUBLIC_ATTACHMENT_PREFIXES) {
    if (!path.startsWith(prefix)) continue;
    const match = path.slice(prefix.length).match(/^([^/?#]+)\/([^/?#]+)/);
    if (!match) return null;
    const [, sessionId, fileUniqueId] = match;
    if (!sessionId || !fileUniqueId) return null;
    return {
      sessionId,
      fileUniqueId,
    };
  }

  return null;
};

const resolveNormalizedPublicAttachmentLink = ({
  attachment,
  payloadSessionId,
}: {
  attachment: Record<string, unknown>;
  payloadSessionId: string;
}): string | null => {
  const fromFileUniqueId = buildCanonicalPublicAttachmentUrl({
    sessionId: payloadSessionId,
    fileUniqueId: normalizeString(attachment.file_unique_id),
  });
  if (fromFileUniqueId) return fromFileUniqueId;

  const url = normalizeString(attachment.url);
  const parsedFromUrl = extractPublicAttachmentPathParts(url);
  if (parsedFromUrl) {
    return buildCanonicalPublicAttachmentUrl(parsedFromUrl);
  }

  const uri = normalizeString(attachment.uri);
  const parsedFromUri = extractPublicAttachmentPathParts(uri);
  if (parsedFromUri) {
    return buildCanonicalPublicAttachmentUrl(parsedFromUri);
  }

  return null;
};

const resolveAttachmentReference = ({
  attachment,
  payloadSessionId,
}: {
  attachment: CodexTaskAttachment;
  payloadSessionId: string;
}): string | null => {
  const directPublicUrl = normalizeString(attachment.public_url);
  if (directPublicUrl.startsWith('http://') || directPublicUrl.startsWith('https://')) {
    return directPublicUrl;
  }

  const normalizedAttachmentLink = resolveNormalizedPublicAttachmentLink({
    attachment: attachment as Record<string, unknown>,
    payloadSessionId,
  });
  if (normalizedAttachmentLink) return normalizedAttachmentLink;

  const url = normalizeString(attachment.url);
  if (url.startsWith('http://') || url.startsWith('https://')) return url;

  const uri = normalizeString(attachment.uri);
  if (uri.startsWith('http://') || uri.startsWith('https://')) return uri;

  const fileId = normalizeString(attachment.file_id);
  if (fileId) return `telegram_file_id:${fileId}`;

  return null;
};

const resolveAttachmentReverseReference = ({
  attachment,
}: {
  attachment: CodexTaskAttachment;
}): string | null => {
  const reverseUrl = normalizeString(attachment.reverse_url);
  if (reverseUrl.startsWith('http://') || reverseUrl.startsWith('https://')) return reverseUrl;
  if (reverseUrl.startsWith('/')) {
    const absolute = toAbsoluteVoicebotUrl(reverseUrl);
    if (absolute) return absolute;
  }

  const reverseUri = normalizeString(attachment.reverse_uri);
  if (reverseUri.startsWith('http://') || reverseUri.startsWith('https://')) return reverseUri;
  if (reverseUri.startsWith('/')) {
    const absolute = toAbsoluteVoicebotUrl(reverseUri);
    if (absolute) return absolute;
  }

  const url = normalizeString(attachment.url);
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  if (url.startsWith('/')) {
    const absolute = toAbsoluteVoicebotUrl(url);
    if (absolute) return absolute;
  }

  const uri = normalizeString(attachment.uri);
  if (uri.startsWith('http://') || uri.startsWith('https://')) return uri;
  if (uri.startsWith('/')) {
    const absolute = toAbsoluteVoicebotUrl(uri);
    if (absolute) return absolute;
  }

  return null;
};

const normalizeTaskAttachments = ({
  attachments,
  payloadSessionId,
  messageDbId,
}: {
  attachments: Array<Record<string, unknown>>;
  payloadSessionId: string;
  messageDbId: string;
}): CodexTaskAttachment[] =>
  attachments.map((attachment, attachmentIndex) => {
    const normalizedAttachment: CodexTaskAttachment = {
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
      attachment_index: attachmentIndex,
    };

    const messageAttachmentPath = buildMessageAttachmentPath(messageDbId, attachmentIndex);
    const messageAttachmentUrl = toAbsoluteVoicebotUrl(messageAttachmentPath);
    const publicAttachmentUrl = resolveNormalizedPublicAttachmentLink({
      attachment: normalizedAttachment as Record<string, unknown>,
      payloadSessionId,
    });

    return {
      ...normalizedAttachment,
      ...(publicAttachmentUrl ? { public_url: publicAttachmentUrl } : {}),
      ...(messageAttachmentPath ? { reverse_uri: messageAttachmentPath } : {}),
      ...(messageAttachmentUrl ? { reverse_url: messageAttachmentUrl } : {}),
    };
  });

const buildTaskDescription = ({
  normalizedText,
  payload,
}: {
  normalizedText: string;
  payload: CodexTaskPayload;
}): string => {
  const baseText = normalizedText || DEFAULT_CODEX_TASK_DESCRIPTION;
  const attachmentRefs = Array.from(
    new Set(
      payload.attachments
        .map((attachment) => resolveAttachmentReference({ attachment, payloadSessionId: payload.session_id }))
        .filter((value): value is string => Boolean(value))
    )
  );
  const reverseRefs = Array.from(
    new Set(payload.attachments.map((attachment) => resolveAttachmentReverseReference({ attachment })).filter(Boolean))
  ) as string[];
  if (attachmentRefs.length === 0 && reverseRefs.length === 0) return baseText;

  let description = baseText;
  if (attachmentRefs.length > 0) {
    description += `\n\nAttachments:\n${attachmentRefs.map((ref) => `- ${ref}`).join('\n')}`;
  }
  if (reverseRefs.length > 0) {
    description += `\n\nAttachment reverse links:\n${reverseRefs.map((ref) => `- ${ref}`).join('\n')}`;
  }

  return description;
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
    attachments: normalizeTaskAttachments({
      attachments,
      payloadSessionId: sessionId.toHexString(),
      messageDbId: messageDbId.toHexString(),
    }),
    external_ref: buildCanonicalSessionLink(sessionId.toHexString()),
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
  const taskTitle = toTaskTitle(normalizedText);
  const publicTaskId = await ensureUniqueTaskPublicId({
    db: deps.db,
    preferredId: taskTitle,
    fallbackText: normalizedText,
  });
  const taskObjectId = new ObjectId();
  const now = new Date();
  const deferredUntil = new Date(now.getTime() + 15 * 60 * 1000);

  const taskDoc: Record<string, unknown> = {
    _id: taskObjectId,
    id: publicTaskId,
    name: taskTitle,
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
    source_ref: buildCanonicalTaskSourceRef(taskObjectId),
    external_ref: buildCanonicalSessionLink(payload.session_id),
    source: 'VOICE_BOT',
    source_data: {
      session_id: new ObjectId(payload.session_id),
      message_id: payload.telegram_message_id,
      message_db_id: new ObjectId(payload.message_db_id),
      trigger: payload.trigger,
      attachments: payload.attachments,
      payload,
    },
    codex_task: true,
    codex_review_state: 'deferred',
    codex_review_due_at: deferredUntil,
    task_status: TASK_STATUSES.READY_10,
    task_status_history: [],
    last_status_update: now,
    status_update_checked: false,
    is_deleted: false,
    created_at: now,
    updated_at: now,
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

const normalizeProcessorList = (value: unknown): string[] =>
  Array.isArray(value) ? value.map((entry) => String(entry || '').trim()).filter(Boolean) : [];

const isCategorizationEnabledForSession = (session: IngressSession): boolean => {
  const processors = normalizeProcessorList(session.processors);
  return processors.length === 0 || processors.includes(VOICEBOT_PROCESSORS.CATEGORIZATION);
};

const isCreateTasksEnabledForSession = (session: IngressSession): boolean => {
  const sessionProcessors = normalizeProcessorList(session.session_processors);
  return sessionProcessors.length === 0 || sessionProcessors.includes(VOICEBOT_JOBS.postprocessing.CREATE_TASKS);
};

type CategorizationEnqueueOutcome = 'queued' | 'disabled' | 'not_queued';

const getOpenAIKeySource = (): string => {
  for (const key of OPENAI_KEY_ENV_NAMES) {
    if (normalizeString(process.env[key])) return key;
  }
  return OPENAI_KEY_ENV_NAMES[0];
};

const createOpenAiResponsesClient = async (): Promise<OpenAiResponsesClient | null> => {
  const source = getOpenAIKeySource();
  const key = normalizeString(process.env[source]);
  if (!key) return null;
  const { default: OpenAI } = await import('openai');
  return new OpenAI({ apiKey: key });
};

const buildCanonicalGarbageDetection = (garbageDetection: GarbageDetectionResult): Record<string, unknown> => ({
  checked_at: garbageDetection.checked_at || new Date(),
  detector_version: garbageDetection.detector_version || 'post_transcribe_garbage_v1',
  model: garbageDetection.model || null,
  skipped: Boolean(garbageDetection.skipped),
  skip_reason: garbageDetection.skip_reason || null,
  is_garbage: Boolean(garbageDetection.is_garbage),
  code: garbageDetection.code || null,
  reason: garbageDetection.reason || null,
  raw_output: garbageDetection.raw_output || null,
});

const resolveCanonicalTextGarbageDetection = async ({
  deps,
  transcriptionText,
  sessionId,
  ingressSource,
}: {
  deps: IngressDeps;
  transcriptionText: string;
  sessionId: ObjectId;
  ingressSource: string;
}): Promise<GarbageDetectionResult | null> => {
  try {
    if (deps.garbageDetector) {
      return await deps.garbageDetector({ transcriptionText });
    }

    const openAiClient = await createOpenAiResponsesClient();
    if (!openAiClient) return null;

    return await detectGarbageTranscription({
      openaiClient: openAiClient,
      transcriptionText,
    });
  } catch (error) {
    logWarn(deps, `[voicebot-tgbot] garbage detector failed for ${ingressSource}, continuing regular flow`, {
      session_id: sessionId.toHexString(),
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
};

const enqueueCategorizationForTranscribedMessage = async ({
  deps,
  session,
  sessionId,
  messageObjectId,
  ingressSource,
}: {
  deps: IngressDeps;
  session: IngressSession;
  sessionId: ObjectId;
  messageObjectId: ObjectId;
  ingressSource: string;
}): Promise<CategorizationEnqueueOutcome> => {
  if (!isCategorizationEnabledForSession(session)) return 'disabled';
  if (!deps.processorsQueue) {
    logWarn(deps, `[voicebot-tgbot] processors queue unavailable for ${ingressSource} categorization`, {
      session_id: sessionId.toHexString(),
      message_id: messageObjectId.toHexString(),
    });
    return 'not_queued';
  }

  const sessionHex = sessionId.toHexString();
  const messageHex = messageObjectId.toHexString();
  const processorKey = `processors_data.${VOICEBOT_PROCESSORS.CATEGORIZATION}`;
  const now = Date.now();
  const jobId = `${sessionHex}-${messageHex}-CATEGORIZE`;

  await deps.db.collection(VOICEBOT_COLLECTIONS.MESSAGES).updateOne(
    runtimeQuery({ _id: messageObjectId }),
    {
      $set: {
        [`${processorKey}.is_processing`]: true,
        [`${processorKey}.is_processed`]: false,
        [`${processorKey}.is_finished`]: false,
        [`${processorKey}.job_queued_timestamp`]: now,
      },
      $unset: {
        categorization_error: 1,
        categorization_error_message: 1,
        categorization_error_timestamp: 1,
        categorization_retry_reason: 1,
        categorization_next_attempt_at: 1,
      },
    }
  );

  try {
    await deps.processorsQueue.add(
      VOICEBOT_JOBS.voice.CATEGORIZE,
      {
        message_id: messageHex,
        session_id: sessionHex,
        job_id: jobId,
      },
      { deduplication: { id: jobId } }
    );
  } catch (error) {
    await deps.db.collection(VOICEBOT_COLLECTIONS.MESSAGES).updateOne(
      runtimeQuery({ _id: messageObjectId }),
      {
        $set: {
          [`${processorKey}.is_processing`]: false,
          [`${processorKey}.is_processed`]: false,
          [`${processorKey}.is_finished`]: false,
        },
        $unset: {
          [`${processorKey}.job_queued_timestamp`]: 1,
        },
      }
    );
    throw error;
  }

  return 'queued';
};

const enqueueCreateTasksRefreshForSession = async ({
  deps,
  session,
  sessionId,
  ingressSource,
}: {
  deps: IngressDeps;
  session: IngressSession;
  sessionId: ObjectId;
  ingressSource: string;
}): Promise<void> => {
  if (!isCreateTasksEnabledForSession(session)) return;

  const requestedAt = Date.now();
  const sessionHex = sessionId.toHexString();
  await deps.db.collection(VOICEBOT_COLLECTIONS.SESSIONS).updateOne(
    runtimeQuery({ _id: sessionId }),
    {
      $set: {
        'processors_data.CREATE_TASKS.auto_requested_at': requestedAt,
        'processors_data.CREATE_TASKS.is_processed': false,
        'processors_data.CREATE_TASKS.is_processing': false,
        updated_at: new Date(),
      },
      $unset: {
        'processors_data.CREATE_TASKS.error': 1,
        'processors_data.CREATE_TASKS.error_message': 1,
        'processors_data.CREATE_TASKS.error_timestamp': 1,
        'processors_data.CREATE_TASKS.no_task_decision': 1,
        'processors_data.CREATE_TASKS.no_task_reason_code': 1,
        'processors_data.CREATE_TASKS.no_task_reason': 1,
        'processors_data.CREATE_TASKS.no_task_evidence': 1,
        'processors_data.CREATE_TASKS.no_task_inferred': 1,
        'processors_data.CREATE_TASKS.no_task_source': 1,
        'processors_data.CREATE_TASKS.last_tasks_count': 1,
      },
    }
  );

  if (!deps.postprocessorsQueue) {
    logWarn(deps, `[voicebot-tgbot] postprocessors queue unavailable for ${ingressSource} create_tasks refresh`, {
      session_id: sessionHex,
    });
    return;
  }

  await deps.postprocessorsQueue.add(
    VOICEBOT_JOBS.postprocessing.CREATE_TASKS,
    {
      session_id: sessionHex,
      auto_requested_at: requestedAt,
      refresh_mode: 'incremental_refresh',
    },
    { deduplication: { id: `${sessionHex}-CREATE_TASKS-AUTO` } }
  );
};

const runCanonicalTextIngressPostprocessing = async ({
  deps,
  session,
  sessionId,
  messageObjectId,
  ingressSource,
  skipCategorizationReason = null,
}: {
  deps: IngressDeps;
  session: IngressSession;
  sessionId: ObjectId;
  messageObjectId: ObjectId;
  ingressSource: string;
  skipCategorizationReason?: string | null;
}): Promise<void> => {
  if (skipCategorizationReason) {
    if (isCreateTasksEnabledForSession(session)) {
      logWarn(
        deps,
        `[voicebot-tgbot] skipping ${ingressSource} create_tasks refresh because categorization was not queued`,
        {
          session_id: sessionId.toHexString(),
          message_id: messageObjectId.toHexString(),
          reason: skipCategorizationReason,
        }
      );
    }
    return;
  }

  let categorizationOutcome: CategorizationEnqueueOutcome = 'not_queued';
  try {
    categorizationOutcome = await enqueueCategorizationForTranscribedMessage({
      deps,
      session,
      sessionId,
      messageObjectId,
      ingressSource,
    });
  } catch (error) {
    logWarn(deps, `[voicebot-tgbot] failed to enqueue ${ingressSource} categorization`, {
      session_id: sessionId.toHexString(),
      message_id: messageObjectId.toHexString(),
      error: error instanceof Error ? error.message : String(error),
    });
  }

  if (categorizationOutcome === 'not_queued' && isCreateTasksEnabledForSession(session)) {
    try {
      await persistCreateTasksNoTaskDecision({
        db: deps.db,
        sessionFilter: runtimeQuery({ _id: sessionId }),
        noTaskDecision: buildCreateTasksCategorizationNotQueuedDecision({
          path: `tg_ingress_${ingressSource}`,
        }),
        tasksCount: 0,
      });
    } catch (error) {
      logWarn(deps, `[voicebot-tgbot] failed to persist ${ingressSource} create_tasks no-task decision`, {
        session_id: sessionId.toHexString(),
        message_id: messageObjectId.toHexString(),
        error: error instanceof Error ? error.message : String(error),
      });
    }
    logWarn(
      deps,
      `[voicebot-tgbot] skipping ${ingressSource} create_tasks refresh because categorization was not queued`,
      {
        session_id: sessionId.toHexString(),
        message_id: messageObjectId.toHexString(),
        reason: categorizationOutcome,
      }
    );
    return;
  }

  try {
    await enqueueCreateTasksRefreshForSession({
      deps,
      session,
      sessionId,
      ingressSource,
    });
  } catch (error) {
    logWarn(deps, `[voicebot-tgbot] failed to enqueue ${ingressSource} create_tasks refresh`, {
      session_id: sessionId.toHexString(),
      message_id: messageObjectId.toHexString(),
      error: error instanceof Error ? error.message : String(error),
    });
  }
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
    await enqueueTranscribeJob({
      voiceQueue: deps.voiceQueue,
      session_id,
      message_id,
      chat_id: context.chat_id,
      attempts: 1,
    });
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

  const transcriptionPayload = buildCanonicalReadyTextTranscription({
    text: parsed.data.text,
    messageTimestampSec: context.message_timestamp,
    speaker: parsed.data.speaker ?? null,
  });
  const garbageDetection = await resolveCanonicalTextGarbageDetection({
    deps,
    transcriptionText: transcriptionPayload.transcription_text,
    sessionId,
    ingressSource: 'text ingress',
  });
  const nowTs = Date.now();

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
    session_id: sessionId,
    session_type: session.session_type || VOICEBOT_SESSION_TYPES.MULTIPROMPT_VOICE_SESSION,
    created_at: Date.now(),
    ...transcriptionPayload,
    ...(garbageDetection
      ? {
        garbage_detected: Boolean(garbageDetection.is_garbage),
        garbage_detection: buildCanonicalGarbageDetection(garbageDetection),
      }
      : {}),
    ...(garbageDetection?.is_garbage
      ? {
        categorization: [],
        categorization_timestamp: nowTs,
        processors_data: {
          categorization: {
            is_processing: false,
            is_processed: true,
            is_finished: true,
            skipped_reason: 'garbage_detected',
          },
        },
        ...buildVoiceMessageDeletionFields({
          deletedAt: new Date(nowTs),
          deletionReason: VOICE_DELETION_REASONS.GARBAGE_DETECTED,
          deletionNote: garbageDetection.reason || garbageDetection.code || null,
        }),
      }
      : {}),
    ...(parsed.data.speaker ? { speaker: parsed.data.speaker } : {}),
  };

  const insert = await deps.db.collection(VOICEBOT_COLLECTIONS.MESSAGES).insertOne(doc);
  const messageObjectId = insert.insertedId;

  await updateSessionAfterMessage(deps, sessionId, context);

  await runCanonicalTextIngressPostprocessing({
    deps,
    session,
    sessionId,
    messageObjectId,
    ingressSource: 'text ingress',
    skipCategorizationReason: garbageDetection?.is_garbage ? 'garbage_detected' : null,
  });

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
    ...(Number.isFinite(Number(item.duration_ms))
      ? { duration_ms: Math.max(0, Number(item.duration_ms)) }
      : Number.isFinite(Number(item.duration))
        ? { duration_ms: Math.max(0, Math.round(Number(item.duration) * 1000)) }
        : {}),
    ...(Number.isFinite(Number(item.width)) ? { width: Number(item.width) } : {}),
    ...(Number.isFinite(Number(item.height)) ? { height: Number(item.height) } : {}),
    ...(typeof item.has_audio === 'boolean' ? { has_audio: item.has_audio } : {}),
    ...(normalizeString(item.audio_track_state) ? { audio_track_state: normalizeString(item.audio_track_state) } : {}),
    ...(normalizeString(item.url) ? { url: normalizeString(item.url) } : {}),
    ...(normalizeString(item.uri) ? { uri: normalizeString(item.uri) } : {}),
  }));

type PayloadMediaKind = 'audio' | 'video' | 'image' | 'binary_document' | 'unknown';
type ClassificationResolutionState = 'resolved' | 'pending';
type TranscriptionEligibility = 'eligible' | 'ineligible' | null;
type IngressAttachmentClassification = {
  payload_media_kind: PayloadMediaKind;
  speech_bearing_assessment: string;
  classification_resolution_state: ClassificationResolutionState;
  transcription_eligibility: TranscriptionEligibility;
  transcription_eligibility_basis: string;
  classification_rule_ref: string;
  transcription_skip_reason: string | null;
};

type PrimaryProjection = {
  primary_transcription_attachment_index: number | null;
  primary_payload_media_kind: PayloadMediaKind;
  classification_resolution_state: ClassificationResolutionState;
  transcription_eligibility: TranscriptionEligibility;
  transcription_eligibility_basis: string;
  classification_rule_ref: string;
  transcription_processing_state: 'pending_classification' | 'pending_transcription' | 'classified_skip';
  transcription_skip_reason: string | null;
  file_id: string | null;
  file_unique_id: string | null;
  file_name: string | null;
  file_size: number | null;
  mime_type: string | null;
};

const INGRESS_CLASSIFICATION_RULE = 'tg_attachment_ingress_media_kind_v1';
const AUDIO_MIME_PREFIX = 'audio/';
const VIDEO_MIME_PREFIX = 'video/';
const IMAGE_MIME_PREFIX = 'image/';
const AUDIO_EXTENSIONS = new Set([
  '.aac',
  '.flac',
  '.m4a',
  '.mp3',
  '.ogg',
  '.oga',
  '.opus',
  '.wav',
  '.weba',
]);
const VIDEO_EXTENSIONS = new Set([
  '.3gp',
  '.avi',
  '.m4v',
  '.mov',
  '.mp4',
  '.mpeg',
  '.mpg',
  '.webm',
  '.mkv',
]);
const IMAGE_EXTENSIONS = new Set([
  '.avif',
  '.bmp',
  '.gif',
  '.heic',
  '.jpeg',
  '.jpg',
  '.png',
  '.svg',
  '.webp',
]);
const BINARY_DOCUMENT_EXTENSIONS = new Set([
  '.7z',
  '.csv',
  '.doc',
  '.docx',
  '.epub',
  '.gz',
  '.json',
  '.odt',
  '.pdf',
  '.ppt',
  '.pptx',
  '.rar',
  '.rtf',
  '.tar',
  '.txt',
  '.xls',
  '.xlsx',
  '.xml',
  '.zip',
]);

const normalizeExtension = (value: unknown): string => {
  const raw = normalizeString(value).toLowerCase();
  if (!raw) return '';
  const extension = raw.includes('.') ? raw.slice(raw.lastIndexOf('.')) : raw;
  if (!extension) return '';
  return extension.startsWith('.') ? extension : `.${extension}`;
};

const classifyAttachmentPayloadMediaKind = (attachment: Record<string, unknown>): PayloadMediaKind => {
  const kind = normalizeString(attachment.kind).toLowerCase();
  const mimeType = normalizeString(attachment.mimeType).toLowerCase();
  const extension = normalizeExtension(attachment.name);

  if (mimeType.startsWith(AUDIO_MIME_PREFIX)) return 'audio';
  if (mimeType.startsWith(VIDEO_MIME_PREFIX)) return 'video';
  if (mimeType.startsWith(IMAGE_MIME_PREFIX)) return 'image';

  if (AUDIO_EXTENSIONS.has(extension)) return 'audio';
  if (VIDEO_EXTENSIONS.has(extension)) return 'video';
  if (IMAGE_EXTENSIONS.has(extension)) return 'image';
  if (BINARY_DOCUMENT_EXTENSIONS.has(extension)) return 'binary_document';

  if (kind === 'voice' || kind === 'audio') return 'audio';
  if (kind === 'video' || kind === 'video_note' || kind === 'animation') return 'video';
  if (kind === 'photo' || kind === 'image' || kind === 'sticker') return 'image';
  if (kind === 'document' || kind === 'file') return 'binary_document';

  return 'unknown';
};

const classifyIngressAttachment = (attachment: Record<string, unknown>): IngressAttachmentClassification => {
  const payloadMediaKind = classifyAttachmentPayloadMediaKind(attachment);
  if (payloadMediaKind === 'audio' || payloadMediaKind === 'video') {
    const hasAudioFlag = typeof attachment.has_audio === 'boolean' ? attachment.has_audio : null;
    const audioTrackState = normalizeString(attachment.audio_track_state).toLowerCase();
    const noAudioTrackByState = [
      'none',
      'missing',
      'no_audio',
      'no_audio_track',
      'without_audio',
      'mute',
      'muted',
    ].includes(audioTrackState);
    if (payloadMediaKind === 'video' && (hasAudioFlag === false || noAudioTrackByState)) {
      return {
        payload_media_kind: payloadMediaKind,
        speech_bearing_assessment: 'non_speech',
        classification_resolution_state: 'resolved',
        transcription_eligibility: 'ineligible',
        transcription_eligibility_basis: 'ingress_video_no_audio_track',
        classification_rule_ref: INGRESS_CLASSIFICATION_RULE,
        transcription_skip_reason: 'no_audio_track',
      };
    }
    return {
      payload_media_kind: payloadMediaKind,
      speech_bearing_assessment: 'unresolved',
      classification_resolution_state: 'pending',
      transcription_eligibility: null,
      transcription_eligibility_basis: 'ingress_requires_speech_probe',
      classification_rule_ref: INGRESS_CLASSIFICATION_RULE,
      transcription_skip_reason: null,
    };
  }

  if (payloadMediaKind === 'image' || payloadMediaKind === 'binary_document') {
    return {
      payload_media_kind: payloadMediaKind,
      speech_bearing_assessment: 'non_speech',
      classification_resolution_state: 'resolved',
      transcription_eligibility: 'ineligible',
      transcription_eligibility_basis: 'ingress_non_speech_payload_media',
      classification_rule_ref: INGRESS_CLASSIFICATION_RULE,
      transcription_skip_reason: 'ineligible_payload_media_kind',
    };
  }

  return {
    payload_media_kind: 'unknown',
    speech_bearing_assessment: 'unresolved',
    classification_resolution_state: 'pending',
    transcription_eligibility: null,
    transcription_eligibility_basis: 'ingress_payload_media_unknown',
    classification_rule_ref: INGRESS_CLASSIFICATION_RULE,
    transcription_skip_reason: null,
  };
};

const rankAttachmentCandidate = (attachment: Record<string, unknown>, attachmentIndex: number): [number, number, number] => {
  const duration = Number.isFinite(Number(attachment.duration_ms)) ? Number(attachment.duration_ms) : -1;
  const size = Number.isFinite(Number(attachment.size)) ? Number(attachment.size) : -1;
  return [duration, size, -attachmentIndex];
};

const compareAttachmentRank = (
  left: [number, number, number],
  right: [number, number, number]
): number => {
  if (left[0] !== right[0]) return right[0] - left[0];
  if (left[1] !== right[1]) return right[1] - left[1];
  return right[2] - left[2];
};

const selectPrimaryAttachmentIndex = (attachments: Array<Record<string, unknown>>): number | null => {
  if (!attachments.length) return null;

  const pickByState = (
    predicate: (attachment: Record<string, unknown>) => boolean
  ): number | null => {
    const candidates = attachments
      .map((attachment, attachmentIndex) => ({
        attachmentIndex,
        rank: rankAttachmentCandidate(attachment, attachmentIndex),
        attachment,
      }))
      .filter((entry) => predicate(entry.attachment))
      .sort((left, right) => compareAttachmentRank(left.rank, right.rank));
    return candidates.length > 0 ? candidates[0]?.attachmentIndex ?? null : null;
  };

  const eligible = pickByState((attachment) => attachment.transcription_eligibility === 'eligible');
  if (Number.isInteger(eligible)) return eligible;

  const hasPending = attachments.some((attachment) => attachment.classification_resolution_state === 'pending');
  if (hasPending) return null;

  return pickByState(() => true);
};

const buildPrimaryAttachmentProjection = ({
  attachments,
  primaryIndex,
}: {
  attachments: Array<Record<string, unknown>>;
  primaryIndex: number | null;
}): PrimaryProjection => {
  const fallback: PrimaryProjection = {
    primary_transcription_attachment_index: null,
    primary_payload_media_kind: 'unknown',
    classification_resolution_state: 'pending',
    transcription_eligibility: null,
    transcription_eligibility_basis: 'ingress_payload_media_unknown',
    classification_rule_ref: INGRESS_CLASSIFICATION_RULE,
    transcription_processing_state: 'pending_classification',
    transcription_skip_reason: null,
    file_id: null,
    file_unique_id: null,
    file_name: null,
    file_size: null,
    mime_type: null,
  };
  if (
    typeof primaryIndex !== 'number' ||
    !Number.isInteger(primaryIndex) ||
    primaryIndex < 0 ||
    primaryIndex >= attachments.length
  ) {
    if (!attachments.length) {
      return fallback;
    }
    const bestCandidate = attachments
      .map((attachment, attachmentIndex) => ({
        attachment,
        rank: rankAttachmentCandidate(attachment, attachmentIndex),
      }))
      .sort((left, right) => compareAttachmentRank(left.rank, right.rank))[0]?.attachment;
    const payloadMediaKindRaw = String(bestCandidate?.payload_media_kind || '').trim();
    const payloadMediaKind: PayloadMediaKind = (
      payloadMediaKindRaw === 'audio' ||
      payloadMediaKindRaw === 'video' ||
      payloadMediaKindRaw === 'image' ||
      payloadMediaKindRaw === 'binary_document' ||
      payloadMediaKindRaw === 'unknown'
    )
      ? payloadMediaKindRaw
      : 'unknown';
    return {
      ...fallback,
      primary_payload_media_kind: payloadMediaKind,
      transcription_eligibility_basis:
        normalizeString(bestCandidate?.transcription_eligibility_basis) || fallback.transcription_eligibility_basis,
      classification_rule_ref: normalizeString(bestCandidate?.classification_rule_ref) || INGRESS_CLASSIFICATION_RULE,
      file_id: normalizeString(bestCandidate?.file_id) || null,
      file_unique_id: normalizeString(bestCandidate?.file_unique_id) || null,
      file_name: normalizeString(bestCandidate?.name) || null,
      file_size: Number.isFinite(Number(bestCandidate?.size)) ? Number(bestCandidate?.size) : null,
      mime_type: normalizeString(bestCandidate?.mimeType) || null,
    };
  }

  const primary = attachments[primaryIndex] || {};
  const classificationResolutionState =
    String(primary.classification_resolution_state || '').trim() === 'resolved' ? 'resolved' : 'pending';
  const transcriptionEligibilityRaw = String(primary.transcription_eligibility || '').trim();
  const transcriptionEligibility: TranscriptionEligibility = transcriptionEligibilityRaw === 'eligible'
    ? 'eligible'
    : transcriptionEligibilityRaw === 'ineligible'
      ? 'ineligible'
      : null;
  const payloadMediaKindRaw = String(primary.payload_media_kind || '').trim();
  const payloadMediaKind: PayloadMediaKind = (
    payloadMediaKindRaw === 'audio' ||
    payloadMediaKindRaw === 'video' ||
    payloadMediaKindRaw === 'image' ||
    payloadMediaKindRaw === 'binary_document' ||
    payloadMediaKindRaw === 'unknown'
  )
    ? payloadMediaKindRaw
    : 'unknown';

  const transcriptionProcessingState: PrimaryProjection['transcription_processing_state'] =
    classificationResolutionState === 'pending'
      ? 'pending_classification'
      : transcriptionEligibility === 'eligible'
        ? 'pending_transcription'
        : 'classified_skip';

  return {
    primary_transcription_attachment_index: primaryIndex,
    primary_payload_media_kind: payloadMediaKind,
    classification_resolution_state: classificationResolutionState,
    transcription_eligibility: transcriptionEligibility,
    transcription_eligibility_basis:
      normalizeString(primary.transcription_eligibility_basis) || fallback.transcription_eligibility_basis,
    classification_rule_ref: normalizeString(primary.classification_rule_ref) || INGRESS_CLASSIFICATION_RULE,
    transcription_processing_state: transcriptionProcessingState,
    transcription_skip_reason:
      transcriptionProcessingState === 'classified_skip'
        ? (normalizeString(primary.transcription_skip_reason) || 'ineligible_payload_media_kind')
        : null,
    file_id: normalizeString(primary.file_id) || null,
    file_unique_id: normalizeString(primary.file_unique_id) || null,
    file_name: normalizeString(primary.name) || null,
    file_size: Number.isFinite(Number(primary.size)) ? Number(primary.size) : null,
    mime_type: normalizeString(primary.mimeType) || null,
  };
};

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

  const attachments = normalizeAttachments(parsed.data.attachments).map((attachment) => ({
    ...attachment,
    ...classifyIngressAttachment(attachment),
  }));
  const primaryAttachmentIndex = selectPrimaryAttachmentIndex(attachments);
  const primaryProjection = buildPrimaryAttachmentProjection({
    attachments,
    primaryIndex: primaryAttachmentIndex,
  });
  const shouldPersistReadyText =
    messageText.length > 0 && primaryProjection.transcription_processing_state === 'classified_skip';
  const readyTextPayload = shouldPersistReadyText
    ? buildCanonicalReadyTextTranscription({
      text: messageText,
      messageTimestampSec: context.message_timestamp,
      speaker: null,
    })
    : null;
  const garbageDetection = readyTextPayload
    ? await resolveCanonicalTextGarbageDetection({
      deps,
      transcriptionText: readyTextPayload.transcription_text,
      sessionId,
      ingressSource: 'attachment ingress',
    })
    : null;
  const nowTs = Date.now();

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
    source_note_text: messageText || null,
    session_id: sessionId,
    session_type: session.session_type || VOICEBOT_SESSION_TYPES.MULTIPROMPT_VOICE_SESSION,
    created_at: new Date(),
    is_transcribed: false,
    to_transcribe: false,
    transcribe_attempts: 0,
    ...(readyTextPayload ?? {}),
    ...(garbageDetection
      ? {
        garbage_detected: Boolean(garbageDetection.is_garbage),
        garbage_detection: buildCanonicalGarbageDetection(garbageDetection),
      }
      : {}),
    ...(garbageDetection?.is_garbage
      ? {
        categorization: [],
        categorization_timestamp: nowTs,
        processors_data: {
          categorization: {
            is_processing: false,
            is_processed: true,
            is_finished: true,
            skipped_reason: 'garbage_detected',
          },
        },
        ...buildVoiceMessageDeletionFields({
          deletedAt: new Date(nowTs),
          deletionReason: VOICE_DELETION_REASONS.GARBAGE_DETECTED,
          deletionNote: garbageDetection.reason || garbageDetection.code || null,
        }),
      }
      : {}),
    primary_payload_media_kind: primaryProjection.primary_payload_media_kind,
    primary_transcription_attachment_index: primaryProjection.primary_transcription_attachment_index,
    classification_resolution_state: primaryProjection.classification_resolution_state,
    transcription_eligibility: primaryProjection.transcription_eligibility,
    transcription_eligibility_basis: primaryProjection.transcription_eligibility_basis,
    classification_rule_ref: primaryProjection.classification_rule_ref,
    transcription_processing_state: primaryProjection.transcription_processing_state,
    transcription_skip_reason: primaryProjection.transcription_skip_reason,
    file_id: primaryProjection.file_id,
    file_unique_id: primaryProjection.file_unique_id,
    file_name: primaryProjection.file_name,
    file_size: primaryProjection.file_size,
    mime_type: primaryProjection.mime_type,
  };

  const insert = await deps.db.collection(VOICEBOT_COLLECTIONS.MESSAGES).insertOne(doc);
  const messageObjectId = insert.insertedId;

  await updateSessionAfterMessage(deps, sessionId, context);
  if (readyTextPayload) {
    await runCanonicalTextIngressPostprocessing({
      deps,
      session,
      sessionId,
      messageObjectId,
      ingressSource: 'attachment ingress',
      skipCategorizationReason: garbageDetection?.is_garbage ? 'garbage_detected' : null,
    });
  }

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
    primary_attachment_index: primaryProjection.primary_transcription_attachment_index,
    primary_payload_media_kind: primaryProjection.primary_payload_media_kind,
    classification_resolution_state: primaryProjection.classification_resolution_state,
    transcription_processing_state: primaryProjection.transcription_processing_state,
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
  garbageDetector,
  logger,
}: {
  db: Db;
  queues?: Partial<Record<string, QueueLike>>;
  garbageDetector?: IngressDeps['garbageDetector'];
  logger?: IngressDeps['logger'];
}): IngressDeps => {
  const commonQueue = getQueueByName(queues, VOICEBOT_QUEUES.COMMON);
  const voiceQueue = getQueueByName(queues, VOICEBOT_QUEUES.VOICE);
  const processorsQueue = getQueueByName(queues, VOICEBOT_QUEUES.PROCESSORS);
  const postprocessorsQueue = getQueueByName(queues, VOICEBOT_QUEUES.POSTPROCESSORS);

  return {
    db,
    ...(commonQueue ? { commonQueue } : {}),
    ...(voiceQueue ? { voiceQueue } : {}),
    ...(processorsQueue ? { processorsQueue } : {}),
    ...(postprocessorsQueue ? { postprocessorsQueue } : {}),
    ...(garbageDetector ? { garbageDetector } : {}),
    ...(logger ? { logger } : {}),
  };
};
