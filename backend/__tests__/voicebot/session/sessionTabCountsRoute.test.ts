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

const tasksCountDocumentsMock = jest.fn();
const tasksAggregateMock = jest.fn();

jest.unstable_mockModule('../../../src/services/db.js', () => ({
  getDb: getDbMock,
  getRawDb: getRawDbMock,
}));

jest.unstable_mockModule('../../../src/permissions/permission-manager.js', () => ({
  PermissionManager: {
    getUserPermissions: getUserPermissionsMock,
    generateDataFilter: generateDataFilterMock,
    requirePermission: requirePermissionMock,
  },
}));

const { PERMISSIONS } = await import('../../../src/permissions/permissions-config.js');
const { COLLECTIONS, VOICEBOT_COLLECTIONS, TASK_STATUSES } = await import('../../../src/constants.js');
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

describe('Voicebot session_tab_counts route', () => {
  beforeEach(() => {
    getDbMock.mockReset();
    getRawDbMock.mockReset();
    getUserPermissionsMock.mockReset();
    generateDataFilterMock.mockReset();
    requirePermissionMock.mockClear();
    tasksCountDocumentsMock.mockReset();
    tasksAggregateMock.mockReset();

    const sessionDoc = {
      _id: sessionId,
      chat_id: 123456,
      user_id: performerId,
      is_active: true,
      access_level: 'private',
      source_ref: `https://copilot.stratospace.fun/voice/session/${sessionId.toHexString()}`,
    };

    tasksAggregateMock.mockReturnValue({
      toArray: async () => [
        { _id: TASK_STATUSES.NEW_0, count: 4 },
        { _id: TASK_STATUSES.READY_10, count: 7 },
        { _id: TASK_STATUSES.REVIEW_10, count: 3 },
      ],
    });
    tasksCountDocumentsMock.mockResolvedValueOnce(3);

    const dbStub = {
      collection: (name: string) => {
        if (name === COLLECTIONS.TASKS) {
          return {
            countDocuments: tasksCountDocumentsMock,
            aggregate: tasksAggregateMock,
          };
        }
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
  });

  it('returns task and codex counts for the current session scope', async () => {
    const app = buildApp();
    const response = await request(app)
      .post('/voicebot/session_tab_counts')
      .send({ session_id: sessionId.toHexString() });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      session_id: sessionId.toHexString(),
      tasks_count: 14,
      tasks_work_count: 7,
      tasks_review_count: 3,
      codex_count: 3,
      status_counts: [
        { status: TASK_STATUSES.NEW_0, count: 4 },
        { status: TASK_STATUSES.READY_10, count: 7 },
        { status: TASK_STATUSES.REVIEW_10, count: 3 },
      ],
    });

    expect(tasksAggregateMock).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          $match: expect.objectContaining({
            is_deleted: { $ne: true },
            codex_task: { $ne: true },
          }),
        }),
        expect.objectContaining({
          $group: expect.objectContaining({
            _id: '$task_status',
          }),
        }),
      ])
    );
    expect(tasksCountDocumentsMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        is_deleted: { $ne: true },
        codex_task: true,
        external_ref: `https://copilot.stratospace.fun/voice/session/${sessionId.toHexString()}`,
      })
    );
  });
});
