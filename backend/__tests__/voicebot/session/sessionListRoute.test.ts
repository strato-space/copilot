import express from 'express';
import request from 'supertest';
import { ObjectId } from 'mongodb';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const getDbMock = jest.fn();
const getRawDbMock = jest.fn();
const getUserPermissionsMock = jest.fn();
const generateDataFilterMock = jest.fn();

const countDocumentsMock = jest.fn();
const aggregateMock = jest.fn();

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

const { COLLECTIONS, VOICEBOT_COLLECTIONS } = await import('../../../src/constants.js');
const { default: sessionsRouter } = await import('../../../src/api/routes/voicebot/sessions.js');

const performerId = new ObjectId('507f1f77bcf86cd799439011');
const sessionId = new ObjectId('507f1f77bcf86cd799439012');
const sessionRef = `https://copilot.stratospace.fun/voice/session/${sessionId.toHexString()}`;

const buildApp = (): express.Express => {
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

describe('Voicebot sessions list route', () => {
  beforeEach(() => {
    getDbMock.mockReset();
    getRawDbMock.mockReset();
    getUserPermissionsMock.mockReset();
    generateDataFilterMock.mockReset();
    countDocumentsMock.mockReset();
    aggregateMock.mockReset();

    aggregateMock.mockReturnValue({
      toArray: async () => [
        {
          _id: sessionId,
          chat_id: 123456,
          session_name: 'List Session',
          message_count: 5,
          is_active: true,
          is_deleted: false,
        },
      ],
    });

    countDocumentsMock
      .mockResolvedValueOnce(4)
      .mockResolvedValueOnce(3);

    const dbStub = {
      collection: (name: string) => {
        if (name === COLLECTIONS.TASKS) {
          return {
            countDocuments: countDocumentsMock,
          };
        }
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return {
            aggregate: aggregateMock,
          };
        }
        return {
          countDocuments: jest.fn(async () => 0),
          aggregate: jest.fn(() => ({ toArray: async () => [] })),
          findOne: jest.fn(async () => null),
        };
      },
    };

    getDbMock.mockReturnValue(dbStub);
    getRawDbMock.mockReturnValue(dbStub);
    generateDataFilterMock.mockResolvedValue({});
  });

  it('returns task and codex counts for sessions list rows', async () => {
    const app = buildApp();
    const response = await request(app)
      .post('/voicebot/list')
      .send({});

    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      expect.objectContaining({
        _id: sessionId.toHexString(),
        session_name: 'List Session',
        message_count: 5,
        tasks_count: 4,
        codex_count: 3,
      }),
    ]);

    expect(countDocumentsMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        is_deleted: { $ne: true },
        codex_task: { $ne: true },
        $and: expect.any(Array),
      })
    );
    expect(countDocumentsMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        is_deleted: { $ne: true },
        codex_task: true,
        external_ref: sessionRef,
      })
    );
  });
});
