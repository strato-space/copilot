import OpenAI from 'openai';
import { ObjectId, type Db } from 'mongodb';
import {
  VOICEBOT_COLLECTIONS,
  VOICEBOT_JOBS,
  VOICEBOT_PROCESSORS,
  VOICEBOT_QUEUES,
} from '../../../constants.js';
import { getDb } from '../../../services/db.js';
import { IS_PROD_RUNTIME, mergeWithRuntimeFilter } from '../../../services/runtimeScope.js';
import { getVoicebotQueues } from '../../../services/voicebotQueues.js';
import { getLogger } from '../../../utils/logger.js';

const logger = getLogger();

export type CategorizeJobData = {
  message_id?: string;
  session_id?: string;
  force?: boolean;
};

type CategorizeResult = {
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
  message_id?: string | number;
  categorization_attempts?: number;
  categorization_retry_reason?: string;
  transcription_text?: string;
  text?: string;
  speaker?: string;
};

type VoiceSessionRecord = {
  _id: ObjectId;
};

const INSUFFICIENT_QUOTA_RETRY = 'insufficient_quota';
const CATEGORIZATION_MODEL = process.env.VOICEBOT_CATEGORIZATION_MODEL || 'gpt-4.1';
const CATEGORIZATION_MAX_ATTEMPTS = 10;
const CATEGORIZATION_RETRY_BASE_DELAY_MS = 60 * 1000;
const CATEGORIZATION_RETRY_MAX_DELAY_MS = 30 * 60 * 1000;

const CATEGORIZATION_PROMPT = `Ты — агент сегментации транскрипции.

Вход: текст (транскрипция/чат/документ). Может содержать таймкоды и/или имена спикеров.

Задача:
Разбей вход на смысловые сегменты, пригодные для дальнейшей кластеризации.

Выход: только валидный JSON-массив объектов. Никакого текста вокруг.

Поля каждого объекта:
- start: string
- end: string
- speaker: string|null
- text: string
- related_goal: string|null
- segment_type: string
- keywords_grouped: object|null
- certainty_level: "low"|"medium"|"high"
- mentioned_roles: string[]|null
- referenced_systems: string[]|null
- new_pattern_detected: string|null
- quality_flag: string|null
- topic_keywords: string[]|null

Ответ: только JSON.`;

const runtimeQuery = (query: Record<string, unknown>) =>
  mergeWithRuntimeFilter(query, {
    field: 'runtime_tag',
    familyMatch: IS_PROD_RUNTIME,
    includeLegacyInProd: IS_PROD_RUNTIME,
  });

const getRetryDelayMs = (attempts: number): number => {
  const safeAttempts = Math.max(1, Number(attempts) || 1);
  const delay = CATEGORIZATION_RETRY_BASE_DELAY_MS * Math.pow(2, safeAttempts - 1);
  return Math.min(delay, CATEGORIZATION_RETRY_MAX_DELAY_MS);
};

