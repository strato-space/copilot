import express from 'express';
import request from 'supertest';
import { ObjectId } from 'mongodb';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { VOICEBOT_COLLECTIONS } from '../../src/constants.js';
import { PERMISSIONS } from '../../src/permissions/permissions-config.js';

const getDbMock = jest.fn();
const getRawDbMock = jest.fn();
const getUserPermissionsMock = jest.fn();

jest.unstable_mockModule('../../src/services/db.js', () => ({
  getDb: getDbMock,
  getRawDb: getRawDbMock,
}));

jest.unstable_mockModule('../../src/permissions/permission-manager.js', () => ({
  PermissionManager: {
    getUserPermissions: getUserPermissionsMock,
  },
}));

const { default: transcriptionRouter } = await import('../../src/api/routes/voicebot/transcription.js');

describe('VoiceBot transcription runtime scoping', () => {
  beforeEach(() => {
    getDbMock.mockReset();
    getRawDbMock.mockReset();
    getUserPermissionsMock.mockReset();
    getUserPermissionsMock.mockResolvedValue([PERMISSIONS.VOICEBOT_SESSIONS.READ_ALL]);
  });

  it('applies runtime-scoped queries for /get', async () => {
    const sessionId = new ObjectId();
    const performerId = new ObjectId('507f1f77bcf86cd799439011');
    const sessionsFindOne = jest.fn(async () => ({
      _id: sessionId,
      chat_id: 123,
      user_id: performerId.toString(),
      is_deleted: false,
    }));
    const messagesFind = jest.fn(() => ({
      sort: jest.fn(() => ({
        toArray: async () => [],
      })),
    }));

    const dbStub = {
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return { findOne: sessionsFindOne };
        }
        if (name === VOICEBOT_COLLECTIONS.MESSAGES) {
          return { find: messagesFind };
        }
        return {};
      },
    };
    getDbMock.mockReturnValue(dbStub);

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      const vreq = req as express.Request & {
        performer: Record<string, unknown>;
        user: Record<string, unknown>;
      };
      vreq.performer = { _id: performerId, telegram_id: '123' };
      vreq.user = { userId: performerId.toString() };
      next();
    });
    app.use('/transcription', transcriptionRouter);

    const response = await request(app)
      .post('/transcription/get')
      .send({ session_id: sessionId.toString() });

    expect(response.status).toBe(200);
    const [sessionQuery] = sessionsFindOne.mock.calls[0] as [Record<string, unknown>];
    const [messagesQuery] = messagesFind.mock.calls[0] as [Record<string, unknown>];
    expect(sessionQuery).toHaveProperty('$and');
    expect(messagesQuery).toHaveProperty('$and');
  });

  it('returns markdown file for /download/:session_id without runtime-scoped queries', async () => {
    const sessionId = new ObjectId();
    const performerId = new ObjectId('507f1f77bcf86cd799439021');
    const sessionsFindOne = jest.fn(async () => ({
      _id: sessionId,
      chat_id: 321,
      user_id: performerId.toString(),
      session_name: 'Demo Session',
      created_at: new Date('2026-02-24T10:00:00.000Z'),
      is_deleted: false,
    }));
    const messagesFind = jest.fn(() => ({
      sort: jest.fn(() => ({
        toArray: async () => ([
          { transcription_text: 'first line' },
          { transcription: { text: 'second line' } },
        ]),
      })),
    }));

    const dbStub = {
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return { findOne: sessionsFindOne };
        }
        if (name === VOICEBOT_COLLECTIONS.MESSAGES) {
          return { find: messagesFind };
        }
        return {};
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
      vreq.performer = { _id: performerId, telegram_id: '321' };
      vreq.user = { userId: performerId.toString(), email: 'user@example.com' };
      next();
    });
    app.use('/transcription', transcriptionRouter);

    const response = await request(app)
      .get(`/transcription/download/${sessionId.toString()}`);

    expect(response.status).toBe(200);
    expect(response.text).toContain('first line');
    expect(response.text).toContain('second line');
    expect(response.headers['content-type']).toContain('text/markdown');
    expect(response.headers['content-disposition']).toContain('.md');

    const [sessionQuery] = sessionsFindOne.mock.calls[0] as [Record<string, unknown>];
    const [messagesQuery] = messagesFind.mock.calls[0] as [Record<string, unknown>];
    expect(sessionQuery).not.toHaveProperty('$and');
    expect(messagesQuery).not.toHaveProperty('$and');
  });

  it('returns 400 on invalid session_id format', async () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      const vreq = req as express.Request & {
        performer: Record<string, unknown>;
        user: Record<string, unknown>;
      };
      vreq.performer = { _id: new ObjectId(), telegram_id: '1' };
      vreq.user = { userId: new ObjectId().toString() };
      next();
    });
    app.use('/transcription', transcriptionRouter);

    const response = await request(app)
      .post('/transcription/get')
      .send({ session_id: 'not-an-objectid' });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Invalid session_id');
  });

  it('returns 400 on invalid session_id format for /download', async () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      const vreq = req as express.Request & {
        performer: Record<string, unknown>;
        user: Record<string, unknown>;
      };
      vreq.performer = { _id: new ObjectId(), telegram_id: '1' };
      vreq.user = { userId: new ObjectId().toString() };
      next();
    });
    app.use('/transcription', transcriptionRouter);

    const response = await request(app)
      .get('/transcription/download/not-an-objectid');

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Invalid session_id');
  });
});
