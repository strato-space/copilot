import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import OpenAI from 'openai';
import { ObjectId } from 'mongodb';
import {
  VOICEBOT_COLLECTIONS,
  VOICEBOT_JOBS,
  VOICEBOT_QUEUES,
} from '../../../constants.js';
import { getDb } from '../../../services/db.js';
import { getVoicebotQueues } from '../../../services/voicebotQueues.js';
import { IS_PROD_RUNTIME, mergeWithRuntimeFilter } from '../../../services/runtimeScope.js';
import { getLogger } from '../../../utils/logger.js';

const logger = getLogger();

const CUSTOM_PROMPT_MODEL =
  String(process.env.VOICEBOT_CUSTOM_PROMPT_MODEL || '').trim() || 'gpt-4.1';

type SessionRecord = {
  _id: ObjectId;
  processors_data?: Record<string, unknown>;
};

type MessageRecord = {
  _id: ObjectId;
  message_id?: string | number;
  message_timestamp?: number;
  source_type?: string;
  categorization?: unknown[];
};

export type OneCustomPromptJobData = {
  session_id?: string;
  processor_name?: string;
};

type OneCustomPromptResult = {
  ok: boolean;
  session_id?: string;
  processor_name?: string;
  data_count?: number;
  enqueued_final?: boolean;
  skipped?: boolean;
  reason?: string;
  error?: string;
};

const runtimeQuery = (query: Record<string, unknown>) =>
  mergeWithRuntimeFilter(query, {
    field: 'runtime_tag',
    familyMatch: IS_PROD_RUNTIME,
    includeLegacyInProd: IS_PROD_RUNTIME,
  });

const resolveCustomPromptsDir = (): string => {
  const configured = String(process.env.VOICEBOT_CUSTOM_PROMPTS_DIR || '').trim();
  if (configured) return configured;
  return path.resolve(process.cwd(), '..', 'voicebot_runtime', 'voicebot', 'custom_prompts');
};

