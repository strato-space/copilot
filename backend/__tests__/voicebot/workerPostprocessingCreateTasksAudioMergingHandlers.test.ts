import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ObjectId } from 'mongodb';

import {
  VOICEBOT_COLLECTIONS,
  VOICEBOT_JOBS,
  VOICEBOT_QUEUES,
} from '../../src/constants.js';

const getDbMock = jest.fn();
const getVoicebotQueuesMock = jest.fn();
const handleCreateTasksFromChunksJobMock = jest.fn();

jest.unstable_mockModule('../../src/services/db.js', () => ({
  getDb: getDbMock,
}));

jest.unstable_mockModule('../../src/services/voicebotQueues.js', () => ({
  getVoicebotQueues: getVoicebotQueuesMock,
}));

jest.unstable_mockModule('../../src/workers/voicebot/handlers/createTasksFromChunks.js', () => ({
  handleCreateTasksFromChunksJob: handleCreateTasksFromChunksJobMock,
}));

const { handleCreateTasksPostprocessingJob } = await import(
  '../../src/workers/voicebot/handlers/createTasksPostprocessing.js'
);
const { handleAudioMergingJob } = await import(
  '../../src/workers/voicebot/handlers/audioMerging.js'
);
const { VOICEBOT_WORKER_MANIFEST } = await import('../../src/workers/voicebot/manifest.js');

describe('postprocessing create tasks + audio merging handlers', () => {
  beforeEach(() => {
    getDbMock.mockReset();
    getVoicebotQueuesMock.mockReset();
    handleCreateTasksFromChunksJobMock.mockReset();
  });

  it('requeues CREATE_TASKS when categorization is pending', async () => {
    const sessionId = new ObjectId();
    const sessionsFindOne = jest.fn(async () => ({ _id: sessionId }));
    const sessionsUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
    const messagesFind = jest.fn(() => ({
      sort: () => ({
        toArray: async () => [
          {
            _id: new ObjectId(),
            session_id: sessionId,
            processors_data: {
              categorization: { is_processed: false },
            },
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
      [VOICEBOT_QUEUES.POSTPROCESSORS]: {
        add: postprocessorsAdd,
      },
    });

    const result = await handleCreateTasksPostprocessingJob({
      session_id: sessionId.toString(),
    });

    expect(result).toMatchObject({
      ok: true,
      skipped: true,
      reason: 'categorization_pending',
      requeued: true,
      session_id: sessionId.toString(),
    });

    expect(handleCreateTasksFromChunksJobMock).not.toHaveBeenCalled();
    expect(postprocessorsAdd).toHaveBeenCalledWith(
      VOICEBOT_JOBS.postprocessing.CREATE_TASKS,
      expect.objectContaining({ session_id: sessionId.toString() }),
      expect.objectContaining({ delay: 60_000 })
    );
  });

  it('delegates to createTasksFromChunks and emits SESSION_TASKS_CREATED notify on success', async () => {
    const sessionId = new ObjectId();
    const sessionsFindOne = jest.fn(async () => ({ _id: sessionId }));
    const sessionsUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
    const messagesFind = jest.fn(() => ({
      sort: () => ({
        toArray: async () => [
          {
            _id: new ObjectId(),
            session_id: sessionId,
            categorization: [{ text: 'first' }, { text: 'second' }],
          },
        ],
      }),
    }));
    const notifiesAdd = jest.fn(async () => ({ id: 'notify-job' }));

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
      [VOICEBOT_QUEUES.NOTIFIES]: {
        add: notifiesAdd,
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

    expect(result).toMatchObject({
      ok: true,
      session_id: sessionId.toString(),
      tasks_count: 2,
    });

    expect(handleCreateTasksFromChunksJobMock).toHaveBeenCalledWith(
      expect.objectContaining({
        session_id: sessionId.toString(),
        chunks_to_process: [{ text: 'first' }, { text: 'second' }],
      })
    );

    expect(notifiesAdd).toHaveBeenCalledWith(
      VOICEBOT_JOBS.notifies.SESSION_TASKS_CREATED,
      expect.objectContaining({ session_id: sessionId.toString() }),
      expect.objectContaining({ attempts: 1, deduplication: expect.any(Object) })
    );
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

    expect(sessionsUpdateOne).toHaveBeenCalledTimes(1);
    const updatePayload = sessionsUpdateOne.mock.calls[0]?.[1] as Record<string, unknown>;
    const setPayload = (updatePayload.$set as Record<string, unknown>) || {};
    expect(setPayload['processors_data.CREATE_TASKS.is_processed']).toBe(true);
    expect(setPayload['processors_data.CREATE_TASKS.data']).toEqual([]);
  });

  it('audio_merging skips when there are fewer than 2 telegram chunks', async () => {
    const sessionId = new ObjectId();
    const sessionsFindOne = jest.fn(async () => ({ _id: sessionId }));
    const messagesCountDocuments = jest.fn(async () => 1);

    getDbMock.mockReturnValue({
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return { findOne: sessionsFindOne };
        }
        if (name === VOICEBOT_COLLECTIONS.MESSAGES) {
          return { countDocuments: messagesCountDocuments };
        }
        return {};
      },
    });

    const result = await handleAudioMergingJob({
      session_id: sessionId.toString(),
    });

    expect(result).toMatchObject({
      ok: true,
      skipped: true,
      reason: 'not_enough_telegram_voice_chunks',
      telegram_chunks: 1,
      session_id: sessionId.toString(),
    });
  });

  it('audio_merging reports transport unavailable when telegram merge inputs exist', async () => {
    const sessionId = new ObjectId();
    const sessionsFindOne = jest.fn(async () => ({ _id: sessionId }));
    const messagesCountDocuments = jest.fn(async () => 3);

    getDbMock.mockReturnValue({
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return { findOne: sessionsFindOne };
        }
        if (name === VOICEBOT_COLLECTIONS.MESSAGES) {
          return { countDocuments: messagesCountDocuments };
        }
        return {};
      },
    });

    const result = await handleAudioMergingJob({
      session_id: sessionId.toString(),
    });

    expect(result).toMatchObject({
      ok: true,
      skipped: true,
      reason: 'telegram_merge_transport_unavailable',
      telegram_chunks: 3,
      session_id: sessionId.toString(),
    });
  });

  it('manifest includes AUDIO_MERGING and CREATE_TASKS postprocessing bindings', () => {
    expect(VOICEBOT_WORKER_MANIFEST[VOICEBOT_JOBS.postprocessing.AUDIO_MERGING]).toBeDefined();
    expect(VOICEBOT_WORKER_MANIFEST[VOICEBOT_JOBS.postprocessing.CREATE_TASKS]).toBeDefined();
  });
});
