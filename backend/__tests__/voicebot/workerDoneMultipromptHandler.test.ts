import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ObjectId } from 'mongodb';

import {
  VOICEBOT_COLLECTIONS,
  VOICEBOT_JOBS,
  VOICEBOT_QUEUES,
} from '../../src/constants.js';

const getDbMock = jest.fn();
const getVoicebotQueuesMock = jest.fn();
const buildDoneNotifyPreviewMock = jest.fn();
const writeDoneNotifyRequestedLogMock = jest.fn();

jest.unstable_mockModule('../../src/services/db.js', () => ({
  getDb: getDbMock,
}));

jest.unstable_mockModule('../../src/services/voicebotQueues.js', () => ({
  getVoicebotQueues: getVoicebotQueuesMock,
}));

jest.unstable_mockModule('../../src/services/voicebotDoneNotify.js', () => ({
  buildDoneNotifyPreview: buildDoneNotifyPreviewMock,
  writeDoneNotifyRequestedLog: writeDoneNotifyRequestedLogMock,
}));

const { handleDoneMultipromptJob } = await import('../../src/workers/voicebot/handlers/doneMultiprompt.js');

describe('handleDoneMultipromptJob', () => {
  beforeEach(() => {
    getDbMock.mockReset();
    getVoicebotQueuesMock.mockReset();
    buildDoneNotifyPreviewMock.mockReset();
    writeDoneNotifyRequestedLogMock.mockReset();

    buildDoneNotifyPreviewMock.mockResolvedValue({
      event_name: 'Сессия завершена',
      telegram_message: 'line1\nline2\nline3\nline4',
    });
    writeDoneNotifyRequestedLogMock.mockResolvedValue({});
  });

  it('updates session, enqueues postprocessing/notify jobs and writes notify log', async () => {
    const sessionId = new ObjectId();
    const sessionDoc = { _id: sessionId, is_deleted: false };
    const sessionsFindOne = jest.fn(async () => sessionDoc);
    const sessionsUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
    const tgSessionsUpdateMany = jest.fn(async () => ({ matchedCount: 0, modifiedCount: 0 }));
    const postprocessorsAdd = jest.fn(async () => ({ id: 'post-job' }));
    const notifiesAdd = jest.fn(async () => ({ id: 'notify-job' }));

    getDbMock.mockReturnValue({
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return {
            findOne: sessionsFindOne,
            updateOne: sessionsUpdateOne,
          };
        }
        if (name === VOICEBOT_COLLECTIONS.TG_VOICE_SESSIONS) {
          return {
            updateMany: tgSessionsUpdateMany,
          };
        }
        return {};
      },
    });

    getVoicebotQueuesMock.mockReturnValue({
      [VOICEBOT_QUEUES.POSTPROCESSORS]: {
        add: postprocessorsAdd,
      },
      [VOICEBOT_QUEUES.NOTIFIES]: {
        add: notifiesAdd,
      },
    });

    const result = await handleDoneMultipromptJob({
      session_id: sessionId.toString(),
    });

    expect(result.ok).toBe(true);
    expect(sessionsFindOne).toHaveBeenCalledTimes(1);
    expect(sessionsUpdateOne).toHaveBeenCalledTimes(1);
    const [updateQuery] = sessionsUpdateOne.mock.calls[0] as [Record<string, unknown>];
    expect(updateQuery).toHaveProperty('$and');
    expect(tgSessionsUpdateMany).toHaveBeenCalledTimes(1);

    expect(postprocessorsAdd).toHaveBeenCalledTimes(3);
    expect(postprocessorsAdd.mock.calls[0]?.[0]).toBe(VOICEBOT_JOBS.postprocessing.ALL_CUSTOM_PROMPTS);
    expect(postprocessorsAdd.mock.calls[1]?.[0]).toBe(VOICEBOT_JOBS.postprocessing.AUDIO_MERGING);
    expect(postprocessorsAdd.mock.calls[2]?.[0]).toBe(VOICEBOT_JOBS.postprocessing.CREATE_TASKS);

    expect(notifiesAdd).toHaveBeenCalledWith(
      VOICEBOT_JOBS.notifies.SESSION_DONE,
      expect.objectContaining({ session_id: sessionId.toString() }),
      expect.objectContaining({ attempts: 1 })
    );

    expect(buildDoneNotifyPreviewMock).toHaveBeenCalledTimes(1);
    expect(writeDoneNotifyRequestedLogMock).toHaveBeenCalledTimes(1);
  });

  it('enqueues SESSION_READY_TO_SUMMARIZE when closed session has project_id', async () => {
    const sessionId = new ObjectId();
    const projectId = new ObjectId();
    const sessionDoc = { _id: sessionId, is_deleted: false, project_id: projectId };
    const sessionsFindOne = jest.fn(async () => sessionDoc);
    const sessionsUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
    const tgSessionsUpdateMany = jest.fn(async () => ({ matchedCount: 0, modifiedCount: 0 }));
    const sessionLogInsertOne = jest.fn(async () => ({ insertedId: new ObjectId() }));
    const postprocessorsAdd = jest.fn(async () => ({ id: 'post-job' }));
    const notifiesAdd = jest.fn(async () => ({ id: 'notify-job' }));

    getDbMock.mockReturnValue({
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return {
            findOne: sessionsFindOne,
            updateOne: sessionsUpdateOne,
          };
        }
        if (name === VOICEBOT_COLLECTIONS.TG_VOICE_SESSIONS) {
          return {
            updateMany: tgSessionsUpdateMany,
          };
        }
        if (name === VOICEBOT_COLLECTIONS.SESSION_LOG) {
          return {
            insertOne: sessionLogInsertOne,
          };
        }
        return {};
      },
    });

    getVoicebotQueuesMock.mockReturnValue({
      [VOICEBOT_QUEUES.POSTPROCESSORS]: {
        add: postprocessorsAdd,
      },
      [VOICEBOT_QUEUES.NOTIFIES]: {
        add: notifiesAdd,
      },
    });

    const result = await handleDoneMultipromptJob({
      session_id: sessionId.toString(),
    });

    expect(result.ok).toBe(true);
    expect(notifiesAdd).toHaveBeenCalledWith(
      VOICEBOT_JOBS.notifies.SESSION_DONE,
      expect.objectContaining({ session_id: sessionId.toString() }),
      expect.objectContaining({ attempts: 1 })
    );
    expect(notifiesAdd).toHaveBeenCalledWith(
      VOICEBOT_JOBS.notifies.SESSION_READY_TO_SUMMARIZE,
      expect.objectContaining({
        session_id: sessionId.toString(),
        payload: { project_id: projectId.toHexString() },
      }),
      expect.objectContaining({ attempts: 1 })
    );
    expect(sessionLogInsertOne).toHaveBeenCalled();
  });

  it('returns session_not_found for unknown session', async () => {
    const sessionId = new ObjectId();
    const sessionsFindOne = jest.fn(async () => null);

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

    const result = await handleDoneMultipromptJob({
      session_id: sessionId.toString(),
    });

    expect(result).toEqual({ ok: false, error: 'session_not_found' });
  });
});
