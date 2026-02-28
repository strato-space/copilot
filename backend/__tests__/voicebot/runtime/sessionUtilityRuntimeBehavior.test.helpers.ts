import express from 'express';
import { ObjectId } from 'mongodb';
import { jest } from '@jest/globals';

process.env.VOICE_RUNTIME_ENV = 'prod';
process.env.VOICE_RUNTIME_SERVER_NAME = 'p2';

export const getDbMock = jest.fn();
export const getRawDbMock = jest.fn();
export const getUserPermissionsMock = jest.fn();
export const generateDataFilterMock = jest.fn();
export const createBdIssueMock = jest.fn();

jest.unstable_mockModule('../../../src/services/bdClient.js', () => ({
  createBdIssue: createBdIssueMock,
}));

jest.unstable_mockModule('../../../src/services/db.js', () => ({
  getDb: getDbMock,
  getRawDb: getRawDbMock,
}));

jest.unstable_mockModule('../../../src/permissions/permission-manager.js', () => ({
  PermissionManager: {
    requirePermission: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
    getUserPermissions: getUserPermissionsMock,
    generateDataFilter: generateDataFilterMock,
  },
}));

export const { PERMISSIONS } = await import('../../../src/permissions/permissions-config.js');
export const { COLLECTIONS, TASK_CLASSES, VOICEBOT_COLLECTIONS } = await import('../../../src/constants.js');
export const { RUNTIME_TAG } = await import('../../../src/services/runtimeScope.js');
const { default: sessionsRouter } = await import('../../../src/api/routes/voicebot/sessions.js');

export const performerId = new ObjectId('507f1f77bcf86cd799439011');
export const codexPerformerObjectId = new ObjectId('69a2561d642f3a032ad88e7a');

export const buildApp = () => {
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

export const buildDefaultCollection = () => ({
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

export const resetRuntimeBehaviorMocks = () => {
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
};
