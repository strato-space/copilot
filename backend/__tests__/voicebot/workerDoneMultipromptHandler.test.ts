import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ObjectId } from 'mongodb';

import { VOICEBOT_COLLECTIONS } from '../../src/constants.js';

const getDbMock = jest.fn();
const buildDoneNotifyPreviewMock = jest.fn();
const writeDoneNotifyRequestedLogMock = jest.fn();

jest.unstable_mockModule('../../src/services/db.js', () => ({
  getDb: getDbMock,
}));

jest.unstable_mockModule('../../src/services/voicebotDoneNotify.js', () => ({
  buildDoneNotifyPreview: buildDoneNotifyPreviewMock,
  writeDoneNotifyRequestedLog: writeDoneNotifyRequestedLogMock,
}));

const { handleDoneMultipromptJob } = await import('../../src/workers/voicebot/handlers/doneMultiprompt.js');

describe('handleDoneMultipromptJob', () => {
  beforeEach(() => {
    getDbMock.mockReset();
    buildDoneNotifyPreviewMock.mockReset();
    writeDoneNotifyRequestedLogMock.mockReset();
    buildDoneNotifyPreviewMock.mockResolvedValue({
      event_name: 'Сессия завершена',
      telegram_message: 'line1\nline2\nline3\nline4',
    });
    writeDoneNotifyRequestedLogMock.mockResolvedValue({});
  });

  it('updates session and writes notify log', async () => {
    const sessionId = new ObjectId();
    const sessionDoc = { _id: sessionId, is_deleted: false };
    const sessionsFindOne = jest.fn(async () => sessionDoc);
    const sessionsUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
    const tgSessionsUpdateMany = jest.fn(async () => ({ matchedCount: 0, modifiedCount: 0 }));

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

    const result = await handleDoneMultipromptJob({
      session_id: sessionId.toString(),
    });

    expect(result.ok).toBe(true);
    expect(sessionsFindOne).toHaveBeenCalledTimes(1);
    expect(sessionsUpdateOne).toHaveBeenCalledTimes(1);
    const [updateQuery] = sessionsUpdateOne.mock.calls[0] as [Record<string, unknown>];
    expect(updateQuery).toHaveProperty('$and');
    expect(tgSessionsUpdateMany).toHaveBeenCalledTimes(1);
    expect(buildDoneNotifyPreviewMock).toHaveBeenCalledTimes(1);
    expect(writeDoneNotifyRequestedLogMock).toHaveBeenCalledTimes(1);
  });
});
