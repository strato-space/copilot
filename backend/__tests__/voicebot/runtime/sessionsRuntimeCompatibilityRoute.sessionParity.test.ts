import request from 'supertest';
import { ObjectId } from 'mongodb';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import {
  VOICEBOT_COLLECTIONS,
  performerId,
  getDbMock,
  getRawDbMock,
  buildApp,
  createStableMessagesCountAggregateMock,
  resetSessionsRuntimeCompatibilityMocks,
} from './sessionsRuntimeCompatibilityRoute.test.helpers.js';

describe('VoiceBot sessions runtime compatibility (runtime-tag agnostic)', () => {
  beforeEach(() => {
    resetSessionsRuntimeCompatibilityMocks();
  });

  it('POST /voicebot/list keeps access filter only without runtime_tag clauses', async () => {
    const aggregatePipelineCalls: Array<Array<Record<string, unknown>>> = [];
    const visibleSessionId = new ObjectId();
    const aggregateMock = jest.fn(async () => [
      {
        _id: visibleSessionId,
        chat_id: 123456,
        session_name: 'Prod session',
        is_active: false,
      },
    ]);
    const messageCountsAggregate = createStableMessagesCountAggregateMock({
      [visibleSessionId.toHexString()]: 1,
    });

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
        if (name === VOICEBOT_COLLECTIONS.MESSAGES) {
          return {
            aggregate: messageCountsAggregate,
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
    expect(pipeline?.[0]).toEqual({ $match: {} });
    expect(JSON.stringify(pipeline ?? [])).not.toContain('runtime_tag');

    expect(messageCountsAggregate).toHaveBeenCalledTimes(1);
    const [messageCountPipeline] = messageCountsAggregate.mock.calls[0] as [
      Array<Record<string, unknown>>,
    ];
    expect(messageCountPipeline).toEqual([
      {
        $match: {
          session_id: { $in: [visibleSessionId] },
        },
      },
      {
        $group: {
          _id: '$session_id',
          count: { $sum: 1 },
        },
      },
    ]);
  });

  it('POST /voicebot/list hides inactive sessions with zero messages when not deleted', async () => {
    const hiddenSessionId = new ObjectId();
    const rawDbStub = {
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return {
            aggregate: jest.fn(() => ({
              toArray: async () => [
                {
                  _id: hiddenSessionId,
                  chat_id: 999888,
                  session_name: 'Inactive empty session',
                  is_active: false,
                  is_deleted: false,
                },
              ],
            })),
          };
        }
        if (name === VOICEBOT_COLLECTIONS.MESSAGES) {
          return {
            aggregate: createStableMessagesCountAggregateMock({}),
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
    expect(response.body).toHaveLength(0);
  });

  it('POST /voicebot/session reads by id without runtime_tag filter wrappers', async () => {
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
        _id: expect.any(ObjectId),
        is_deleted: { $ne: true },
      })
    );
    expect(sessionQuery).not.toHaveProperty('$and');

    const [messagesQuery] = messagesFind.mock.calls[0] as [Record<string, unknown>];
    expect(messagesQuery).toEqual(
      expect.objectContaining({
        session_id: expect.any(ObjectId),
        is_deleted: { $ne: true },
      })
    );
    expect(messagesQuery).not.toHaveProperty('$and');
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

  it('POST /voicebot/session removes stale categorization rows for already deleted transcript segments', async () => {
    const sessionId = new ObjectId();
    const messageId = new ObjectId();
    const deletedSegmentId = `ch_${new ObjectId().toHexString()}`;

    const sessionFindOne = jest.fn(async () => ({
      _id: sessionId,
      chat_id: 123456,
      user_id: performerId.toString(),
      session_name: 'Stale cleanup parity',
      runtime_tag: 'prod-p2',
      is_active: true,
      is_deleted: false,
      participants: [],
      allowed_users: [],
    }));
    const messageUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
    const staleRowText = 'クレームチーズの 上に Кремиум Кремиум';
    const messagesFind = jest.fn(() => ({
      toArray: async () => [
        {
          _id: messageId,
          session_id: sessionId,
          message_id: 'msg-stale-1',
          runtime_tag: 'prod-p2',
          message_timestamp: 1700000000,
          message_type: 'voice',
          transcription: {
            text: staleRowText,
            segments: [
              {
                id: deletedSegmentId,
                text: 'クレームチーズの上に…Кремиум Кремиум',
                start: 0,
                end: 0,
                is_deleted: true,
              },
              {
                id: `ch_${new ObjectId().toHexString()}`,
                text: 'Keep me',
                start: 1,
                end: 1,
                is_deleted: false,
              },
            ],
          },
          categorization: [
            { text: staleRowText, start: '', end: '', speaker: 'Unknown' },
            { text: 'Keep me', start: '', end: '', speaker: 'Unknown' },
          ],
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
          findOne: jest.fn(async () => null),
          find: jest.fn(() => ({ toArray: async () => [] })),
        };
      },
    };

    const dbStub = {
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return { findOne: sessionFindOne };
        }
        if (name === VOICEBOT_COLLECTIONS.MESSAGES) {
          return { updateOne: messageUpdateOne };
        }
        if (name === VOICEBOT_COLLECTIONS.PERSONS || name === VOICEBOT_COLLECTIONS.PERFORMERS) {
          return { find: jest.fn(() => ({ project: () => ({ toArray: async () => [] }) })) };
        }
        return {
          findOne: jest.fn(async () => null),
          updateOne: jest.fn(async () => ({ matchedCount: 0, modifiedCount: 0 })),
          find: jest.fn(() => ({ project: () => ({ toArray: async () => [] }) })),
        };
      },
    };

    getRawDbMock.mockReturnValue(rawDbStub);
    getDbMock.mockReturnValue(dbStub);

    const app = buildApp();
    const response = await request(app)
      .post('/voicebot/session')
      .send({ session_id: sessionId.toHexString() });

    expect(response.status).toBe(200);
    const returnedRows = response.body.session_messages?.[0]?.categorization ?? [];
    expect(returnedRows).toEqual([
      { text: 'Keep me', start: '', end: '', speaker: 'Unknown' },
    ]);
    expect(messageUpdateOne).toHaveBeenCalledTimes(1);
    const [, updateDoc] = messageUpdateOne.mock.calls[0] as [Record<string, unknown>, { $set?: Record<string, unknown> }];
    expect(updateDoc.$set?.categorization).toEqual([
      { text: 'Keep me', start: '', end: '', speaker: 'Unknown' },
    ]);
  });

  it('POST /voicebot/session clears categorization when all transcript segments are deleted', async () => {
    const sessionId = new ObjectId();
    const messageId = new ObjectId();

    const sessionFindOne = jest.fn(async () => ({
      _id: sessionId,
      chat_id: 123456,
      user_id: performerId.toString(),
      session_name: 'All deleted transcript cleanup',
      runtime_tag: 'prod-p2',
      is_active: true,
      is_deleted: false,
      participants: [],
      allowed_users: [],
    }));
    const messageUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
    const messagesFind = jest.fn(() => ({
      toArray: async () => [
        {
          _id: messageId,
          session_id: sessionId,
          message_id: 'msg-all-deleted',
          runtime_tag: 'prod-p2',
          message_timestamp: 1700000000,
          message_type: 'voice',
          transcription: {
            segments: [
              { id: `ch_${new ObjectId().toHexString()}`, text: 'first', start: 0, end: 0, is_deleted: true },
              { id: `ch_${new ObjectId().toHexString()}`, text: 'second', start: 1, end: 1, is_deleted: true },
            ],
          },
          categorization: [
            { text: 'stale row #1', start: '', end: '', speaker: 'Unknown' },
            { text: 'stale row #2', start: '', end: '', speaker: 'Unknown' },
          ],
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
          findOne: jest.fn(async () => null),
          find: jest.fn(() => ({ toArray: async () => [] })),
        };
      },
    };

    const dbStub = {
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return { findOne: sessionFindOne };
        }
        if (name === VOICEBOT_COLLECTIONS.MESSAGES) {
          return { updateOne: messageUpdateOne };
        }
        if (name === VOICEBOT_COLLECTIONS.PERSONS || name === VOICEBOT_COLLECTIONS.PERFORMERS) {
          return { find: jest.fn(() => ({ project: () => ({ toArray: async () => [] }) })) };
        }
        return {
          findOne: jest.fn(async () => null),
          updateOne: jest.fn(async () => ({ matchedCount: 0, modifiedCount: 0 })),
          find: jest.fn(() => ({ project: () => ({ toArray: async () => [] }) })),
        };
      },
    };

    getRawDbMock.mockReturnValue(rawDbStub);
    getDbMock.mockReturnValue(dbStub);

    const app = buildApp();
    const response = await request(app)
      .post('/voicebot/session')
      .send({ session_id: sessionId.toHexString() });

    expect(response.status).toBe(200);
    const returnedRows = response.body.session_messages?.[0]?.categorization ?? [];
    expect(returnedRows).toEqual([]);
    expect(messageUpdateOne).toHaveBeenCalledTimes(1);
    const [, updateDoc] = messageUpdateOne.mock.calls[0] as [Record<string, unknown>, { $set?: Record<string, unknown> }];
    expect(updateDoc.$set?.categorization).toEqual([]);
  });

});
