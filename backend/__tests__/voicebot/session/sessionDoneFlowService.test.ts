import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ObjectId } from 'mongodb';

import { VOICEBOT_COLLECTIONS, VOICEBOT_JOBS, VOICEBOT_QUEUES } from '../../../src/constants.js';

const getDbMock = jest.fn();
const buildDoneNotifyPreviewMock = jest.fn();
const writeDoneNotifyRequestedLogMock = jest.fn();
const clearActiveVoiceSessionBySessionIdMock = jest.fn();
const clearActiveVoiceSessionForUserMock = jest.fn();

jest.unstable_mockModule('../../../src/services/db.js', () => ({
  getDb: getDbMock,
}));

jest.unstable_mockModule('../../../src/services/voicebot/voicebotDoneNotify.js', () => ({
  buildDoneNotifyPreview: buildDoneNotifyPreviewMock,
  writeDoneNotifyRequestedLog: writeDoneNotifyRequestedLogMock,
}));

jest.unstable_mockModule('../../../src/voicebot_tgbot/activeSessionMapping.js', () => ({
  clearActiveVoiceSessionBySessionId: clearActiveVoiceSessionBySessionIdMock,
  clearActiveVoiceSessionForUser: clearActiveVoiceSessionForUserMock,
}));

const { completeSessionDoneFlow } = await import('../../../src/services/voicebotSessionDoneFlow.js');

const buildDb = ({
  session,
  sessionsUpdateOne,
}: {
  session: Record<string, unknown> | null;
  sessionsUpdateOne?: jest.Mock;
}) => {
  const sessionFindOne = jest.fn(async () => (session ? { ...session } : null));
  const updateOne = sessionsUpdateOne ?? jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
  const tgUpdateMany = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));

  const db = {
    collection: (name: string) => {
      if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
        return {
          findOne: sessionFindOne,
          updateOne,
        };
      }
      if (name === VOICEBOT_COLLECTIONS.TG_VOICE_SESSIONS) {
        return {
          updateMany: tgUpdateMany,
        };
      }
      return {
        insertOne: jest.fn(async () => ({ insertedId: new ObjectId() })),
      };
    },
  };

  return {
    db,
    sessionFindOne,
    updateOne,
    tgUpdateMany,
  };
};

describe('completeSessionDoneFlow summary correlation/idempotency', () => {
  beforeEach(() => {
    getDbMock.mockReset();
    buildDoneNotifyPreviewMock.mockReset();
    writeDoneNotifyRequestedLogMock.mockReset();
    clearActiveVoiceSessionBySessionIdMock.mockReset();
    clearActiveVoiceSessionForUserMock.mockReset();

    buildDoneNotifyPreviewMock.mockResolvedValue({
      event_name: 'Сессия завершена',
      telegram_message: 'line1\nline2\nline3\nline4',
    });
    writeDoneNotifyRequestedLogMock.mockResolvedValue({});
    clearActiveVoiceSessionBySessionIdMock.mockResolvedValue(undefined);
    clearActiveVoiceSessionForUserMock.mockResolvedValue(undefined);
  });

  it('generates and propagates summary_correlation_id to DONE_MULTIPROMPT payload', async () => {
    const sessionId = new ObjectId();
    const session = {
      _id: sessionId,
      chat_id: 777,
      is_active: true,
      to_finalize: false,
    };
    const dbFixture = buildDb({ session });
    const commonAdd = jest.fn(async () => ({ id: 'job-1' }));

    const result = await completeSessionDoneFlow({
      session_id: sessionId.toHexString(),
      db: dbFixture.db as any,
      queues: {
        [VOICEBOT_QUEUES.COMMON]: { add: commonAdd },
      },
      telegram_user_id: '777',
    });

    expect(result.ok).toBe(true);
    expect(result.summary_correlation_id).toEqual(expect.any(String));

    expect(dbFixture.updateOne).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        $set: expect.objectContaining({
          summary_correlation_id: result.summary_correlation_id,
        }),
        $inc: expect.objectContaining({ done_count: 1 }),
      })
    );

    expect(commonAdd).toHaveBeenCalledWith(
      VOICEBOT_JOBS.common.DONE_MULTIPROMPT,
      expect.objectContaining({
        session_id: sessionId.toHexString(),
        summary_correlation_id: result.summary_correlation_id,
        already_closed: true,
      })
    );
  });

  it('reuses existing summary_correlation_id for already-closed sessions without another close update', async () => {
    const sessionId = new ObjectId();
    const existingCorrelation = 'corr-existing';
    const session = {
      _id: sessionId,
      chat_id: 888,
      is_active: false,
      to_finalize: true,
      done_at: new Date(),
      summary_correlation_id: existingCorrelation,
    };
    const closeUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
    const dbFixture = buildDb({
      session,
      sessionsUpdateOne: closeUpdateOne,
    });
    const commonAdd = jest.fn(async () => ({ id: 'job-2' }));

    const result = await completeSessionDoneFlow({
      session_id: sessionId.toHexString(),
      db: dbFixture.db as any,
      queues: {
        [VOICEBOT_QUEUES.COMMON]: { add: commonAdd },
      },
      telegram_user_id: '888',
    });

    expect(result.ok).toBe(true);
    expect(result.summary_correlation_id).toBe(existingCorrelation);

    expect(closeUpdateOne).not.toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        $inc: expect.objectContaining({ done_count: 1 }),
      })
    );

    expect(commonAdd).toHaveBeenCalledWith(
      VOICEBOT_JOBS.common.DONE_MULTIPROMPT,
      expect.objectContaining({
        summary_correlation_id: existingCorrelation,
      })
    );
  });
});
