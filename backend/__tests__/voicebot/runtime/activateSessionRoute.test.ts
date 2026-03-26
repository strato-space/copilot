import express from 'express';
import request from 'supertest';
import { ObjectId } from 'mongodb';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const getDbMock = jest.fn();
const getRawDbMock = jest.fn();
const getUserPermissionsMock = jest.fn();
const generateDataFilterMock = jest.fn();
const requirePermissionMock = jest.fn(
  () =>
    (_req: express.Request, _res: express.Response, next: express.NextFunction) =>
      next()
);

jest.unstable_mockModule('../../../src/services/db.js', () => ({
  getDb: getDbMock,
  getRawDb: getRawDbMock,
}));

jest.unstable_mockModule('../../../src/permissions/permission-manager.js', () => ({
  PermissionManager: {
    requirePermission: requirePermissionMock,
    getUserPermissions: getUserPermissionsMock,
    generateDataFilter: generateDataFilterMock,
  },
}));

const { PERMISSIONS } = await import('../../../src/permissions/permissions-config.js');
const { VOICEBOT_COLLECTIONS } = await import('../../../src/constants.js');
const { default: sessionsRouter } = await import('../../../src/api/routes/voicebot/sessions.js');

const performerId = new ObjectId('507f1f77bcf86cd799439011');
const sessionId = new ObjectId('507f1f77bcf86cd799439012');

const buildApp = () => {
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
  app.use('/voicebot', sessionsRouter);
  return app;
};

const createDbStub = ({
  sessionDoc,
  activeSessionUpdateOneMock,
}: {
  sessionDoc: Record<string, unknown> | null;
  activeSessionUpdateOneMock: jest.Mock;
}) => ({
  collection: (name: string) => {
    if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
      return {
        findOne: jest.fn(async () => sessionDoc),
      };
    }
    if (name === VOICEBOT_COLLECTIONS.TG_VOICE_SESSIONS) {
      return {
        updateOne: activeSessionUpdateOneMock,
      };
    }
    return {
      findOne: jest.fn(async () => null),
      updateOne: jest.fn(async () => ({ matchedCount: 0, modifiedCount: 0 })),
    };
  },
});

describe('POST /voicebot/activate_session', () => {
  beforeEach(() => {
    getDbMock.mockReset();
    getRawDbMock.mockReset();
    getUserPermissionsMock.mockReset();
    generateDataFilterMock.mockReset();
    requirePermissionMock.mockClear();

    getUserPermissionsMock.mockResolvedValue([PERMISSIONS.VOICEBOT_SESSIONS.READ_ALL]);
    generateDataFilterMock.mockResolvedValue({});
  });

  it('activates an active non-finalized session', async () => {
    const activeSessionUpdateOneMock = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
    const sessionDoc = {
      _id: sessionId,
      chat_id: 123456,
      user_id: performerId.toHexString(),
      session_name: 'Current session',
      is_active: true,
      is_finalized: false,
    };
    const dbStub = createDbStub({ sessionDoc, activeSessionUpdateOneMock });
    getDbMock.mockReturnValue(dbStub);
    getRawDbMock.mockReturnValue(dbStub);

    const app = buildApp();
    const response = await request(app)
      .post('/voicebot/activate_session')
      .send({ session_id: sessionId.toHexString() });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(
      expect.objectContaining({
        success: true,
        session_id: sessionId.toHexString(),
        session_name: 'Current session',
        is_active: true,
      })
    );
    expect(activeSessionUpdateOneMock).toHaveBeenCalledTimes(1);
    const [, update] = activeSessionUpdateOneMock.mock.calls[0] as [
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect((update.$set as Record<string, unknown>).active_session_id).toBeInstanceOf(ObjectId);
    expect(((update.$set as Record<string, unknown>).active_session_id as ObjectId).toHexString()).toBe(
      sessionId.toHexString()
    );
  });

  it('rejects inactive sessions with 409 session_inactive', async () => {
    const activeSessionUpdateOneMock = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
    const sessionDoc = {
      _id: sessionId,
      chat_id: 123456,
      user_id: performerId.toHexString(),
      session_name: 'Closed session',
      is_active: false,
      is_finalized: false,
    };
    const dbStub = createDbStub({ sessionDoc, activeSessionUpdateOneMock });
    getDbMock.mockReturnValue(dbStub);
    getRawDbMock.mockReturnValue(dbStub);

    const app = buildApp();
    const response = await request(app)
      .post('/voicebot/activate_session')
      .send({ session_id: sessionId.toHexString() });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: 'session_inactive' });
    expect(activeSessionUpdateOneMock).not.toHaveBeenCalled();
  });

  it('rejects finalized sessions with 409 session_inactive', async () => {
    const activeSessionUpdateOneMock = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
    const sessionDoc = {
      _id: sessionId,
      chat_id: 123456,
      user_id: performerId.toHexString(),
      session_name: 'Finalized session',
      is_active: true,
      is_finalized: true,
    };
    const dbStub = createDbStub({ sessionDoc, activeSessionUpdateOneMock });
    getDbMock.mockReturnValue(dbStub);
    getRawDbMock.mockReturnValue(dbStub);

    const app = buildApp();
    const response = await request(app)
      .post('/voicebot/activate_session')
      .send({ session_id: sessionId.toHexString() });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: 'session_inactive' });
    expect(activeSessionUpdateOneMock).not.toHaveBeenCalled();
  });
});
