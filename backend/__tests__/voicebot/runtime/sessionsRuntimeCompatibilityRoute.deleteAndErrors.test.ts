import request from 'supertest';
import { ObjectId } from 'mongodb';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import {
  VOICEBOT_COLLECTIONS,
  performerId,
  getDbMock,
  getRawDbMock,
  getVoicebotQueuesMock,
  buildApp,
  resetSessionsRuntimeCompatibilityMocks,
} from './sessionsRuntimeCompatibilityRoute.test.helpers.js';
import { VOICEBOT_JOBS, VOICEBOT_QUEUES } from '../../../src/constants.js';

describe('VoiceBot sessions runtime compatibility (runtime-tag agnostic)', () => {
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
    const sessionUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
    const postprocessorsAdd = jest.fn(async () => ({ id: 'postprocessor-job' }));

    const dbStub = {
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return {
            findOne: sessionFindOne,
            updateOne: sessionUpdateOne,
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
    getVoicebotQueuesMock.mockReturnValue({
      [VOICEBOT_QUEUES.POSTPROCESSORS]: {
        add: postprocessorsAdd,
      },
    });

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
    expect(sessionUpdateOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: sessionId }),
      expect.objectContaining({
        $set: expect.objectContaining({
          'processors_data.CREATE_TASKS.auto_requested_at': expect.any(Number),
          'processors_data.CREATE_TASKS.is_processed': false,
          'processors_data.CREATE_TASKS.is_processing': false,
        }),
      })
    );
    expect(postprocessorsAdd).toHaveBeenCalledWith(
      VOICEBOT_JOBS.postprocessing.CREATE_TASKS,
      expect.objectContaining({
        session_id: sessionId.toHexString(),
        refresh_mode: 'incremental_refresh',
        auto_requested_at: expect.any(Number),
      }),
      expect.objectContaining({
        deduplication: {
          id: `${sessionId.toHexString()}-CREATE_TASKS-AUTO`,
        },
      })
    );
  });

  it('POST /voicebot/edit_transcript_chunk requeues possible-task refresh', async () => {
    const sessionId = new ObjectId();
    const messageId = new ObjectId();
    const segmentId = `ch_${new ObjectId().toHexString()}`;

    const sessionFindOne = jest.fn(async () => ({
      _id: sessionId,
      chat_id: 123456,
      user_id: performerId.toString(),
      session_name: 'Edit parity',
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
        text: 'Original segment',
        segments: [{ id: segmentId, text: 'Original segment', start: 0, end: 10, is_deleted: false }],
      },
      transcription_text: 'Original segment',
      transcription_chunks: [{ id: segmentId, text: 'Original segment', start: 0, end: 10, is_deleted: false }],
      categorization: [{ id: segmentId, text: 'Original category', timeStart: 0, timeEnd: 10 }],
    }));
    const messageUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
    const sessionUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
    const objectLocatorFindOne = jest.fn(async () => null);
    const objectLocatorUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1, upsertedCount: 1 }));
    const sessionLogInsertOne = jest.fn(async () => ({ insertedId: new ObjectId() }));
    const postprocessorsAdd = jest.fn(async () => ({ id: 'postprocessor-job' }));

    const dbStub = {
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return {
            findOne: sessionFindOne,
            updateOne: sessionUpdateOne,
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
    getVoicebotQueuesMock.mockReturnValue({
      [VOICEBOT_QUEUES.POSTPROCESSORS]: {
        add: postprocessorsAdd,
      },
    });

    const app = buildApp();
    const response = await request(app)
      .post('/voicebot/edit_transcript_chunk')
      .send({
        session_id: sessionId.toHexString(),
        message_id: messageId.toHexString(),
        segment_oid: segmentId,
        text: 'Updated segment',
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(sessionUpdateOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: sessionId }),
      expect.objectContaining({
        $set: expect.objectContaining({
          'processors_data.CREATE_TASKS.auto_requested_at': expect.any(Number),
          'processors_data.CREATE_TASKS.is_processed': false,
        }),
      })
    );
    expect(postprocessorsAdd).toHaveBeenCalledWith(
      VOICEBOT_JOBS.postprocessing.CREATE_TASKS,
      expect.objectContaining({
        session_id: sessionId.toHexString(),
        refresh_mode: 'incremental_refresh',
      }),
      expect.any(Object)
    );
  });

  it('POST /voicebot/rollback_event requeues possible-task refresh after transcript rollback', async () => {
    const sessionId = new ObjectId();
    const messageId = new ObjectId();
    const eventId = new ObjectId();
    const segmentId = `ch_${new ObjectId().toHexString()}`;

    const sessionFindOne = jest.fn(async () => ({
      _id: sessionId,
      chat_id: 123456,
      user_id: performerId.toString(),
      session_name: 'Rollback parity',
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
        text: 'Edited segment',
        segments: [{ id: segmentId, text: 'Edited segment', start: 0, end: 10, is_deleted: false }],
      },
      transcription_text: 'Edited segment',
      transcription_chunks: [{ id: segmentId, text: 'Edited segment', start: 0, end: 10, is_deleted: false }],
      categorization: [{ id: segmentId, text: 'Edited category', timeStart: 0, timeEnd: 10 }],
    }));
    const messageUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
    const sessionUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
    const objectLocatorFindOne = jest.fn(async () => null);
    const objectLocatorUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1, upsertedCount: 1 }));
    const sessionLogFindOne = jest.fn(async (filter: Record<string, unknown>) => {
      if (String(filter._id || '') === eventId.toHexString()) {
        return {
          _id: eventId,
          session_id: sessionId,
          message_id: messageId,
          event_name: 'transcript_segment_edited',
          target: {
            entity_oid: segmentId,
            path: `/messages/msg_${messageId.toHexString()}/transcription/segments[id=${segmentId}]`,
          },
          diff: {
            old_value: 'Original segment',
            new_value: 'Edited segment',
          },
        };
      }
      return null;
    });
    const sessionLogInsertOne = jest.fn(async () => ({ insertedId: new ObjectId() }));
    const postprocessorsAdd = jest.fn(async () => ({ id: 'postprocessor-job' }));

    const dbStub = {
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return {
            findOne: sessionFindOne,
            updateOne: sessionUpdateOne,
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
            findOne: sessionLogFindOne,
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
    getVoicebotQueuesMock.mockReturnValue({
      [VOICEBOT_QUEUES.POSTPROCESSORS]: {
        add: postprocessorsAdd,
      },
    });

    const app = buildApp();
    const response = await request(app)
      .post('/voicebot/rollback_event')
      .send({
        session_id: sessionId.toHexString(),
        event_id: eventId.toHexString(),
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(sessionUpdateOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: sessionId }),
      expect.objectContaining({
        $set: expect.objectContaining({
          'processors_data.CREATE_TASKS.auto_requested_at': expect.any(Number),
          'processors_data.CREATE_TASKS.is_processed': false,
        }),
      })
    );
    expect(postprocessorsAdd).toHaveBeenCalledWith(
      VOICEBOT_JOBS.postprocessing.CREATE_TASKS,
      expect.objectContaining({
        session_id: sessionId.toHexString(),
        refresh_mode: 'incremental_refresh',
      }),
      expect.any(Object)
    );
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
    expect(sessionFindOne).toHaveBeenCalledTimes(1);
  });

  it('POST /voicebot/session ignores runtime_tag and returns matching session', async () => {
    const sessionId = new ObjectId();
    const sessionFindOne = jest.fn(async () => ({
      _id: sessionId,
      chat_id: 123456,
      user_id: performerId.toString(),
      session_name: 'Runtime-tag agnostic session',
      runtime_tag: 'dev-p2',
      is_active: false,
      is_deleted: false,
      participants: [],
      allowed_users: [],
    }));
    const messagesFind = jest.fn(() => ({ toArray: async () => [] }));

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
          find: jest.fn(() => ({ project: () => ({ toArray: async () => [] }) })),
        };
      },
    };

    const dbStub = {
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.PERSONS || name === VOICEBOT_COLLECTIONS.PERFORMERS) {
          return {
            find: jest.fn(() => ({ project: () => ({ toArray: async () => [] }) })),
          };
        }
        if (name === VOICEBOT_COLLECTIONS.MESSAGES) {
          return {
            updateOne: jest.fn(async () => ({ matchedCount: 0, modifiedCount: 0 })),
          };
        }
        return {
          find: jest.fn(() => ({ project: () => ({ toArray: async () => [] }) })),
          findOne: jest.fn(async () => null),
          updateOne: jest.fn(async () => ({ matchedCount: 0, modifiedCount: 0 })),
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
    expect(response.body.voice_bot_session?._id).toBe(sessionId.toHexString());
    expect(response.body.session_messages).toEqual([]);
    expect(sessionFindOne).toHaveBeenCalledTimes(1);
  });

});
