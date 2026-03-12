import express from 'express';
import request from 'supertest';
import { ObjectId } from 'mongodb';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const getDbMock = jest.fn();
const getRawDbMock = jest.fn();
const getUserPermissionsMock = jest.fn();
const getUserAccessibleProjectsMock = jest.fn();
const generateDataFilterMock = jest.fn();

jest.unstable_mockModule('../../src/services/db.js', () => ({
  getDb: getDbMock,
  getRawDb: getRawDbMock,
}));

jest.unstable_mockModule('../../src/permissions/permission-manager.js', () => ({
  PermissionManager: {
    requirePermission: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
    getUserPermissions: getUserPermissionsMock,
    getUserAccessibleProjects: getUserAccessibleProjectsMock,
    generateDataFilter: generateDataFilterMock,
  },
}));

const { default: sessionsRouter } = await import('../../src/api/routes/voicebot/sessions.js');
const { VOICEBOT_COLLECTIONS, COLLECTIONS } = await import('../../src/constants.js');
const { PERMISSIONS } = await import('../../src/permissions/permissions-config.js');

const performerId = new ObjectId('507f1f77bcf86cd799439011');

const buildCursor = <T,>(rows: T[]) => ({
  toArray: async () => rows,
});

const buildApp = (): express.Express => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const vreq = req as express.Request & {
      performer: Record<string, unknown>;
      user: Record<string, unknown>;
    };
    vreq.performer = { _id: performerId, projects_access: [] };
    vreq.user = { userId: performerId.toHexString(), email: 'voice@strato.space' };
    next();
  });
  app.use('/voicebot', sessionsRouter);
  return app;
};

describe('POST /voicebot/project_performers', () => {
  beforeEach(() => {
    getDbMock.mockReset();
    getRawDbMock.mockReset();
    getUserPermissionsMock.mockReset();
    getUserAccessibleProjectsMock.mockReset();
    generateDataFilterMock.mockReset();
  });

  it('returns enriched project and performer rows for the selected project', async () => {
    const projectId = new ObjectId('672315cb537994d86e1c68ae');
    const performerObjectId = new ObjectId('66fe917725f930d1016edffc');
    const linkId = new ObjectId('507f1f77bcf86cd799439099');

    const dbStub = {
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.PROJECTS) {
          return {
            findOne: jest.fn(async () => ({
              _id: projectId,
              name: 'OperOps',
              is_deleted: false,
            })),
          };
        }
        if (name === COLLECTIONS.PROJECT_PERFORMER_LINKS) {
          return {
            find: jest.fn((query: Record<string, unknown>) => {
              if (query.project_id) {
                return buildCursor([
                  {
                    _id: linkId,
                    project_id: projectId,
                    performer_id: performerObjectId,
                    role: 'designer',
                    source: 'manual',
                    confidence: 'high',
                    is_active: true,
                  },
                ]);
              }
              if (query.performer_id) {
                return buildCursor([
                  {
                    _id: linkId,
                    project_id: projectId,
                    performer_id: performerObjectId,
                    role: 'designer',
                    source: 'manual',
                    confidence: 'high',
                    is_active: true,
                  },
                ]);
              }
              return buildCursor([]);
            }),
          };
        }
        if (name === COLLECTIONS.TELEGRAM_CHATS) {
          return {
            find: jest.fn(() => buildCursor([])),
          };
        }
        if (name === COLLECTIONS.TELEGRAM_USERS) {
          return {
            find: jest.fn(() => buildCursor([])),
          };
        }
        if (name === COLLECTIONS.TELEGRAM_CHAT_MEMBERSHIPS) {
          return {
            find: jest.fn(() => buildCursor([])),
          };
        }
        if (name === VOICEBOT_COLLECTIONS.PERFORMERS) {
          return {
            find: jest.fn(() => ({
              project: jest.fn(() => ({
                toArray: async () => [
                  {
                    _id: performerObjectId,
                    name: 'Илья Карпов',
                    real_name: 'Илья Карпов',
                    corporate_email: 'ilya@strato.space',
                    telegram_id: 'ilya_telegram',
                    telegram_name: 'ilya',
                    role: 'designer',
                    projects_access: [],
                    is_active: true,
                    is_deleted: false,
                  },
                ],
              })),
            })),
          };
        }
        return {
          findOne: jest.fn(async () => null),
          find: jest.fn(() => buildCursor([])),
        };
      },
    };

    getDbMock.mockReturnValue(dbStub);
    getRawDbMock.mockReturnValue(dbStub);
    getUserPermissionsMock.mockResolvedValue([PERMISSIONS.PROJECTS.READ_ALL]);

    const app = buildApp();
    const response = await request(app)
      .post('/voicebot/project_performers')
      .send({ project_id: projectId.toHexString() });

    expect(response.status).toBe(200);
    expect(response.body.project).toEqual(
      expect.objectContaining({
        _id: projectId.toHexString(),
        name: 'OperOps',
        telegram_chats: [],
      }),
    );
    expect(response.body.project.project_performer_links).toEqual([
      expect.objectContaining({
        id: linkId.toHexString(),
        project_id: projectId.toHexString(),
        performer_id: performerObjectId.toHexString(),
      }),
    ]);
    expect(response.body.performers).toEqual([
      expect.objectContaining({
        _id: performerObjectId.toHexString(),
        name: 'Илья Карпов',
        project_performer_links: [
          expect.objectContaining({
            project_id: projectId.toHexString(),
            performer_id: performerObjectId.toHexString(),
          }),
        ],
      }),
    ]);
  });

  it('returns 403 when caller has no project read permissions', async () => {
    const projectId = new ObjectId('672315cb537994d86e1c68ae');
    getDbMock.mockReturnValue({
      collection: () => ({
        findOne: jest.fn(async () => null),
        find: jest.fn(() => buildCursor([])),
      }),
    });
    getRawDbMock.mockReturnValue(getDbMock.mock.results.at(-1)?.value);
    getUserPermissionsMock.mockResolvedValue([]);

    const app = buildApp();
    const response = await request(app)
      .post('/voicebot/project_performers')
      .send({ project_id: projectId.toHexString() });

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: 'Forbidden' });
  });

  it('returns 404 when project is missing', async () => {
    const projectId = new ObjectId('672315cb537994d86e1c68ae');
    const dbStub = {
      collection: () => ({
        findOne: jest.fn(async () => null),
        find: jest.fn(() => buildCursor([])),
      }),
    };
    getDbMock.mockReturnValue(dbStub);
    getRawDbMock.mockReturnValue(dbStub);
    getUserPermissionsMock.mockResolvedValue([PERMISSIONS.PROJECTS.READ_ALL]);

    const app = buildApp();
    const response = await request(app)
      .post('/voicebot/project_performers')
      .send({ project_id: projectId.toHexString() });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: 'Project not found' });
  });
});