const getErrorMessage = (error: unknown): string => {
  if (!error) return 'Unknown categorization error';
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

const normalizeString = (value: unknown, fallback = ''): string => {
  if (typeof value === 'string') return value;
  if (value == null) return fallback;
  return String(value);
};

const normalizeListToCsv = (value: unknown): string => {
  if (Array.isArray(value)) {
    return value
      .map((entry) => normalizeString(entry).trim())
      .filter(Boolean)
      .join(', ');
  }
  return normalizeString(value);
};

const normalizeCategorizationItem = (
  rawItem: unknown,
  speakerOverride: string | null
): Record<string, unknown> => {
  const item = (rawItem && typeof rawItem === 'object' ? rawItem : {}) as Record<string, unknown>;
  return {
    ...item,
    topic_keywords: normalizeListToCsv(item.topic_keywords),
    keywords_grouped: item.keywords_grouped ? JSON.stringify(item.keywords_grouped) : '',
    related_goal: normalizeString(item.related_goal),
    new_pattern_detected: normalizeString(item.new_pattern_detected),
    certainty_level: normalizeString(item.certainty_level, 'low'),
    mentioned_roles: normalizeListToCsv(item.mentioned_roles),
    referenced_systems: normalizeListToCsv(item.referenced_systems),
    start: normalizeString(item.start),
    end: normalizeString(item.end),
    speaker: speakerOverride || normalizeString(item.speaker, 'Unknown'),
    text: normalizeString(item.text),
  };
};

const createOpenAiClient = (): OpenAI | null => {
  const apiKey = String(process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) return null;
  return new OpenAI({ apiKey });
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
  db: Db;
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

export const handleCategorizeJob = async (
  payload: CategorizeJobData
): Promise<CategorizeResult> => {
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

  const transcriptionText = String(message.transcription_text || message.text || '').trim();
  if (!transcriptionText && !payload.force) {
    return {
      ok: true,
      skipped: true,
      reason: 'missing_transcription_text',
      message_id,
      session_id,
    };
  }

  const processorKey = `processors_data.${VOICEBOT_PROCESSORS.CATEGORIZATION}`;
  const shouldSkipHardLimit = String(message.categorization_retry_reason || '') === INSUFFICIENT_QUOTA_RETRY;
  const attempts = (Number(message.categorization_attempts) || 0) + 1;
  const nextAttemptAt = Date.now() + getRetryDelayMs(attempts);

  if (attempts > CATEGORIZATION_MAX_ATTEMPTS && !shouldSkipHardLimit) {
    await db.collection(VOICEBOT_COLLECTIONS.MESSAGES).updateOne(runtimeQuery({ _id: messageObjectId }), {
      $set: {
        categorization_attempts: attempts,
        categorization_retry_reason: 'max_attempts_exceeded',
        categorization_error: 'max_attempts_exceeded',
        categorization_error_message: 'Categorization exceeded maximum retry attempts.',
        categorization_error_timestamp: new Date(),
        [`${processorKey}.is_processing`]: false,
        [`${processorKey}.is_processed`]: true,
        [`${processorKey}.is_finished`]: true,
        [`${processorKey}.job_queued_timestamp`]: Date.now(),
      },
      $unset: {
        categorization_next_attempt_at: 1,
      },
    });
    await emitMessageUpdateById({
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

  const client = createOpenAiClient();
  if (!client) {
    await db.collection(VOICEBOT_COLLECTIONS.MESSAGES).updateOne(runtimeQuery({ _id: messageObjectId }), {
      $set: {
        categorization_attempts: attempts,
        [`${processorKey}.is_processing`]: false,
        [`${processorKey}.is_processed`]: false,
        categorization_error: 'openai_api_key_missing',
        categorization_error_message: 'OPENAI_API_KEY is not configured',
        categorization_error_timestamp: new Date(),
        categorization_timestamp: Date.now(),
      },
      $unset: {
        categorization_retry_reason: 1,
        categorization_next_attempt_at: 1,
      },
    });
    await emitMessageUpdateById({
      db,
      messageObjectId,
      message_id,
      session_id,
    });
    return {
      ok: false,
      error: 'openai_api_key_missing',
      message_id,
      session_id,
    };
  }

  try {
    const categorizationsResponse = await client.responses.create({
      model: CATEGORIZATION_MODEL,
      instructions: CATEGORIZATION_PROMPT,
      input: transcriptionText,
      store: false,
    });

    const outputText = normalizeString((categorizationsResponse as { output_text?: string }).output_text).trim();
    const parsed = JSON.parse(outputText);
    const rawItems = Array.isArray(parsed) ? parsed : [];
    const categorization = rawItems.map((item) =>
      normalizeCategorizationItem(item, typeof message.speaker === 'string' ? message.speaker : null)
    );

    await db.collection(VOICEBOT_COLLECTIONS.MESSAGES).updateOne(runtimeQuery({ _id: messageObjectId }), {
      $set: {
        [`${processorKey}.is_processing`]: false,
        [`${processorKey}.is_processed`]: true,
        categorization,
        categorization_timestamp: Date.now(),
      },
      $unset: {
        categorization_attempts: 1,
        categorization_next_attempt_at: 1,
        categorization_error: 1,
        categorization_error_message: 1,
        categorization_error_timestamp: 1,
        categorization_retry_reason: 1,
      },
    });
    await emitMessageUpdateById({
      db,
      messageObjectId,
      message_id,
      session_id,
    });

    logger.info('[voicebot-worker] categorize handled', {
      message_id,
      session_id,
      model: CATEGORIZATION_MODEL,
      items: categorization.length,
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
      : normalizeErrorCode(error) || 'categorization_failed';

    await db.collection(VOICEBOT_COLLECTIONS.MESSAGES).updateOne(runtimeQuery({ _id: messageObjectId }), {
      $set: {
        categorization_attempts: attempts,
        [`${processorKey}.is_processing`]: false,
        [`${processorKey}.is_processed`]: false,
        categorization_error: normalizedCode,
        categorization_error_message: getErrorMessage(error),
        categorization_error_timestamp: new Date(),
        categorization_timestamp: Date.now(),
        ...(quotaRetryable
          ? {
              categorization_retry_reason: INSUFFICIENT_QUOTA_RETRY,
              categorization_next_attempt_at: new Date(nextAttemptAt),
            }
          : {}),
      },
      ...(quotaRetryable
        ? {}
        : {
            $unset: {
              categorization_retry_reason: 1,
              categorization_next_attempt_at: 1,
            },
        }),
    });
    await emitMessageUpdateById({
      db,
      messageObjectId,
      message_id,
      session_id,
    });

    logger.error('[voicebot-worker] categorize failed', {
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
