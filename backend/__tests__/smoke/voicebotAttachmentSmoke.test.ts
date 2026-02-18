import express from 'express';
import request from 'supertest';
import { ObjectId } from 'mongodb';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { VOICEBOT_COLLECTIONS } from '../../src/constants.js';
import { PERMISSIONS } from '../../src/permissions/permissions-config.js';

const getDbMock = jest.fn();
const getRawDbMock = jest.fn();
const requirePermissionMock = jest.fn(
  () =>
    (_req: express.Request, _res: express.Response, next: express.NextFunction) =>
      next()
);
const getUserPermissionsMock = jest.fn();

jest.unstable_mockModule('../../src/services/db.js', () => ({
  getDb: getDbMock,
  getRawDb: getRawDbMock,
}));

jest.unstable_mockModule('../../src/permissions/permission-manager.js', () => ({
  PermissionManager: {
    requirePermission: requirePermissionMock,
    getUserPermissions: getUserPermissionsMock,
  },
}));

jest.unstable_mockModule('../../src/utils/audioUtils.js', () => ({
  getAudioDurationFromFile: jest.fn(async () => 0),
}));

const { default: uploadsRouter } = await import('../../src/api/routes/voicebot/uploads.js');

let tempDir = '';

describe('VoiceBot attachment smoke', () => {
  beforeEach(() => {
    getDbMock.mockReset();
    getRawDbMock.mockReset();
    requirePermissionMock.mockClear();
    getUserPermissionsMock.mockReset();
    getUserPermissionsMock.mockResolvedValue([PERMISSIONS.VOICEBOT_SESSIONS.READ_ALL]);

    tempDir = mkdtempSync(join(tmpdir(), 'voice-attach-smoke-'));
  });

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = '';
    }
  });

  it('serves both message_attachment proxy and public_attachment for telegram files', async () => {
    const performerId = new ObjectId('507f1f77bcf86cd799439011');
    const sessionId = new ObjectId();
    const messageId = new ObjectId();
    const fileUniqueId = 'uniq-smoke-1';
    const filePath = join(tempDir, 'payload.txt');
    writeFileSync(filePath, 'attachment smoke payload', 'utf8');

    const messageDoc = {
      _id: messageId,
      session_id: sessionId,
      source_type: 'telegram',
      message_type: 'document',
      file_id: 'file-id-smoke',
      attachments: [
        {
          source: 'telegram',
          file_id: 'file-id-smoke',
          file_unique_id: fileUniqueId,
          file_path: filePath,
        },
      ],
    };

    const dbStub = {
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return {
            findOne: jest.fn(async () => ({
              _id: sessionId,
              chat_id: 123456,
              user_id: performerId.toString(),
              access_level: 'private',
              is_deleted: false,
            })),
          };
        }

        if (name === VOICEBOT_COLLECTIONS.MESSAGES) {
          return {
            findOne: jest.fn(async () => messageDoc),
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

    const protectedRes = await request(app).get(`/voicebot/message_attachment/${messageId.toHexString()}/0`);
    expect(protectedRes.status).toBe(200);
    expect(protectedRes.text).toBe('attachment smoke payload');

    const publicRes = await request(app).get(`/voicebot/public_attachment/${sessionId.toHexString()}/${fileUniqueId}`);
    expect(publicRes.status).toBe(200);
    expect(publicRes.text).toBe('attachment smoke payload');
  });
});
