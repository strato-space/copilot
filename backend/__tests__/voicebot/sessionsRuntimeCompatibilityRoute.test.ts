import express from 'express';
import request from 'supertest';
import { ObjectId } from 'mongodb';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

process.env.VOICE_RUNTIME_ENV = 'prod';
process.env.VOICE_RUNTIME_SERVER_NAME = 'p2';

const getDbMock = jest.fn();
const getRawDbMock = jest.fn();
const generateDataFilterMock = jest.fn();
const getUserPermissionsMock = jest.fn();
const requirePermissionMock = jest.fn(
  () =>
    (_req: express.Request, _res: express.Response, next: express.NextFunction) =>
      next()
);

jest.unstable_mockModule('../../src/services/db.js', () => ({
  getDb: getDbMock,
  getRawDb: getRawDbMock,
}));

jest.unstable_mockModule('../../src/permissions/permission-manager.js', () => ({
  PermissionManager: {
    generateDataFilter: generateDataFilterMock,
    getUserPermissions: getUserPermissionsMock,
    requirePermission: requirePermissionMock,
  },
}));

const { PERMISSIONS } = await import('../../src/permissions/permissions-config.js');
const { VOICEBOT_COLLECTIONS } = await import('../../src/constants.js');
const { default: sessionsRouter } = await import('../../src/api/routes/voicebot/sessions.js');

const performerId = new ObjectId('507f1f77bcf86cd799439011');

const buildApp = () => {
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
    vreq.user = {
      userId: performerId.toString(),
      email: 'test@example.com',
    };
    next();
  });
  app.use('/voicebot', sessionsRouter);
  return app;
};

