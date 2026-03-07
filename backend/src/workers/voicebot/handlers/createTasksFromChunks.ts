import { ObjectId } from 'mongodb';
import {
  VOICEBOT_COLLECTIONS,
  VOICEBOT_JOBS,
  VOICEBOT_QUEUES,
} from '../../../constants.js';
import { getDb } from '../../../services/db.js';
import { getVoicebotQueues } from '../../../services/voicebotQueues.js';
import { getLogger } from '../../../utils/logger.js';
import { runtimeQuery } from './shared/sharedRuntime.js';
import { runCreateTasksAgent } from '../../../services/voicebot/createTasksAgent.js';
import { persistPossibleTasksForSession } from '../../../services/voicebot/persistPossibleTasks.js';

const logger = getLogger();

export type CreateTasksFromChunksJobData = {
  session_id?: string;
  chunks_to_process?: Array<
    | string
    | {
        text?: unknown;
      }
  >;
  socket_id?: string | null;
};

type CreateTasksFromChunksResult = {
  ok: boolean;
  session_id?: string;
  tasks_count?: number;
  skipped?: boolean;
  reason?: string;
  error?: string;
};

type SessionRecord = {
  _id: ObjectId;
  project_id?: ObjectId | string | null;
  session_name?: string | null;
  user_id?: ObjectId | string | null;
};

const normalizeChunkText = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const text = (value as { text?: unknown }).text;
    if (typeof text === 'string') return text;
  }
  return '';
};

const toProjectId = (value: ObjectId | string | null | undefined): string => {
  if (!value) return '';
  if (typeof value === 'string') return value.trim();
  return value.toString().trim();
};

const enqueuePossibleTasksRefresh = async ({
  session_id,
}: {
  session_id: string;
}): Promise<void> => {
  const queues = getVoicebotQueues();
  const eventsQueue = queues?.[VOICEBOT_QUEUES.EVENTS];
  if (!eventsQueue) {
    logger.warn('[voicebot-worker] create_tasks events queue unavailable', {
      session_id,
    });
    return;
  }

  const updatedAt = new Date().toISOString();
  await eventsQueue.add(
    VOICEBOT_JOBS.events.SEND_TO_SOCKET,
    {
      session_id,
      event: 'session_update',
      payload: {
        _id: session_id,
        session_id,
        updated_at: updatedAt,
        taskflow_refresh: {
          reason: 'auto_transcription_chunk',
          possible_tasks: true,
          updated_at: updatedAt,
        },
      },
    },
    {
      attempts: 1,
    }
  );
};

export const handleCreateTasksFromChunksJob = async (
  payload: CreateTasksFromChunksJobData
): Promise<CreateTasksFromChunksResult> => {
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

  const chunkTexts = Array.isArray(payload.chunks_to_process)
    ? payload.chunks_to_process
        .map((item) => normalizeChunkText(item))
        .map((value) => value.trim())
        .filter(Boolean)
    : [];

  try {
    const tasks = await runCreateTasksAgent({
      sessionId: session_id,
      projectId: toProjectId(session.project_id),
      ...(chunkTexts.length > 0 ? { rawText: chunkTexts.join('\n\n') } : {}),
    });

    const persisted = await persistPossibleTasksForSession({
      db,
      sessionId: session_id,
      sessionName: String(session.session_name || '').trim(),
      defaultProjectId: toProjectId(session.project_id),
      taskItems: tasks,
      createdById: session.user_id ? String(session.user_id) : '',
    });

    await enqueuePossibleTasksRefresh({ session_id });

    return {
      ok: true,
      session_id,
      tasks_count: persisted.items.length,
      ...(persisted.items.length === 0 ? { skipped: true, reason: 'no_tasks' } : {}),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).updateOne(
      runtimeQuery({ _id: sessionObjectId }),
      {
        $set: {
          'processors_data.CREATE_TASKS.is_processing': false,
          'processors_data.CREATE_TASKS.is_processed': false,
          'processors_data.CREATE_TASKS.error': message,
          'processors_data.CREATE_TASKS.error_message': message,
          'processors_data.CREATE_TASKS.error_timestamp': new Date(),
          updated_at: new Date(),
        },
      }
    );
    logger.error('[voicebot-worker] create_tasks_from_chunks failed', {
      session_id,
      error: message,
    });
    return {
      ok: false,
      error: message,
      session_id,
    };
  }
};
