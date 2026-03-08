import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ObjectId } from 'mongodb';

import { VOICEBOT_COLLECTIONS } from '../../../src/constants.js';

const getDbMock = jest.fn();
const handleCreateTasksFromChunksJobMock = jest.fn();

jest.unstable_mockModule('../../../src/services/db.js', () => ({
  getDb: getDbMock,
}));

jest.unstable_mockModule('../../../src/workers/voicebot/handlers/createTasksFromChunks.js', () => ({
  handleCreateTasksFromChunksJob: handleCreateTasksFromChunksJobMock,
}));

const { handleCreateTasksPostprocessingJob } = await import(
  '../../../src/workers/voicebot/handlers/createTasksPostprocessing.js'
);

describe('handleCreateTasksPostprocessingJob realtime refresh contract', () => {
  beforeEach(() => {
    getDbMock.mockReset();
    handleCreateTasksFromChunksJobMock.mockReset();
  });

  it('delegates to createTasksFromChunks once transcript text exists and returns handler result', async () => {
    const sessionId = new ObjectId();
    const sessionsFindOne = jest
      .fn()
      .mockResolvedValueOnce({ _id: sessionId })
      .mockResolvedValueOnce({
        _id: sessionId,
        processors_data: {
          CREATE_TASKS: {
            auto_requested_at: 0,
          },
        },
      });
    const sessionsUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
    const messagesFind = jest.fn(() => ({
      sort: () => ({
        toArray: async () => [
          {
            _id: new ObjectId(),
            session_id: sessionId,
            transcription_text: 'Надо реализовать автоматический пересчет possible tasks',
          },
        ],
      }),
    }));

    getDbMock.mockReturnValue({
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return { findOne: sessionsFindOne, updateOne: sessionsUpdateOne };
        }
        if (name === VOICEBOT_COLLECTIONS.MESSAGES) {
          return { find: messagesFind };
        }
        return {};
      },
    });

    handleCreateTasksFromChunksJobMock.mockResolvedValue({
      ok: true,
      session_id: sessionId.toString(),
      tasks_count: 2,
    });

    const result = await handleCreateTasksPostprocessingJob({
      session_id: sessionId.toString(),
    });

    expect(result).toEqual({
      ok: true,
      session_id: sessionId.toString(),
      tasks_count: 2,
    });
    expect(handleCreateTasksFromChunksJobMock).toHaveBeenCalledWith({
      session_id: sessionId.toString(),
      refresh_mode: 'incremental_refresh',
    });

    expect(sessionsUpdateOne).toHaveBeenNthCalledWith(
      1,
      expect.any(Object),
      expect.objectContaining({
        $set: expect.objectContaining({
          'processors_data.CREATE_TASKS.is_processing': true,
          'processors_data.CREATE_TASKS.is_processed': false,
        }),
      })
    );
    expect(sessionsUpdateOne).toHaveBeenNthCalledWith(
      2,
      expect.any(Object),
      expect.objectContaining({
        $set: expect.objectContaining({
          is_messages_processed: true,
        }),
      })
    );
  });
});
