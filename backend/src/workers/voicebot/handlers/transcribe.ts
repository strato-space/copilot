import { createReadStream, existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import OpenAI from 'openai';
import { ObjectId } from 'mongodb';
import {
  COLLECTIONS,
  RUNTIME_TAG,
  TASK_STATUSES,
  VOICEBOT_FILE_STORAGE,
  VOICEBOT_COLLECTIONS,
  VOICEBOT_JOBS,
  VOICEBOT_PROCESSORS,
  VOICEBOT_QUEUES,
} from '../../../constants.js';
import { getDb } from '../../../services/db.js';
import {
  IS_PROD_RUNTIME,
  mergeWithRuntimeFilter,
  RUNTIME_SERVER_NAME,
} from '../../../services/runtimeScope.js';
import { getVoicebotQueues } from '../../../services/voicebotQueues.js';
import {
  buildSegmentsFromChunks,
  resolveMessageDurationSeconds,
} from '../../../services/transcriptionTimeline.js';
import { ensureUniqueTaskPublicId } from '../../../services/taskPublicId.js';
import { getAudioDurationFromFile, splitAudioFileByDuration } from '../../../utils/audioUtils.js';
import { getLogger } from '../../../utils/logger.js';
import { buildCanonicalSessionLink } from '../../../voicebot_tgbot/sessionTelegramMessage.js';

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

type VoiceMessageRecord = {
  _id: ObjectId;
  session_id?: ObjectId | string;
  user_id?: ObjectId | string | null;
  is_transcribed?: boolean;
  transcribe_attempts?: number;
  transcription_retry_reason?: string;
  file_hash?: string;
  file_unique_id?: string;
  hash_sha256?: string;
  file_path?: string;
  message_timestamp?: number;
  duration?: number;
  processors_data?: Record<string, unknown>;
  transcription_text?: string;
  text?: string;
  transcription_raw?: unknown;
  transcription?: unknown;
  transcription_chunks?: unknown[];
  task?: string;
  source_type?: string;
  message_type?: string;
  file_id?: string;
  mime_type?: string;
};

type VoiceSessionRecord = {
  _id: ObjectId;
  user_id?: ObjectId | string | null;
  project_id?: ObjectId | string | null;
  processors?: unknown[];
};

type CodexProject = {
  _id: ObjectId;
  name?: string;
  title?: string;
  git_repo?: string | null;
};

type CodexPerformer = {
  _id: ObjectId;
  id?: string;
  name?: string;
  real_name?: string;
};

type CodexVoiceTaskPayload = {
  trigger: 'voice_command';
  trigger_word: 'codex' | 'кодекс';
  text: string;
  normalized_text: string;
  session_id: string;
  message_db_id: string;
  source_type: string;
  message_type: string;
  external_ref: string;
  source_ref: string;
  created_at: string;
};

const HARD_MAX_TRANSCRIBE_ATTEMPTS = 10;
const TRANSCRIBE_RETRY_BASE_DELAY_MS = 60 * 1000;
const TRANSCRIBE_RETRY_MAX_DELAY_MS = 30 * 60 * 1000;
const INSUFFICIENT_QUOTA_RETRY = 'insufficient_quota';
const OPENAI_KEY_ENV_NAMES = ['OPENAI_API_KEY'] as const;
const OPENAI_TRANSCRIBE_MAX_BYTES = 25 * 1024 * 1024;
const OPENAI_TRANSCRIBE_SEGMENT_TARGET_BYTES = 8 * 1024 * 1024;
const OPENAI_TRANSCRIBE_MIN_SEGMENT_SECONDS = 45;
const TELEGRAM_BOT_API_BASE_URL = 'https://api.telegram.org';
const CODEX_VOICE_TRIGGER_PATTERN = /^\s*(codex|кодекс)(?=\s|$|[,:;.!?-])/iu;
const CODEX_VOICE_TRIGGER_STRIP_PATTERN = /^\s*(?:codex|кодекс)(?:\s+|[,:;.!?-]\s*)?/iu;
const CODEX_VOICE_TASK_TRIGGER = 'voice_command';
const DEFAULT_CODEX_VOICE_TASK_TITLE = 'Voice Codex command';
const DEFAULT_CODEX_VOICE_TASK_DESCRIPTION = 'Created from voice command trigger.';

const TELEGRAM_EXTENSION_BY_MIME: Record<string, string> = {
  'audio/ogg': '.ogg',
  'audio/opus': '.ogg',
  'audio/webm': '.webm',
  'audio/mpeg': '.mp3',
  'audio/mp3': '.mp3',
  'audio/x-m4a': '.m4a',
  'audio/mp4': '.m4a',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
};

const runtimeQuery = (query: Record<string, unknown>) =>
  mergeWithRuntimeFilter(query, {
    field: 'runtime_tag',
    familyMatch: IS_PROD_RUNTIME,
    includeLegacyInProd: IS_PROD_RUNTIME,
  });

const normalizeString = (value: unknown): string => String(value ?? '').trim();

const toObjectIdOrNull = (value: unknown): ObjectId | null => {
  if (value instanceof ObjectId) return value;
  const normalized = normalizeString(value);
  if (!normalized || !ObjectId.isValid(normalized)) return null;
  return new ObjectId(normalized);
};

const detectCodexVoiceTriggerWord = (value: string): 'codex' | 'кодекс' | null => {
  const match = value.match(CODEX_VOICE_TRIGGER_PATTERN);
  if (!match) return null;
  const normalized = normalizeString(match[1]).toLowerCase();
  if (normalized === 'codex') return 'codex';
  if (normalized === 'кодекс') return 'кодекс';
  return null;
};

const stripCodexVoiceTrigger = (value: string): string =>
  value.replace(CODEX_VOICE_TRIGGER_STRIP_PATTERN, '').replace(/\s+/g, ' ').trim();

const toCodexTaskTitle = (normalizedText: string): string => {
  const firstLine = normalizedText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  const title = firstLine || DEFAULT_CODEX_VOICE_TASK_TITLE;
  return title.slice(0, 180);
};

const findCodexProject = async ({
  db,
  session,
}: {
  db: ReturnType<typeof getDb>;
  session: VoiceSessionRecord;
}): Promise<CodexProject | null> => {
  const sessionProjectId = toObjectIdOrNull(session.project_id);
  if (sessionProjectId) {
    const sessionProject = (await db.collection(VOICEBOT_COLLECTIONS.PROJECTS).findOne(
      runtimeQuery({
        _id: sessionProjectId,
        is_deleted: { $ne: true },
      })
    )) as CodexProject | null;
    if (sessionProject && normalizeString(sessionProject.git_repo)) {
      return sessionProject;
    }
  }

  return db.collection(VOICEBOT_COLLECTIONS.PROJECTS).findOne(
    runtimeQuery({
      name: { $regex: /^copilot$/i },
      is_deleted: { $ne: true },
      git_repo: { $type: 'string', $nin: [''] },
    })
  ) as Promise<CodexProject | null>;
};

const findCodexPerformer = async (db: ReturnType<typeof getDb>): Promise<CodexPerformer | null> =>
  db.collection(VOICEBOT_COLLECTIONS.PERFORMERS).findOne(
    runtimeQuery({
      is_deleted: { $ne: true },
      is_banned: { $ne: true },
      $or: [
        { id: { $regex: /^codex$/i } },
        { name: { $regex: /^codex$/i } },
        { real_name: { $regex: /^codex$/i } },
      ],
    }),
    {
      projection: { _id: 1, id: 1, name: 1, real_name: 1 },
    }
  ) as Promise<CodexPerformer | null>;

const upsertSessionCodexPayload = async ({
  db,
  sessionObjectId,
  message_id,
  payload,
}: {
  db: ReturnType<typeof getDb>;
  sessionObjectId: ObjectId;
  message_id: string;
  payload: CodexVoiceTaskPayload;
}): Promise<void> => {
  const metadataSet = {
    'processors_data.CODEX_TASKS.is_processing': false,
    'processors_data.CODEX_TASKS.is_processed': true,
    'processors_data.CODEX_TASKS.job_finished_timestamp': Date.now(),
    updated_at: new Date(),
  };

  await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).updateOne(runtimeQuery({ _id: sessionObjectId }), {
    $set: metadataSet,
  });

  await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).updateOne(
    runtimeQuery({
      _id: sessionObjectId,
      'processors_data.CODEX_TASKS.data': {
        $not: {
          $elemMatch: {
            trigger: CODEX_VOICE_TASK_TRIGGER,
            message_db_id: message_id,
          },
        },
      },
    }),
    {
      $push: {
        'processors_data.CODEX_TASKS.data': payload,
      },
      $set: {
        updated_at: new Date(),
      },
    } as Record<string, unknown>
  );
};

