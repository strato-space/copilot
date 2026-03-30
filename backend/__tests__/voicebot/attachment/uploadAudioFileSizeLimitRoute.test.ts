import express from 'express';
import request from 'supertest';
import { ObjectId } from 'mongodb';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { PERMISSIONS } from '../../../src/permissions/permissions-config.js';

const getDbMock = jest.fn();
const getRawDbMock = jest.fn();
const getUserPermissionsMock = jest.fn();
const requirePermissionMock = jest.fn(() => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next());
const getAudioDurationFromFileMock = jest.fn();
const getFileSha256FromPathMock = jest.fn(async () => 'sha256-upload-test');
const TEST_MAX_AUDIO_FILE_SIZE = 16;

const registerRouteMocks = () => {
  jest.unstable_mockModule('../../../src/services/db.js', () => ({
    getDb: getDbMock,
    getRawDb: getRawDbMock,
  }));

  jest.unstable_mockModule('../../../src/permissions/permission-manager.js', () => ({
    PermissionManager: {
      getUserPermissions: getUserPermissionsMock,
      requirePermission: requirePermissionMock,
    },
  }));

  jest.unstable_mockModule('../../../src/utils/audioUtils.js', () => ({
    getAudioDurationFromFile: getAudioDurationFromFileMock,
    getFileSha256FromPath: getFileSha256FromPathMock,
  }));
};

const loadRouteUnderTest = async () => {
  const originalMaxAudioFileSizeEnv = process.env.VOICEBOT_MAX_AUDIO_FILE_SIZE;
  process.env.VOICEBOT_MAX_AUDIO_FILE_SIZE = String(TEST_MAX_AUDIO_FILE_SIZE);
  jest.resetModules();
  registerRouteMocks();

  try {
    const constantsModule = await import('../../../src/constants.js');
    const uploadsModule = await import('../../../src/api/routes/voicebot/uploads.js');
    return {
      VOICEBOT_COLLECTIONS: constantsModule.VOICEBOT_COLLECTIONS,
      VOICEBOT_FILE_STORAGE: constantsModule.VOICEBOT_FILE_STORAGE,
      uploadsRouter: uploadsModule.default,
    };
  } finally {
    if (originalMaxAudioFileSizeEnv === undefined) {
      delete process.env.VOICEBOT_MAX_AUDIO_FILE_SIZE;
    } else {
      process.env.VOICEBOT_MAX_AUDIO_FILE_SIZE = originalMaxAudioFileSizeEnv;
    }
  }
};

describe('POST /voicebot/upload_audio file size limit handling', () => {
  beforeEach(() => {
    getDbMock.mockReset();
    getRawDbMock.mockReset();
    getUserPermissionsMock.mockReset();
    requirePermissionMock.mockClear();
    getAudioDurationFromFileMock.mockReset();
    getFileSha256FromPathMock.mockReset();

    getUserPermissionsMock.mockResolvedValue([PERMISSIONS.VOICEBOT_SESSIONS.READ_ALL]);
  });

  it('returns 413 with structured payload when file exceeds configured max size', async () => {
    const {
      VOICEBOT_COLLECTIONS,
      VOICEBOT_FILE_STORAGE,
      uploadsRouter,
    } = await loadRouteUnderTest();

    const sessionId = new ObjectId('507f1f77bcf86cd799439040');
    const performerId = new ObjectId('507f1f77bcf86cd799439041');
    const dbStub = {
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return {
            findOne: jest.fn(async () => ({
              _id: sessionId,
              chat_id: 777,
              user_id: performerId.toString(),
              access_level: 'private',
              is_deleted: false,
              runtime_tag: 'prod-p2',
            })),
            updateOne: jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 })),
          };
        }
        if (name === VOICEBOT_COLLECTIONS.MESSAGES) {
          return {
            insertOne: jest.fn(async () => ({ insertedId: new ObjectId() })),
            find: jest.fn(() => ({
              project: jest.fn(() => ({
                toArray: jest.fn(async () => []),
              })),
            })),
            updateMany: jest.fn(async () => ({ matchedCount: 0, modifiedCount: 0 })),
          };
        }
        return {
          findOne: jest.fn(async () => null),
          updateOne: jest.fn(async () => ({ matchedCount: 0, modifiedCount: 0 })),
          insertOne: jest.fn(async () => ({ insertedId: new ObjectId() })),
        };
      },
    };

    getDbMock.mockReturnValue(dbStub);
    getRawDbMock.mockReturnValue(dbStub);
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      const vreq = req as express.Request & {
        performer: Record<string, unknown>;
        user: Record<string, unknown>;
      };
      vreq.performer = {
        _id: new ObjectId('507f1f77bcf86cd799439041'),
        telegram_id: '777',
        projects_access: [],
      };
      vreq.user = { userId: '507f1f77bcf86cd799439041' };
      next();
    });
    app.use('/voicebot', uploadsRouter);

    const payload = Buffer.from('small-audio-payload');
    const response = await request(app)
      .post('/voicebot/upload_audio')
      .field('session_id', '507f1f77bcf86cd799439040')
      .attach('audio', payload, {
        filename: 'oversized.webm',
        contentType: 'audio/webm',
      });

    expect(response.status).toBe(413);
    expect(response.body).toEqual({
      error: 'file_too_large',
      message: 'File too large',
      max_size_bytes: VOICEBOT_FILE_STORAGE.maxAudioFileSize,
      max_size_mb: Number((VOICEBOT_FILE_STORAGE.maxAudioFileSize / (1024 * 1024)).toFixed(1)),
      request_id: expect.any(String),
    });
  });
});
