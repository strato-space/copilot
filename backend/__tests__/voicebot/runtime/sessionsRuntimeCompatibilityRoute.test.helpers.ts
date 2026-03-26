import express from 'express';
import { ObjectId } from 'mongodb';
import { jest } from '@jest/globals';

process.env.VOICE_RUNTIME_ENV = 'prod';
process.env.VOICE_RUNTIME_SERVER_NAME = 'p2';

export const getDbMock = jest.fn();
export const getRawDbMock = jest.fn();
export const getVoicebotQueuesMock = jest.fn();
export const detectGarbageTranscriptionMock = jest.fn();
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

jest.unstable_mockModule('../../../src/services/voicebotQueues.js', () => ({
  getVoicebotQueues: getVoicebotQueuesMock,
}));

jest.unstable_mockModule('../../../src/services/voicebot/transcriptionGarbageDetector.js', () => ({
  detectGarbageTranscription: detectGarbageTranscriptionMock,
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
  getVoicebotQueuesMock.mockReset();
  detectGarbageTranscriptionMock.mockReset();
  generateDataFilterMock.mockReset();
  getUserPermissionsMock.mockReset();
  requirePermissionMock.mockClear();
  getVoicebotQueuesMock.mockReturnValue(null);
  detectGarbageTranscriptionMock.mockResolvedValue(null);
  generateDataFilterMock.mockResolvedValue({});
  getUserPermissionsMock.mockResolvedValue([PERMISSIONS.VOICEBOT_SESSIONS.READ_ALL]);
};

type AggregatePipelineStage = Record<string, unknown>;

const extractSessionIdsFromMessagesCountPipeline = (
  pipeline: Array<AggregatePipelineStage> = []
): ObjectId[] => {
  const matchStage = pipeline.find((stage) =>
    Object.prototype.hasOwnProperty.call(stage, '$match')
  ) as { $match?: { session_id?: { $in?: unknown[] } } } | undefined;

  const inValues = matchStage?.$match?.session_id?.$in;
  if (!Array.isArray(inValues)) {
    return [];
  }

  return inValues.filter((value): value is ObjectId => value instanceof ObjectId);
};

export const createStableMessagesCountAggregateMock = (
  countsBySessionId: Record<string, number> = {}
) =>
  jest.fn((pipeline: Array<AggregatePipelineStage> = []) => ({
    toArray: async () =>
      extractSessionIdsFromMessagesCountPipeline(pipeline)
        .map((sessionId) => ({
          _id: sessionId,
          count: Number(countsBySessionId[sessionId.toHexString()] ?? 0),
        }))
        .filter((row) => row.count > 0),
  }));