const maybeCreateCodexTaskFromVoiceCommand = async ({
  db,
  session,
  sessionObjectId,
  session_id,
  message,
  messageObjectId,
  message_id,
  transcriptionText,
}: {
  db: ReturnType<typeof getDb>;
  session: VoiceSessionRecord;
  sessionObjectId: ObjectId;
  session_id: string;
  message: VoiceMessageRecord;
  messageObjectId: ObjectId;
  message_id: string;
  transcriptionText: string;
}): Promise<void> => {
  const rawText = normalizeString(transcriptionText);
  const triggerWord = detectCodexVoiceTriggerWord(rawText);
  if (!triggerWord) return;

  const normalizedText = stripCodexVoiceTrigger(rawText);
  const timestampMs = Number(message.message_timestamp)
    ? Number(message.message_timestamp) * 1000
    : Date.now();
  const payload: CodexVoiceTaskPayload = {
    trigger: CODEX_VOICE_TASK_TRIGGER,
    trigger_word: triggerWord,
    text: rawText,
    normalized_text: normalizedText,
    session_id,
    message_db_id: message_id,
    source_type: normalizeString(message.source_type) || 'voice',
    message_type: normalizeString(message.message_type) || 'voice',
    external_ref: buildCanonicalSessionLink(session_id),
    source_ref: session_id,
    created_at: new Date(timestampMs).toISOString(),
  };

  await upsertSessionCodexPayload({
    db,
    sessionObjectId,
    message_id,
    payload,
  });

  const existingTask = (await db.collection(COLLECTIONS.TASKS).findOne(
    runtimeQuery({
      is_deleted: { $ne: true },
      codex_task: true,
      'source_data.trigger': CODEX_VOICE_TASK_TRIGGER,
      $or: [
        { 'source_data.message_db_id': messageObjectId },
        { 'source_data.message_db_id': message_id },
      ],
    }),
    {
      projection: { _id: 1 },
    }
  )) as { _id: ObjectId } | null;

  if (existingTask?._id) {
    await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).updateOne(runtimeQuery({ _id: sessionObjectId }), {
      $set: {
        'processors_data.CODEX_TASKS.last_task_id': existingTask._id.toHexString(),
        updated_at: new Date(),
      },
    });
    logger.info('[voicebot-worker] codex voice command task already exists', {
      session_id,
      message_id,
      task_id: existingTask._id.toHexString(),
    });
    return;
  }

  const project = await findCodexProject({ db, session });
  if (!project) {
    logger.warn('[voicebot-worker] codex voice command skipped: project not found', {
      session_id,
      message_id,
    });
    return;
  }

  const codexPerformer = await findCodexPerformer(db);
  const actorId = toObjectIdOrNull(message.user_id) || toObjectIdOrNull(session.user_id);
  const taskTitle = toCodexTaskTitle(normalizedText);
  const publicTaskId = await ensureUniqueTaskPublicId({
    db,
    preferredId: taskTitle,
    fallbackText: normalizedText,
  });
  const now = new Date();
  const deferredUntil = new Date(now.getTime() + 15 * 60 * 1000);

  const taskDoc: Record<string, unknown> = {
    id: publicTaskId,
    name: taskTitle,
    description: normalizedText || DEFAULT_CODEX_VOICE_TASK_DESCRIPTION,
    priority: 'P2',
    priority_reason: CODEX_VOICE_TASK_TRIGGER,
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
    created_by_performer_id: actorId || null,
    source_kind: 'voice_session',
    source_ref: session_id,
    external_ref: payload.external_ref,
    source: 'VOICE_BOT',
    source_data: {
      session_id: sessionObjectId,
      message_db_id: messageObjectId,
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

  const insert = await db.collection(COLLECTIONS.TASKS).insertOne(taskDoc);
  await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).updateOne(runtimeQuery({ _id: sessionObjectId }), {
    $set: {
      'processors_data.CODEX_TASKS.last_task_id': insert.insertedId.toHexString(),
      updated_at: new Date(),
    },
  });

  logger.info('[voicebot-worker] codex voice command task created', {
    session_id,
    message_id,
    task_id: insert.insertedId.toHexString(),
    trigger_word: triggerWord,
  });
};

