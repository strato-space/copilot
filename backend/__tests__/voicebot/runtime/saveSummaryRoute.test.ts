import express from 'express';
import request from 'supertest';
import { ObjectId } from 'mongodb';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const getDbMock = jest.fn();
const getRawDbMock = jest.fn();
const getUserPermissionsMock = jest.fn();
const generateDataFilterMock = jest.fn();

jest.unstable_mockModule('../../../src/services/db.js', () => ({
  getDb: getDbMock,
  getRawDb: getRawDbMock,
}));

jest.unstable_mockModule('../../../src/permissions/permission-manager.js', () => ({
  PermissionManager: {
    getUserPermissions: getUserPermissionsMock,
    generateDataFilter: generateDataFilterMock,
    requirePermission: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
  },
}));

const { PERMISSIONS } = await import('../../../src/permissions/permissions-config.js');
const { VOICEBOT_COLLECTIONS } = await import('../../../src/constants.js');
const { default: sessionsRouter } = await import('../../../src/api/routes/voicebot/sessions.js');

const performerId = new ObjectId('507f1f77bcf86cd799439011');

const extractQueryObjectId = (query: unknown): ObjectId | null => {
  if (!query || typeof query !== 'object') return null;
  const record = query as Record<string, unknown>;
  if (record._id instanceof ObjectId) return record._id;
  if (Array.isArray(record.$and)) {
    for (const part of record.$and) {
      const nested = extractQueryObjectId(part);
      if (nested) return nested;
    }
  }
  return null;
};

const buildFixture = () => {
  const sessionId = new ObjectId();
  const sessionDoc: Record<string, unknown> = {
    _id: sessionId,
    chat_id: Number('123456'),
    user_id: performerId.toHexString(),
    is_deleted: false,
    session_name: 'Summary Session',
    participants: [],
    allowed_users: [],
  };

  const insertedLogs: Array<Record<string, unknown>> = [];
  const sessionUpdateOne = jest.fn(async (query: unknown, update: unknown) => {
    const queryId = extractQueryObjectId(query);
    if (!(queryId instanceof ObjectId) || !queryId.equals(sessionId)) {
      return { matchedCount: 0, modifiedCount: 0 };
    }

    const updateRecord = update && typeof update === 'object' ? update as Record<string, unknown> : {};
    const setPayload = updateRecord.$set && typeof updateRecord.$set === 'object'
      ? updateRecord.$set as Record<string, unknown>
      : {};
    Object.assign(sessionDoc, setPayload);
    return { matchedCount: 1, modifiedCount: 1 };
  });

  const sessionFindOne = jest.fn(async (query: unknown) => {
    const queryId = extractQueryObjectId(query);
    if (queryId instanceof ObjectId && queryId.equals(sessionId)) {
      return { ...sessionDoc };
    }
    return null;
  });

  const sessionLogInsertOne = jest.fn(async (doc: Record<string, unknown>) => {
    insertedLogs.push(doc);
    return { insertedId: new ObjectId() };
  });

  const defaultCollection = {
    findOne: jest.fn(async () => null),
    find: jest.fn(() => ({ toArray: async () => [] })),
    updateOne: jest.fn(async () => ({ matchedCount: 0, modifiedCount: 0 })),
    insertOne: jest.fn(async () => ({ insertedId: new ObjectId() })),
  };

  const dbStub = {
    collection: (name: string) => {
      if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
        return {
          updateOne: sessionUpdateOne,
          findOne: sessionFindOne,
        };
      }
      if (name === VOICEBOT_COLLECTIONS.SESSION_LOG) {
        return {
          insertOne: sessionLogInsertOne,
        };
      }
      return defaultCollection;
    },
  };

  const rawDbStub = {
    collection: (name: string) => {
      if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
        return {
          findOne: sessionFindOne,
        };
      }
      if (name === VOICEBOT_COLLECTIONS.MESSAGES) {
        return {
          find: jest.fn(() => ({ toArray: async () => [] })),
        };
      }
      return defaultCollection;
    },
  };

  return {
    sessionId,
    sessionDoc,
    insertedLogs,
    sessionUpdateOne,
    sessionLogInsertOne,
    dbStub,
    rawDbStub,
  };
};

const buildApp = (emitMock: jest.Mock) => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const vreq = req as express.Request & {
      performer: Record<string, unknown>;
      user: Record<string, unknown>;
    };
    vreq.performer = {
      _id: performerId,
      telegram_id: '123456',
      projects_access: [],
    };
    vreq.user = {
      userId: performerId.toHexString(),
      email: 'tester@strato.space',
    };
    next();
  });
  app.set('io', {
    of: jest.fn(() => ({
      to: jest.fn(() => ({ emit: emitMock })),
    })),
  });
  app.use('/voicebot', sessionsRouter);
  return app;
};