const getCustomProcessors = (): string[] => {
  const promptsDir = resolveCustomPromptsDir();
  if (!existsSync(promptsDir)) return [];

  try {
    return readdirSync(promptsDir)
      .filter((file) => file.endsWith('.md'))
      .map((file) => file.replace(/\.md$/i, ''))
      .map((name) => name.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
};

const getCustomPromptText = (processorName: string): string | null => {
  const promptsDir = resolveCustomPromptsDir();
  const fileName = processorName.endsWith('.md') ? processorName : `${processorName}.md`;
  const promptPath = path.join(promptsDir, fileName);
  if (!existsSync(promptPath)) return null;

  try {
    return readFileSync(promptPath, 'utf8');
  } catch {
    return null;
  }
};

const createOpenAiClient = (): OpenAI | null => {
  const apiKey = String(process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) return null;
  return new OpenAI({ apiKey });
};

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

const toBoolean = (value: unknown): boolean => value === true;

export const handleOneCustomPromptJob = async (
  payload: OneCustomPromptJobData
): Promise<OneCustomPromptResult> => {
  const session_id = String(payload.session_id || '').trim();
  if (!session_id || !ObjectId.isValid(session_id)) {
    return { ok: false, error: 'invalid_session_id' };
  }

  const processor_name = String(payload.processor_name || '').trim();
  if (!processor_name) {
    return { ok: false, error: 'invalid_processor_name', session_id };
  }

  const db = getDb();
  const sessionObjectId = new ObjectId(session_id);
  const session = (await db
    .collection(VOICEBOT_COLLECTIONS.SESSIONS)
    .findOne(runtimeQuery({ _id: sessionObjectId, is_deleted: { $ne: true } }))) as SessionRecord | null;

  if (!session) {
    return { ok: false, error: 'session_not_found', session_id, processor_name };
  }

  const messages = (await db
    .collection(VOICEBOT_COLLECTIONS.MESSAGES)
    .find(runtimeQuery({ session_id: sessionObjectId, is_deleted: { $ne: true } }))
    .sort({ message_timestamp: 1, message_id: 1, _id: 1 })
    .toArray()) as MessageRecord[];

  if (messages.length === 0) {
    return {
      ok: true,
      skipped: true,
      reason: 'no_messages',
      session_id,
      processor_name,
    };
  }

  const processorKey = `processors_data.${processor_name}`;
  const selectedPrompt = getCustomPromptText(processor_name);
  if (!selectedPrompt) {
    await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).updateOne(runtimeQuery({ _id: sessionObjectId }), {
      $set: {
        [`${processorKey}.is_processing`]: false,
        [`${processorKey}.is_processed`]: false,
        [`${processorKey}.error`]: 'custom_prompt_not_found',
        [`${processorKey}.error_message`]: `No custom prompt found for ${processor_name}`,
        [`${processorKey}.error_timestamp`]: new Date(),
      },
    });
    return { ok: false, error: 'custom_prompt_not_found', session_id, processor_name };
  }

  const allCategorizations = messages
    .map((message) => message.categorization)
    .filter((rows) => Array.isArray(rows) && rows.length > 0);

  const client = createOpenAiClient();
  if (!client) {
    await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).updateOne(runtimeQuery({ _id: sessionObjectId }), {
      $set: {
        [`${processorKey}.is_processing`]: false,
        [`${processorKey}.is_processed`]: false,
        [`${processorKey}.error`]: 'openai_api_key_missing',
        [`${processorKey}.error_message`]: 'OPENAI_API_KEY is not configured',
        [`${processorKey}.error_timestamp`]: new Date(),
      },
    });
    return { ok: false, error: 'openai_api_key_missing', session_id, processor_name };
  }

  try {
    let normalizedRows: Array<Record<string, unknown>> = [];

    if (allCategorizations.length > 0) {
      const response = await client.responses.create({
        model: CUSTOM_PROMPT_MODEL,
        instructions: selectedPrompt,
        input: JSON.stringify(allCategorizations),
        store: false,
      });

      const outputText = normalizeString((response as { output_text?: string }).output_text);
      const parsedRows = parseJsonArray(outputText);
      normalizedRows = parsedRows
        .filter((row) => row && typeof row === 'object')
        .map((row) => {
          const item = row as Record<string, unknown>;
          return {
            ...item,
            result: normalizeString(item.result),
          };
        });
    }

    await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).updateOne(runtimeQuery({ _id: sessionObjectId }), {
      $set: {
        [`${processorKey}.job_finished_timestamp`]: Date.now(),
        [`${processorKey}.is_processing`]: false,
        [`${processorKey}.is_processed`]: true,
        [`${processorKey}.data`]: normalizedRows,
        updated_at: new Date(),
      },
      $unset: {
        [`${processorKey}.error`]: 1,
        [`${processorKey}.error_message`]: 1,
        [`${processorKey}.error_timestamp`]: 1,
      },
    });

    const refreshedSession = (await db
      .collection(VOICEBOT_COLLECTIONS.SESSIONS)
      .findOne(runtimeQuery({ _id: sessionObjectId }))) as SessionRecord | null;

    let enqueuedFinal = false;
    const finalProcessorKey = `processors_data.${VOICEBOT_JOBS.postprocessing.FINAL_CUSTOM_PROMPT}`;
    const isFinalProcessed = toBoolean(
      refreshedSession?.processors_data?.[VOICEBOT_JOBS.postprocessing.FINAL_CUSTOM_PROMPT] &&
        (refreshedSession?.processors_data?.[VOICEBOT_JOBS.postprocessing.FINAL_CUSTOM_PROMPT] as Record<string, unknown>)
          .is_processed
    );

    if (!isFinalProcessed) {
      const customProcessors = getCustomProcessors();
      const allProcessed = customProcessors.every((processor) =>
        toBoolean(
          refreshedSession?.processors_data?.[processor] &&
            (refreshedSession?.processors_data?.[processor] as Record<string, unknown>).is_processed
        )
      );

      if (allProcessed) {
        const queues = getVoicebotQueues();
        const postprocessorsQueue = queues?.[VOICEBOT_QUEUES.POSTPROCESSORS] || null;
        if (postprocessorsQueue) {
          const jobId = `${session_id}-FINAL_CUSTOM_PROCESSING`;
          await postprocessorsQueue.add(
            VOICEBOT_JOBS.postprocessing.FINAL_CUSTOM_PROMPT,
            {
              session_id,
              job_id: jobId,
            },
            {
              deduplication: { id: jobId },
              delay: 1000,
            }
          );
          enqueuedFinal = true;
        }
      }
    }

    logger.info('[voicebot-worker] one_custom_prompt handled', {
      session_id,
      processor_name,
      model: CUSTOM_PROMPT_MODEL,
      data_count: normalizedRows.length,
      enqueued_final: enqueuedFinal,
      final_processor_key: finalProcessorKey,
    });

    return {
      ok: true,
      session_id,
      processor_name,
      data_count: normalizedRows.length,
      enqueued_final: enqueuedFinal,
    };
  } catch (error) {
    const messageText = getErrorMessage(error);
    await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).updateOne(runtimeQuery({ _id: sessionObjectId }), {
      $set: {
        [`${processorKey}.is_processing`]: false,
        [`${processorKey}.is_processed`]: false,
        [`${processorKey}.error`]: 'one_custom_prompt_failed',
        [`${processorKey}.error_message`]: messageText,
        [`${processorKey}.error_timestamp`]: new Date(),
      },
    });

    logger.error('[voicebot-worker] one_custom_prompt failed', {
      session_id,
      processor_name,
      error: messageText,
    });

    return {
      ok: false,
      error: 'one_custom_prompt_failed',
      session_id,
      processor_name,
    };
  }
};
