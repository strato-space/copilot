import express from 'express';
import request from 'supertest';
import { ObjectId } from 'mongodb';
import { beforeEach, describe, expect, it, jest, afterEach } from '@jest/globals';
import { existsSync, unlinkSync } from 'node:fs';

import { VOICEBOT_COLLECTIONS, VOICEBOT_JOBS, VOICEBOT_QUEUES } from '../../src/constants.js';
import { PERMISSIONS } from '../../src/permissions/permissions-config.js';
import { IS_PROD_RUNTIME } from '../../src/services/runtimeScope.js';

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
  it('enqueues transcribe job when voice queue is available', async () => {
    const sessionId = new ObjectId();
    const performerId = new ObjectId('507f1f77bcf86cd799439019');
    const insertedMessages: Array<Record<string, unknown>> = [];

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
            insertOne: jest.fn(async (doc: Record<string, unknown>) => {
              insertedMessages.push(doc);
              return { insertedId: new ObjectId('507f1f77bcf86cd79943909a') };
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

    const voiceQueueAddMock = jest.fn(async () => ({ id: 'job-1' }));

    const app = express();
    app.use(express.json());
    app.set('voicebotQueues', {
      [VOICEBOT_QUEUES.VOICE]: {
        add: voiceQueueAddMock,
      },
    });
    app.use((req, _res, next) => {
      const vreq = req as express.Request & {
        performer: Record<string, unknown>;
        user: Record<string, unknown>;
      };
      vreq.performer = {
        _id: performerId,
        telegram_id: '777',
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
    expect(voiceQueueAddMock).toHaveBeenCalledTimes(1);
    expect(voiceQueueAddMock).toHaveBeenCalledWith(
      VOICEBOT_JOBS.voice.TRANSCRIBE,
      expect.objectContaining({
        session_id: sessionId.toString(),
        message_id: '507f1f77bcf86cd79943909a',
        message_db_id: '507f1f77bcf86cd79943909a',
      }),
      expect.objectContaining({
        deduplication: expect.objectContaining({
          id: `${sessionId.toString()}-507f1f77bcf86cd79943909a-TRANSCRIBE`,
        }),
      })
    );

    expect(insertedMessages).toHaveLength(1);
    expect(insertedMessages[0]?.to_transcribe).toBe(false);

    const persisted = insertedMessages[0] ?? {};
    const storedPath = typeof persisted.file_path === 'string' ? persisted.file_path : '';
    if (storedPath) uploadedFilePaths.add(storedPath);
  });

  it('pushes new_message and session_update to the socket room after upload', async () => {
    const sessionId = new ObjectId();
    const performerId = new ObjectId('507f1f77bcf86cd799439012');
    const insertedMessages: Array<Record<string, unknown>> = [];

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
            insertOne: jest.fn(async (doc: Record<string, unknown>) => {
              insertedMessages.push(doc);
              return { insertedId: new ObjectId('507f1f77bcf86cd799439099') };
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

    const emitMock = jest.fn();
    const toMock = jest.fn(() => ({ emit: emitMock }));
    const ofMock = jest.fn(() => ({ to: toMock }));

    const app = express();
    app.use(express.json());
    app.set('io', { of: ofMock });
    app.use((req, _res, next) => {
      const vreq = req as express.Request & {
        performer: Record<string, unknown>;
        user: Record<string, unknown>;
      };
      vreq.performer = {
        _id: performerId,
        telegram_id: '777',
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
    expect(insertedMessages).toHaveLength(1);

    const persisted = insertedMessages[0] ?? {};
    const storedPath = typeof persisted.file_path === 'string' ? persisted.file_path : '';
    if (storedPath) uploadedFilePaths.add(storedPath);

    expect(ofMock).toHaveBeenCalledWith('/voicebot');
    expect(toMock).toHaveBeenNthCalledWith(1, `voicebot:session:${sessionId.toString()}`);
    expect(toMock).toHaveBeenNthCalledWith(2, `voicebot:session:${sessionId.toString()}`);

    expect(emitMock).toHaveBeenNthCalledWith(
      1,
      'new_message',
      expect.objectContaining({
        session_id: sessionId.toString(),
        runtime_tag: 'prod-p2',
        is_transcribed: false,
      })
    );
    expect(emitMock).toHaveBeenNthCalledWith(
      2,
      'session_update',
      expect.objectContaining({
        session_id: sessionId.toString(),
        runtime_tag: 'prod-p2',
        is_messages_processed: false,
      })
    );
  });

  it('accepts upload for inactive (closed) sessions when session is not deleted', async () => {
    const sessionId = new ObjectId();
    const performerId = new ObjectId('507f1f77bcf86cd799439021');
    const insertedMessages: Array<Record<string, unknown>> = [];

    const dbStub = {
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return {
            findOne: jest.fn(async () => ({
              _id: sessionId,
              chat_id: 333,
              user_id: performerId.toString(),
              access_level: 'private',
              is_active: false,
              is_deleted: false,
              runtime_tag: 'prod-p2',
            })),
            updateOne: jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 })),
          };
        }
        if (name === VOICEBOT_COLLECTIONS.MESSAGES) {
          return {
            insertOne: jest.fn(async (doc: Record<string, unknown>) => {
              insertedMessages.push(doc);
              return { insertedId: new ObjectId('507f1f77bcf86cd799439098') };
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
        telegram_id: '333',
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
    expect(insertedMessages).toHaveLength(1);

    const persisted = insertedMessages[0] ?? {};
    const storedPath = typeof persisted.file_path === 'string' ? persisted.file_path : '';
    if (storedPath) uploadedFilePaths.add(storedPath);
  });


  it('returns runtime_mismatch (409) when target session is owned by different runtime family', async () => {
    const sessionId = new ObjectId();
    const performerId = new ObjectId('507f1f77bcf86cd799439013');

    const runtimeMismatchSession = {
      _id: sessionId,
      chat_id: 999,
      user_id: performerId.toString(),
      access_level: 'private',
      is_deleted: false,
      runtime_tag: IS_PROD_RUNTIME ? 'dev-other-host' : 'prod-other-host',
    };

    const dbStub = {
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return {
            findOne: jest.fn(async (_query: Record<string, unknown>) => null),
            updateOne: jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 })),
          };
        }
        return {
          findOne: jest.fn(async () => null),
          updateOne: jest.fn(async () => ({ matchedCount: 0, modifiedCount: 0 })),
          insertOne: jest.fn(async () => ({ insertedId: new ObjectId() })),
        };
      },
    };

    const rawDbStub = {
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return {
            findOne: jest.fn(async (_query: Record<string, unknown>) => runtimeMismatchSession),
          };
        }
        return { findOne: jest.fn(async () => null) };
      },
    };

    getDbMock.mockReturnValue(dbStub);
    getRawDbMock.mockReturnValue(rawDbStub);

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      const vreq = req as express.Request & { performer: Record<string, unknown>; user: Record<string, unknown> };
      vreq.performer = {
        _id: performerId,
        telegram_id: '999',
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

    expect(response.status).toBe(409);
    expect(response.body.error).toBe('runtime_mismatch');
  });

});
