import express from 'express';
import request from 'supertest';
import { ObjectId } from 'mongodb';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

process.env.VOICE_RUNTIME_ENV = 'prod';
process.env.VOICE_RUNTIME_SERVER_NAME = 'p2';

const getDbMock = jest.fn();
const getRawDbMock = jest.fn();
const getUserPermissionsMock = jest.fn();
const generateDataFilterMock = jest.fn();

jest.unstable_mockModule('../../src/services/db.js', () => ({
  getDb: getDbMock,
  getRawDb: getRawDbMock,
}));

jest.unstable_mockModule('../../src/permissions/permission-manager.js', () => ({
  PermissionManager: {
    requirePermission: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
    getUserPermissions: getUserPermissionsMock,
    generateDataFilter: generateDataFilterMock,
  },
}));

const { PERMISSIONS } = await import('../../src/permissions/permissions-config.js');
const { COLLECTIONS, TASK_CLASSES, VOICEBOT_COLLECTIONS } = await import('../../src/constants.js');
const { RUNTIME_TAG } = await import('../../src/services/runtimeScope.js');
const { default: sessionsRouter } = await import('../../src/api/routes/voicebot/sessions.js');

const performerId = new ObjectId('507f1f77bcf86cd799439011');

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
    vreq.user = { userId: performerId.toHexString(), email: 'tester@strato.space' };
    next();
  });
  app.use('/voicebot', sessionsRouter);
  return app;
};

const buildDefaultCollection = () => ({
  findOne: jest.fn(async () => null),
  find: jest.fn(() => ({
    sort: () => ({ toArray: async () => [] }),
    project: () => ({ toArray: async () => [] }),
    toArray: async () => [],
  })),
  insertMany: jest.fn(async () => ({ insertedCount: 0 })),
  updateOne: jest.fn(async () => ({ matchedCount: 0, modifiedCount: 0 })),
});

