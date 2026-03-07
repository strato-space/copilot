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
import {
  handleCreateTasksFromChunksJob,
} from './createTasksFromChunks.js';

const logger = getLogger();

export type CreateTasksPostprocessingJobData = {
  session_id?: string;
  auto_requested_at?: number;
};

type SessionRecord = {
  _id: ObjectId;
  project_id?: ObjectId | string | null;
  session_name?: string | null;
  user_id?: ObjectId | string | null;
};

type MessageRecord = {
  _id: ObjectId;
  transcription_text?: string;
  text?: string;
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

const enqueueCreateTasksPostprocessing = async ({
  session_id,
  auto_requested_at,
}: {
  session_id: string;
  auto_requested_at?: number;
}): Promise<boolean> => {
  const queues = getVoicebotQueues();
  const postprocessorsQueue = queues?.[VOICEBOT_QUEUES.POSTPROCESSORS];
  if (!postprocessorsQueue) {
    logger.warn('[voicebot-worker] create_tasks auto refresh skipped without postprocessors queue', {
      session_id,
    });
    return false;
  }

  await postprocessorsQueue.add(
    VOICEBOT_JOBS.postprocessing.CREATE_TASKS,
    {
      session_id,
      ...(typeof auto_requested_at === 'number' ? { auto_requested_at } : {}),
    },
    {
      deduplication: { id: `${session_id}-CREATE_TASKS-AUTO` },
    }
  );
  return true;
};

const getLatestAutoRequestedAt = async ({
  db,
  sessionObjectId,
}: {
  db: ReturnType<typeof getDb>;
  sessionObjectId: ObjectId;
}): Promise<number> => {
  const session = await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).findOne(
    runtimeQuery({ _id: sessionObjectId }),
    {
      projection: {
        'processors_data.CREATE_TASKS.auto_requested_at': 1,
      },
    }
  );
  const processorsData =
    session?.processors_data && typeof session.processors_data === 'object'
      ? (session.processors_data as Record<string, unknown>)
      : {};
  const createTasksProcessor =
    processorsData.CREATE_TASKS && typeof processorsData.CREATE_TASKS === 'object'
      ? (processorsData.CREATE_TASKS as Record<string, unknown>)
      : {};
  const raw = createTasksProcessor.auto_requested_at;
  const numeric = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(numeric) ? numeric : 0;
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

  const startedAt = Date.now();
  await markCreateTasksPending({ sessionObjectId, isProcessing: true });

  const hasAnyTranscript = messages.some((message) => {
    const transcriptionText = String(message.transcription_text || '').trim();
    const fallbackText = String(message.text || '').trim();
    return Boolean(transcriptionText || fallbackText);
  });

  if (!hasAnyTranscript) {
    await markCreateTasksNoData({ sessionObjectId });
    await markSessionMessagesProcessed({ sessionObjectId });
    return {
      ok: true,
      skipped: true,
      reason: 'no_transcript_text',
      session_id,
    };
  }

  const result = await handleCreateTasksFromChunksJob({ session_id });
  if (result.ok) {
    await markSessionMessagesProcessed({ sessionObjectId });
  }

  const latestRequestedAt = await getLatestAutoRequestedAt({ db, sessionObjectId });
  const shouldRequeue = latestRequestedAt > startedAt;
  if (shouldRequeue) {
    const requeued = await enqueueCreateTasksPostprocessing({
      session_id,
      auto_requested_at: latestRequestedAt,
    });
    if (requeued) {
      logger.info('[voicebot-worker] create_tasks auto refresh requeued after newer transcription', {
        session_id,
        started_at: startedAt,
        latest_requested_at: latestRequestedAt,
      });
    }
  }

  const response: CreateTasksPostprocessingResult = {
    ok: result.ok,
    session_id,
  };

  if (typeof result.tasks_count === 'number') response.tasks_count = result.tasks_count;
  if (typeof result.skipped === 'boolean') response.skipped = result.skipped;
  if (typeof result.reason === 'string' && result.reason) response.reason = result.reason;
  if (typeof result.error === 'string' && result.error) response.error = result.error;
  if (shouldRequeue) response.requeued = true;

  return response;
};
