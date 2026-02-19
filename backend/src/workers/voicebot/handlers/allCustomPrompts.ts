import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
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

const PROCESSING_GRACE_MS = 15 * 60 * 1000;

type SessionRecord = {
  _id: ObjectId;
  session_processors?: unknown[];
  processors_data?: Record<string, unknown>;
};

export type AllCustomPromptsJobData = {
  session_id?: string;
};

type AllCustomPromptsResult = {
  ok: boolean;
  session_id?: string;
  queued?: number;
  skipped?: number;
  skipped_no_queue?: number;
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

const toBoolean = (value: unknown): boolean => value === true;

const toTimestamp = (value: unknown): number => {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
    const ts = new Date(value).getTime();
    return Number.isNaN(ts) ? 0 : ts;
  }
  if (value instanceof Date) return value.getTime();
  return 0;
};

export const handleAllCustomPromptsJob = async (
  payload: AllCustomPromptsJobData
): Promise<AllCustomPromptsResult> => {
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
    return { ok: false, error: 'session_not_found', session_id };
  }

  const customProcessors = getCustomProcessors();
  const sessionProcessors = new Set(
    (Array.isArray(session.session_processors) ? session.session_processors : [])
      .map((item) => String(item || '').trim())
      .filter(Boolean)
  );

  const queues = getVoicebotQueues();
  const postprocessorsQueue = queues?.[VOICEBOT_QUEUES.POSTPROCESSORS] || null;

  let queued = 0;
  let skipped = 0;
  let skippedNoQueue = 0;
  const now = Date.now();

  for (const processor of customProcessors) {
    if (!sessionProcessors.has(processor)) continue;

    const processorData =
      (session.processors_data?.[processor] as Record<string, unknown> | undefined) || {};
    const isProcessing = toBoolean(processorData.is_processing);
    const isProcessed = toBoolean(processorData.is_processed);
    const queuedAt = toTimestamp(processorData.job_queued_timestamp);

    if (isProcessed) {
      skipped += 1;
      continue;
    }
    if (isProcessing && now - queuedAt < PROCESSING_GRACE_MS) {
      skipped += 1;
      continue;
    }

    await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).updateOne(
      runtimeQuery({ _id: sessionObjectId }),
      {
        $set: {
          [`processors_data.${processor}.job_queued_timestamp`]: now,
          [`processors_data.${processor}.is_processing`]: true,
          [`processors_data.${processor}.is_processed`]: false,
          updated_at: new Date(),
        },
      }
    );

    if (!postprocessorsQueue) {
      skippedNoQueue += 1;
      continue;
    }

    const jobId = `${session_id}-CUSTOM_POST_PROCESSING-${processor}`;
    await postprocessorsQueue.add(
      VOICEBOT_JOBS.postprocessing.ONE_CUSTOM_PROMPT,
      {
        session_id,
        processor_name: processor,
        job_id: jobId,
      },
      { deduplication: { id: jobId } }
    );

    queued += 1;
  }

  logger.info('[voicebot-worker] all_custom_prompts handled', {
    session_id,
    queued,
    skipped,
    skipped_no_queue: skippedNoQueue,
    custom_processors_total: customProcessors.length,
  });

  return {
    ok: true,
    session_id,
    queued,
    skipped,
    skipped_no_queue: skippedNoQueue,
  };
};
