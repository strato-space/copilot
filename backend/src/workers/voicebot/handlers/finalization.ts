import OpenAI from 'openai';
import { ObjectId } from 'mongodb';
import {
  VOICEBOT_COLLECTIONS,
  VOICEBOT_JOBS,
  VOICEBOT_PROCESSORS,
} from '../../../constants.js';
import { getDb } from '../../../services/db.js';
import { IS_PROD_RUNTIME, mergeWithRuntimeFilter } from '../../../services/runtimeScope.js';
import { getLogger } from '../../../utils/logger.js';

const logger = getLogger();

export type FinalizationJobData = {
  session_id?: string;
  force?: boolean;
  processor_name?: string;
  custom_processors?: string[];
};

type FinalizationResult = {
  ok: boolean;
  session_id?: string;
  skipped?: boolean;
  reason?: string;
  error?: string;
};

type SessionRecord = {
  _id: ObjectId;
  is_messages_processed?: boolean;
  processors_data?: Record<string, unknown>;
};

type ProcessorBucket = {
  data?: unknown[];
};

const FINALIZATION_MODEL = process.env.VOICEBOT_FINALIZATION_MODEL || 'gpt-4.1';

const QUESTIONS_DEDUP_PROMPT = `
Ты — помощник для обработки и группировки вопросов.

Вход: JSON-массив объектов с полем result.
Задача: убрать дубли по смыслу, оставить один лучший вариант формулировки.

Требования:
- Возвращай только JSON-массив объектов.
- Сохраняй поле result.
- Не добавляй пояснения.
`;

const runtimeQuery = (query: Record<string, unknown>) =>
  mergeWithRuntimeFilter(query, {
    field: 'runtime_tag',
    familyMatch: IS_PROD_RUNTIME,
    includeLegacyInProd: IS_PROD_RUNTIME,
  });

const normalizeString = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  return String(value);
};

const createOpenAiClient = (): OpenAI | null => {
  const apiKey = String(process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) return null;
  return new OpenAI({ apiKey });
};

const toProcessorBucket = (value: unknown): ProcessorBucket | null => {
  if (!value || typeof value !== 'object') return null;
  return value as ProcessorBucket;
};

const getReservedProcessorKeys = (): Set<string> =>
  new Set([
    ...Object.values(VOICEBOT_PROCESSORS),
    ...Object.values(VOICEBOT_JOBS.postprocessing),
  ]);

const collectCustomProcessorNames = (
  processorsData: Record<string, unknown>,
  explicitProcessors?: string[]
): string[] => {
  if (Array.isArray(explicitProcessors) && explicitProcessors.length > 0) {
    return explicitProcessors
      .map((name) => String(name || '').trim())
      .filter(Boolean);
  }

  const reserved = getReservedProcessorKeys();
  return Object.keys(processorsData)
    .filter((name) => !reserved.has(name));
};

const collectFinalizationInput = (
  processorsData: Record<string, unknown>,
  customProcessors?: string[]
): unknown[] => {
  const names = collectCustomProcessorNames(processorsData, customProcessors);
  const rows: unknown[] = [];

  for (const name of names) {
    const bucket = toProcessorBucket(processorsData[name]);
    if (!bucket || !Array.isArray(bucket.data)) continue;
    rows.push(...bucket.data);
  }

  return rows;
};

