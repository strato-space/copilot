import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ObjectId } from 'mongodb';

import { VOICEBOT_COLLECTIONS, VOICEBOT_JOBS, VOICEBOT_QUEUES } from '../../../src/constants.js';

const getDbMock = jest.fn();
const getVoicebotQueuesMock = jest.fn();
const handleCreateTasksFromChunksJobMock = jest.fn();

jest.unstable_mockModule('../../../src/services/db.js', () => ({
  getDb: getDbMock,
}));

jest.unstable_mockModule('../../../src/services/voicebotQueues.js', () => ({
  getVoicebotQueues: getVoicebotQueuesMock,
}));

jest.unstable_mockModule('../../../src/workers/voicebot/handlers/createTasksFromChunks.js', () => ({
  handleCreateTasksFromChunksJob: handleCreateTasksFromChunksJobMock,
}));

const { handleCreateTasksPostprocessingJob } = await import(
  '../../../src/workers/voicebot/handlers/createTasksPostprocessing.js'
);
const { handleAudioMergingJob } = await import(
  '../../../src/workers/voicebot/handlers/shared/audioMerging.js'
);
const { VOICEBOT_WORKER_MANIFEST } = await import('../../../src/workers/voicebot/manifest.js');

describe('postprocessing create tasks + audio merging handlers', () => {
  beforeEach(() => {
    getDbMock.mockReset();
    getVoicebotQueuesMock.mockReset();
    handleCreateTasksFromChunksJobMock.mockReset();
  });

  it('marks CREATE_TASKS as empty when session has no messages', async () => {
    const sessionId = new ObjectId();
    const sessionsFindOne = jest.fn(async () => ({ _id: sessionId }));
    const sessionsUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
    const messagesFind = jest.fn(() => ({
      sort: () => ({
        toArray: async () => [],
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

    const result = await handleCreateTasksPostprocessingJob({
      session_id: sessionId.toString(),
    });

    expect(result).toMatchObject({
      ok: true,
      skipped: true,
      reason: 'no_messages',
      session_id: sessionId.toString(),
    });
    expect(handleCreateTasksFromChunksJobMock).not.toHaveBeenCalled();
    expect(sessionsUpdateOne).toHaveBeenCalledTimes(2);
  });

  it('marks CREATE_TASKS as empty when session has no transcript text yet', async () => {
    const sessionId = new ObjectId();
    const sessionsFindOne = jest.fn(async () => ({ _id: sessionId }));
    const sessionsUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
    const messagesFind = jest.fn(() => ({
      sort: () => ({
        toArray: async () => [
          {
            _id: new ObjectId(),
            session_id: sessionId,
            message_type: 'image',
            text: '',
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

    const result = await handleCreateTasksPostprocessingJob({
      session_id: sessionId.toString(),
    });

    expect(result).toMatchObject({
      ok: true,
      skipped: true,
      reason: 'no_transcript_text',
      session_id: sessionId.toString(),
    });
    expect(handleCreateTasksFromChunksJobMock).not.toHaveBeenCalled();
    expect(sessionsUpdateOne).toHaveBeenCalledTimes(3);
  });

  it('requeues CREATE_TASKS when newer transcription arrived during current run', async () => {
    const sessionId = new ObjectId();
    const startedAutoRequestedAt = Date.now() - 10_000;
    const newerAutoRequestedAt = Date.now() + 60_000;
    const sessionsFindOne = jest.fn(async () => ({
      _id: sessionId,
      processors_data: {
        CREATE_TASKS: {
          auto_requested_at: newerAutoRequestedAt,
        },
      },
    }));
    const sessionsUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
    const messagesFind = jest.fn(() => ({
      sort: () => ({
        toArray: async () => [
          {
            _id: new ObjectId(),
            session_id: sessionId,
            transcription_text: 'Need recalculated possible tasks',
          },
        ],
      }),
    }));
    const postprocessorsAdd = jest.fn(async () => ({ id: 'create-tasks-retry' }));

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
    getVoicebotQueuesMock.mockReturnValue({
      [VOICEBOT_QUEUES.POSTPROCESSORS]: { add: postprocessorsAdd },
    });

    handleCreateTasksFromChunksJobMock.mockResolvedValue({
      ok: true,
      session_id: sessionId.toString(),
      tasks_count: 1,
    });

    const result = await handleCreateTasksPostprocessingJob({
      session_id: sessionId.toString(),
      auto_requested_at: startedAutoRequestedAt,
    });

    expect(result).toMatchObject({
      ok: true,
      session_id: sessionId.toString(),
      tasks_count: 1,
      requeued: true,
    });
    expect(postprocessorsAdd).toHaveBeenCalledWith(
      VOICEBOT_JOBS.postprocessing.CREATE_TASKS,
      expect.objectContaining({
        session_id: sessionId.toString(),
        auto_requested_at: newerAutoRequestedAt,
      }),
      expect.objectContaining({
        deduplication: { id: `${sessionId.toString()}-CREATE_TASKS-AUTO` },
      })
    );
  });

  it('worker manifest routes AUDIO_MERGING to handler', async () => {
    expect(VOICEBOT_WORKER_MANIFEST[VOICEBOT_JOBS.postprocessing.AUDIO_MERGING]).toBeDefined();

    const result = await VOICEBOT_WORKER_MANIFEST[VOICEBOT_JOBS.postprocessing.AUDIO_MERGING]({
      job_id: 'merge-1',
      session_id: 'sess-1',
    });

    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        error: 'invalid_session_id',
      })
    );
  });

  it('audio merging direct handler rejects invalid session ids deterministically', async () => {
    const result = await handleAudioMergingJob({
      session_id: 'sess-1',
    });

    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        error: 'invalid_session_id',
      })
    );
  });
});
