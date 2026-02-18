import express from 'express';
import request from 'supertest';
import { ObjectId } from 'mongodb';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { VOICEBOT_COLLECTIONS, VOICEBOT_SESSION_TYPES } from '../../src/constants.js';

const getDbMock = jest.fn();
const getRawDbMock = jest.fn();
const requirePermissionMock = jest.fn(() => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next());
const getUserPermissionsMock = jest.fn();
const generateDataFilterMock = jest.fn();

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

const { default: sessionsRouter } = await import('../../src/api/routes/voicebot/sessions.js');
const { default: uploadsRouter } = await import('../../src/api/routes/voicebot/uploads.js');

describe('VoiceBot API smoke', () => {
  beforeEach(() => {
    getDbMock.mockReset();
    getRawDbMock.mockReset();
    getUserPermissionsMock.mockReset();
    generateDataFilterMock.mockReset();
    requirePermissionMock.mockClear();
    getUserPermissionsMock.mockResolvedValue([]);
    generateDataFilterMock.mockResolvedValue({});
  });

  it('serves critical flat endpoints without 404 regressions', async () => {
    const performerId = new ObjectId('507f1f77bcf86cd799439011');
    const createdSessionId = new ObjectId();

    const dbStub = {
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return {
            insertOne: jest.fn(async () => ({ insertedId: createdSessionId })),
            findOne: jest.fn(async () => ({
              _id: createdSessionId,
              chat_id: 123,
              user_id: performerId.toString(),
              is_deleted: false,
              session_type: VOICEBOT_SESSION_TYPES.MULTIPROMPT_VOICE_SESSION,
            })),
          };
        }
        if (name === VOICEBOT_COLLECTIONS.TG_VOICE_SESSIONS) {
          return {
            updateOne: jest.fn(async () => ({ upsertedCount: 1 })),
          };
        }
        if (name === VOICEBOT_COLLECTIONS.PERFORMERS) {
          return {
            find: jest.fn(() => ({
              project: jest.fn(() => ({
                sort: jest.fn(() => ({
                  toArray: async () => [],
                })),
              })),
            })),
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
        telegram_id: '123',
        projects_access: [],
      };
      vreq.user = { userId: performerId.toString() };
      next();
    });
    app.use('/voicebot', sessionsRouter);
    app.use('/voicebot', uploadsRouter);

    const createRes = await request(app)
      .post('/voicebot/create_session')
      .send({ session_name: 'Smoke' });
    expect(createRes.status).toBe(201);
    expect(createRes.body.session_id).toBe(createdSessionId.toString());

    const addTextRes = await request(app)
      .post('/voicebot/add_text')
      .send({});
    expect(addTextRes.status).toBe(400);
    expect(addTextRes.body.error).toBe('session_id is required');

    const triggerRes = await request(app)
      .post('/voicebot/trigger_session_ready_to_summarize')
      .send({});
    expect(triggerRes.status).toBe(400);
    expect(triggerRes.body.error).toBe('session_id is required');

    const usersRes = await request(app)
      .post('/voicebot/auth/list-users')
      .send({});
    expect(usersRes.status).toBe(200);
    expect(Array.isArray(usersRes.body)).toBe(true);
  });
});