describe('POST /voicebot/save_summary', () => {
  beforeEach(() => {
    getDbMock.mockReset();
    getRawDbMock.mockReset();
    getUserPermissionsMock.mockReset();
    generateDataFilterMock.mockReset();

    getUserPermissionsMock.mockResolvedValue([
      PERMISSIONS.VOICEBOT_SESSIONS.READ_ALL,
      PERMISSIONS.VOICEBOT_SESSIONS.UPDATE,
    ]);
    generateDataFilterMock.mockResolvedValue({});
  });

  it('validates payload deterministically', async () => {
    const fixture = buildFixture();
    getDbMock.mockReturnValue(fixture.dbStub);
    getRawDbMock.mockReturnValue(fixture.rawDbStub);
    const app = buildApp(jest.fn());

    const missingSessionResponse = await request(app)
      .post('/voicebot/save_summary')
      .send({});
    expect(missingSessionResponse.status).toBe(400);
    expect(missingSessionResponse.body.error).toBe('session_id is required');

    const missingMdResponse = await request(app)
      .post('/voicebot/save_summary')
      .send({ session_id: fixture.sessionId.toHexString() });
    expect(missingMdResponse.status).toBe(400);
    expect(missingMdResponse.body.error).toBe('md_text is required');

    const nonStringMdResponse = await request(app)
      .post('/voicebot/save_summary')
      .send({ session_id: fixture.sessionId.toHexString(), md_text: { value: 'bad' } });
    expect(nonStringMdResponse.status).toBe(400);
    expect(nonStringMdResponse.body.error).toBe('md_text must be a string');

    const tooLongResponse = await request(app)
      .post('/voicebot/save_summary')
      .send({ session_id: fixture.sessionId.toHexString(), md_text: 'x'.repeat(20001) });
    expect(tooLongResponse.status).toBe(400);
    expect(tooLongResponse.body.error).toBe('md_text exceeds 20000 characters');

    const invalidSessionIdResponse = await request(app)
      .post('/voicebot/save_summary')
      .send({ session_id: 'bad-session-id', md_text: 'text' });
    expect(invalidSessionIdResponse.status).toBe(400);
    expect(invalidSessionIdResponse.body.error).toBe('invalid_session_id');
  });

  it('persists summary, logs summary_save, emits realtime refresh hint, and returns summary on session fetch', async () => {
    const fixture = buildFixture();
    getDbMock.mockReturnValue(fixture.dbStub);
    getRawDbMock.mockReturnValue(fixture.rawDbStub);

    const emitMock = jest.fn();
    const app = buildApp(emitMock);
    const mdText = '## Session Summary\n- item 1\n- item 2';

    const saveResponse = await request(app)
      .post('/voicebot/save_summary')
      .send({ session_id: fixture.sessionId.toHexString(), md_text: mdText });

    expect(saveResponse.status).toBe(200);
    expect(saveResponse.body).toEqual(
      expect.objectContaining({
        success: true,
        session_id: fixture.sessionId.toHexString(),
        summary: expect.objectContaining({
          md_text: mdText,
          updated_at: expect.any(String),
        }),
        summary_event_oid: expect.any(String),
      })
    );

    expect(fixture.sessionUpdateOne).toHaveBeenCalledWith(
      expect.objectContaining({
        $and: expect.arrayContaining([
          expect.objectContaining({ _id: fixture.sessionId }),
        ]),
      }),
      expect.objectContaining({
        $set: expect.objectContaining({
          summary_md_text: mdText,
          summary_saved_at: expect.any(Date),
          updated_at: expect.any(Date),
        }),
      })
    );

    expect(fixture.sessionLogInsertOne).toHaveBeenCalledTimes(1);
    expect(fixture.insertedLogs[0]?.event_name).toBe('summary_save');
    expect(fixture.insertedLogs[0]?.metadata).toEqual(
      expect.objectContaining({
        summary_field: 'summary_md_text',
        summary_chars: mdText.length,
      })
    );

    expect(emitMock).toHaveBeenCalledWith(
      'session_update',
      expect.objectContaining({
        _id: fixture.sessionId.toHexString(),
        session_id: fixture.sessionId.toHexString(),
        taskflow_refresh: expect.objectContaining({
          reason: 'save_summary',
          summary: true,
        }),
      })
    );

    const getResponse = await request(app)
      .post('/voicebot/get')
      .send({ session_id: fixture.sessionId.toHexString() });

    expect(getResponse.status).toBe(200);
    expect(getResponse.body?.voice_bot_session?.summary_md_text).toBe(mdText);

    const clearResponse = await request(app)
      .post('/voicebot/save_summary')
      .send({ session_id: fixture.sessionId.toHexString(), md_text: '' });
    expect(clearResponse.status).toBe(200);
    expect(clearResponse.body?.summary?.md_text).toBe('');
  });
});
