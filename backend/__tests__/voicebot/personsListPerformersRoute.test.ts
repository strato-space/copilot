import express from 'express';
import request from 'supertest';
import { ObjectId } from 'mongodb';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { VOICEBOT_COLLECTIONS } from '../../src/constants.js';

const getDbMock = jest.fn();
const requirePermissionMock = jest.fn(
  () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next()
);

jest.unstable_mockModule('../../src/services/db.js', () => ({
  getDb: getDbMock,
}));

jest.unstable_mockModule('../../src/permissions/permission-manager.js', () => ({
  PermissionManager: {
    requirePermission: requirePermissionMock,
  },
}));

const { default: personsRouter } = await import('../../src/api/routes/voicebot/persons.js');

describe('POST /voicebot/persons/list_performers', () => {
  beforeEach(() => {
    getDbMock.mockReset();
    requirePermissionMock.mockClear();
  });

  it('filters performers by canonical lifecycle and keeps include_ids rows', async () => {
    const activePerformerId = new ObjectId('507f1f77bcf86cd799439021');
    const includedPerformerId = new ObjectId('507f1f77bcf86cd799439022');
    const findMock = jest.fn(() => ({
      project: jest.fn(() => ({
        sort: jest.fn(() => ({
          toArray: async () => [
            {
              _id: activePerformerId,
              name: 'Active User',
              corporate_email: 'active@strato.space',
            },
            {
              _id: includedPerformerId,
              real_name: 'Archived User',
              corporate_email: 'archived@strato.space',
            },
          ],
        })),
      })),
    }));

    const dbStub = {
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.PERFORMERS) {
          return { find: findMock };
        }
        return {
          findOne: jest.fn(async () => null),
        };
      },
    };

    getDbMock.mockReturnValue(dbStub);

    const app = express();
    app.use(express.json());
    app.use('/voicebot/persons', personsRouter);

    const response = await request(app)
      .post('/voicebot/persons/list_performers')
      .send({ include_ids: [includedPerformerId.toHexString()] });

    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      {
        _id: activePerformerId.toHexString(),
        name: 'Active User',
        email: 'active@strato.space',
        projects_access: [],
      },
      {
        _id: includedPerformerId.toHexString(),
        name: 'Archived User',
        email: 'archived@strato.space',
        projects_access: [],
      },
    ]);

    expect(findMock).toHaveBeenCalledWith({
      $or: [
        {
          $and: [
            { is_deleted: { $ne: true } },
            { is_active: { $ne: false } },
            { active: { $ne: false } },
            {
              $nor: [
                { corporate_email: { $in: [/^gatitulin@strato\.space$/i, /^vilco@yandex\.ru$/i] } },
                { email: { $in: [/^gatitulin@strato\.space$/i, /^vilco@yandex\.ru$/i] } },
                { name: { $in: [/^d1zmens$/i, /^vilco_o$/i] } },
                { real_name: { $in: [/^d1zmens$/i, /^vilco_o$/i] } },
                { username: { $in: [/^d1zmens$/i, /^vilco_o$/i] } },
                { telegram_username: { $in: [/^d1zmens$/i, /^vilco_o$/i] } },
                { login: { $in: [/^d1zmens$/i, /^vilco_o$/i] } },
              ],
            },
          ],
        },
        { _id: { $in: [includedPerformerId] } },
      ],
    });
  });
});
