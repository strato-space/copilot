import { ObjectId } from 'mongodb';
import {
  VOICEBOT_COLLECTIONS,
  VOICEBOT_JOBS,
  VOICEBOT_PROCESSORS,
  VOICEBOT_QUEUES,
} from '../../../constants.js';
import { getDb } from '../../../services/db.js';
import { getVoicebotQueues } from '../../../services/voicebotQueues.js';
import { IS_PROD_RUNTIME, mergeWithRuntimeFilter } from '../../../services/runtimeScope.js';
import { getLogger } from '../../../utils/logger.js';
import {
  handleCreateTasksFromChunksJob,
  type CreateTasksFromChunksJobData,
} from './createTasksFromChunks.js';

const logger = getLogger();

const RETRY_DELAY_MS = 60_000;

export type CreateTasksPostprocessingJobData = {
  session_id?: string;
};

type SessionRecord = {
  _id: ObjectId;
};

type MessageRecord = {
  _id: ObjectId;
  message_type?: string;
  transcription_text?: string;
  text?: string;
  categorization?: unknown;
  processors_data?: Record<string, unknown>;
  message_timestamp?: number;
  message_id?: number | string;
};

type CreateTasksPostprocessingResult = {
  ok: boolean;
  session_id?: string;
  skipped?: boolean;
  reason?: string;
  requeued?: boolean;
  tasks_count?: number;
  error?: string;
};

const runtimeQuery = (query: Record<string, unknown>) =>
  mergeWithRuntimeFilter(query, {
    field: 'runtime_tag',
    familyMatch: IS_PROD_RUNTIME,
    includeLegacyInProd: IS_PROD_RUNTIME,
  });

const NON_CATEGORIZABLE_TYPES = new Set([
  'image',
  'screenshot',
  'document',
  'photo',
  'file',
  'attachment',
]);

const shouldRequireCategorization = (message: MessageRecord): boolean => {
  const messageType = String(message.message_type || '').trim().toLowerCase();
  if (NON_CATEGORIZABLE_TYPES.has(messageType)) return false;

  const transcriptionText = String(message.transcription_text || '').trim();
  const fallbackText = String(message.text || '').trim();
  const effectiveText = transcriptionText || fallbackText;
  if (!effectiveText) return false;
  if (effectiveText === '[Image]' || effectiveText === '[Screenshot]') return false;
  return true;
};

const isCategorizationReady = (message: MessageRecord): boolean => {
  if (!shouldRequireCategorization(message)) {
    return true;
  }

  if (Array.isArray(message.categorization)) {
    return true;
  }

  const processor =
    (message.processors_data?.[VOICEBOT_PROCESSORS.CATEGORIZATION] as Record<string, unknown> | undefined) ||
    null;

  return processor?.is_processed === true || processor?.is_finished === true;
};

const markSessionMessagesProcessed = async ({ sessionObjectId }: { sessionObjectId: ObjectId }): Promise<void> => {
  const db = getDb();
  await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).updateOne(
    runtimeQuery({ _id: sessionObjectId }),
    {
      $set: {
        is_messages_processed: true,
        updated_at: new Date(),
      },
    }
  );
};

const markCreateTasksPending = async ({
  sessionObjectId,
  isProcessing,
}: {
  sessionObjectId: ObjectId;
  isProcessing: boolean;
}): Promise<void> => {
  const db = getDb();
  await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).updateOne(
    runtimeQuery({ _id: sessionObjectId }),
    {
      $set: {
        'processors_data.CREATE_TASKS.job_queued_timestamp': Date.now(),
        'processors_data.CREATE_TASKS.is_processing': isProcessing,
        'processors_data.CREATE_TASKS.is_processed': false,
        updated_at: new Date(),
      },
    }
  );
};

const markCreateTasksNoData = async ({ sessionObjectId }: { sessionObjectId: ObjectId }): Promise<void> => {
  const db = getDb();
  await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).updateOne(
    runtimeQuery({ _id: sessionObjectId }),
    {
      $set: {
        'processors_data.CREATE_TASKS.job_finished_timestamp': Date.now(),
        'processors_data.CREATE_TASKS.is_processing': false,
        'processors_data.CREATE_TASKS.is_processed': true,
        'processors_data.CREATE_TASKS.data': [],
        updated_at: new Date(),
      },
      $unset: {
        'processors_data.CREATE_TASKS.error': 1,
        'processors_data.CREATE_TASKS.error_message': 1,
        'processors_data.CREATE_TASKS.error_timestamp': 1,
      },
    }
  );
};

const enqueueSessionTasksCreatedNotify = async (session_id: string): Promise<void> => {
  const queues = getVoicebotQueues();
  const notifiesQueue = queues?.[VOICEBOT_QUEUES.NOTIFIES];
  if (!notifiesQueue) return;

  await notifiesQueue.add(
    VOICEBOT_JOBS.notifies.SESSION_TASKS_CREATED,
    { session_id },
    {
      attempts: 1,
      deduplication: { id: `${session_id}-SESSION_TASKS_CREATED` },
    }
  );
};

