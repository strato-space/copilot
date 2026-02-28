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

const tasksFindMock = jest.fn();
const tasksSortMock = jest.fn();
const tasksToArrayMock = jest.fn();

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
const { COLLECTIONS, VOICEBOT_COLLECTIONS } = await import('../../../src/constants.js');
const { default: sessionsRouter } = await import('../../../src/api/routes/voicebot/sessions.js');

const performerId = new ObjectId('507f1f77bcf86cd799439011');
const sessionId = new ObjectId('507f1f77bcf86cd799439012');
const externalRef = `https://copilot.stratospace.fun/voice/session/${sessionId.toHexString()}`;

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

describe('Voicebot codex_tasks route', () => {
  beforeEach(() => {
    getDbMock.mockReset();
    getRawDbMock.mockReset();
    getUserPermissionsMock.mockReset();
    generateDataFilterMock.mockReset();
    requirePermissionMock.mockClear();
    tasksFindMock.mockReset();
    tasksSortMock.mockReset();
    tasksToArrayMock.mockReset();

    const sessionDoc = {
      _id: sessionId,
      chat_id: 123456,
      user_id: performerId,
      is_active: true,
      access_level: 'private',
    };

    tasksToArrayMock.mockResolvedValue([]);
    tasksSortMock.mockReturnValue({ toArray: tasksToArrayMock });
    tasksFindMock.mockReturnValue({ sort: tasksSortMock });

    const dbStub = {
      collection: (name: string) => {
        if (name === COLLECTIONS.TASKS) {
          return {
            find: tasksFindMock,
          };
        }
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return {
            findOne: jest.fn(async () => sessionDoc),
          };
        }
        return {
          findOne: jest.fn(async () => null),
          find: jest.fn(() => ({ toArray: async () => [] })),
        };
      },
    };

    const rawDbStub = {
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
    getRawDbMock.mockReturnValue(rawDbStub);
    getUserPermissionsMock.mockResolvedValue([
      PERMISSIONS.VOICEBOT_SESSIONS.READ_ALL,
      PERMISSIONS.VOICEBOT_SESSIONS.UPDATE,
    ]);
    generateDataFilterMock.mockResolvedValue({});
  });

  it('returns codex tasks linked by canonical external_ref in newest-first order', async () => {
    tasksToArrayMock.mockResolvedValue([
      {
        _id: new ObjectId('507f1f77bcf86cd799439015'),
        id: 'copilot-bbb2',
        name: 'Second',
        description: 'Older task',
        task_status: 'ARCHIVE',
        priority: 'P2',
        codex_review_state: 'deferred',
        external_ref: externalRef,
        dependencies_from_ai: ['copilot-prev-a', 'copilot-prev-b'],
        created_at: new Date('2026-02-28T01:00:00.000Z'),
        updated_at: new Date('2026-02-28T01:01:00.000Z'),
      },
      {
        _id: new ObjectId('507f1f77bcf86cd799439014'),
        id: 'copilot-aaa1',
        name: 'First',
        description: 'Newest task',
        task_status: 'READY_10',
        priority: 'P1',
        codex_review_state: 'deferred',
        external_ref: externalRef,
        issue_type: 'feature',
        assignee: 'vp',
        owner: 'vp@strato.space',
        created_by: '507f1f77bcf86cd799439011',
        created_by_name: 'vp',
        source_kind: 'voice_session',
        source_ref: sessionId.toHexString(),
        labels: ['voice-operops-codex', 'wave-b-tabs'],
        dependencies: [{ id: 'copilot-c1xj', title: 'Blocks codex tab listing' }],
        notes: 'Deferred review queued',
        created_at: new Date('2026-02-28T02:00:00.000Z'),
        updated_at: new Date('2026-02-28T02:01:00.000Z'),
      },
    ]);

    const app = buildApp();
    const response = await request(app)
      .post('/voicebot/codex_tasks')
      .send({ session_id: sessionId.toHexString() });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'copilot-aaa1',
          external_ref: externalRef,
          issue_type: 'feature',
          assignee: 'vp',
          owner: 'vp@strato.space',
          created_by_name: 'vp',
          source_kind: 'voice_session',
          source_ref: sessionId.toHexString(),
          labels: ['voice-operops-codex', 'wave-b-tabs'],
          dependencies: ['copilot-c1xj'],
          notes: 'Deferred review queued',
        }),
        expect.objectContaining({
          id: 'copilot-bbb2',
          task_status: 'ARCHIVE',
          dependencies: ['copilot-prev-a', 'copilot-prev-b'],
        }),
      ])
    );

    expect(tasksFindMock).toHaveBeenCalledWith(
      expect.objectContaining({
        $and: expect.arrayContaining([
          expect.objectContaining({
            external_ref: externalRef,
            is_deleted: { $ne: true },
          }),
        ]),
      }),
      expect.objectContaining({
        projection: expect.objectContaining({
          _id: 1,
          id: 1,
          name: 1,
          task_status: 1,
          created_at: 1,
        }),
      })
    );
    expect(tasksSortMock).toHaveBeenCalledWith({ created_at: -1, _id: -1 });
  });

  it('returns 400 when session_id is missing', async () => {
    const app = buildApp();
    const response = await request(app).post('/voicebot/codex_tasks').send({});

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('session_id is required');
    expect(tasksFindMock).not.toHaveBeenCalled();
  });

  it('returns 403 when user does not have access to the session', async () => {
    getUserPermissionsMock.mockResolvedValue([]);

    const app = buildApp();
    const response = await request(app)
      .post('/voicebot/codex_tasks')
      .send({ session_id: sessionId.toHexString() });

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('Access denied to this session');
    expect(tasksFindMock).not.toHaveBeenCalled();
  });
});
