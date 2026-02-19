import express from 'express';
import request from 'supertest';
import { ObjectId } from 'mongodb';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

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

describe('Voicebot utility routes payload validation', () => {
  beforeEach(() => {
    getDbMock.mockReset();
    getRawDbMock.mockReset();
    getUserPermissionsMock.mockReset();
    generateDataFilterMock.mockReset();

    const dbStub = {
      collection: () => ({
        findOne: jest.fn(async () => null),
        find: jest.fn(() => ({ toArray: async () => [] })),
        insertMany: jest.fn(async () => ({ insertedCount: 0 })),
        updateOne: jest.fn(async () => ({ matchedCount: 0, modifiedCount: 0 })),
      }),
    };
    getDbMock.mockReturnValue(dbStub);
    getRawDbMock.mockReturnValue(dbStub);

    getUserPermissionsMock.mockResolvedValue([
      PERMISSIONS.VOICEBOT_SESSIONS.READ_ALL,
      PERMISSIONS.PROJECTS.READ_ALL,
    ]);
    generateDataFilterMock.mockResolvedValue({});
  });

  it('returns 400 for invalid create_tickets payload', async () => {
    const app = buildApp();
    const response = await request(app)
      .post('/voicebot/create_tickets')
      .send({ session_id: '507f1f77bcf86cd799439011', tickets: [] });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('session_id and tickets are required');
  });

  it('returns 400 for invalid project_id format in topics', async () => {
    const app = buildApp();
    const response = await request(app)
      .post('/voicebot/topics')
      .send({ project_id: 'not-an-objectid' });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Invalid project_id format');
  });

  it('returns 400 for missing file_id in get_file_content', async () => {
    const app = buildApp();
    const response = await request(app)
      .post('/voicebot/get_file_content')
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('file_id is required');
  });
});