const enqueuePendingCategorizationJobs = async ({
  session_id,
  messages,
}: {
  session_id: string;
  messages: MessageRecord[];
}): Promise<{ enqueued: number; skippedNoQueue: boolean }> => {
  const queues = getVoicebotQueues();
  const processorsQueue = queues?.[VOICEBOT_QUEUES.PROCESSORS];
  if (!processorsQueue) {
    return { enqueued: 0, skippedNoQueue: true };
  }

  const db = getDb();
  let enqueued = 0;
  const now = Date.now();

  for (const message of messages) {
    if (!shouldRequireCategorization(message)) continue;
    if (isCategorizationReady(message)) continue;

    const processorState = (message.processors_data?.[VOICEBOT_PROCESSORS.CATEGORIZATION] ||
      {}) as Record<string, unknown>;
    if (processorState.is_processing === true) continue;

    const messageObjectId = new ObjectId(message._id);
    const messageId = messageObjectId.toString();
    const jobId = `${session_id}-${messageId}-CATEGORIZE`;
    const processorKey = `processors_data.${VOICEBOT_PROCESSORS.CATEGORIZATION}`;

    await db.collection(VOICEBOT_COLLECTIONS.MESSAGES).updateOne(
      runtimeQuery({ _id: messageObjectId }),
      {
        $set: {
          [`${processorKey}.is_processing`]: true,
          [`${processorKey}.is_processed`]: false,
          [`${processorKey}.is_finished`]: false,
          [`${processorKey}.job_queued_timestamp`]: now,
        },
        $unset: {
          categorization_retry_reason: 1,
          categorization_next_attempt_at: 1,
        },
      }
    );

    await processorsQueue.add(
      VOICEBOT_JOBS.voice.CATEGORIZE,
      {
        message_id: messageId,
        session_id,
        job_id: jobId,
      },
      { deduplication: { id: jobId } }
    );
    enqueued += 1;
  }

  return { enqueued, skippedNoQueue: false };
};

export const handleCreateTasksPostprocessingJob = async (
  payload: CreateTasksPostprocessingJobData
): Promise<CreateTasksPostprocessingResult> => {
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

  const messages = (await db
    .collection(VOICEBOT_COLLECTIONS.MESSAGES)
    .find(runtimeQuery({ session_id: sessionObjectId, is_deleted: { $ne: true } }))
    .sort({ message_timestamp: 1, message_id: 1, _id: 1 })
    .toArray()) as MessageRecord[];

  if (messages.length === 0) {
    await markCreateTasksNoData({ sessionObjectId });
    await markSessionMessagesProcessed({ sessionObjectId });
    return {
      ok: true,
      skipped: true,
      reason: 'no_messages',
      session_id,
    };
  }

  const allCategorized = messages.every(isCategorizationReady);
  if (!allCategorized) {
    const pendingCategorization = await enqueuePendingCategorizationJobs({
      session_id,
      messages,
    });

    if (pendingCategorization.enqueued > 0) {
      logger.info('[voicebot-worker] create_tasks queued missing categorization jobs', {
        session_id,
        enqueued: pendingCategorization.enqueued,
      });
    }
    if (pendingCategorization.skippedNoQueue) {
      logger.warn('[voicebot-worker] create_tasks pending without processors queue', {
        session_id,
      });
    }

    await markCreateTasksPending({ sessionObjectId, isProcessing: false });

    const queues = getVoicebotQueues();
    const postprocessorsQueue = queues?.[VOICEBOT_QUEUES.POSTPROCESSORS];
    if (!postprocessorsQueue) {
      logger.warn('[voicebot-worker] create_tasks pending without postprocessors queue', {
        session_id,
      });
      return {
        ok: true,
        skipped: true,
        reason: 'categorization_pending',
        requeued: false,
        session_id,
      };
    }

    const jobId = `${session_id}-CREATE_TASKS-${Date.now()}`;
    await postprocessorsQueue.add(
      VOICEBOT_JOBS.postprocessing.CREATE_TASKS,
      {
        session_id,
        job_id: jobId,
      },
      {
        delay: RETRY_DELAY_MS,
      }
    );

    return {
      ok: true,
      skipped: true,
      reason: 'categorization_pending',
      requeued: true,
      session_id,
    };
  }

  await markCreateTasksPending({ sessionObjectId, isProcessing: true });

  const chunksToProcess = messages
    .map((message) => message.categorization)
    .filter((value) => Array.isArray(value) && value.length > 0)
    .flat() as CreateTasksFromChunksJobData['chunks_to_process'];

  if (!chunksToProcess || chunksToProcess.length === 0) {
    await markCreateTasksNoData({ sessionObjectId });
    await markSessionMessagesProcessed({ sessionObjectId });
    return {
      ok: true,
      skipped: true,
      reason: 'no_chunks_to_process',
      session_id,
    };
  }

  const result = await handleCreateTasksFromChunksJob({
    session_id,
    chunks_to_process: chunksToProcess,
  });

  if (result.ok && (result.tasks_count || 0) > 0) {
    await enqueueSessionTasksCreatedNotify(session_id);
  }
  if (result.ok) {
    await markSessionMessagesProcessed({ sessionObjectId });
  }

  const response: CreateTasksPostprocessingResult = {
    ok: result.ok,
    session_id,
  };

  if (typeof result.tasks_count === 'number') response.tasks_count = result.tasks_count;
  if (typeof result.skipped === 'boolean') response.skipped = result.skipped;
  if (typeof result.reason === 'string' && result.reason) response.reason = result.reason;
  if (typeof result.error === 'string' && result.error) response.error = result.error;

  return response;
};
