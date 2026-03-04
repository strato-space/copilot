import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ObjectId } from 'mongodb';

import {
  VOICEBOT_COLLECTIONS,
  VOICEBOT_JOBS,
  VOICEBOT_QUEUES,
} from '../../../src/constants.js';

const getDbMock = jest.fn();
const getVoicebotQueuesMock = jest.fn();
const createResponseMock = jest.fn();
const openAiCtorMock = jest.fn(() => ({
  responses: {
    create: createResponseMock,
  },
}));

jest.unstable_mockModule('../../../src/services/db.js', () => ({
  getDb: getDbMock,
}));

jest.unstable_mockModule('../../../src/services/voicebotQueues.js', () => ({
  getVoicebotQueues: getVoicebotQueuesMock,
}));

jest.unstable_mockModule('openai', () => ({
  default: openAiCtorMock,
}));

const { handleCreateTasksPostprocessingJob } = await import(
  '../../../src/workers/voicebot/handlers/createTasksPostprocessing.js'
);

describe('handleCreateTasksPostprocessingJob realtime emission', () => {
  beforeEach(() => {
    getDbMock.mockReset();
    getVoicebotQueuesMock.mockReset();
    createResponseMock.mockReset();
    openAiCtorMock.mockClear();
    process.env.OPENAI_API_KEY = 'sk-test123';
    delete process.env.VOICEBOT_TASK_CREATION_MODEL;
  });

  it('enqueues tickets_prepared for session room delivery when socket_id is absent', async () => {
    const sessionId = new ObjectId();
    const sessionsFindOne = jest.fn(async () => ({ _id: sessionId }));
    const sessionsUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
    const messagesFind = jest.fn(() => ({
      sort: () => ({
        toArray: async () => [
          {
            _id: new ObjectId(),
            session_id: sessionId,
            categorization: [{ text: 'Ship parity task' }],
          },
        ],
      }),
    }));
    const eventsAdd = jest.fn(async () => ({ id: 'event-job' }));
    const notifiesAdd = jest.fn(async () => ({ id: 'notify-job' }));

    getDbMock.mockReturnValue({
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return {
            findOne: sessionsFindOne,
            updateOne: sessionsUpdateOne,
          };
        }
        if (name === VOICEBOT_COLLECTIONS.MESSAGES) {
          return {
            find: messagesFind,
          };
        }
        return {};
      },
    });

    getVoicebotQueuesMock.mockReturnValue({
      [VOICEBOT_QUEUES.EVENTS]: {
        add: eventsAdd,
      },
      [VOICEBOT_QUEUES.NOTIFIES]: {
        add: notifiesAdd,
      },
    });

    createResponseMock.mockResolvedValue({
      output_text: JSON.stringify([
        {
          id: 'TASK-1',
          task_id_from_ai: 'TASK-1',
          name: 'Ship parity',
          description: 'Implement parity',
          priority: 'P2',
        },
      ]),
    });

    const result = await handleCreateTasksPostprocessingJob({
      session_id: sessionId.toString(),
    });

    expect(result).toMatchObject({
      ok: true,
      session_id: sessionId.toString(),
      tasks_count: 1,
    });

    expect(eventsAdd).toHaveBeenCalledWith(
      VOICEBOT_JOBS.events.SEND_TO_SOCKET,
      expect.objectContaining({
        session_id: sessionId.toString(),
        event: 'tickets_prepared',
        payload: expect.arrayContaining([
          expect.objectContaining({
            id: 'TASK-1',
            name: 'Ship parity',
          }),
        ]),
      }),
      expect.objectContaining({ attempts: 1 })
    );
    expect((eventsAdd.mock.calls[0]?.[1] as Record<string, unknown>)?.socket_id).toBeUndefined();

    expect(notifiesAdd).toHaveBeenCalledWith(
      VOICEBOT_JOBS.notifies.SESSION_TASKS_CREATED,
      expect.objectContaining({ session_id: sessionId.toString() }),
      expect.objectContaining({ attempts: 1, deduplication: expect.any(Object) })
    );
  });
});
