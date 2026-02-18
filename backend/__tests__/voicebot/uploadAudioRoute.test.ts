import express from 'express';
import request from 'supertest';
import { ObjectId } from 'mongodb';
import { beforeEach, describe, expect, it, jest, afterEach } from '@jest/globals';
import { existsSync, unlinkSync } from 'node:fs';

import { VOICEBOT_COLLECTIONS } from '../../src/constants.js';
import { PERMISSIONS } from '../../src/permissions/permissions-config.js';

const getDbMock = jest.fn();
const getRawDbMock = jest.fn();
const getUserPermissionsMock = jest.fn();
const requirePermissionMock = jest.fn(() => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next());
const getAudioDurationFromFileMock = jest.fn();

jest.unstable_mockModule('../../src/services/db.js', () => ({
  getDb: getDbMock,
  getRawDb: getRawDbMock,
}));

jest.unstable_mockModule('../../src/permissions/permission-manager.js', () => ({
  PermissionManager: {
    getUserPermissions: getUserPermissionsMock,
    requirePermission: requirePermissionMock,
  },
}));

jest.unstable_mockModule('../../src/utils/audioUtils.js', () => ({
  getAudioDurationFromFile: getAudioDurationFromFileMock,
}));

const { default: uploadsRouter } = await import('../../src/api/routes/voicebot/uploads.js');
const uploadedFilePaths = new Set<string>();

describe('POST /voicebot/upload_audio', () => {
  beforeEach(() => {
    getDbMock.mockReset();
    getRawDbMock.mockReset();
    getUserPermissionsMock.mockReset();
    requirePermissionMock.mockClear();
    getAudioDurationFromFileMock.mockReset();

    getUserPermissionsMock.mockResolvedValue([PERMISSIONS.VOICEBOT_SESSIONS.READ_ALL]);
    getAudioDurationFromFileMock.mockResolvedValue(123.456);
  });

  afterEach(() => {
    for (const filePath of uploadedFilePaths) {
      if (existsSync(filePath)) {
        unlinkSync(filePath);
      }
    }
    uploadedFilePaths.clear();
  });

  it('persists probed duration into message and file metadata', async () => {
    const sessionId = new ObjectId();
    const performerId = new ObjectId('507f1f77bcf86cd799439011');
    const insertedMessages: Array<Record<string, unknown>> = [];
    const sessionFindOne = jest.fn(async () => ({
      _id: sessionId,
      chat_id: 123456,
      user_id: performerId.toString(),
      access_level: 'private',
      is_deleted: false,
    }));

    const dbStub = {
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return {
            findOne: sessionFindOne,
            updateOne: jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 })),
          };
        }
        if (name === VOICEBOT_COLLECTIONS.MESSAGES) {
          return {
            insertOne: jest.fn(async (doc: Record<string, unknown>) => {
              insertedMessages.push(doc);
              return { insertedId: new ObjectId() };
            }),
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
        _id: performerId,
        telegram_id: '123456',
        projects_access: [],
      };
      vreq.user = { userId: performerId.toString() };
      next();
    });
    app.use('/voicebot', uploadsRouter);

    const response = await request(app)
      .post('/voicebot/upload_audio')
      .field('session_id', sessionId.toString())
      .attach('audio', Buffer.from('webm-audio-fixture'), {
        filename: 'chunk.webm',
        contentType: 'audio/webm',
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.file_info.duration).toBe(123.456);
    expect(getAudioDurationFromFileMock).toHaveBeenCalledTimes(1);
    const [sessionQuery] = sessionFindOne.mock.calls[0] as [Record<string, unknown>];
    expect(sessionQuery).toHaveProperty('$and');

    expect(insertedMessages).toHaveLength(1);
    const persisted = insertedMessages[0] ?? {};
    const storedPath = typeof persisted.file_path === 'string' ? persisted.file_path : '';
    if (storedPath) uploadedFilePaths.add(storedPath);
    expect(persisted.duration).toBe(123.456);
    expect(persisted.runtime_tag).toBeDefined();
    expect((persisted.file_metadata as Record<string, unknown>)?.duration).toBe(123.456);
  });
});
