import express from 'express';
import request from 'supertest';
import { ObjectId } from 'mongodb';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { existsSync, rmSync } from 'node:fs';

import { VOICEBOT_COLLECTIONS } from '../../../src/constants.js';
import { PERMISSIONS } from '../../../src/permissions/permissions-config.js';

const getDbMock = jest.fn();
const getRawDbMock = jest.fn();
const getUserPermissionsMock = jest.fn();
const requirePermissionMock = jest.fn(
  () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next()
);

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
  getAudioDurationFromFile: jest.fn(async () => 0),
  getFileSha256FromPath: jest.fn(async () => 'sha256-upload-test'),
}));

const { default: uploadsRouter } = await import('../../../src/api/routes/voicebot/uploads.js');

describe('POST /voicebot/upload_attachment', () => {
  const createdFiles: string[] = [];
  const createdDirs: string[] = [];

  beforeEach(() => {
    getDbMock.mockReset();
    getRawDbMock.mockReset();
    getUserPermissionsMock.mockReset();
    requirePermissionMock.mockClear();
    getUserPermissionsMock.mockResolvedValue([PERMISSIONS.VOICEBOT_SESSIONS.READ_OWN]);
  });

  afterEach(() => {
    for (const filePath of createdFiles) {
      if (existsSync(filePath)) rmSync(filePath, { force: true });
    }
    for (const dirPath of createdDirs) {
      if (existsSync(dirPath)) rmSync(dirPath, { recursive: true, force: true });
    }
    createdFiles.length = 0;
    createdDirs.length = 0;
  });

  it('stores pasted image in server fs and returns public_attachment URL', async () => {
    const sessionId = new ObjectId();
    const performerId = new ObjectId('507f1f77bcf86cd799439011');
    const sessionDoc = {
      _id: sessionId,
      chat_id: 123456,
      user_id: performerId.toString(),
      access_level: 'private',
      is_deleted: false,
      runtime_tag: 'prod-p2',
    };

    const dbStub = {
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return {
            findOne: jest.fn(async () => sessionDoc),
          };
        }
        return {
          findOne: jest.fn(async () => null),
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
      .post('/voicebot/upload_attachment')
      .field('session_id', sessionId.toString())
      .attach('attachment', Buffer.from('fake-png-content'), {
        filename: 'clipboard.png',
        contentType: 'image/png',
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.session_id).toBe(sessionId.toString());
    expect(response.body.attachment).toBeDefined();
    expect(response.body.attachment.source).toBe('web');
    expect(response.body.attachment.kind).toBe('image');
    expect(response.body.attachment.file_unique_id).toMatch(/^wa_[a-f0-9]{16}_[a-z0-9]+$/);
    expect(String(response.body.attachment.uri)).toMatch(
      new RegExp(`^/api/voicebot/public_attachment/${sessionId.toString()}/`)
    );
    expect(String(response.body.attachment.uri).startsWith('data:image/')).toBe(false);
    expect(String(response.body.attachment.url).startsWith('data:image/')).toBe(false);

    const filePath = String(response.body.attachment.file_path || '');
    expect(filePath).toContain(`/uploads/voicebot/attachments/${sessionId.toString()}/`);
    expect(filePath.endsWith('.png')).toBe(true);
    expect(existsSync(filePath)).toBe(true);
    createdFiles.push(filePath);

    const directoryPath = filePath.slice(0, filePath.lastIndexOf('/'));
    createdDirs.push(directoryPath);
  });
});
