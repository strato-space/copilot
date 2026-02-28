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
const createBdIssueMock = jest.fn();

jest.unstable_mockModule('../../src/services/bdClient.js', () => ({
  createBdIssue: createBdIssueMock,
}));

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
const codexPerformerObjectId = new ObjectId('69a2561d642f3a032ad88e7a');

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
  deleteMany: jest.fn(async () => ({ deletedCount: 0 })),
});

describe('Voicebot utility routes runtime behavior', () => {
  beforeEach(() => {
    getDbMock.mockReset();
    getRawDbMock.mockReset();
    getUserPermissionsMock.mockReset();
    generateDataFilterMock.mockReset();
    createBdIssueMock.mockReset();

    getUserPermissionsMock.mockResolvedValue([
      PERMISSIONS.VOICEBOT_SESSIONS.READ_ALL,
      PERMISSIONS.PROJECTS.READ_ALL,
    ]);
    generateDataFilterMock.mockResolvedValue({});
    createBdIssueMock.mockResolvedValue('copilot-codex-bd-id');
    delete process.env.VOICE_WEB_INTERFACE_URL;
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
    const updateOneSpy = jest.fn(async () => ({ matchedCount: 1 }));
    const taskFindOne = jest.fn(async () => null);

    const dbStub = {
      collection: (name: string) => {
        if (name === COLLECTIONS.PERFORMERS) {
          return {
            findOne: jest.fn(async () => ({ _id: taskPerformerId, name: 'Assignee' })),
          };
        }
        if (name === COLLECTIONS.TASKS) {
          return {
            findOne: taskFindOne,
            insertMany: insertManySpy,
            updateOne: updateOneSpy,
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
    createBdIssueMock.mockReset();
    createBdIssueMock.mockResolvedValue('copilot-codex-bd-id');

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

  it('create_tickets keeps valid rows and reports rejected invalid performer ids', async () => {
    const sessionId = new ObjectId();
    const projectId = new ObjectId();
    const validPerformerId = new ObjectId();

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
            findOne: jest.fn(async ({ _id }: { _id: ObjectId }) => (
              _id.toHexString() === validPerformerId.toHexString()
                ? { _id: validPerformerId, name: 'Assignee' }
                : null
            )),
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
            id: 'invalid-performer',
            name: 'Task with malformed performer id',
            description: 'Should fail performer validation',
            performer_id: 'not-an-object-id',
            project_id: projectId.toHexString(),
            project: 'Demo project',
          },
          {
            id: 'valid-task',
            name: 'Task with valid performer id',
            description: 'Should be inserted',
            performer_id: validPerformerId.toHexString(),
            project_id: projectId.toHexString(),
            project: 'Demo project',
          },
        ],
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.insertedCount).toBe(1);
    expect(response.body.rejected_rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ticket_id: 'invalid-performer',
          field: 'performer_id',
          reason: 'invalid_performer_id',
          performer_id: 'not-an-object-id',
        }),
      ])
    );

    expect(insertManySpy).toHaveBeenCalledTimes(1);
    const [insertedDocs] = insertManySpy.mock.calls[0] as [Array<Record<string, unknown>>];
    expect(insertedDocs).toHaveLength(1);
    expect((insertedDocs[0]?.performer_id as ObjectId).toHexString()).toBe(validPerformerId.toHexString());
  });

  it('create_tickets returns row-level invalid_rows details for invalid performer ids', async () => {
    const sessionId = new ObjectId();
    const projectId = new ObjectId();

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
            findOne: jest.fn(async () => null),
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
            id: 'invalid-performer',
            name: 'Task with invalid performer id',
            description: 'Should fail performer validation',
            performer_id: 'not-an-object-id',
            project_id: projectId.toHexString(),
            project: 'Demo project',
          },
        ],
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('No valid tasks to create tickets');
    expect(response.body.invalid_rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ticket_id: 'invalid-performer',
          field: 'performer_id',
          reason: 'invalid_performer_id',
          performer_id: 'not-an-object-id',
        }),
      ])
    );
    expect(insertManySpy).not.toHaveBeenCalled();
  });

  it('create_tickets returns row-level project_id guard error when codex project git_repo is empty', async () => {
    const sessionId = new ObjectId();
    const projectId = new ObjectId();
    const taskPerformerId = codexPerformerObjectId;

    const sessionFindOne = jest.fn(async () => ({
      _id: sessionId,
      chat_id: 123456,
      user_id: performerId.toHexString(),
      session_name: 'Runtime test session',
      is_deleted: false,
      runtime_tag: 'prod',
    }));

    const insertManySpy = jest.fn(async (docs: Array<Record<string, unknown>>) => ({ insertedCount: docs.length }));

    const taskUpdateOneSpy = jest.fn(async () => ({ matchedCount: 1 }));
    const dbStub = {
      collection: (name: string) => {
        if (name === COLLECTIONS.PERFORMERS) {
          return {
            findOne: jest.fn(async () => ({
              _id: taskPerformerId,
              id: 'automation-performer',
              name: 'Automation Bot',
              corporate_email: 'automation-bot@strato.space',
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
            updateOne: taskUpdateOneSpy,
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
    expect(response.body.error).toBe('No valid tasks to create tickets');
    expect(response.body.invalid_rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ticket_id: 'ticket-1',
          field: 'project_id',
          reason: 'codex_project_git_repo_required',
          project_id: projectId.toHexString(),
          performer_id: taskPerformerId.toHexString(),
          message: 'Для задач Codex у проекта должен быть git_repo',
        }),
      ])
    );
    expect(insertManySpy).not.toHaveBeenCalled();
  });

  it('create_tickets keeps valid rows and reports row-level codex project git_repo guard errors', async () => {
    const sessionId = new ObjectId();
    const codexProjectId = new ObjectId();
    const regularProjectId = new ObjectId();
    const codexPerformerId = codexPerformerObjectId;
    const regularPerformerId = new ObjectId();

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
            findOne: jest.fn(async ({ _id }: { _id: ObjectId }) => {
              if (_id.toHexString() === codexPerformerId.toHexString()) {
                return {
                  _id: codexPerformerId,
                  id: 'automation-performer',
                  name: 'Automation Bot',
                  corporate_email: 'automation-bot@strato.space',
                };
              }
              if (_id.toHexString() === regularPerformerId.toHexString()) {
                return {
                  _id: regularPerformerId,
                  name: 'Regular assignee',
                  corporate_email: 'user@strato.space',
                };
              }
              return null;
            }),
          };
        }
        if (name === COLLECTIONS.PROJECTS) {
          return {
            findOne: jest.fn(async ({ _id }: { _id: ObjectId }) => {
              if (_id.toHexString() === codexProjectId.toHexString()) {
                return {
                  _id: codexProjectId,
                  git_repo: '',
                };
              }
              if (_id.toHexString() === regularProjectId.toHexString()) {
                return {
                  _id: regularProjectId,
                  git_repo: 'git@github.com:strato-space/copilot.git',
                };
              }
              return null;
            }),
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
            id: 'codex-row',
            name: 'Codex task',
            description: 'Should fail on git_repo guard',
            performer_id: codexPerformerId.toHexString(),
            project_id: codexProjectId.toHexString(),
            project: 'No repo project',
          },
          {
            id: 'regular-row',
            name: 'Regular task',
            description: 'Should pass',
            performer_id: regularPerformerId.toHexString(),
            project_id: regularProjectId.toHexString(),
            project: 'Repo project',
          },
        ],
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.insertedCount).toBe(1);
    expect(response.body.rejected_rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ticket_id: 'codex-row',
          field: 'project_id',
          reason: 'codex_project_git_repo_required',
          project_id: codexProjectId.toHexString(),
          performer_id: codexPerformerId.toHexString(),
        }),
      ])
    );

    expect(insertManySpy).toHaveBeenCalledTimes(1);
    const [insertedDocs] = insertManySpy.mock.calls[0] as [Array<Record<string, unknown>>];
    expect(insertedDocs).toHaveLength(1);
    expect(String(insertedDocs[0]?.id ?? '')).toContain('regular-row');
    expect((insertedDocs[0]?.performer_id as ObjectId).toHexString()).toBe(regularPerformerId.toHexString());
  });

  it('create_tickets routes canonical codex performer id rows to bd sync without mongo insertMany', async () => {
    const sessionId = new ObjectId();
    const projectId = new ObjectId();
    const taskPerformerId = codexPerformerObjectId;

    const sessionFindOne = jest.fn(async () => ({
      _id: sessionId,
      chat_id: 123456,
      user_id: performerId.toHexString(),
      session_name: 'Runtime test session',
      is_deleted: false,
      runtime_tag: 'prod',
    }));

    const insertManySpy = jest.fn(async (docs: Array<Record<string, unknown>>) => ({ insertedCount: docs.length }));
    const deleteManySpy = jest.fn(async () => ({ deletedCount: 0 }));

    const dbStub = {
      collection: (name: string) => {
        if (name === COLLECTIONS.PERFORMERS) {
          return {
            findOne: jest.fn(async () => ({
              _id: taskPerformerId,
              id: 'automation-performer',
              name: 'Automation Bot',
              corporate_email: 'automation-bot@strato.space',
            })),
          };
        }
        if (name === COLLECTIONS.PROJECTS) {
          return {
            findOne: jest.fn(async () => ({
              _id: projectId,
              git_repo: 'git@github.com:strato-space/copilot.git',
            })),
          };
        }
        if (name === COLLECTIONS.TASKS) {
          return {
            findOne: jest.fn(async () => null),
            insertMany: insertManySpy,
            deleteMany: deleteManySpy,
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
    process.env.VOICE_WEB_INTERFACE_URL = 'https://copilot-dev.stratospace.fun/voice/session';
    const response = await request(app)
      .post('/voicebot/create_tickets')
      .send({
        session_id: sessionId.toHexString(),
        tickets: [
          {
            id: 'ticket-1',
            name: 'Investigate ingress regression',
            description: 'Details',
            performer_id: taskPerformerId.toHexString(),
            project_id: projectId.toHexString(),
            project: 'Copilot',
          },
        ],
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.insertedCount).toBe(0);
    expect(createBdIssueMock).toHaveBeenCalledTimes(1);
    expect(createBdIssueMock).toHaveBeenCalledWith({
      title: 'Investigate ingress regression',
      description: expect.stringContaining('Source: Voice session https://copilot.stratospace.fun/voice/session/'),
      assignee: 'tester@strato.space',
      externalRef: `https://copilot.stratospace.fun/voice/session/${sessionId.toHexString()}`,
    });
    expect(deleteManySpy).toHaveBeenCalledTimes(1);
    expect(deleteManySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        $and: expect.arrayContaining([
          expect.objectContaining({
            external_ref: `https://copilot.stratospace.fun/voice/session/${sessionId.toHexString()}`,
            codex_task: true,
            is_deleted: { $ne: true },
          }),
        ]),
      })
    );
    expect(insertManySpy).not.toHaveBeenCalled();
  });

  it('create_tickets routes codex alias performer id rows to bd sync without mongo insertMany', async () => {
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
    const deleteManySpy = jest.fn(async () => ({ deletedCount: 0 }));

    const dbStub = {
      collection: (name: string) => {
        if (name === COLLECTIONS.PERFORMERS) {
          return {
            findOne: jest.fn(async () => ({
              _id: taskPerformerId,
              id: 'codex-system',
              name: 'Automation Bot',
              corporate_email: 'automation-bot@strato.space',
            })),
          };
        }
        if (name === COLLECTIONS.PROJECTS) {
          return {
            findOne: jest.fn(async () => ({
              _id: projectId,
              git_repo: 'git@github.com:strato-space/copilot.git',
            })),
          };
        }
        if (name === COLLECTIONS.TASKS) {
          return {
            findOne: jest.fn(async () => null),
            insertMany: insertManySpy,
            deleteMany: deleteManySpy,
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
    process.env.VOICE_WEB_INTERFACE_URL = 'https://copilot-dev.stratospace.fun/voice/session';

    const app = buildApp();
    const response = await request(app)
      .post('/voicebot/create_tickets')
      .send({
        session_id: sessionId.toHexString(),
        tickets: [
          {
            id: 'alias-ticket',
            name: 'Alias codex task',
            description: 'Alias details',
            performer_id: taskPerformerId.toHexString(),
            project_id: projectId.toHexString(),
            project: 'Copilot',
          },
        ],
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.insertedCount).toBe(0);
    expect(createBdIssueMock).toHaveBeenCalledTimes(1);
    expect(insertManySpy).not.toHaveBeenCalled();
    expect(deleteManySpy).toHaveBeenCalledTimes(1);
  });

  it('create_tickets routes raw codex alias ids to bd sync without performer lookup or mongo insertMany', async () => {
    const sessionId = new ObjectId();
    const projectId = new ObjectId();

    const sessionFindOne = jest.fn(async () => ({
      _id: sessionId,
      chat_id: 123456,
      user_id: performerId.toHexString(),
      session_name: 'Runtime test session',
      is_deleted: false,
      runtime_tag: 'prod',
    }));

    const insertManySpy = jest.fn(async (docs: Array<Record<string, unknown>>) => ({ insertedCount: docs.length }));
    const deleteManySpy = jest.fn(async () => ({ deletedCount: 0 }));
    const performerFindOneSpy = jest.fn(async () => ({
      _id: new ObjectId(),
      id: 'human-performer',
      name: 'Should not be loaded',
    }));

    const dbStub = {
      collection: (name: string) => {
        if (name === COLLECTIONS.PERFORMERS) {
          return {
            findOne: performerFindOneSpy,
          };
        }
        if (name === COLLECTIONS.PROJECTS) {
          return {
            findOne: jest.fn(async () => ({
              _id: projectId,
              git_repo: 'git@github.com:strato-space/copilot.git',
            })),
          };
        }
        if (name === COLLECTIONS.TASKS) {
          return {
            findOne: jest.fn(async () => null),
            insertMany: insertManySpy,
            deleteMany: deleteManySpy,
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
    process.env.VOICE_WEB_INTERFACE_URL = 'https://copilot-dev.stratospace.fun/voice/session';

    const app = buildApp();
    const response = await request(app)
      .post('/voicebot/create_tickets')
      .send({
        session_id: sessionId.toHexString(),
        tickets: [
          {
            id: 'raw-alias-ticket',
            name: 'Raw alias codex task',
            description: 'Alias details',
            performer_id: 'codex-system',
            project_id: projectId.toHexString(),
            project: 'Copilot',
          },
        ],
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.insertedCount).toBe(0);
    expect(createBdIssueMock).toHaveBeenCalledTimes(1);
    expect(insertManySpy).not.toHaveBeenCalled();
    expect(deleteManySpy).toHaveBeenCalledTimes(1);
    expect(performerFindOneSpy).not.toHaveBeenCalled();
  });

  it('create_tickets routes malformed performer payloads with codex id to bd sync without mongo insertMany', async () => {
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
    const deleteManySpy = jest.fn(async () => ({ deletedCount: 0 }));
    const malformedCodexId = { id: codexPerformerObjectId.toHexString() } as unknown as ObjectId;

    const dbStub = {
      collection: (name: string) => {
        if (name === COLLECTIONS.PERFORMERS) {
          return {
            findOne: jest.fn(async () => ({
              _id: malformedCodexId,
              id: { raw: true },
              name: null,
              corporate_email: 12345,
            })),
          };
        }
        if (name === COLLECTIONS.PROJECTS) {
          return {
            findOne: jest.fn(async () => ({
              _id: projectId,
              git_repo: 'git@github.com:strato-space/copilot.git',
            })),
          };
        }
        if (name === COLLECTIONS.TASKS) {
          return {
            findOne: jest.fn(async () => null),
            insertMany: insertManySpy,
            deleteMany: deleteManySpy,
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
    process.env.VOICE_WEB_INTERFACE_URL = 'https://copilot-dev.stratospace.fun/voice/session';

    const app = buildApp();
    const response = await request(app)
      .post('/voicebot/create_tickets')
      .send({
        session_id: sessionId.toHexString(),
        tickets: [
          {
            id: 'malformed-codex-ticket',
            name: 'Malformed codex performer task',
            description: 'Malformed payload details',
            performer_id: taskPerformerId.toHexString(),
            project_id: projectId.toHexString(),
            project: 'Copilot',
          },
        ],
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.insertedCount).toBe(0);
    expect(createBdIssueMock).toHaveBeenCalledTimes(1);
    expect(insertManySpy).not.toHaveBeenCalled();
    expect(deleteManySpy).toHaveBeenCalledTimes(1);
  });

  it('create_tickets routes performer records labeled as codex by name to bd sync without mongo insertMany', async () => {
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
    const deleteManySpy = jest.fn(async () => ({ deletedCount: 0 }));

    const dbStub = {
      collection: (name: string) => {
        if (name === COLLECTIONS.PERFORMERS) {
          return {
            findOne: jest.fn(async () => ({
              _id: taskPerformerId,
              id: 'automation-performer',
              name: 'Codex',
              corporate_email: 'automation-bot@strato.space',
            })),
          };
        }
        if (name === COLLECTIONS.PROJECTS) {
          return {
            findOne: jest.fn(async () => ({
              _id: projectId,
              git_repo: 'git@github.com:strato-space/copilot.git',
            })),
          };
        }
        if (name === COLLECTIONS.TASKS) {
          return {
            findOne: jest.fn(async () => null),
            insertMany: insertManySpy,
            deleteMany: deleteManySpy,
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
    process.env.VOICE_WEB_INTERFACE_URL = 'https://copilot-dev.stratospace.fun/voice/session';

    const app = buildApp();
    const response = await request(app)
      .post('/voicebot/create_tickets')
      .send({
        session_id: sessionId.toHexString(),
        tickets: [
          {
            id: 'name-codex-ticket',
            name: 'Name codex task',
            description: 'Name-based codex details',
            performer_id: taskPerformerId.toHexString(),
            project_id: projectId.toHexString(),
            project: 'Copilot',
          },
        ],
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.insertedCount).toBe(0);
    expect(createBdIssueMock).toHaveBeenCalledTimes(1);
    expect(insertManySpy).not.toHaveBeenCalled();
    expect(deleteManySpy).toHaveBeenCalledTimes(1);
  });

  it('create_tickets deletes old codex rows for the same voice session before creating new codex issue', async () => {
    const sessionId = new ObjectId();
    const codexProjectId = new ObjectId();
    const taskPerformerId = codexPerformerObjectId;
    const regularPerformerId = new ObjectId();
    const regularProjectId = new ObjectId();

    const sessionFindOne = jest.fn(async () => ({
      _id: sessionId,
      chat_id: 123456,
      user_id: performerId.toHexString(),
      session_name: 'Runtime test session',
      is_deleted: false,
      runtime_tag: 'prod',
    }));

    const insertManySpy = jest.fn(async (docs: Array<Record<string, unknown>>) => ({ insertedCount: docs.length }));
    const deleteManySpy = jest.fn(async () => ({ deletedCount: 2 }));

    const dbStub = {
      collection: (name: string) => {
        if (name === COLLECTIONS.PERFORMERS) {
          return {
            findOne: jest.fn(async ({ _id }: { _id: ObjectId }) => {
              const queryId = _id.toHexString();
              if (queryId === taskPerformerId.toHexString()) {
                return {
                  _id: taskPerformerId,
                  id: 'automation-performer',
                  name: 'Automation Bot',
                  corporate_email: 'automation-bot@strato.space',
                };
              }
              if (queryId === regularPerformerId.toHexString()) {
                return {
                  _id: regularPerformerId,
                  name: 'Operator',
                  corporate_email: 'ops@strato.space',
                };
              }
              return null;
            }),
          };
        }
        if (name === COLLECTIONS.PROJECTS) {
          return {
            findOne: jest.fn(async () => ({
              _id: codexProjectId,
              git_repo: 'git@github.com:strato-space/copilot.git',
            })),
          };
        }
        if (name === COLLECTIONS.TASKS) {
          return {
            findOne: jest.fn(async () => null),
            insertMany: insertManySpy,
            deleteMany: deleteManySpy,
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
    process.env.VOICE_WEB_INTERFACE_URL = 'https://copilot-dev.stratospace.fun/voice/session';
    const response = await request(app)
      .post('/voicebot/create_tickets')
      .send({
        session_id: sessionId.toHexString(),
        tickets: [
          {
            id: 'codex-ticket',
            name: 'Codex sync task',
            description: 'Codex details',
            performer_id: taskPerformerId.toHexString(),
            project_id: codexProjectId.toHexString(),
            project: 'Copilot',
          },
          {
            id: 'regular-ticket',
            name: 'Regular sync task',
            description: 'Regular details',
            performer_id: regularPerformerId.toHexString(),
            project_id: regularProjectId.toHexString(),
            project: 'Copilot',
          },
        ],
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(deleteManySpy).toHaveBeenCalledTimes(1);
    expect(deleteManySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        $and: expect.arrayContaining([
          expect.objectContaining({
            external_ref: `https://copilot.stratospace.fun/voice/session/${sessionId.toHexString()}`,
            codex_task: true,
            is_deleted: { $ne: true },
          }),
        ]),
      })
    );
    expect(createBdIssueMock).toHaveBeenCalledTimes(1);
    expect(response.body.insertedCount).toBe(1);
    expect(insertManySpy).toHaveBeenCalledTimes(1);
    const [insertedDocs] = insertManySpy.mock.calls[0] as [Array<Record<string, unknown>>];
    expect(insertedDocs).toHaveLength(1);
    expect(String(insertedDocs[0]?.id ?? '')).toContain('regular-ticket');
    expect((insertedDocs[0]?.performer_id as ObjectId).toHexString()).toBe(regularPerformerId.toHexString());
  });

  it('create_tickets returns codex_issue_sync_errors and keeps no mongo codex rows on bd sync failure', async () => {
    const sessionId = new ObjectId();
    const projectId = new ObjectId();
    const taskPerformerId = codexPerformerObjectId;

    const sessionFindOne = jest.fn(async () => ({
      _id: sessionId,
      chat_id: 123456,
      user_id: performerId.toHexString(),
      session_name: 'Runtime test session',
      is_deleted: false,
      runtime_tag: 'prod',
    }));

    const insertManySpy = jest.fn(async (docs: Array<Record<string, unknown>>) => ({ insertedCount: docs.length }));
    const deleteManySpy = jest.fn(async () => ({ deletedCount: 0 }));

    const dbStub = {
      collection: (name: string) => {
        if (name === COLLECTIONS.PERFORMERS) {
          return {
            findOne: jest.fn(async () => ({
              _id: taskPerformerId,
              id: 'automation-performer',
              name: 'Automation Bot',
              corporate_email: 'automation-bot@strato.space',
            })),
          };
        }
        if (name === COLLECTIONS.PROJECTS) {
          return {
            findOne: jest.fn(async () => ({
              _id: projectId,
              git_repo: 'git@github.com:strato-space/copilot.git',
            })),
          };
        }
        if (name === COLLECTIONS.TASKS) {
          return {
            findOne: jest.fn(async () => null),
            insertMany: insertManySpy,
            deleteMany: deleteManySpy,
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

    createBdIssueMock.mockRejectedValueOnce(new Error('bd cli failed'));

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
            name: 'Deferred sync failure',
            description: 'Details',
            performer_id: taskPerformerId.toHexString(),
            project_id: projectId.toHexString(),
            project: 'Copilot',
          },
        ],
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.codex_issue_sync_errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          task_id: expect.stringContaining('ticket-1'),
          error: expect.stringContaining('bd cli failed'),
        }),
      ])
    );
    expect(response.body.codex_issue_sync_errors).toHaveLength(1);
    expect(createBdIssueMock).toHaveBeenCalledTimes(1);
    expect(insertManySpy).not.toHaveBeenCalled();
    expect(deleteManySpy).toHaveBeenCalledTimes(1);
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
