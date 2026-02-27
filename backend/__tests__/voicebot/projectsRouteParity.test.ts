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

const { PERMISSIONS } = await import('../../src/permissions/permissions-config.js');
const { VOICEBOT_COLLECTIONS, COLLECTIONS } = await import('../../src/constants.js');
const { default: sessionsRouter } = await import('../../src/api/routes/voicebot/sessions.js');

const performerId = new ObjectId('507f1f77bcf86cd799439011');

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

describe('VoiceBot /projects parity', () => {
  beforeEach(() => {
    getDbMock.mockReset();
    getRawDbMock.mockReset();
    getUserPermissionsMock.mockReset();
    getUserAccessibleProjectsMock.mockReset();
    generateDataFilterMock.mockReset();
  });

  it('uses grouped aggregate for READ_ALL with project_group and customer lookups', async () => {
    const aggregateCalls: Array<Array<Record<string, unknown>>> = [];
    const dbStub = {
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.PROJECTS) {
          return {
            aggregate: (pipeline: Array<Record<string, unknown>>) => {
              aggregateCalls.push(pipeline);
              return {
                toArray: async () => [
                  {
                    _id: new ObjectId(),
                    name: 'PMO',
                    git_repo: 'strato-space/copilot',
                    project_group: { name: 'Operations' },
                  },
                ],
              };
            },
          };
        }
        return {};
      },
    };

    getDbMock.mockReturnValue(dbStub);
    getUserPermissionsMock.mockResolvedValue([PERMISSIONS.PROJECTS.READ_ALL]);

    const app = buildApp();
    const response = await request(app).post('/voicebot/projects').send({});

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body).toHaveLength(1);
    expect(response.body[0]?.name).toBe('PMO');
    expect(response.body[0]?.git_repo).toBe('strato-space/copilot');

    const [pipeline] = aggregateCalls;
    expect(Array.isArray(pipeline)).toBe(true);

    const lookupFroms = pipeline
      .map((stage) => (stage as { $lookup?: { from?: string } }).$lookup?.from)
      .filter((value): value is string => typeof value === 'string');

    expect(lookupFroms).toContain(COLLECTIONS.PROJECT_GROUPS);
    expect(lookupFroms).toContain(COLLECTIONS.CUSTOMERS);

    const projectStage = pipeline.find((stage) => Object.prototype.hasOwnProperty.call(stage, '$project')) as
      | { $project?: Record<string, unknown> }
      | undefined;

    expect(projectStage?.$project).toEqual(
      expect.objectContaining({
        git_repo: 1,
        project_group: expect.any(Object),
        customer: expect.any(Object),
      })
    );
  });

  it('falls back to PermissionManager accessible-projects for READ_ASSIGNED', async () => {
    const assignedProjects = [
      {
        _id: '507f1f77bcf86cd799439021',
        name: 'Agent Fab',
        project_group: { name: 'AI Agents' },
      },
    ];

    getDbMock.mockReturnValue({
      collection: () => ({}),
    });
    getUserPermissionsMock.mockResolvedValue([PERMISSIONS.PROJECTS.READ_ASSIGNED]);
    getUserAccessibleProjectsMock.mockResolvedValue(assignedProjects);

    const app = buildApp();
    const response = await request(app).post('/voicebot/projects').send({});

    expect(response.status).toBe(200);
    expect(response.body).toEqual(assignedProjects);
    expect(getUserAccessibleProjectsMock).toHaveBeenCalledTimes(1);
  });
});
