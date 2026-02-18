import express from 'express';
import request from 'supertest';
import { ObjectId } from 'mongodb';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { VOICEBOT_COLLECTIONS } from '../../src/constants.js';

const getDbMock = jest.fn();
const requirePermissionMock = jest.fn(() => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next());
const getUserPermissionsMock = jest.fn();

jest.unstable_mockModule('../../src/services/db.js', () => ({
  getDb: getDbMock,
}));

jest.unstable_mockModule('../../src/permissions/permission-manager.js', () => ({
  PermissionManager: {
    requirePermission: requirePermissionMock,
    getUserPermissions: getUserPermissionsMock,
  },
}));

const { default: permissionsRouter } = await import('../../src/api/routes/voicebot/permissions.js');

describe('VoiceBot permissions runtime scoping', () => {
  beforeEach(() => {
    getDbMock.mockReset();
    requirePermissionMock.mockClear();
    getUserPermissionsMock.mockReset();
  });

  it('scopes /log query with runtime filter', async () => {
    const permissionsLogFind = jest.fn(() => ({
      sort: jest.fn(() => ({
        skip: jest.fn(() => ({
          limit: jest.fn(() => ({
            toArray: async () => [],
          })),
        })),
      })),
    }));
    const dbStub = {
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.PERMISSIONS_LOG) {
          return { find: permissionsLogFind };
        }
        return {};
      },
    };
    getDbMock.mockReturnValue(dbStub);

    const app = express();
    app.use(express.json());
    app.use('/permissions', permissionsRouter);

    const response = await request(app)
      .post('/permissions/log')
      .send({ limit: 10, skip: 0 });

    expect(response.status).toBe(200);
    const [query] = permissionsLogFind.mock.calls[0] as [Record<string, unknown>];
    expect(
      Object.prototype.hasOwnProperty.call(query, '$and')
      || Object.prototype.hasOwnProperty.call(query, '$or')
      || Object.prototype.hasOwnProperty.call(query, 'runtime_tag')
    ).toBe(true);
  });

  it('writes runtime_tag in permission log records', async () => {
    const actorId = new ObjectId('507f1f77bcf86cd799439011');
    const targetId = new ObjectId('507f1f77bcf86cd799439012');
    const performersUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
    const permissionsLogInsertOne = jest.fn(async () => ({ insertedId: new ObjectId() }));

    const dbStub = {
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.PERFORMERS) {
          return { updateOne: performersUpdateOne };
        }
        if (name === VOICEBOT_COLLECTIONS.PERMISSIONS_LOG) {
          return { insertOne: permissionsLogInsertOne };
        }
        return {};
      },
    };
    getDbMock.mockReturnValue(dbStub);

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      const preq = req as express.Request & { user: Record<string, unknown> };
      preq.user = { userId: actorId.toString(), email: 'admin@strato.space' };
      next();
    });
    app.use('/permissions', permissionsRouter);

    const response = await request(app)
      .post('/permissions/users/role')
      .send({
        user_id: targetId.toString(),
        role: 'ADMIN',
        additional_roles: [],
      });

    expect(response.status).toBe(200);
    expect(permissionsLogInsertOne).toHaveBeenCalledTimes(1);
    const [insertDoc] = permissionsLogInsertOne.mock.calls[0] as [Record<string, unknown>];
    expect(insertDoc.runtime_tag).toBeDefined();
  });
});
