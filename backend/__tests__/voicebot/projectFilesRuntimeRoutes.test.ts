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
    getUserPermissions: getUserPermissionsMock,
    generateDataFilter: generateDataFilterMock,
  },
}));

const { PERMISSIONS } = await import('../../src/permissions/permissions-config.js');
const { VOICEBOT_COLLECTIONS } = await import('../../src/constants.js');
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

describe('Voicebot project files endpoints runtime isolation', () => {
  beforeEach(() => {
    getDbMock.mockReset();
    getRawDbMock.mockReset();
    getUserPermissionsMock.mockReset();
    generateDataFilterMock.mockReset();

    getUserPermissionsMock.mockResolvedValue([PERMISSIONS.PROJECTS.READ_ALL]);
    generateDataFilterMock.mockResolvedValue({});
  });

  it('POST /voicebot/get_project_files applies prod-family runtime filter', async () => {
    const projectId = new ObjectId();
    const findSpy = jest.fn(() => ({
      sort: () => ({ toArray: async () => [] }),
    }));

    const dbStub = {
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.GOOGLE_DRIVE_PROJECTS_FILES) {
          return { find: findSpy };
        }
        return {
          findOne: jest.fn(async () => null),
          find: jest.fn(() => ({ toArray: async () => [] })),
        };
      },
    };

    getDbMock.mockReturnValue(dbStub);
    getRawDbMock.mockReturnValue(dbStub);

    const app = buildApp();
    const response = await request(app)
      .post('/voicebot/get_project_files')
      .send({ project_id: projectId.toHexString() });

    expect(response.status).toBe(200);
    const [query] = findSpy.mock.calls[0] as [Record<string, unknown>];
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

  it('POST /voicebot/get_file_content scopes lookup by runtime filter', async () => {
    const findOneSpy = jest.fn(async () => null);

    const dbStub = {
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.GOOGLE_DRIVE_PROJECTS_FILES) {
          return { findOne: findOneSpy };
        }
        return {
          findOne: jest.fn(async () => null),
          find: jest.fn(() => ({ toArray: async () => [] })),
        };
      },
    };

    getDbMock.mockReturnValue(dbStub);
    getRawDbMock.mockReturnValue(dbStub);

    const app = buildApp();
    const response = await request(app)
      .post('/voicebot/get_file_content')
      .send({ file_id: 'file-123' });

    expect(response.status).toBe(404);
    const [query] = findOneSpy.mock.calls[0] as [Record<string, unknown>];
    expect(query).toEqual(
      expect.objectContaining({
        $and: expect.arrayContaining([
          expect.objectContaining({ file_id: 'file-123' }),
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