const maybeCreateCodexTaskFromVoiceCommandSafe = async ({
  db,
  session,
  sessionObjectId,
  session_id,
  message,
  messageObjectId,
  message_id,
  transcriptionText,
}: {
  db: ReturnType<typeof getDb>;
  session: VoiceSessionRecord;
  sessionObjectId: ObjectId;
  session_id: string;
  message: VoiceMessageRecord;
  messageObjectId: ObjectId;
  message_id: string;
  transcriptionText: string;
}): Promise<void> => {
  try {
    await maybeCreateCodexTaskFromVoiceCommand({
      db,
      session,
      sessionObjectId,
      session_id,
      message,
      messageObjectId,
      message_id,
      transcriptionText,
    });
  } catch (error) {
    logger.warn('[voicebot-worker] codex voice command trigger failed', {
      session_id,
      message_id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

const getRetryDelayMs = (attempts: number): number => {
  const safeAttempts = Math.max(1, Number(attempts) || 1);
  const delay = TRANSCRIBE_RETRY_BASE_DELAY_MS * Math.pow(2, safeAttempts - 1);
  return Math.min(delay, TRANSCRIBE_RETRY_MAX_DELAY_MS);
};

const getErrorMessage = (error: unknown): string => {
  if (!error) return 'Unknown transcription error';
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error != null) {
    const typed = error as Record<string, unknown>;
    const message = typed.message;
    if (typeof message === 'string' && message.trim()) return message;
    const response = typed.response as Record<string, unknown> | undefined;
    const data = response?.data as Record<string, unknown> | undefined;
    const nestedError = data?.error as Record<string, unknown> | undefined;
    if (typeof nestedError?.message === 'string' && nestedError.message.trim()) {
      return nestedError.message;
    }
  }
  return String(error);
};

const normalizeErrorCode = (error: unknown): string | null => {
  if (!error || typeof error !== 'object') return null;
  const typed = error as Record<string, unknown>;
  const typedError = typed.error as Record<string, unknown> | undefined;
  const response = typed.response as Record<string, unknown> | undefined;
  const responseData = response?.data as Record<string, unknown> | undefined;
  const responseError = responseData?.error as Record<string, unknown> | undefined;

  const candidates = [
    typed.code,
    typedError?.code,
    responseError?.code,
    responseError?.type,
    typedError?.type,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim().toLowerCase();
    }
  }

  return null;
};

const isQuotaError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;
  const typed = error as Record<string, unknown>;
  const statusRaw =
    typed.status ??
    (typed.response as Record<string, unknown> | undefined)?.status ??
    (((typed.response as Record<string, unknown> | undefined)?.data as Record<string, unknown> | undefined)
      ?.status as unknown);
  const status = Number(statusRaw);
  const code = normalizeErrorCode(error) || '';
  const message = getErrorMessage(error).toLowerCase();

  if (status === 429) {
    if (/insufficient|quota|balance|billing|payment/.test(code)) return true;
    if (/insufficient[_\s-]*quota|exceeded your quota|quota.*exceeded|billing|payment required/.test(message)) {
      return true;
    }
  }

  return false;
};

const isPayloadTooLargeError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;
  const typed = error as Record<string, unknown>;
  const statusRaw =
    typed.status ??
    (typed.response as Record<string, unknown> | undefined)?.status ??
    (((typed.response as Record<string, unknown> | undefined)?.data as Record<string, unknown> | undefined)
      ?.status as unknown);
  const status = Number(statusRaw);
  if (status === 413) return true;
  const message = getErrorMessage(error).toLowerCase();
  return /maximum content size limit|request entity too large|payload too large/.test(message);
};

const getOpenAIKeySource = (): string =>
  OPENAI_KEY_ENV_NAMES.find((name) => Boolean(process.env[name])) || 'OPENAI_API_KEY';

const maskOpenAIKey = (apiKey: string): string => {
  const raw = String(apiKey || '');
  if (!raw) return 'unknown';
  const safeTail = raw.replace(/[^A-Za-z0-9_-]/g, '').slice(-4);
  if (safeTail.length === 4) return `sk-...${safeTail}`;
  return 'sk-...????';
};

const getTranscriptionErrorContext = ({
  apiKey,
  filePath,
  errorCode,
}: {
  apiKey: string;
  filePath: string | null;
  errorCode: string;
}): Record<string, unknown> => ({
  server_name: RUNTIME_SERVER_NAME || 'unknown',
  openai_key_source: getOpenAIKeySource(),
  openai_key_mask: maskOpenAIKey(apiKey),
  openai_key_present: Boolean(apiKey),
  openai_api_key_env_file: process.env.DOTENV_CONFIG_PATH || '.env',
  ...(filePath ? { file_path: filePath } : {}),
  error_code: errorCode,
});

const getFileSizeBytes = (filePath: string): number => {
  const stats = statSync(filePath);
  return Math.max(0, Number(stats.size) || 0);
};

const normalizeMimeType = (value: unknown): string | null => {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized || null;
};

const sanitizeExtension = (rawExtension: unknown): string => {
  const normalized = String(rawExtension || '').trim().toLowerCase();
  if (!normalized) return '';
  const dotted = normalized.startsWith('.') ? normalized : `.${normalized}`;
  const safe = dotted.replace(/[^a-z0-9.]/g, '');
  if (!safe || safe === '.') return '';
  return safe;
};

const resolveTelegramAudioExtension = ({
  telegramFilePath,
  mimeType,
}: {
  telegramFilePath: string;
  mimeType: string | null;
}): string => {
  const fromPath = sanitizeExtension(extname(telegramFilePath || ''));
  if (fromPath) return fromPath;
  const byMime = mimeType ? TELEGRAM_EXTENSION_BY_MIME[mimeType] : null;
  return byMime || '.ogg';
};

const resolveTelegramBotToken = (): string | null => {
  const prodToken =
    typeof process.env.TG_VOICE_BOT_TOKEN === 'string' ? process.env.TG_VOICE_BOT_TOKEN.trim() : '';
  const betaToken =
    typeof process.env.TG_VOICE_BOT_BETA_TOKEN === 'string' ? process.env.TG_VOICE_BOT_BETA_TOKEN.trim() : '';
  if (IS_PROD_RUNTIME) return prodToken || betaToken || null;
  return betaToken || prodToken || null;
};

type TelegramTransportDownloadResult =
  | {
    ok: true;
    file_path: string;
    telegram_file_path: string;
    mime_type: string | null;
    file_size: number;
  }
  | {
    ok: false;
    error_code: string;
    error_message: string;
    context?: Record<string, unknown>;
  };

type TelegramFetchResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  arrayBuffer: () => Promise<ArrayBuffer>;
  headers: {
    get: (name: string) => string | null;
  };
};

const downloadTelegramFileToLocal = async ({
  fileId,
  sessionId,
  messageId,
  mimeTypeHint,
}: {
  fileId: string;
  sessionId: string;
  messageId: string;
  mimeTypeHint: string | null;
}): Promise<TelegramTransportDownloadResult> => {
  const token = resolveTelegramBotToken();
  if (!token) {
    return {
      ok: false,
      error_code: 'telegram_bot_token_missing',
      error_message: 'Telegram bot token is not configured',
    };
  }

  const metadataUrl = `${TELEGRAM_BOT_API_BASE_URL}/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`;
  let metadataResponse: TelegramFetchResponse;
  try {
    metadataResponse = (await fetch(metadataUrl, { method: 'GET' })) as unknown as TelegramFetchResponse;
  } catch (error) {
    return {
      ok: false,
      error_code: 'telegram_get_file_request_failed',
      error_message: getErrorMessage(error),
    };
  }

  if (!metadataResponse.ok) {
    return {
      ok: false,
      error_code: 'telegram_get_file_http_error',
      error_message: `Telegram getFile failed (${metadataResponse.status})`,
      context: { status: metadataResponse.status },
    };
  }

  type TelegramGetFileResponse = {
    ok?: boolean;
    description?: string;
    result?: {
      file_path?: string;
    };
  };

  let metadataBody: TelegramGetFileResponse | null = null;
  try {
    metadataBody = (await metadataResponse.json()) as TelegramGetFileResponse;
  } catch (error) {
    return {
      ok: false,
      error_code: 'telegram_get_file_invalid_json',
      error_message: getErrorMessage(error),
    };
  }

  const telegramFilePath =
    typeof metadataBody?.result?.file_path === 'string' ? metadataBody.result.file_path.trim() : '';
  if (!metadataBody?.ok || !telegramFilePath) {
    return {
      ok: false,
      error_code: 'telegram_file_path_missing',
      error_message: metadataBody?.description || 'Telegram file path not found',
    };
  }

  const downloadUrl = `${TELEGRAM_BOT_API_BASE_URL}/file/bot${token}/${telegramFilePath}`;
  let downloadResponse: TelegramFetchResponse;
  try {
    downloadResponse = (await fetch(downloadUrl, { method: 'GET' })) as unknown as TelegramFetchResponse;
  } catch (error) {
    return {
      ok: false,
      error_code: 'telegram_file_download_request_failed',
      error_message: getErrorMessage(error),
    };
  }

  if (!downloadResponse.ok) {
    return {
      ok: false,
      error_code: 'telegram_file_download_http_error',
      error_message: `Telegram file download failed (${downloadResponse.status})`,
      context: { status: downloadResponse.status },
    };
  }

  let binary: Buffer;
  try {
    binary = Buffer.from(await downloadResponse.arrayBuffer());
  } catch (error) {
    return {
      ok: false,
      error_code: 'telegram_file_download_read_failed',
      error_message: getErrorMessage(error),
    };
  }
  if (binary.length <= 0) {
    return {
      ok: false,
      error_code: 'telegram_file_download_empty',
      error_message: 'Telegram file download returned empty payload',
    };
  }

  const mimeType =
    normalizeMimeType(downloadResponse.headers.get('content-type')) || normalizeMimeType(mimeTypeHint);
  const extension = resolveTelegramAudioExtension({
    telegramFilePath,
    mimeType,
  });

  const transportDir = resolve(VOICEBOT_FILE_STORAGE.audioDir, 'telegram', sessionId);
  mkdirSync(transportDir, { recursive: true });
  const safeMessageId = messageId.replace(/[^a-zA-Z0-9_-]/g, '').slice(-32) || 'message';
  const safeFileId = fileId.replace(/[^a-zA-Z0-9_-]/g, '').slice(-24) || 'file';
  const localFilePath = join(
    transportDir,
    `tg_${Date.now().toString(36)}_${safeMessageId}_${safeFileId}${extension}`
  );
  writeFileSync(localFilePath, binary);

  return {
    ok: true,
    file_path: localFilePath,
    telegram_file_path: telegramFilePath,
    mime_type: mimeType,
    file_size: binary.length,
  };
};

const createOpenAiClient = (): { apiKey: string; client: OpenAI | null } => {
  const source = getOpenAIKeySource();
  const key = String(process.env[source] || '').trim();
  if (!key) return { apiKey: '', client: null };
  return {
    apiKey: key,
    client: new OpenAI({ apiKey: key }),
  };
};

const resolveMessageContentHash = (message: VoiceMessageRecord): string => {
  const candidates = [message.file_hash, message.file_unique_id, message.hash_sha256];
  for (const value of candidates) {
    const normalized = String(value || '').trim();
    if (normalized) return normalized;
  }
  return '';
};

const shouldUseTranscriptionReuse = (message: VoiceMessageRecord): boolean => {
  const hasText = typeof message.transcription_text === 'string' && message.transcription_text.trim().length > 0;
  const hasChunks = Array.isArray(message.transcription_chunks) && message.transcription_chunks.length > 0;
  const hasPayload = Boolean(message.transcription);
  return hasText || hasChunks || hasPayload;
};

const enqueueCategorizationIfEnabled = async ({
  db,
  session,
  session_id,
  message_id,
  messageObjectId,
}: {
  db: ReturnType<typeof getDb>;
  session: VoiceSessionRecord;
  session_id: string;
  message_id: string;
  messageObjectId: ObjectId;
}): Promise<void> => {
  const sessionProcessors = Array.isArray(session.processors)
    ? session.processors.map((value) => String(value || '').trim()).filter(Boolean)
    : [];
  const categorizationEnabled =
    sessionProcessors.length === 0 || sessionProcessors.includes(VOICEBOT_PROCESSORS.CATEGORIZATION);

  if (!categorizationEnabled) return;

  const queues = getVoicebotQueues();
  const processorsQueue = queues?.[VOICEBOT_QUEUES.PROCESSORS];
  if (!processorsQueue) {
    logger.warn('[voicebot-worker] processors queue unavailable after transcribe', {
      message_id,
      session_id,
    });
    return;
  }

  const processorKey = `processors_data.${VOICEBOT_PROCESSORS.CATEGORIZATION}`;
  const jobId = `${session_id}-${message_id}-CATEGORIZE`;
  await db.collection(VOICEBOT_COLLECTIONS.MESSAGES).updateOne(runtimeQuery({ _id: messageObjectId }), {
    $set: {
      [`${processorKey}.is_processing`]: true,
      [`${processorKey}.is_processed`]: false,
      [`${processorKey}.is_finished`]: false,
      [`${processorKey}.job_queued_timestamp`]: Date.now(),
    },
    $unset: {
      categorization_retry_reason: 1,
      categorization_next_attempt_at: 1,
      categorization_error: 1,
      categorization_error_message: 1,
      categorization_error_timestamp: 1,
    },
  });

  await processorsQueue.add(
    VOICEBOT_JOBS.voice.CATEGORIZE,
    {
      message_id,
      session_id,
      job_id: jobId,
    },
    { deduplication: { id: jobId } }
  );
};

