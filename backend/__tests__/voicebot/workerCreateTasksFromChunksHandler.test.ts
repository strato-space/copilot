import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ObjectId } from 'mongodb';

import {
  VOICEBOT_COLLECTIONS,
  VOICEBOT_JOBS,
  VOICEBOT_QUEUES,
} from '../../src/constants.js';

const getDbMock = jest.fn();
const getVoicebotQueuesMock = jest.fn();
const createResponseMock = jest.fn();
const openAiCtorMock = jest.fn(() => ({
  responses: {
    create: createResponseMock,
  },
}));

jest.unstable_mockModule('../../src/services/db.js', () => ({
  getDb: getDbMock,
}));

jest.unstable_mockModule('../../src/services/voicebotQueues.js', () => ({
  getVoicebotQueues: getVoicebotQueuesMock,
}));

jest.unstable_mockModule('openai', () => ({
  default: openAiCtorMock,
}));

const { handleCreateTasksFromChunksJob } = await import(
  '../../src/workers/voicebot/handlers/createTasksFromChunks.js'
);

describe('handleCreateTasksFromChunksJob', () => {
  beforeEach(() => {
    getDbMock.mockReset();
    getVoicebotQueuesMock.mockReset();
    createResponseMock.mockReset();
    openAiCtorMock.mockClear();
    process.env.OPENAI_API_KEY = 'sk-test123';
    delete process.env.VOICEBOT_TASK_CREATION_MODEL;
  });

  it('skips when chunks_to_process is empty', async () => {
    const sessionId = new ObjectId();
    const sessionsFindOne = jest.fn(async () => ({ _id: sessionId }));

    getDbMock.mockReturnValue({
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return {
            findOne: sessionsFindOne,
            updateOne: jest.fn(),
          };
        }
        return {};
      },
    });

    const result = await handleCreateTasksFromChunksJob({
      session_id: sessionId.toString(),
      chunks_to_process: [],
    });

    expect(result).toMatchObject({
      ok: true,
      skipped: true,
      reason: 'no_chunks_to_process',
      session_id: sessionId.toString(),
    });
    expect(createResponseMock).not.toHaveBeenCalled();
  });

  it('creates tasks and emits tickets_prepared event when socket_id is provided', async () => {
    const sessionId = new ObjectId();
    const sessionsFindOne = jest.fn(async () => ({ _id: sessionId }));
    const sessionsUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
    const eventsAdd = jest.fn(async () => ({ id: 'event-job' }));

    getDbMock.mockReturnValue({
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return {
            findOne: sessionsFindOne,
            updateOne: sessionsUpdateOne,
          };
        }
        return {};
      },
    });

    getVoicebotQueuesMock.mockReturnValue({
      [VOICEBOT_QUEUES.EVENTS]: {
        add: eventsAdd,
      },
    });

    createResponseMock.mockResolvedValue({
      output_text: JSON.stringify([
        {
          'Task ID': 'TASK-1',
          'Task Title': 'Ship voice parity',
          Description: 'Implement full parity',
          Priority: 'P2',
        },
      ]),
    });

    const result = await handleCreateTasksFromChunksJob({
      session_id: sessionId.toString(),
      chunks_to_process: [{ text: 'Need to ship parity this week' }],
      socket_id: 'socket-123',
    });

    expect(result).toMatchObject({
      ok: true,
      session_id: sessionId.toString(),
      tasks_count: 1,
    });

    expect(sessionsUpdateOne).toHaveBeenCalledTimes(1);
    const updatePayload = sessionsUpdateOne.mock.calls[0]?.[1] as Record<string, unknown>;
    const setPayload = (updatePayload.$set as Record<string, unknown>) || {};
    expect(setPayload['processors_data.CREATE_TASKS.is_processed']).toBe(true);
    const storedTasks = setPayload['processors_data.CREATE_TASKS.data'] as Array<Record<string, unknown>>;
    expect(Array.isArray(storedTasks)).toBe(true);
    expect(storedTasks[0]).toMatchObject({
      id: 'TASK-1',
      task_id_from_ai: 'TASK-1',
      name: 'Ship voice parity',
      description: 'Implement full parity',
      priority: 'P2',
    });
    expect(storedTasks[0]).not.toHaveProperty('Task Title');

    expect(eventsAdd).toHaveBeenCalledWith(
      VOICEBOT_JOBS.events.SEND_TO_SOCKET,
      expect.objectContaining({
        event: 'tickets_prepared',
        socket_id: 'socket-123',
        payload: expect.arrayContaining([
          expect.objectContaining({
            id: 'TASK-1',
            name: 'Ship voice parity',
          }),
        ]),
      }),
      expect.objectContaining({ attempts: 1 })
    );
  });

  it('writes openai_api_key_missing when key is not configured', async () => {
    const sessionId = new ObjectId();
    const sessionsFindOne = jest.fn(async () => ({ _id: sessionId }));
    const sessionsUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));

    getDbMock.mockReturnValue({
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return {
            findOne: sessionsFindOne,
            updateOne: sessionsUpdateOne,
          };
        }
        return {};
      },
    });

    delete process.env.OPENAI_API_KEY;

    const result = await handleCreateTasksFromChunksJob({
      session_id: sessionId.toString(),
      chunks_to_process: ['need this task'],
    });

    expect(result).toMatchObject({
      ok: false,
      error: 'openai_api_key_missing',
      session_id: sessionId.toString(),
    });
    expect(openAiCtorMock).not.toHaveBeenCalled();

    const updatePayload = sessionsUpdateOne.mock.calls[0]?.[1] as Record<string, unknown>;
    const setPayload = (updatePayload.$set as Record<string, unknown>) || {};
    expect(setPayload['processors_data.CREATE_TASKS.error']).toBe('openai_api_key_missing');
  });
});