export const handleFinalizationJob = async (
  payload: FinalizationJobData
): Promise<FinalizationResult> => {
  const session_id = String(payload.session_id || '').trim();
  if (!session_id || !ObjectId.isValid(session_id)) {
    return { ok: false, error: 'invalid_session_id' };
  }

  const db = getDb();
  const sessionObjectId = new ObjectId(session_id);
  const session = (await db
    .collection(VOICEBOT_COLLECTIONS.SESSIONS)
    .findOne(runtimeQuery({ _id: sessionObjectId, is_deleted: { $ne: true } }))) as SessionRecord | null;

  if (!session) {
    return { ok: false, error: 'session_not_found' };
  }

  const isProcessed = Boolean(session.is_messages_processed);
  if (!isProcessed && !payload.force) {
    return {
      ok: true,
      skipped: true,
      reason: 'messages_not_processed',
      session_id,
    };
  }

  const processorName = String(
    payload.processor_name || VOICEBOT_JOBS.postprocessing.FINAL_CUSTOM_PROMPT
  ).trim();
  const processorKey = `processors_data.${processorName}`;

  const processorsData = (session.processors_data && typeof session.processors_data === 'object'
    ? session.processors_data
    : {}) as Record<string, unknown>;

  const allData = collectFinalizationInput(processorsData, payload.custom_processors);

  if (allData.length === 0) {
    await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).updateOne(
      runtimeQuery({ _id: sessionObjectId }),
      {
        $set: {
          [`${processorKey}.job_finished_timestamp`]: Date.now(),
          [`${processorKey}.is_processing`]: false,
          [`${processorKey}.is_processed`]: true,
          [`${processorKey}.data`]: [],
          updated_at: new Date(),
        },
        $unset: {
          [`${processorKey}.error`]: 1,
          [`${processorKey}.error_message`]: 1,
          [`${processorKey}.error_timestamp`]: 1,
        },
      }
    );

    return {
      ok: true,
      skipped: true,
      reason: 'no_custom_data',
      session_id,
    };
  }

  const client = createOpenAiClient();
  if (!client) {
    await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).updateOne(
      runtimeQuery({ _id: sessionObjectId }),
      {
        $set: {
          [`${processorKey}.job_finished_timestamp`]: Date.now(),
          [`${processorKey}.is_processing`]: false,
          [`${processorKey}.is_processed`]: false,
          [`${processorKey}.error`]: 'openai_api_key_missing',
          [`${processorKey}.error_message`]: 'OPENAI_API_KEY is not configured',
          [`${processorKey}.error_timestamp`]: new Date(),
          updated_at: new Date(),
        },
      }
    );

    return {
      ok: false,
      error: 'openai_api_key_missing',
      session_id,
    };
  }

  try {
    const response = await client.responses.create({
      model: FINALIZATION_MODEL,
      instructions: QUESTIONS_DEDUP_PROMPT,
      input: JSON.stringify(allData),
      store: false,
    });

    const outputText = normalizeString((response as { output_text?: string }).output_text).trim();
    let parsed: unknown[] = [];
    if (outputText) {
      try {
        const asJson = JSON.parse(outputText);
        parsed = Array.isArray(asJson) ? asJson : [];
      } catch (parseError) {
        logger.warn('[voicebot-worker] finalization parse failed, fallback to empty list', {
          session_id,
          error: parseError instanceof Error ? parseError.message : String(parseError),
        });
      }
    }

    const normalized = parsed.map((row) => {
      const bucket = (row && typeof row === 'object' ? row : {}) as Record<string, unknown>;
      return {
        ...bucket,
        result: normalizeString(bucket.result),
      };
    });

    await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).updateOne(
      runtimeQuery({ _id: sessionObjectId }),
      {
        $set: {
          [`${processorKey}.job_finished_timestamp`]: Date.now(),
          [`${processorKey}.is_processing`]: false,
          [`${processorKey}.is_processed`]: true,
          [`${processorKey}.data`]: normalized,
          updated_at: new Date(),
        },
        $unset: {
          [`${processorKey}.error`]: 1,
          [`${processorKey}.error_message`]: 1,
          [`${processorKey}.error_timestamp`]: 1,
        },
      }
    );

    logger.info('[voicebot-worker] finalization handled', {
      session_id,
      processor: processorName,
      model: FINALIZATION_MODEL,
      input_count: allData.length,
      output_count: normalized.length,
    });

    return {
      ok: true,
      session_id,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).updateOne(
      runtimeQuery({ _id: sessionObjectId }),
      {
        $set: {
          [`${processorKey}.job_finished_timestamp`]: Date.now(),
          [`${processorKey}.is_processing`]: false,
          [`${processorKey}.is_processed`]: false,
          [`${processorKey}.error`]: 'finalization_failed',
          [`${processorKey}.error_message`]: message,
          [`${processorKey}.error_timestamp`]: new Date(),
          updated_at: new Date(),
        },
      }
    );

    logger.error('[voicebot-worker] finalization failed', {
      session_id,
      processor: processorName,
      error: message,
    });

    return {
      ok: false,
      error: 'finalization_failed',
      session_id,
    };
  }
};
