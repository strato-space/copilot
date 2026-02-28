import request from 'supertest';
import { ObjectId } from 'mongodb';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import {
  VOICEBOT_COLLECTIONS,
  performerId,
  getDbMock,
  getRawDbMock,
  buildApp,
  resetSessionsRuntimeCompatibilityMocks,
} from './sessionsRuntimeCompatibilityRoute.test.helpers.js';

describe('VoiceBot sessions runtime compatibility (prod + prod-*)', () => {
  beforeEach(() => {
    resetSessionsRuntimeCompatibilityMocks();
  });

  it('POST /voicebot/delete_transcript_chunk marks canonical transcription segment as deleted', async () => {
    const sessionId = new ObjectId();
    const messageId = new ObjectId();
    const firstSegmentId = `ch_${new ObjectId().toHexString()}`;
    const secondSegmentId = `ch_${new ObjectId().toHexString()}`;

    const sessionFindOne = jest.fn(async () => ({
      _id: sessionId,
      chat_id: 123456,
      user_id: performerId.toString(),
      session_name: 'Delete parity',
      runtime_tag: 'prod-p2',
      is_active: true,
      is_deleted: false,
      participants: [],
      allowed_users: [],
    }));
    const messageFindOne = jest.fn(async () => ({
      _id: messageId,
      session_id: sessionId,
      runtime_tag: 'prod-p2',
      transcription: {
        text: 'First segment Second segment',
        segments: [
          { id: firstSegmentId, text: 'First segment', start: 0, end: 10, is_deleted: false },
          { id: secondSegmentId, text: 'Second segment', start: 10, end: 20, is_deleted: false },
        ],
      },
      transcription_text: 'First segment Second segment',
      transcription_chunks: [
        { id: firstSegmentId, text: 'First segment', start: 0, end: 10, is_deleted: false },
        { id: secondSegmentId, text: 'Second segment', start: 10, end: 20, is_deleted: false },
      ],
      categorization: [
        { id: firstSegmentId, text: 'First category', timeStart: 0, timeEnd: 10 },
        { id: secondSegmentId, text: 'Second category', timeStart: 10, timeEnd: 20 },
      ],
    }));
    const messageUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
    const objectLocatorFindOne = jest.fn(async () => null);
    const objectLocatorUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1, upsertedCount: 1 }));
    const sessionLogInsertOne = jest.fn(async () => ({ insertedId: new ObjectId() }));

    const dbStub = {
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return {
            findOne: sessionFindOne,
          };
        }
        if (name === VOICEBOT_COLLECTIONS.MESSAGES) {
          return {
            findOne: messageFindOne,
            updateOne: messageUpdateOne,
          };
        }
        if (name === VOICEBOT_COLLECTIONS.OBJECT_LOCATOR) {
          return {
            findOne: objectLocatorFindOne,
            updateOne: objectLocatorUpdateOne,
          };
        }
        if (name === VOICEBOT_COLLECTIONS.SESSION_LOG) {
          return {
            insertOne: sessionLogInsertOne,
          };
        }
        return {
          findOne: jest.fn(async () => null),
          updateOne: jest.fn(async () => ({ matchedCount: 0, modifiedCount: 0 })),
          insertOne: jest.fn(async () => ({ insertedId: new ObjectId() })),
          find: jest.fn(() => ({ toArray: async () => [] })),
        };
      },
    };

    getRawDbMock.mockReturnValue(dbStub);
    getDbMock.mockReturnValue(dbStub);

    const app = buildApp();
    const response = await request(app)
      .post('/voicebot/delete_transcript_chunk')
      .send({
        session_id: sessionId.toHexString(),
        message_id: messageId.toHexString(),
        segment_oid: firstSegmentId,
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.event?.event_name).toBe('transcript_segment_deleted');

    expect(messageUpdateOne.mock.calls.length).toBeGreaterThan(0);
    const [, updateDoc] = messageUpdateOne.mock.calls[messageUpdateOne.mock.calls.length - 1] as [
      Record<string, unknown>,
      { $set?: Record<string, unknown> }
    ];
    const setPayload = updateDoc.$set || {};
    const persistedTranscription = (setPayload.transcription ?? {}) as { text?: string; segments?: Array<Record<string, unknown>> };
    const persistedSegments = Array.isArray(persistedTranscription.segments) ? persistedTranscription.segments : [];
    const deletedSegment = persistedSegments.find((segment) => segment.id === firstSegmentId);
    const aliveSegment = persistedSegments.find((segment) => segment.id === secondSegmentId);

    expect(deletedSegment?.is_deleted).toBe(true);
    expect(aliveSegment?.is_deleted).toBe(false);
    expect(persistedTranscription.text).toBe('Second segment');
    expect(setPayload.transcription_text).toBe('Second segment');
  });

  it('POST /voicebot/session returns 404 when session does not exist in raw DB', async () => {
    const sessionId = new ObjectId();
    const sessionFindOne = jest.fn(async () => null);

    const rawDbStub = {
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return { findOne: sessionFindOne };
        }
        return {
          find: jest.fn(() => ({ toArray: async () => [] })),
        };
      },
    };

    const dbStub = {
      collection: (_name: string) => ({
        find: jest.fn(() => ({ toArray: async () => [] })),
      }),
    };

    getRawDbMock.mockReturnValue(rawDbStub);
    getDbMock.mockReturnValue(dbStub);

    const app = buildApp();
    const response = await request(app)
      .post('/voicebot/session')
      .send({ session_id: sessionId.toHexString() });

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('Session not found');
    expect(sessionFindOne).toHaveBeenCalledTimes(2);
  });

  it('POST /voicebot/session returns 409 runtime_mismatch when session exists outside runtime scope', async () => {
    const sessionId = new ObjectId();
    const sessionFindOne = jest
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        _id: sessionId,
        runtime_tag: 'dev-p2',
        is_deleted: false,
      });

    const rawDbStub = {
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return { findOne: sessionFindOne };
        }
        return {
          find: jest.fn(() => ({ toArray: async () => [] })),
        };
      },
    };

    const dbStub = {
      collection: (_name: string) => ({
        find: jest.fn(() => ({ toArray: async () => [] })),
      }),
    };

    getRawDbMock.mockReturnValue(rawDbStub);
    getDbMock.mockReturnValue(dbStub);

    const app = buildApp();
    const response = await request(app)
      .post('/voicebot/session')
      .send({ session_id: sessionId.toHexString() });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe('runtime_mismatch');
    expect(sessionFindOne).toHaveBeenCalledTimes(2);
  });

});
