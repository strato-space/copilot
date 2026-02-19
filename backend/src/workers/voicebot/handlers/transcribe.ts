import { createReadStream, existsSync } from 'node:fs';
import OpenAI from 'openai';
import { ObjectId } from 'mongodb';
import {
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
import { getAudioDurationFromFile } from '../../../utils/audioUtils.js';
import { getLogger } from '../../../utils/logger.js';

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
};

type VoiceSessionRecord = {
  _id: ObjectId;
  processors?: unknown[];
};

const HARD_MAX_TRANSCRIBE_ATTEMPTS = 10;
const TRANSCRIBE_RETRY_BASE_DELAY_MS = 60 * 1000;
const TRANSCRIBE_RETRY_MAX_DELAY_MS = 30 * 60 * 1000;
const INSUFFICIENT_QUOTA_RETRY = 'insufficient_quota';
const OPENAI_KEY_ENV_NAMES = ['OPENAI_API_KEY'] as const;

const runtimeQuery = (query: Record<string, unknown>) =>
  mergeWithRuntimeFilter(query, {
    field: 'runtime_tag',
    familyMatch: IS_PROD_RUNTIME,
    includeLegacyInProd: IS_PROD_RUNTIME,
  });

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

      await enqueueCategorizationIfEnabled({
        db,
        session,
        session_id,
        message_id,
        messageObjectId,
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

  const filePath = String(message.file_path || '').trim();
  if (!filePath) {
    return {
      ok: true,
      skipped: true,
      reason: 'missing_file_path',
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
    return {
      ok: false,
      error: errorCode,
      message_id,
      session_id,
    };
  }

  try {
    const transcription = await client.audio.transcriptions.create({
      file: createReadStream(filePath),
      model: 'whisper-1',
    });
    const transcription_text = String(transcription.text || '').trim();
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

    const transcription_chunks = [
      {
        segment_index: 0,
        id: `ch_${new ObjectId().toHexString()}`,
        text: transcription_text,
        timestamp: Number(message.message_timestamp)
          ? new Date(Number(message.message_timestamp) * 1000)
          : new Date(),
        duration_seconds: durationSeconds || 0,
      },
    ];

    const timeline = buildSegmentsFromChunks({
      chunks: transcription_chunks,
      messageDurationSeconds: durationSeconds,
      fallbackTimestampMs: Number(message.message_timestamp)
        ? Number(message.message_timestamp) * 1000
        : Date.now(),
    });

    await db.collection(VOICEBOT_COLLECTIONS.MESSAGES).updateOne(runtimeQuery({ _id: messageObjectId }), {
      $set: {
        transcribe_timestamp: Date.now(),
        transcription_text,
        task: 'transcribe',
        text: transcription_text,
        transcription_raw: transcription,
        transcription: {
          schema_version: 1,
          provider: 'openai',
          model: 'whisper-1',
          task: 'transcribe',
          duration_seconds: durationSeconds || timeline.derivedDurationSeconds || null,
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
        transcription_chunks,
        is_transcribed: true,
        transcription_method: 'direct',
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
    await enqueueCategorizationIfEnabled({
      db,
      session,
      session_id,
      message_id,
      messageObjectId,
    });

    logger.info('[voicebot-worker] transcribe handled', {
      message_id,
      session_id,
      source: 'openai_whisper',
      method: 'direct',
    });

    return {
      ok: true,
      message_id,
      session_id,
    };
  } catch (error) {
    const quotaRetryable = isQuotaError(error);
    const normalizedCode = quotaRetryable
      ? normalizeErrorCode(error) || INSUFFICIENT_QUOTA_RETRY
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