const queueMessageUpdateEvent = async ({
  session_id,
  message_id,
  message,
}: {
  session_id: string;
  message_id: string;
  message: Record<string, unknown>;
}): Promise<void> => {
  const queues = getVoicebotQueues();
  const eventsQueue = queues?.[VOICEBOT_QUEUES.EVENTS];
  if (!eventsQueue) return;

  await eventsQueue.add(VOICEBOT_JOBS.events.SEND_TO_SOCKET, {
    session_id,
    event: 'message_update',
    payload: {
      message_id,
      message,
    },
  });
};

const emitMessageUpdateById = async ({
  db,
  messageObjectId,
  message_id,
  session_id,
}: {
  db: ReturnType<typeof getDb>;
  messageObjectId: ObjectId;
  message_id: string;
  session_id: string;
}): Promise<void> => {
  const updatedMessage = (await db
    .collection(VOICEBOT_COLLECTIONS.MESSAGES)
    .findOne(runtimeQuery({ _id: messageObjectId }))) as Record<string, unknown> | null;
  if (!updatedMessage) return;

  await queueMessageUpdateEvent({
    session_id,
    message_id,
    message: {
      ...updatedMessage,
      _id: String(updatedMessage._id || message_id),
      session_id: String(updatedMessage.session_id || session_id),
    },
  });
};

