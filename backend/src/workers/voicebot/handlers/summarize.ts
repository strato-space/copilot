import OpenAI from 'openai';
import { ObjectId } from 'mongodb';
import {
  VOICEBOT_COLLECTIONS,
  VOICEBOT_PROCESSORS,
} from '../../../constants.js';
import { getDb } from '../../../services/db.js';
import { IS_PROD_RUNTIME, mergeWithRuntimeFilter } from '../../../services/runtimeScope.js';
import { getLogger } from '../../../utils/logger.js';

const logger = getLogger();

const SUMMARIZATION_MODEL =
  String(process.env.VOICEBOT_SUMMARIZATION_MODEL || '').trim() || 'gpt-4.1';

const SUMMARIZATION_PROMPT = `
Ты — аналитик. На входе JSON-массив категorizованных сегментов диалога.
Верни только JSON-массив объектов с полями:
- goal: string
- summary: string

Правила:
- Без markdown, только JSON.
- Без пояснений.
- Убирай дубли по смыслу.
- Язык ответа = язык входа.
`;

export type SummarizeJobData = {
  message_id?: string;
  session_id?: string;
  force?: boolean;
};

type SummarizeResult = {
  ok: boolean;
  message_id?: string;
  session_id?: string;
  skipped?: boolean;
  reason?: string;
  error?: string;
};

type MessageRecord = {
  _id: ObjectId;
  session_id?: ObjectId | string;
  categorization?: unknown[];
  processors_data?: Record<string, unknown>;
};

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

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return String(error);
};

const createOpenAiClient = (): OpenAI | null => {
  const apiKey = String(process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) return null;
  return new OpenAI({ apiKey });
};

const parseJsonArray = (raw: string): unknown[] => {
  const direct = raw.trim();
  if (!direct) return [];

  const candidates = [
    direct,
    direct.replace(/^```json\s*/i, '').replace(/```$/i, '').trim(),
    direct.replace(/^```\s*/i, '').replace(/```$/i, '').trim(),
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // ignore parse error and continue
    }
  }

  return [];
};

const getCategorizationData = (message: MessageRecord): unknown[] => {
  if (Array.isArray(message.categorization)) {
    return message.categorization;
  }

  const processorsData =
    message.processors_data && typeof message.processors_data === 'object'
      ? (message.processors_data as Record<string, unknown>)
      : {};
  const categorizationBucket = processorsData[VOICEBOT_PROCESSORS.CATEGORIZATION] as
    | { data?: unknown[] }
    | undefined;

  if (categorizationBucket && Array.isArray(categorizationBucket.data)) {
    return categorizationBucket.data;
  }

  return [];
};

export const handleSummarizeJob = async (
  payload: SummarizeJobData
): Promise<SummarizeResult> => {
  const message_id = String(payload.message_id || '').trim();
  if (!message_id || !ObjectId.isValid(message_id)) {
    return { ok: false, error: 'invalid_message_id' };
  }

  const db = getDb();
  const messageObjectId = new ObjectId(message_id);
  const message = (await db
    .collection(VOICEBOT_COLLECTIONS.MESSAGES)
    .findOne(runtimeQuery({ _id: messageObjectId, is_deleted: { $ne: true } }))) as MessageRecord | null;

  if (!message) {
    return { ok: false, error: 'message_not_found', message_id };
  }

  const session_id = String(message.session_id || payload.session_id || '').trim();
  if (!session_id || !ObjectId.isValid(session_id)) {
    return { ok: false, error: 'invalid_session_id', message_id };
  }

  const sessionObjectId = new ObjectId(session_id);
  const session = await db
    .collection(VOICEBOT_COLLECTIONS.SESSIONS)
    .findOne(runtimeQuery({ _id: sessionObjectId, is_deleted: { $ne: true } }));

  if (!session) {
    return { ok: false, error: 'session_not_found', message_id, session_id };
  }

  const categorization = getCategorizationData(message);
  if (categorization.length === 0 && !payload.force) {
    return {
      ok: true,
      skipped: true,
      reason: 'missing_categorization',
      message_id,
      session_id,
    };
  }

  const processorKey = `processors_data.${VOICEBOT_PROCESSORS.SUMMARIZATION}`;
  const client = createOpenAiClient();

  if (!client) {
    await db.collection(VOICEBOT_COLLECTIONS.MESSAGES).updateOne(runtimeQuery({ _id: messageObjectId }), {
      $set: {
        [`${processorKey}.is_processing`]: false,
        [`${processorKey}.is_processed`]: false,
        summarization_error: 'openai_api_key_missing',
        summarization_error_message: 'OPENAI_API_KEY is not configured',
        summarization_error_timestamp: new Date(),
      },
    });

    return {
      ok: false,
      error: 'openai_api_key_missing',
      message_id,
      session_id,
    };
  }

  try {
    const response = await client.responses.create({
      model: SUMMARIZATION_MODEL,
      instructions: SUMMARIZATION_PROMPT,
      input: JSON.stringify(categorization),
      store: false,
    });

    const outputText = normalizeString((response as { output_text?: string }).output_text);
    const parsedRows = parseJsonArray(outputText);
    const normalizedRows = parsedRows
      .filter((row) => row && typeof row === 'object')
      .map((row) => {
        const item = row as Record<string, unknown>;
        return {
          ...item,
          goal: normalizeString(item.goal),
          summary: normalizeString(item.summary),
        };
      });

    await db.collection(VOICEBOT_COLLECTIONS.MESSAGES).updateOne(runtimeQuery({ _id: messageObjectId }), {
      $set: {
        [`${processorKey}.is_processing`]: false,
        [`${processorKey}.is_processed`]: true,
        [`${processorKey}.data`]: normalizedRows,
        summarization_timestamp: Date.now(),
      },
      $unset: {
        summarization_error: 1,
        summarization_error_message: 1,
        summarization_error_timestamp: 1,
      },
    });

    logger.info('[voicebot-worker] summarize handled', {
      message_id,
      session_id,
      model: SUMMARIZATION_MODEL,
      items: normalizedRows.length,
    });

    return {
      ok: true,
      message_id,
      session_id,
    };
  } catch (error) {
    const messageText = getErrorMessage(error);

    await db.collection(VOICEBOT_COLLECTIONS.MESSAGES).updateOne(runtimeQuery({ _id: messageObjectId }), {
      $set: {
        [`${processorKey}.is_processing`]: false,
        [`${processorKey}.is_processed`]: false,
        summarization_error: 'summarization_failed',
        summarization_error_message: messageText,
        summarization_error_timestamp: new Date(),
      },
    });

    logger.error('[voicebot-worker] summarize failed', {
      message_id,
      session_id,
      error: messageText,
    });

    return {
      ok: false,
      error: 'summarization_failed',
      message_id,
      session_id,
    };
  }
};