describe('Voicebot utility routes runtime behavior', () => {
  beforeEach(() => {
    getDbMock.mockReset();
    getRawDbMock.mockReset();
    getUserPermissionsMock.mockReset();
    generateDataFilterMock.mockReset();

    getUserPermissionsMock.mockResolvedValue([
      PERMISSIONS.VOICEBOT_SESSIONS.READ_ALL,
      PERMISSIONS.PROJECTS.READ_ALL,
    ]);
    generateDataFilterMock.mockResolvedValue({});
  });

  it('create_tickets writes tasks with runtime_tag', async () => {
    const sessionId = new ObjectId();
    const projectId = new ObjectId();
    const taskPerformerId = new ObjectId();

    const sessionFindOne = jest.fn(async () => ({
      _id: sessionId,
      chat_id: 123456,
      user_id: performerId.toHexString(),
      session_name: 'Runtime test session',
      is_deleted: false,
      runtime_tag: 'prod',
    }));

    const insertManySpy = jest.fn(async (docs: Array<Record<string, unknown>>) => ({ insertedCount: docs.length }));

    const dbStub = {
      collection: (name: string) => {
        if (name === COLLECTIONS.PERFORMERS) {
          return {
            findOne: jest.fn(async () => ({ _id: taskPerformerId, name: 'Assignee' })),
          };
        }
        if (name === COLLECTIONS.TASKS) {
          return {
            findOne: jest.fn(async () => null),
            insertMany: insertManySpy,
          };
        }
        return buildDefaultCollection();
      },
    };

    const rawDbStub = {
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return { findOne: sessionFindOne };
        }
        return buildDefaultCollection();
      },
    };

    getDbMock.mockReturnValue(dbStub);
    getRawDbMock.mockReturnValue(rawDbStub);

    const app = buildApp();
    const response = await request(app)
      .post('/voicebot/create_tickets')
      .send({
        session_id: sessionId.toHexString(),
        tickets: [
          {
            id: 'ticket-1',
            name: 'Implement feature',
            description: 'Details',
            performer_id: taskPerformerId.toHexString(),
            project_id: projectId.toHexString(),
            project: 'Demo project',
          },
        ],
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);

    expect(insertManySpy).toHaveBeenCalledTimes(1);
    const [insertedDocs] = insertManySpy.mock.calls[0] as [Array<Record<string, unknown>>];
    expect(Array.isArray(insertedDocs)).toBe(true);
    expect(insertedDocs).toHaveLength(1);
    expect(insertedDocs[0]?.runtime_tag).toBe(RUNTIME_TAG);
    expect((insertedDocs[0]?.source_data as Record<string, unknown>)?.session_id).toBeInstanceOf(ObjectId);
  });

  it('create_tickets rejects codex assignment when project git_repo is empty', async () => {
    const sessionId = new ObjectId();
    const projectId = new ObjectId();
    const taskPerformerId = new ObjectId();

    const sessionFindOne = jest.fn(async () => ({
      _id: sessionId,
      chat_id: 123456,
      user_id: performerId.toHexString(),
      session_name: 'Runtime test session',
      is_deleted: false,
      runtime_tag: 'prod',
    }));

    const insertManySpy = jest.fn(async (docs: Array<Record<string, unknown>>) => ({ insertedCount: docs.length }));

    const dbStub = {
      collection: (name: string) => {
        if (name === COLLECTIONS.PERFORMERS) {
          return {
            findOne: jest.fn(async () => ({
              _id: taskPerformerId,
              name: 'Codex',
              corporate_email: 'codex@strato.space',
            })),
          };
        }
        if (name === COLLECTIONS.PROJECTS) {
          return {
            findOne: jest.fn(async () => ({
              _id: projectId,
              git_repo: '',
            })),
          };
        }
        if (name === COLLECTIONS.TASKS) {
          return {
            findOne: jest.fn(async () => null),
            insertMany: insertManySpy,
          };
        }
        return buildDefaultCollection();
      },
    };

    const rawDbStub = {
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return { findOne: sessionFindOne };
        }
        return buildDefaultCollection();
      },
    };

    getDbMock.mockReturnValue(dbStub);
    getRawDbMock.mockReturnValue(rawDbStub);

    const app = buildApp();
    const response = await request(app)
      .post('/voicebot/create_tickets')
      .send({
        session_id: sessionId.toHexString(),
        tickets: [
          {
            id: 'ticket-1',
            name: 'Implement feature',
            description: 'Details',
            performer_id: taskPerformerId.toHexString(),
            project_id: projectId.toHexString(),
            project: 'Demo project',
          },
        ],
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Codex assignment requires project git_repo');
    expect(response.body.project_id).toBe(projectId.toHexString());
    expect(insertManySpy).not.toHaveBeenCalled();
  });

  it('task_types reads execution plans with prod-family runtime filter', async () => {
    const rootId = new ObjectId();
    const childId = new ObjectId();
    const planId = new ObjectId();

    const executionFindSpy = jest.fn(() => ({
      toArray: async () => [{ _id: planId, title: 'Plan title' }],
    }));

    const dbStub = {
      collection: (name: string) => {
        if (name === COLLECTIONS.TASK_TYPES_TREE) {
          return {
            find: jest.fn(() => ({
              toArray: async () => [
                {
                  _id: rootId,
                  title: 'Root',
                  type_class: TASK_CLASSES.FUNCTIONALITY,
                },
                {
                  _id: childId,
                  title: 'Child',
                  type_class: 'TASK',
                  parent_type_id: rootId,
                  execution_plan: [planId],
                },
              ],
            })),
          };
        }
        if (name === COLLECTIONS.EXECUTION_PLANS_ITEMS) {
          return { find: executionFindSpy };
        }
        return buildDefaultCollection();
      },
    };

    getDbMock.mockReturnValue(dbStub);
    getRawDbMock.mockReturnValue(dbStub);

    const app = buildApp();
    const response = await request(app).post('/voicebot/task_types').send({});

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body).toHaveLength(1);

    const [query] = executionFindSpy.mock.calls[0] as [Record<string, unknown>];
    expect(query).toEqual({
      $or: [
        { runtime_tag: { $regex: '^prod(?:-|$)' } },
        { runtime_tag: { $exists: false } },
        { runtime_tag: null },
        { runtime_tag: '' },
      ],
    });
  });

  it('topics query applies runtime-family filter', async () => {
    const projectId = new ObjectId();
    const topicsFindSpy = jest.fn(() => ({
      sort: () => ({ toArray: async () => [] }),
    }));

    const dbStub = {
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.TOPICS) {
          return { find: topicsFindSpy };
        }
        if (name === VOICEBOT_COLLECTIONS.PROJECTS) {
          return {
            findOne: jest.fn(async () => ({ _id: projectId, name: 'Demo project' })),
          };
        }
        return buildDefaultCollection();
      },
    };

    getDbMock.mockReturnValue(dbStub);
    getRawDbMock.mockReturnValue(dbStub);

    const app = buildApp();
    const response = await request(app)
      .post('/voicebot/topics')
      .send({ project_id: projectId.toHexString() });

    expect(response.status).toBe(200);
    const [query] = topicsFindSpy.mock.calls[0] as [Record<string, unknown>];
    expect(query).toEqual(
      expect.objectContaining({
        $and: expect.arrayContaining([
          expect.objectContaining({ project_id: projectId }),
          {
            $or: [
              { runtime_tag: { $regex: '^prod(?:-|$)' } },
              { runtime_tag: { $exists: false } },
              { runtime_tag: null },
              { runtime_tag: '' },
            ],
          },
        ]),
      })
    );
  });
});
