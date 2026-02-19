import express from 'express';
import request from 'supertest';
import { ObjectId } from 'mongodb';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

process.env.VOICE_RUNTIME_ENV = 'prod';
process.env.VOICE_RUNTIME_SERVER_NAME = 'p2';

const getDbMock = jest.fn();
const getRawDbMock = jest.fn();
const requirePermissionMock = jest.fn(
  () =>
    (_req: express.Request, _res: express.Response, next: express.NextFunction) =>
      next()
);
const getUserPermissionsMock = jest.fn();
const generateDataFilterMock = jest.fn();
const authMiddlewareMock = jest.fn(
  (_req: express.Request, res: express.Response) =>
    res.status(401).json({ error: 'blocked_auth' })
);
const requireAdminMock = jest.fn(
  (_req: express.Request, res: express.Response) =>
    res.status(403).json({ error: 'blocked_role' })
);

jest.unstable_mockModule('../../src/services/db.js', () => ({
  getDb: getDbMock,
  getRawDb: getRawDbMock,
}));

jest.unstable_mockModule('../../src/permissions/permission-manager.js', () => ({
  PermissionManager: {
    requirePermission: requirePermissionMock,
    getUserPermissions: getUserPermissionsMock,
    generateDataFilter: generateDataFilterMock,
  },
}));

jest.unstable_mockModule('../../src/api/middleware/auth.js', () => ({
  authMiddleware: authMiddlewareMock,
}));

jest.unstable_mockModule('../../src/api/middleware/roleGuard.js', () => ({
  requireAdmin: requireAdminMock,
}));

jest.unstable_mockModule('../../src/utils/audioUtils.js', () => ({
  getAudioDurationFromFile: jest.fn(async () => 0),
  getFileSha256FromPath: jest.fn(async () => 'sha256-public-attachment'),
}));

const { VOICEBOT_COLLECTIONS } = await import('../../src/constants.js');
const { default: voicebotRouter } = await import('../../src/api/routes/voicebot/index.js');

let tempDir = '';
let attachmentFilePath = '';

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/voicebot', voicebotRouter);
  return app;
};

describe('voicebot public_attachment route exposure', () => {
  const sessionId = new ObjectId();
  const fileUniqueId = 'uniq-file-42';

  beforeEach(() => {
    getDbMock.mockReset();
    getRawDbMock.mockReset();
    requirePermissionMock.mockClear();
    authMiddlewareMock.mockClear();
    requireAdminMock.mockClear();

    tempDir = mkdtempSync(join(tmpdir(), 'voice-public-attachment-'));
    attachmentFilePath = join(tempDir, 'example.txt');
    writeFileSync(attachmentFilePath, 'public attachment payload', 'utf8');

    const dbStub = {
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.MESSAGES) {
          return {
            findOne: jest.fn(async () => ({
              _id: new ObjectId(),
              session_id: sessionId,
              attachments: [
                {
                  file_unique_id: fileUniqueId,
                  file_path: attachmentFilePath,
                },
              ],
            })),
          };
        }

        return {
          findOne: jest.fn(async () => null),
          find: jest.fn(() => ({ toArray: async () => [] })),
          aggregate: jest.fn(() => ({ toArray: async () => [] })),
          updateOne: jest.fn(async () => ({ matchedCount: 0, modifiedCount: 0 })),
          insertOne: jest.fn(async () => ({ insertedId: new ObjectId() })),
        };
      },
    };

    getDbMock.mockReturnValue(dbStub);
    getRawDbMock.mockReturnValue(dbStub);
  });

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = '';
    }
  });

  it('serves canonical /public_attachment without passing auth middleware', async () => {
    const app = buildApp();
    const response = await request(app).get(
      `/voicebot/public_attachment/${sessionId.toHexString()}/${fileUniqueId}`
    );

    expect(response.status).toBe(200);
    expect(response.text).toBe('public attachment payload');
    expect(authMiddlewareMock).not.toHaveBeenCalled();
    expect(requireAdminMock).not.toHaveBeenCalled();
  });

  it('serves legacy /uploads/public_attachment without passing auth middleware', async () => {
    const app = buildApp();
    const response = await request(app).get(
      `/voicebot/uploads/public_attachment/${sessionId.toHexString()}/${fileUniqueId}`
    );

    expect(response.status).toBe(200);
    expect(response.text).toBe('public attachment payload');
    expect(authMiddlewareMock).not.toHaveBeenCalled();
    expect(requireAdminMock).not.toHaveBeenCalled();
  });

  it('keeps non-public voicebot endpoints behind auth middleware', async () => {
    const app = buildApp();
    const response = await request(app).post('/voicebot/active_session').send({});

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'blocked_auth' });
    expect(authMiddlewareMock).toHaveBeenCalledTimes(1);
  });
});
