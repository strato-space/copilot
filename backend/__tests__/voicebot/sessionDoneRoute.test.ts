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
const getVoicebotQueuesMock = jest.fn();
const completeSessionDoneFlowMock = jest.fn();

jest.unstable_mockModule('../../src/services/db.js', () => ({
  getDb: getDbMock,
  getRawDb: getRawDbMock,
}));

jest.unstable_mockModule('../../src/permissions/permission-manager.js', () => ({
  PermissionManager: {
    generateDataFilter: generateDataFilterMock,
    getUserPermissions: getUserPermissionsMock,
    requirePermission: requirePermissionMock,
  },
}));

jest.unstable_mockModule('../../src/services/voicebotQueues.js', () => ({
  getVoicebotQueues: getVoicebotQueuesMock,
}));

jest.unstable_mockModule('../../src/services/voicebotSessionDoneFlow.js', () => ({
  completeSessionDoneFlow: completeSessionDoneFlowMock,
}));

const { PERMISSIONS } = await import('../../src/permissions/permissions-config.js');
const { VOICEBOT_COLLECTIONS } = await import('../../src/constants.js');
const { default: sessionsRouter } = await import('../../src/api/routes/voicebot/sessions.js');

const performerId = new ObjectId('507f1f77bcf86cd799439011');
const sessionId = new ObjectId('507f1f77bcf86cd799439012');

const buildApp = () => {
  const emitMock = jest.fn();
  const namespace = {
    to: jest.fn(() => ({ emit: emitMock })),
  };
  const io = {
    of: jest.fn(() => namespace),
  };

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
  app.set('io', io);
  app.use('/voicebot', sessionsRouter);

  return { app, io, namespace, emitMock };
};

describe('Voicebot session_done REST route', () => {
  beforeEach(() => {
    getDbMock.mockReset();
    getRawDbMock.mockReset();
    getUserPermissionsMock.mockReset();
    generateDataFilterMock.mockReset();
    requirePermissionMock.mockClear();
    getVoicebotQueuesMock.mockReset();
    completeSessionDoneFlowMock.mockReset();

    const sessionDoc = {
      _id: sessionId,
      chat_id: 123456,
      user_id: performerId,
      project_id: new ObjectId('507f1f77bcf86cd799439013'),
      session_name: 'REST Done Session',
      is_active: true,
    };

    const dbStub = {
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return {
            findOne: jest.fn(async () => sessionDoc),
          };
        }
        return {
          findOne: jest.fn(async () => null),
        };
      },
    };

    getDbMock.mockReturnValue(dbStub);
    getRawDbMock.mockReturnValue(dbStub);
    getUserPermissionsMock.mockResolvedValue([
      PERMISSIONS.VOICEBOT_SESSIONS.READ_ALL,
      PERMISSIONS.VOICEBOT_SESSIONS.UPDATE,
    ]);
    generateDataFilterMock.mockResolvedValue({});
    getVoicebotQueuesMock.mockReturnValue(null);

    completeSessionDoneFlowMock.mockImplementation(async (params: Record<string, unknown>) => {
      const emitSessionStatus = params.emitSessionStatus as
        | ((payload: { session_id: string; status: string; timestamp: number }) => Promise<void> | void)
        | undefined;
      await emitSessionStatus?.({
        session_id: String(params.session_id || ''),
        status: 'done_queued',
        timestamp: Date.now(),
      });
      return {
        ok: true,
        notify_preview: {
          event_name: 'Сессия завершена',
        },
      };
    });
  });

  it('POST /voicebot/session_done closes session via done-flow and emits realtime updates', async () => {
    const { app, emitMock } = buildApp();
    const response = await request(app)
      .post('/voicebot/session_done')
      .send({ session_id: sessionId.toHexString() });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(
      expect.objectContaining({
        success: true,
        notify_preview: {
          event_name: 'Сессия завершена',
        },
      })
    );

    expect(completeSessionDoneFlowMock).toHaveBeenCalledWith(
      expect.objectContaining({
        session_id: sessionId.toHexString(),
        source: expect.objectContaining({
          type: 'rest',
          route: '/api/voicebot/session_done',
        }),
        actor: expect.objectContaining({ kind: 'user' }),
      })
    );

    expect(emitMock).toHaveBeenCalledWith(
      'session_status',
      expect.objectContaining({
        session_id: sessionId.toHexString(),
        status: 'done_queued',
      })
    );
    expect(emitMock).toHaveBeenCalledWith(
      'session_update',
      expect.objectContaining({
        _id: sessionId.toHexString(),
        session_id: sessionId.toHexString(),
        is_active: false,
        to_finalize: true,
      })
    );
  });

  it('POST /voicebot/close_session is aliased to the same done route', async () => {
    const { app } = buildApp();
    const response = await request(app)
      .post('/voicebot/close_session')
      .send({ session_id: sessionId.toHexString() });

    expect(response.status).toBe(200);
    expect(completeSessionDoneFlowMock).toHaveBeenCalledTimes(1);
  });

  it('returns 400 for missing session_id payload', async () => {
    const { app } = buildApp();
    const response = await request(app).post('/voicebot/session_done').send({});

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('session_id is required');
    expect(completeSessionDoneFlowMock).not.toHaveBeenCalled();
  });
});