describe('VoiceBot sessions runtime compatibility (prod + prod-*)', () => {
  beforeEach(() => {
    getDbMock.mockReset();
    getRawDbMock.mockReset();
    generateDataFilterMock.mockReset();
    getUserPermissionsMock.mockReset();
    requirePermissionMock.mockClear();
    generateDataFilterMock.mockResolvedValue({});
    getUserPermissionsMock.mockResolvedValue([PERMISSIONS.VOICEBOT_SESSIONS.READ_ALL]);
  });

  it('POST /voicebot/list applies prod-family runtime filter (prod + prod-*)', async () => {
    const aggregatePipelineCalls: Array<Array<Record<string, unknown>>> = [];
    const aggregateMock = jest.fn(async () => [
      {
        _id: new ObjectId(),
        chat_id: 123456,
        session_name: 'Prod session',
        message_count: 1,
        is_active: false,
      },
    ]);

    const rawDbStub = {
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return {
            aggregate: jest.fn((pipeline: Array<Record<string, unknown>>) => {
              aggregatePipelineCalls.push(pipeline);
              return { toArray: () => aggregateMock() };
            }),
          };
        }
        return {
          aggregate: jest.fn(() => ({ toArray: async () => [] })),
        };
      },
    };

    getDbMock.mockReturnValue(rawDbStub);
    getRawDbMock.mockReturnValue(rawDbStub);

    const app = buildApp();
    const response = await request(app).post('/voicebot/list').send({});

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body).toHaveLength(1);

    const [pipeline] = aggregatePipelineCalls;
    const runtimeClause = ((pipeline?.[0]?.$match as Record<string, unknown>)?.$and as Array<Record<string, unknown>>)
      ?.find((item) => '$or' in item);

    expect(runtimeClause).toEqual({
      $or: [
        { runtime_tag: { $regex: '^prod(?:-|$)' } },
        { runtime_tag: { $exists: false } },
        { runtime_tag: null },
        { runtime_tag: '' },
      ],
    });

    const lookupStage = pipeline?.find((stage) => {
      const lookup = (stage as { $lookup?: { from?: string } })?.$lookup;
      return lookup?.from === VOICEBOT_COLLECTIONS.MESSAGES;
    }) as
      | { $lookup?: { from?: string; pipeline?: Array<Record<string, unknown>> } }
      | undefined;
    expect(lookupStage?.$lookup?.from).toBe(VOICEBOT_COLLECTIONS.MESSAGES);
    const lookupMatchStage = lookupStage?.$lookup?.pipeline?.find((stage) =>
      Object.prototype.hasOwnProperty.call(stage, '$match')
    ) as { $match?: { $and?: Array<Record<string, unknown>> } } | undefined;
    const lookupRuntimeClause = lookupMatchStage?.$match?.$and?.find((entry) =>
      Object.prototype.hasOwnProperty.call(entry, '$or')
    );

    expect(lookupRuntimeClause).toEqual({
      $or: [
        { runtime_tag: { $regex: '^prod(?:-|$)' } },
        { runtime_tag: { $exists: false } },
        { runtime_tag: null },
        { runtime_tag: '' },
      ],
    });
  });

  it('POST /voicebot/session reads a legacy "prod" session when runtime is "prod-p2"', async () => {
    const sessionId = new ObjectId();
    const sessionFindOne = jest.fn(async () => ({
      _id: sessionId,
      chat_id: 123456,
      user_id: performerId.toString(),
      session_name: 'Legacy prod session',
      runtime_tag: 'prod',
      is_active: false,
      participants: [],
      allowed_users: [],
    }));
    const messagesFind = jest.fn(() => ({
      toArray: async () => [
        {
          _id: new ObjectId(),
          session_id: sessionId,
          message_id: 'msg-1',
          message_timestamp: 1,
          message_type: 'voice',
          transcription_text: 'hello',
        },
      ],
    }));

    const rawDbStub = {
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return { findOne: sessionFindOne };
        }
        if (name === VOICEBOT_COLLECTIONS.MESSAGES) {
          return { find: messagesFind };
        }
        return {
          find: jest.fn(() => ({ project: () => ({ toArray: async () => [] }) })),
          findOne: jest.fn(async () => null),
        };
      },
    };

    const dbStub = {
      collection: (_name: string) => ({
        find: jest.fn(() => ({ project: () => ({ toArray: async () => [] }) })),
      }),
    };

    getRawDbMock.mockReturnValue(rawDbStub);
    getDbMock.mockReturnValue(dbStub);

    const app = buildApp();
    const response = await request(app)
      .post('/voicebot/session')
      .send({ session_id: sessionId.toHexString() });

    expect(response.status).toBe(200);
    expect(response.body.voice_bot_session).toBeDefined();
    expect(response.body.session_messages).toHaveLength(1);

    const [sessionQuery] = sessionFindOne.mock.calls[0] as [Record<string, unknown>];
    expect(sessionQuery).toEqual(
      expect.objectContaining({
        $and: expect.arrayContaining([
          expect.objectContaining({ _id: expect.any(ObjectId) }),
          {
            $or: [
              { runtime_tag: { $regex: '^prod(?:-|$)' } },
              { runtime_tag: { $exists: false } },
              { runtime_tag: null },
              { runtime_tag: '' },
            ],
          },
        ]),
      })
    );

    const [messagesQuery] = messagesFind.mock.calls[0] as [Record<string, unknown>];
    expect(messagesQuery).toEqual(
      expect.objectContaining({
        $and: expect.arrayContaining([
          expect.objectContaining({ session_id: expect.any(ObjectId) }),
          {
            $or: [
              { runtime_tag: { $regex: '^prod(?:-|$)' } },
              { runtime_tag: { $exists: false } },
              { runtime_tag: null },
              { runtime_tag: '' },
            ],
          },
        ]),
      })
    );
  });


  it('POST /voicebot/session returns both legacy uri and direct_uri for telegram attachments', async () => {
    const sessionId = new ObjectId();
    const messageObjectId = new ObjectId();

    const rawDbStub = {
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return {
            findOne: jest.fn(async () => ({
              _id: sessionId,
              chat_id: 123456,
              user_id: performerId.toString(),
              session_name: 'Attachment parity',
              runtime_tag: 'prod-p2',
              is_active: true,
              participants: [],
              allowed_users: [],
            })),
          };
        }
        if (name === VOICEBOT_COLLECTIONS.MESSAGES) {
          return {
            find: jest.fn(() => ({
              toArray: async () => [
                {
                  _id: messageObjectId,
                  session_id: sessionId,
                  message_id: 'telegram-msg-1',
                  message_timestamp: 1700000000,
                  source_type: 'telegram',
                  message_type: 'document',
                  attachments: [
                    {
                      source: 'telegram',
                      kind: 'document',
                      file_id: 'file-id-1',
                      file_unique_id: 'uniq-file-1',
                      name: 'note.pdf',
                      mimeType: 'application/pdf',
                    },
                  ],
                },
              ],
            })),
          };
        }

        return {
          findOne: jest.fn(async () => null),
          find: jest.fn(() => ({ toArray: async () => [] })),
        };
      },
    };

    const dbStub = {
      collection: (_name: string) => ({
        find: jest.fn(() => ({ project: () => ({ toArray: async () => [] }) })),
        findOne: jest.fn(async () => null),
      }),
    };

    getRawDbMock.mockReturnValue(rawDbStub);
    getDbMock.mockReturnValue(dbStub);

    const app = buildApp();
    const response = await request(app)
      .post('/voicebot/session')
      .send({ session_id: sessionId.toHexString() });

    expect(response.status).toBe(200);
    const attachments = response.body.session_attachments as Array<Record<string, unknown>>;
    expect(Array.isArray(attachments)).toBe(true);
    expect(attachments).toHaveLength(1);

    const [attachment] = attachments;
    expect(attachment.uri).toBe(`/api/voicebot/message_attachment/${messageObjectId.toHexString()}/0`);
    expect(attachment.url).toBe(`/api/voicebot/message_attachment/${messageObjectId.toHexString()}/0`);
    expect(attachment.direct_uri).toBe(`/api/voicebot/public_attachment/${sessionId.toHexString()}/uniq-file-1`);
  });

});
