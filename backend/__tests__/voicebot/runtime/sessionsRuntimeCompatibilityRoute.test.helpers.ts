import express from 'express';
import { ObjectId } from 'mongodb';
import { jest } from '@jest/globals';

process.env.VOICE_RUNTIME_ENV = 'prod';
process.env.VOICE_RUNTIME_SERVER_NAME = 'p2';

export const getDbMock = jest.fn();
export const getRawDbMock = jest.fn();
export const generateDataFilterMock = jest.fn();
export const getUserPermissionsMock = jest.fn();
export const requirePermissionMock = jest.fn(
  () =>
    (_req: express.Request, _res: express.Response, next: express.NextFunction) =>
      next()
);

jest.unstable_mockModule('../../../src/services/db.js', () => ({
  getDb: getDbMock,
  getRawDb: getRawDbMock,
}));

jest.unstable_mockModule('../../../src/permissions/permission-manager.js', () => ({
  PermissionManager: {
    generateDataFilter: generateDataFilterMock,
    getUserPermissions: getUserPermissionsMock,
    requirePermission: requirePermissionMock,
  },
}));

export const { PERMISSIONS } = await import('../../../src/permissions/permissions-config.js');
export const { VOICEBOT_COLLECTIONS } = await import('../../../src/constants.js');
const { default: sessionsRouter } = await import('../../../src/api/routes/voicebot/sessions.js');

export const performerId = new ObjectId('507f1f77bcf86cd799439011');

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
    vreq.user = {
      userId: performerId.toString(),
      email: 'test@example.com',
    };
    next();
  });
  app.use('/voicebot', sessionsRouter);
  return app;
};

export const resetSessionsRuntimeCompatibilityMocks = () => {
  getDbMock.mockReset();
  getRawDbMock.mockReset();
  generateDataFilterMock.mockReset();
  getUserPermissionsMock.mockReset();
  requirePermissionMock.mockClear();
  generateDataFilterMock.mockResolvedValue({});
  getUserPermissionsMock.mockResolvedValue([PERMISSIONS.VOICEBOT_SESSIONS.READ_ALL]);
};
