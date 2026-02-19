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
  getFileSha256FromPath: jest.fn(async () => 'sha256-smoke'),
}));

const { default: uploadsRouter } = await import('../../src/api/routes/voicebot/uploads.js');

let tempDir = '';
let originalFetch: typeof global.fetch | undefined;

describe('VoiceBot attachment smoke', () => {
  beforeEach(() => {
    getDbMock.mockReset();
    getRawDbMock.mockReset();
    requirePermissionMock.mockClear();
    getUserPermissionsMock.mockReset();
    getUserPermissionsMock.mockResolvedValue([PERMISSIONS.VOICEBOT_SESSIONS.READ_ALL]);

    tempDir = mkdtempSync(join(tmpdir(), 'voice-attach-smoke-'));
    originalFetch = global.fetch;
  });

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = '';
    }
    if (originalFetch) {
      global.fetch = originalFetch;
    } else {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete (global as { fetch?: typeof global.fetch }).fetch;
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

  it('streams telegram attachment via Telegram API when local file path is absent', async () => {
    process.env.TG_VOICE_BOT_BETA_TOKEN = 'beta-token-smoke';

    const performerId = new ObjectId('507f1f77bcf86cd799439012');
    const sessionId = new ObjectId();
    const messageId = new ObjectId();
    const fileUniqueId = 'uniq-smoke-telegram';

    const messageDoc = {
      _id: messageId,
      session_id: sessionId,
      source_type: 'telegram',
      message_type: 'photo',
      file_id: 'tg-file-id-1',
      attachments: [
        {
          source: 'telegram',
          file_id: 'tg-file-id-1',
          file_unique_id: fileUniqueId,
          mimeType: 'image/png',
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

    const fetchMock = jest
      .fn<typeof global.fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, result: { file_path: 'photos/file_1.png' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response('png-binary-smoke', {
          status: 200,
          headers: { 'content-type': 'image/png' },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, result: { file_path: 'photos/file_1.png' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response('png-binary-smoke', {
          status: 200,
          headers: { 'content-type': 'image/png' },
        })
      );
    global.fetch = fetchMock as typeof global.fetch;

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
    expect(protectedRes.headers['content-type']).toContain('image/png');
    expect(protectedRes.body.toString()).toBe('png-binary-smoke');

    const publicRes = await request(app).get(`/voicebot/public_attachment/${sessionId.toHexString()}/${fileUniqueId}`);
    expect(publicRes.status).toBe(200);
    expect(publicRes.headers['content-type']).toContain('image/png');
    expect(publicRes.body.toString()).toBe('png-binary-smoke');

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[0]?.[0]).toContain('/getFile?file_id=tg-file-id-1');
    expect(fetchMock.mock.calls[1]?.[0]).toContain('/file/botbeta-token-smoke/photos/file_1.png');
  });
});
