import express from 'express';
import request from 'supertest';
import { ObjectId } from 'mongodb';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { VOICEBOT_COLLECTIONS } from '../../src/constants.js';
import { PERMISSIONS } from '../../src/permissions/permissions-config.js';

const getDbMock = jest.fn();
const getRawDbMock = jest.fn();
const getUserPermissionsMock = jest.fn();
const generateDataFilterMock = jest.fn();

jest.unstable_mockModule('../../src/services/db.js', () => ({
  getDb: getDbMock,
  getRawDb: getRawDbMock,
}));

jest.unstable_mockModule('../../src/permissions/permission-manager.js', () => ({
  PermissionManager: {
    getUserPermissions: getUserPermissionsMock,
    generateDataFilter: generateDataFilterMock,
  },
}));

const { default: sessionsRouter } = await import('../../src/api/routes/voicebot/sessions.js');

describe('POST /voicebot/auth/list-users', () => {
  beforeEach(() => {
    getDbMock.mockReset();
    getRawDbMock.mockReset();
    getUserPermissionsMock.mockReset();
    generateDataFilterMock.mockReset();
    getUserPermissionsMock.mockResolvedValue([PERMISSIONS.VOICEBOT_SESSIONS.READ_ALL]);
    generateDataFilterMock.mockResolvedValue({});
  });

  it('returns performers list in expected shape', async () => {
    const performerId = new ObjectId('507f1f77bcf86cd799439011');
    const usersCollection = {
      find: jest.fn(() => ({
        project: jest.fn(() => ({
          sort: jest.fn(() => ({
            toArray: async () => [
              {
                _id: performerId,
                name: '',
                real_name: 'User One',
                corporate_email: 'user.one@strato.space',
                role: 'ADMIN',
              },
            ],
          })),
        })),
      })),
    };

    const dbStub = {
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.PERFORMERS) return usersCollection;
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
      vreq.performer = { _id: performerId, telegram_id: '123' };
      vreq.user = { userId: performerId.toString() };
      next();
    });
    app.use('/voicebot', sessionsRouter);

    const response = await request(app)
      .post('/voicebot/auth/list-users')
      .send({});

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body).toHaveLength(1);
    expect(response.body[0]).toMatchObject({
      name: 'User One',
      email: 'user.one@strato.space',
      role: 'ADMIN',
    });
  });
});