const emitMessageUpdateByIdSafe = async ({
  db,
  messageObjectId,
  message_id,
  session_id,
}: {
  db: ReturnType<typeof getDb>;
  messageObjectId: ObjectId;
  message_id: string;
  session_id: string;
}): Promise<void> => {
  try {
    await emitMessageUpdateById({ db, messageObjectId, message_id, session_id });
  } catch (error) {
    logger.warn('[voicebot-worker] transcribe message_update emit failed', {
      message_id,
      session_id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

export const handleTranscribeJob = async (
  payload: TranscribeJobData
): Promise<TranscribeResult> => {
  const message_id = String(payload.message_id || '').trim();
  if (!message_id || !ObjectId.isValid(message_id)) {
    return { ok: false, error: 'invalid_message_id' };
  }

  const db = getDb();
  const messageObjectId = new ObjectId(message_id);
  const message = (await db
    .collection(VOICEBOT_COLLECTIONS.MESSAGES)
    .findOne(runtimeQuery({ _id: messageObjectId, is_deleted: { $ne: true } }))) as VoiceMessageRecord | null;

  if (!message) {
    return { ok: false, error: 'message_not_found' };
  }

  const session_id = String(message.session_id || payload.session_id || '').trim();
  if (!session_id || !ObjectId.isValid(session_id)) {
    return { ok: false, error: 'invalid_session_id', message_id };
  }
  const sessionObjectId = new ObjectId(session_id);

  const session = (await db
    .collection(VOICEBOT_COLLECTIONS.SESSIONS)
    .findOne(runtimeQuery({ _id: sessionObjectId, is_deleted: { $ne: true } }))) as VoiceSessionRecord | null;
  if (!session) {
    return { ok: false, error: 'session_not_found', message_id, session_id };
  }

  const alreadyTranscribed = Boolean(message.is_transcribed);
  if (alreadyTranscribed && !payload.force) {
    return {
      ok: true,
      skipped: true,
      reason: 'already_transcribed',
      message_id,
      session_id,
    };
  }

  const contentHash = resolveMessageContentHash(message);
  if (contentHash) {
    const reuseSource = (await db
      .collection(VOICEBOT_COLLECTIONS.MESSAGES)
      .findOne(
        runtimeQuery({
          session_id: sessionObjectId,
          is_deleted: { $ne: true },
          _id: { $ne: messageObjectId },
          is_transcribed: true,
          $or: [
            { file_hash: contentHash },
            { file_unique_id: contentHash },
            { hash_sha256: contentHash },
          ],
        }),
        { sort: { updated_at: -1, created_at: -1 } }
      )) as VoiceMessageRecord | null;

    if (reuseSource && shouldUseTranscriptionReuse(reuseSource)) {
      await db.collection(VOICEBOT_COLLECTIONS.MESSAGES).updateOne(runtimeQuery({ _id: messageObjectId }), {
        $set: {
          transcribe_timestamp: Date.now(),
          transcription_text: String(reuseSource.transcription_text || reuseSource.text || '').trim(),
          task: reuseSource.task || 'transcribe',
          text: String(reuseSource.text || reuseSource.transcription_text || '').trim(),
          transcription_raw: reuseSource.transcription_raw ?? null,
          transcription: reuseSource.transcription ?? null,
          transcription_chunks: Array.isArray(reuseSource.transcription_chunks) ? reuseSource.transcription_chunks : [],
          is_transcribed: true,
          transcription_method: 'reuse_by_file_hash',
          transcribe_attempts: 0,
          to_transcribe: false,
          transcription_reused_from_message_id: String(reuseSource._id),
          transcription_reuse_hash: contentHash,
        },
        $unset: {
          transcription_error: 1,
          transcription_error_context: 1,
          error_message: 1,
          error_timestamp: 1,
          transcription_retry_reason: 1,
          transcription_next_attempt_at: 1,
        },
      });

      await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).updateOne(runtimeQuery({ _id: sessionObjectId }), {
        $set: {
          is_corrupted: false,
        },
        $unset: {
          error_source: 1,
          transcription_error: 1,
          transcription_error_context: 1,
          error_message: 1,
          error_timestamp: 1,
          error_message_id: 1,
        },
      });

      const reusedText = String(reuseSource.transcription_text || reuseSource.text || '').trim();
      await maybeCreateCodexTaskFromVoiceCommandSafe({
        db,
        session,
        sessionObjectId,
        session_id,
        message,
        messageObjectId,
        message_id,
        transcriptionText: reusedText,
      });

      await enqueueCategorizationIfEnabled({
        db,
        session,
        session_id,
        message_id,
        messageObjectId,
      });
      await emitMessageUpdateByIdSafe({
        db,
        messageObjectId,
        message_id,
        session_id,
      });

      logger.info('[voicebot-worker] transcribe reused by hash', {
        message_id,
        session_id,
        reused_from_message_id: String(reuseSource._id),
        hash: contentHash.slice(0, 12),
      });

      return {
        ok: true,
        skipped: true,
        reason: 'reused_transcription_by_hash',
        message_id,
        session_id,
      };
    }
  }

  let filePath = String(message.file_path || '').trim();
  let telegramTransportError: Record<string, unknown> | null = null;
  if (!filePath) {
    const textFallback = String(message.text || '').trim();
    if (textFallback) {
      await db.collection(VOICEBOT_COLLECTIONS.MESSAGES).updateOne(runtimeQuery({ _id: messageObjectId }), {
        $set: {
          is_transcribed: true,
          transcription_text: textFallback,
          transcription_raw: textFallback,
          transcribe_timestamp: Date.now(),
          to_transcribe: false,
          transcription_chunks: [],
          transcription_method: 'text_fallback',
          transcribe_attempts: 0,
        },
        $unset: {
          transcription_error: 1,
          transcription_error_context: 1,
          error_message: 1,
          error_timestamp: 1,
          transcription_retry_reason: 1,
          transcription_next_attempt_at: 1,
        },
      });

      await maybeCreateCodexTaskFromVoiceCommandSafe({
        db,
        session,
        sessionObjectId,
        session_id,
        message,
        messageObjectId,
        message_id,
        transcriptionText: textFallback,
      });

      await enqueueCategorizationIfEnabled({
        db,
        session,
        session_id,
        message_id,
        messageObjectId,
      });
      await emitMessageUpdateByIdSafe({
        db,
        messageObjectId,
        message_id,
        session_id,
      });

      return {
        ok: true,
        skipped: true,
        reason: 'text_fallback',
        message_id,
        session_id,
      };
    }

    const sourceType = String(message.source_type || '').trim().toLowerCase();
    const fileId = String(message.file_id || '').trim();
    if (sourceType === 'telegram' && fileId) {
      const transportDownload = await downloadTelegramFileToLocal({
        fileId,
        sessionId: session_id,
        messageId: message_id,
        mimeTypeHint: normalizeMimeType(message.mime_type),
      });
      if (transportDownload.ok) {
        filePath = transportDownload.file_path;
        await db.collection(VOICEBOT_COLLECTIONS.MESSAGES).updateOne(runtimeQuery({ _id: messageObjectId }), {
          $set: {
            file_path: transportDownload.file_path,
            telegram_file_path: transportDownload.telegram_file_path,
            file_transport: 'telegram_download',
            file_size: transportDownload.file_size,
            ...(transportDownload.mime_type ? { mime_type: transportDownload.mime_type } : {}),
          },
        });
      } else {
        telegramTransportError = {
          code: transportDownload.error_code,
          message: transportDownload.error_message,
          ...(transportDownload.context ? { context: transportDownload.context } : {}),
        };
        logger.warn('[voicebot-worker] telegram transport download failed', {
          message_id,
          session_id,
          file_id: fileId,
          ...telegramTransportError,
        });
      }
    }
  }
  if (!filePath) {
    const sourceType = String(message.source_type || '').trim().toLowerCase();
    const fileId = String(message.file_id || '').trim();
    const isTelegramTransportMissing = Boolean(fileId) && sourceType === 'telegram';
    const telegramTransportErrorCode = String(telegramTransportError?.code || '').trim();
    const telegramTransportErrorMessage = String(telegramTransportError?.message || '').trim();
    const errorCode = isTelegramTransportMissing ? 'missing_transport' : 'missing_file_path';
    const defaultTelegramMessage =
      'Telegram file transport is not configured for this message (file_id present, file_path missing)';
    const errorMessage = isTelegramTransportMissing
      ? telegramTransportErrorMessage || defaultTelegramMessage
      : 'Audio file path is missing';
    const transportContext = isTelegramTransportMissing && telegramTransportError
      ? {
        ...(telegramTransportErrorCode ? { code: telegramTransportErrorCode } : {}),
        ...(telegramTransportErrorMessage ? { message: telegramTransportErrorMessage } : {}),
        ...(telegramTransportError.context && typeof telegramTransportError.context === 'object'
          ? { context: telegramTransportError.context as Record<string, unknown> }
          : {}),
      }
      : null;

    await db.collection(VOICEBOT_COLLECTIONS.MESSAGES).updateOne(runtimeQuery({ _id: messageObjectId }), {
      $set: {
        is_transcribed: false,
        transcription_error: errorCode,
        error_message: errorMessage,
        error_timestamp: new Date(),
        transcribe_timestamp: Date.now(),
        to_transcribe: false,
        transcription_error_context: {
          ...getTranscriptionErrorContext({
            apiKey: '',
            filePath: null,
            errorCode,
          }),
          ...(fileId ? { telegram_file_id: fileId } : {}),
          ...(transportContext ? { telegram_transport_error: transportContext } : {}),
        },
      },
      $unset: {
        transcription_retry_reason: 1,
        transcription_next_attempt_at: 1,
      },
    });
    await emitMessageUpdateByIdSafe({
      db,
      messageObjectId,
      message_id,
      session_id,
    });

    return {
      ok: false,
      error: errorCode,
      message_id,
      session_id,
    };
  }
  if (!existsSync(filePath)) {
    const errorCode = 'file_not_found';
    await db.collection(VOICEBOT_COLLECTIONS.MESSAGES).updateOne(runtimeQuery({ _id: messageObjectId }), {
      $set: {
        is_transcribed: false,
        transcription_error: errorCode,
        error_message: 'Audio file is missing on disk',
        error_timestamp: new Date(),
        transcribe_timestamp: Date.now(),
        to_transcribe: false,
        transcription_error_context: getTranscriptionErrorContext({
          apiKey: '',
          filePath,
          errorCode,
        }),
      },
    });
    await emitMessageUpdateByIdSafe({
      db,
      messageObjectId,
      message_id,
      session_id,
    });
    return {
      ok: false,
      error: errorCode,
      message_id,
      session_id,
    };
  }

  const shouldSkipHardLimit = String(message.transcription_retry_reason || '') === INSUFFICIENT_QUOTA_RETRY;
  const attempts = (Number(message.transcribe_attempts) || 0) + 1;
  await db.collection(VOICEBOT_COLLECTIONS.MESSAGES).updateOne(runtimeQuery({ _id: messageObjectId }), {
    $set: { transcribe_attempts: attempts },
  });

  if (attempts > HARD_MAX_TRANSCRIBE_ATTEMPTS && !shouldSkipHardLimit) {
    await db.collection(VOICEBOT_COLLECTIONS.MESSAGES).updateOne(runtimeQuery({ _id: messageObjectId }), {
      $set: {
        is_transcribed: false,
        transcription_error: 'max_attempts_exceeded',
        error_message: 'Message has exceeded maximum transcription attempts.',
        error_timestamp: new Date(),
        transcribe_timestamp: Date.now(),
        to_transcribe: false,
      },
      $unset: {
        transcription_retry_reason: 1,
        transcription_next_attempt_at: 1,
      },
    });
    await emitMessageUpdateByIdSafe({
      db,
      messageObjectId,
      message_id,
      session_id,
    });
    return {
      ok: false,
      error: 'max_attempts_exceeded',
      message_id,
      session_id,
    };
  }

  const { apiKey, client } = createOpenAiClient();
  if (!client) {
    const errorCode = 'openai_api_key_missing';
    await db.collection(VOICEBOT_COLLECTIONS.MESSAGES).updateOne(runtimeQuery({ _id: messageObjectId }), {
      $set: {
        is_transcribed: false,
        transcription_error: errorCode,
        error_message: 'OPENAI_API_KEY is not configured',
        error_timestamp: new Date(),
        transcribe_timestamp: Date.now(),
        to_transcribe: false,
        transcription_error_context: getTranscriptionErrorContext({
          apiKey,
          filePath,
          errorCode,
        }),
      },
    });
    await emitMessageUpdateByIdSafe({
      db,
      messageObjectId,
      message_id,
      session_id,
    });
    return {
      ok: false,
      error: errorCode,
      message_id,
      session_id,
    };
  }

  try {
    const sourceFileSizeBytes = getFileSizeBytes(filePath);
    const sourceExtension = String(extname(filePath) || '.webm').trim() || '.webm';
    const fallbackTimestampMs = Number(message.message_timestamp)
      ? Number(message.message_timestamp) * 1000
      : Date.now();
    const fallbackTimestampDate = new Date(fallbackTimestampMs);

    const durationFromMessage = resolveMessageDurationSeconds({
      message: message as unknown as Record<string, unknown>,
      chunks: [],
    });
    let durationSeconds = durationFromMessage;
    if (durationSeconds == null) {
      try {
        durationSeconds = await getAudioDurationFromFile(filePath);
      } catch (durationError) {
        logger.warn('[voicebot-worker] could not resolve duration via ffprobe', {
          message_id,
          session_id,
          error: durationError instanceof Error ? durationError.message : String(durationError),
        });
      }
    }

    const transcriptionChunks: Array<Record<string, unknown>> = [];
    const transcriptionTextParts: string[] = [];
    let transcriptionMethod = 'direct';
    let transcriptionRaw: unknown = null;
    let aggregatedDurationSeconds = durationSeconds || 0;

    if (sourceFileSizeBytes <= OPENAI_TRANSCRIBE_MAX_BYTES) {
      const transcription = await client.audio.transcriptions.create({
        file: createReadStream(filePath),
        model: 'whisper-1',
      });
      const transcriptionText = String(transcription.text || '').trim();
      transcriptionTextParts.push(transcriptionText);
      transcriptionRaw = transcription;
      transcriptionChunks.push({
        segment_index: 0,
        id: `ch_${new ObjectId().toHexString()}`,
        text: transcriptionText,
        timestamp: fallbackTimestampDate,
        duration_seconds: durationSeconds || 0,
      });
    } else {
      transcriptionMethod = 'segmented_by_size';
      const segmentCount = Math.max(
        2,
        Math.ceil(sourceFileSizeBytes / OPENAI_TRANSCRIBE_SEGMENT_TARGET_BYTES)
      );
      const segmentDurationSeconds =
        durationSeconds && durationSeconds > 0
          ? Math.max(OPENAI_TRANSCRIBE_MIN_SEGMENT_SECONDS, durationSeconds / segmentCount)
          : 180;

      const tempDir = mkdtempSync(join(tmpdir(), 'copilot-transcribe-split-'));
      try {
        const segmentFiles = await splitAudioFileByDuration({
          filePath,
          segmentDurationSeconds,
          outputDir: tempDir,
          outputPrefix: 'part_',
          outputExtension: sourceExtension,
        });

        let currentOffsetSeconds = 0;
        for (let index = 0; index < segmentFiles.length; index += 1) {
          const segmentPath = segmentFiles[index];
          if (!segmentPath) continue;

          const segmentSizeBytes = getFileSizeBytes(segmentPath);
          if (segmentSizeBytes > OPENAI_TRANSCRIBE_MAX_BYTES) {
            throw new Error(
              `oversized_segment_after_split:index=${index}:size=${segmentSizeBytes}`
            );
          }

          const transcription = await client.audio.transcriptions.create({
            file: createReadStream(segmentPath),
            model: 'whisper-1',
          });
          const segmentText = String(transcription.text || '').trim();
          transcriptionTextParts.push(segmentText);

          let segmentDurationSecondsResolved: number | null = null;
          try {
            segmentDurationSecondsResolved = await getAudioDurationFromFile(segmentPath);
          } catch (durationError) {
            logger.warn('[voicebot-worker] could not resolve split segment duration', {
              message_id,
              session_id,
              segment_index: index,
              error: durationError instanceof Error ? durationError.message : String(durationError),
            });
          }

          if (segmentDurationSecondsResolved == null || segmentDurationSecondsResolved <= 0) {
            if (durationSeconds && durationSeconds > 0) {
              const remainingSegments = Math.max(1, segmentFiles.length - index);
              const remainingDuration = Math.max(0, durationSeconds - currentOffsetSeconds);
              segmentDurationSecondsResolved = remainingDuration / remainingSegments;
            } else {
              segmentDurationSecondsResolved = segmentDurationSeconds;
            }
          }

          transcriptionChunks.push({
            segment_index: index,
            id: `ch_${new ObjectId().toHexString()}`,
            text: segmentText,
            timestamp: new Date(fallbackTimestampMs + Math.round(currentOffsetSeconds * 1000)),
            duration_seconds: segmentDurationSecondsResolved || 0,
          });
          currentOffsetSeconds += segmentDurationSecondsResolved || 0;
        }

        aggregatedDurationSeconds =
          currentOffsetSeconds ||
          durationSeconds ||
          segmentDurationSeconds * Math.max(1, transcriptionChunks.length);
        transcriptionRaw = {
          mode: 'segmented_by_size',
          source_file_size_bytes: sourceFileSizeBytes,
          source_duration_seconds: durationSeconds,
          segment_count: transcriptionChunks.length,
        };
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    }

    const transcription_text = transcriptionTextParts
      .map((value) => String(value || '').trim())
      .filter((value) => Boolean(value))
      .join('\n\n')
      .trim();

    const timeline = buildSegmentsFromChunks({
      chunks: transcriptionChunks,
      messageDurationSeconds: durationSeconds || aggregatedDurationSeconds || null,
      fallbackTimestampMs,
    });

    await db.collection(VOICEBOT_COLLECTIONS.MESSAGES).updateOne(runtimeQuery({ _id: messageObjectId }), {
      $set: {
        transcribe_timestamp: Date.now(),
        transcription_text,
        task: 'transcribe',
        text: transcription_text,
        transcription_raw: transcriptionRaw,
        transcription: {
          schema_version: 1,
          provider: 'openai',
          model: 'whisper-1',
          task: 'transcribe',
          duration_seconds:
            durationSeconds ||
            aggregatedDurationSeconds ||
            timeline.derivedDurationSeconds ||
            null,
          text: transcription_text,
          segments: timeline.segments.map((segment) => ({
            id: String(segment.id || `ch_${new ObjectId().toHexString()}`),
            source_segment_id: null,
            start: Number(segment.start) || 0,
            end: Number(segment.end) || 0,
            speaker: segment.speaker ?? null,
            text: String(segment.text || ''),
            is_deleted: Boolean(segment.is_deleted),
          })),
          usage: null,
        },
        transcription_chunks: transcriptionChunks,
        is_transcribed: true,
        transcription_method: transcriptionMethod,
        transcribe_attempts: 0,
        to_transcribe: false,
      },
      $unset: {
        transcription_error: 1,
        transcription_error_context: 1,
        error_message: 1,
        error_timestamp: 1,
        transcription_retry_reason: 1,
        transcription_next_attempt_at: 1,
      },
    });

    await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).updateOne(runtimeQuery({ _id: sessionObjectId }), {
      $set: {
        is_corrupted: false,
      },
      $unset: {
        error_source: 1,
        transcription_error: 1,
        transcription_error_context: 1,
        error_message: 1,
        error_timestamp: 1,
        error_message_id: 1,
      },
    });

    await maybeCreateCodexTaskFromVoiceCommandSafe({
      db,
      session,
      sessionObjectId,
      session_id,
      message,
      messageObjectId,
      message_id,
      transcriptionText: transcription_text,
    });

    await enqueueCategorizationIfEnabled({
      db,
      session,
      session_id,
      message_id,
      messageObjectId,
    });
    await emitMessageUpdateByIdSafe({
      db,
      messageObjectId,
      message_id,
      session_id,
    });

    logger.info('[voicebot-worker] transcribe handled', {
      message_id,
      session_id,
      source: 'openai_whisper',
      method: transcriptionMethod,
      source_file_size_bytes: sourceFileSizeBytes,
      chunks: transcriptionChunks.length,
    });

    return {
      ok: true,
      message_id,
      session_id,
    };
  } catch (error) {
    const quotaRetryable = isQuotaError(error);
    const payloadTooLarge = isPayloadTooLargeError(error);
    const splitFailedBySize = /oversized_segment_after_split/i.test(getErrorMessage(error));
    const normalizedCode = quotaRetryable
      ? normalizeErrorCode(error) || INSUFFICIENT_QUOTA_RETRY
      : payloadTooLarge || splitFailedBySize
        ? 'audio_too_large'
        : normalizeErrorCode(error) || 'transcription_failed';
    const nextAttemptAt = new Date(Date.now() + getRetryDelayMs(attempts));

    await db.collection(VOICEBOT_COLLECTIONS.MESSAGES).updateOne(runtimeQuery({ _id: messageObjectId }), {
      $set: {
        is_transcribed: false,
        transcription_error: normalizedCode,
        error_message: getErrorMessage(error),
        error_timestamp: new Date(),
        transcribe_timestamp: Date.now(),
        transcribe_attempts: attempts,
        transcription_error_context: getTranscriptionErrorContext({
          apiKey,
          filePath,
          errorCode: normalizedCode,
        }),
        ...(quotaRetryable
          ? {
            to_transcribe: true,
            transcription_retry_reason: INSUFFICIENT_QUOTA_RETRY,
            transcription_next_attempt_at: nextAttemptAt,
          }
          : {
            to_transcribe: false,
          }),
      },
      ...(quotaRetryable
        ? {}
        : {
          $unset: {
            transcription_retry_reason: 1,
            transcription_next_attempt_at: 1,
          },
        }),
    });

    await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).updateOne(runtimeQuery({ _id: sessionObjectId }), {
      $set: quotaRetryable
        ? {
          is_corrupted: false,
          error_source: 'transcription',
          transcription_error: normalizedCode,
          error_message: 'OpenAI quota limit reached. Will resume automatically after payment restoration.',
          error_timestamp: new Date(),
          error_message_id: message_id,
          transcription_error_context: getTranscriptionErrorContext({
            apiKey,
            filePath,
            errorCode: normalizedCode,
          }),
        }
        : {
          is_corrupted: true,
          error_source: 'transcription',
          transcription_error: normalizedCode,
          error_message: getErrorMessage(error),
          error_timestamp: new Date(),
          error_message_id: message_id,
          transcription_error_context: getTranscriptionErrorContext({
            apiKey,
            filePath,
            errorCode: normalizedCode,
          }),
        },
    });
    await emitMessageUpdateByIdSafe({
      db,
      messageObjectId,
      message_id,
      session_id,
    });

    logger.error('[voicebot-worker] transcribe failed', {
      message_id,
      session_id,
      error: normalizedCode,
      retry: quotaRetryable,
    });

    return {
      ok: false,
      error: normalizedCode,
      message_id,
      session_id,
    };
  }
};
