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

const DEFAULT_TASK_CREATION_MODEL = 'gpt-4.1';
const TASK_CREATION_MODEL =
  String(process.env.VOICEBOT_TASK_CREATION_MODEL || '').trim() || DEFAULT_TASK_CREATION_MODEL;

const TASK_CREATION_PROMPT = `
Ты — агент бизнес-аналитик/PM.

Вход: текст диалога/встречи/документа.
Цель: выделить конкретные задачи и вернуть их в виде JSON.

Формат ответа: только валидный JSON-массив объектов, без пояснений.
Каждый объект должен содержать ТОЛЬКО эти ключи:
- "Task ID"
- "Task Title"
- "Description"
- "Priority" ("🔥 P1" ... "P7")
- "Priority Reason"
- "Assignee" (роль/имя/команда или "Unassigned")
- "Dialogue Reference" (короткая цитата или ссылка/контекст)
- "Deadline" (если есть; иначе пустая строка)
- "Project/Goal/Req Link" (если есть; иначе пустая строка)
- "Dependencies" (массив Task ID или пустой массив)

Правила:
- Не придумывай лишние задачи: только те, что реально следуют из входа.
- Убирай дубли (если несколько формулировок одной и той же задачи).
- Если данных нет, используй пустую строку или "Unassigned" (для Assignee) и [] (для Dependencies).
- Не добавляй никаких дополнительных полей.
- Ответ должен быть строго JSON, без markdown.
- Язык значений выбирай по языку входа.
`;

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
  model?: string;
};

type SessionRecord = {
  _id: ObjectId;
};

type ParsedTask = Record<string, unknown>;

const runtimeQuery = (query: Record<string, unknown>) =>
  mergeWithRuntimeFilter(query, {
    field: 'runtime_tag',
    familyMatch: IS_PROD_RUNTIME,
    includeLegacyInProd: IS_PROD_RUNTIME,
  });

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return String(error);
};

const isModelNotFoundError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;
  const typed = error as Record<string, unknown>;
  const code = String(
    typed.code ||
      (typed.error as Record<string, unknown> | undefined)?.code ||
      (((typed.response as Record<string, unknown> | undefined)?.data as Record<string, unknown> | undefined)
        ?.error as Record<string, unknown> | undefined)?.code ||
      ''
  ).toLowerCase();
  const message = getErrorMessage(error).toLowerCase();
  return code === 'model_not_found' || (message.includes('model') && message.includes('not found'));
};

const normalizeChunkText = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const text = (value as { text?: unknown }).text;
    if (typeof text === 'string') return text;
  }
  return '';
};

const parseTasksJson = (raw: string): ParsedTask[] => {
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
      if (Array.isArray(parsed)) {
        return parsed.filter((item) => item && typeof item === 'object') as ParsedTask[];
      }
    } catch {
      // continue
    }
  }

  throw new Error('task_creation_invalid_json');
};

const markProcessorError = async ({
  sessionObjectId,
  error,
}: {
  sessionObjectId: ObjectId;
  error: string;
}): Promise<void> => {
  const db = getDb();
  await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).updateOne(
    runtimeQuery({ _id: sessionObjectId }),
    {
      $set: {
        'processors_data.CREATE_TASKS.is_processing': false,
        'processors_data.CREATE_TASKS.is_processed': false,
        'processors_data.CREATE_TASKS.error': error,
        'processors_data.CREATE_TASKS.error_message': error,
        'processors_data.CREATE_TASKS.error_timestamp': new Date(),
        updated_at: new Date(),
      },
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

  const sessionObjectId = new ObjectId(session_id);
  const db = getDb();

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

  if (chunkTexts.length === 0) {
    return {
      ok: true,
      skipped: true,
      reason: 'no_chunks_to_process',
      session_id,
    };
  }

  const combinedText = chunkTexts.join('\n\n');
  const apiKey = String(process.env.OPENAI_API_KEY || '').trim();

  if (!apiKey) {
    await markProcessorError({ sessionObjectId, error: 'openai_api_key_missing' });
    return {
      ok: false,
      error: 'openai_api_key_missing',
      session_id,
    };
  }

  const client = new OpenAI({ apiKey });

  try {
    let response: { output_text?: string };

    try {
      response = (await client.responses.create({
        model: TASK_CREATION_MODEL,
        instructions: TASK_CREATION_PROMPT,
        input: combinedText,
        store: false,
      })) as { output_text?: string };
    } catch (error) {
      if (TASK_CREATION_MODEL !== DEFAULT_TASK_CREATION_MODEL && isModelNotFoundError(error)) {
        logger.warn('[voicebot-worker] create_tasks_from_chunks fallback model', {
          session_id,
          requested_model: TASK_CREATION_MODEL,
          fallback_model: DEFAULT_TASK_CREATION_MODEL,
        });
        response = (await client.responses.create({
          model: DEFAULT_TASK_CREATION_MODEL,
          instructions: TASK_CREATION_PROMPT,
          input: combinedText,
          store: false,
        })) as { output_text?: string };
      } else {
        throw error;
      }
    }

    const outputText = String(response.output_text || '').trim();
    const tasks = parseTasksJson(outputText);

    await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).updateOne(
      runtimeQuery({ _id: sessionObjectId }),
      {
        $set: {
          'processors_data.CREATE_TASKS.is_processing': false,
          'processors_data.CREATE_TASKS.is_processed': true,
          'processors_data.CREATE_TASKS.data': tasks,
          'processors_data.CREATE_TASKS.job_finished_timestamp': Date.now(),
          updated_at: new Date(),
        },
        $unset: {
          'processors_data.CREATE_TASKS.error': 1,
          'processors_data.CREATE_TASKS.error_message': 1,
          'processors_data.CREATE_TASKS.error_timestamp': 1,
        },
      }
    );

    const socketId = String(payload.socket_id || '').trim();
    if (socketId && tasks.length > 0) {
      const queues = getVoicebotQueues();
      const eventsQueue = queues?.[VOICEBOT_QUEUES.EVENTS];
      if (eventsQueue) {
        await eventsQueue.add(
          VOICEBOT_JOBS.events.SEND_TO_SOCKET,
          {
            event: 'tickets_prepared',
            socket_id: socketId,
            payload: tasks,
          },
          {
            attempts: 1,
          }
        );
      } else {
        logger.warn('[voicebot-worker] create_tasks_from_chunks events queue unavailable', {
          session_id,
          socket_id: socketId,
        });
      }
    }

    return {
      ok: true,
      session_id,
      tasks_count: tasks.length,
      model: TASK_CREATION_MODEL,
    };
  } catch (error) {
    const message = getErrorMessage(error);
    await markProcessorError({ sessionObjectId, error: message });
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
