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

const buildSessionDoc = (sessionId: ObjectId) => ({
  _id: sessionId,
  chat_id: 123456,
  user_id: performerId.toString(),
  session_name: 'Categorization mutate',
  runtime_tag: 'prod-p2',
  is_active: true,
  is_deleted: false,
  participants: [],
  allowed_users: [],
});

describe('VoiceBot categorization chunk mutation route validation', () => {
  beforeEach(() => {
    resetSessionsRuntimeCompatibilityMocks();
  });

  it('returns invalid_row_oid for malformed row id payload', async () => {
    const sessionId = new ObjectId();
    const messageId = new ObjectId();
    const sessionFindOne = jest.fn(async () => buildSessionDoc(sessionId));
    const messageFindOne = jest.fn(async () => null);
    const messageUpdateOne = jest.fn(async () => ({ matchedCount: 0, modifiedCount: 0 }));

    const dbStub = {
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) return { findOne: sessionFindOne };
        if (name === VOICEBOT_COLLECTIONS.MESSAGES) return { findOne: messageFindOne, updateOne: messageUpdateOne };
        return {
          findOne: jest.fn(async () => null),
          updateOne: jest.fn(async () => ({ matchedCount: 0, modifiedCount: 0 })),
        };
      },
    };

    getRawDbMock.mockReturnValue(dbStub);
    getDbMock.mockReturnValue(dbStub);

    const app = buildApp();
    const response = await request(app)
      .post('/voicebot/edit_categorization_chunk')
      .send({
        session_id: sessionId.toHexString(),
        message_id: messageId.toHexString(),
        row_oid: 'broken-row-id',
        text: 'updated',
      });

    expect(response.status).toBe(400);
    expect(response.body.error_code).toBe('invalid_row_oid');
  });

  it('returns message_session_mismatch when message id belongs to another session', async () => {
    const sessionId = new ObjectId();
    const otherSessionId = new ObjectId();
    const messageId = new ObjectId();
    const rowOid = `ch_${new ObjectId().toHexString()}`;
    const sessionFindOne = jest.fn(async () => buildSessionDoc(sessionId));
    const messageFindOne = jest.fn(async (query: Record<string, unknown>) => {
      if (JSON.stringify(query).includes('session_id')) return null;
      return {
        _id: messageId,
        session_id: otherSessionId,
        categorization: [{ segment_oid: rowOid, text: 'row text' }],
      };
    });
    const messageUpdateOne = jest.fn(async () => ({ matchedCount: 0, modifiedCount: 0 }));

    const dbStub = {
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) return { findOne: sessionFindOne };
        if (name === VOICEBOT_COLLECTIONS.MESSAGES) return { findOne: messageFindOne, updateOne: messageUpdateOne };
        return {
          findOne: jest.fn(async () => null),
          updateOne: jest.fn(async () => ({ matchedCount: 0, modifiedCount: 0 })),
        };
      },
    };

    getRawDbMock.mockReturnValue(dbStub);
    getDbMock.mockReturnValue(dbStub);

    const app = buildApp();
    const response = await request(app)
      .post('/voicebot/delete_categorization_chunk')
      .send({
        session_id: sessionId.toHexString(),
        message_id: messageId.toHexString(),
        row_oid: rowOid,
      });

    expect(response.status).toBe(409);
    expect(response.body.error_code).toBe('message_session_mismatch');
  });

  it('returns ambiguous_row_locator when row oid resolves in multiple categorization paths', async () => {
    const sessionId = new ObjectId();
    const messageId = new ObjectId();
    const rowOid = `ch_${new ObjectId().toHexString()}`;
    const sessionFindOne = jest.fn(async () => buildSessionDoc(sessionId));
    const messageFindOne = jest.fn(async () => ({
      _id: messageId,
      session_id: sessionId,
      categorization: [{ source_segment_id: rowOid, text: 'first row' }],
      categorization_data: {
        data: [{ source_segment_id: rowOid, text: 'second row' }],
      },
    }));
    const messageUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));

    const dbStub = {
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) return { findOne: sessionFindOne };
        if (name === VOICEBOT_COLLECTIONS.MESSAGES) return { findOne: messageFindOne, updateOne: messageUpdateOne };
        return {
          findOne: jest.fn(async () => null),
          updateOne: jest.fn(async () => ({ matchedCount: 0, modifiedCount: 0 })),
        };
      },
    };

    getRawDbMock.mockReturnValue(dbStub);
    getDbMock.mockReturnValue(dbStub);

    const app = buildApp();
    const response = await request(app)
      .post('/voicebot/delete_categorization_chunk')
      .send({
        session_id: sessionId.toHexString(),
        message_id: messageId.toHexString(),
        row_oid: rowOid,
      });

    expect(response.status).toBe(409);
    expect(response.body.error_code).toBe('ambiguous_row_locator');
    expect(Array.isArray(response.body.matched_paths)).toBe(true);
    expect(response.body.matched_paths.length).toBeGreaterThan(1);
  });

  it('returns row_already_deleted for already deleted categorization row', async () => {
    const sessionId = new ObjectId();
    const messageId = new ObjectId();
    const rowOid = `ch_${new ObjectId().toHexString()}`;
    const sessionFindOne = jest.fn(async () => buildSessionDoc(sessionId));
    const messageFindOne = jest.fn(async () => ({
      _id: messageId,
      session_id: sessionId,
      categorization: [{ segment_oid: rowOid, text: 'row text', is_deleted: true }],
    }));
    const messageUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));

    const dbStub = {
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) return { findOne: sessionFindOne };
        if (name === VOICEBOT_COLLECTIONS.MESSAGES) return { findOne: messageFindOne, updateOne: messageUpdateOne };
        return {
          findOne: jest.fn(async () => null),
          updateOne: jest.fn(async () => ({ matchedCount: 0, modifiedCount: 0 })),
        };
      },
    };

    getRawDbMock.mockReturnValue(dbStub);
    getDbMock.mockReturnValue(dbStub);

    const app = buildApp();
    const response = await request(app)
      .post('/voicebot/edit_categorization_chunk')
      .send({
        session_id: sessionId.toHexString(),
        message_id: messageId.toHexString(),
        row_oid: rowOid,
        text: 'new text',
      });

    expect(response.status).toBe(409);
    expect(response.body.error_code).toBe('row_already_deleted');
  });

  it('logs categorization_chunk_edited and emits message/session realtime updates on successful edit', async () => {
    const sessionId = new ObjectId();
    const messageId = new ObjectId();
    const rowSegmentId = new ObjectId();
    const rowOidInput = `ch_${rowSegmentId.toHexString()}`;
    const insertedEvents: Array<Record<string, unknown>> = [];
    const roomEmit = jest.fn();
    const roomTarget = jest.fn(() => ({ emit: roomEmit }));
    const namespaceOf = jest.fn(() => ({ to: roomTarget }));
    const sessionFindOne = jest.fn(async () => buildSessionDoc(sessionId));
    const messageDoc: Record<string, unknown> & { _id: ObjectId } = {
      _id: messageId,
      message_id: 'msg-runtime-1',
      session_id: sessionId,
      runtime_tag: 'prod-p2',
      categorization: [{ segment_oid: rowOidInput, text: 'old text' }],
    };
    const messageFindOne = jest.fn(async () => messageDoc);
    const messageUpdateOne = jest.fn(async (_query: Record<string, unknown>, update: Record<string, unknown>) => {
      const setPayload = update.$set as Record<string, unknown> | undefined;
      if (setPayload && setPayload.categorization) {
        messageDoc.categorization = setPayload.categorization;
      }
      if (setPayload && setPayload.updated_at) {
        messageDoc.updated_at = setPayload.updated_at;
      }
      if (setPayload && setPayload.is_finalized !== undefined) {
        messageDoc.is_finalized = setPayload.is_finalized;
      }
      return { matchedCount: 1, modifiedCount: 1 };
    });
    const sessionLogInsertOne = jest.fn(async (doc: Record<string, unknown>) => {
      insertedEvents.push(doc);
      return { insertedId: new ObjectId() };
    });

    const dbStub = {
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) return { findOne: sessionFindOne };
        if (name === VOICEBOT_COLLECTIONS.MESSAGES) return { findOne: messageFindOne, updateOne: messageUpdateOne };
        if (name === VOICEBOT_COLLECTIONS.SESSION_LOG) return { insertOne: sessionLogInsertOne };
        return {
          findOne: jest.fn(async () => null),
          updateOne: jest.fn(async () => ({ matchedCount: 0, modifiedCount: 0 })),
          insertOne: jest.fn(async () => ({ insertedId: new ObjectId() })),
        };
      },
    };

    getRawDbMock.mockReturnValue(dbStub);
    getDbMock.mockReturnValue(dbStub);

    const app = buildApp();
    app.set('io', { of: namespaceOf });

    const response = await request(app)
      .post('/voicebot/edit_categorization_chunk')
      .send({
        session_id: sessionId.toHexString(),
        message_id: messageId.toHexString(),
        row_oid: rowOidInput,
        text: 'new text value',
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(insertedEvents).toHaveLength(1);
    expect(insertedEvents[0]).toEqual(
      expect.objectContaining({
        event_name: 'categorization_chunk_edited',
        event_group: 'categorization',
        metadata: expect.objectContaining({
          rollback_policy: 'no_rollback',
          categorization_row_path: 'categorization',
          categorization_row_index: 0,
        }),
        target: expect.objectContaining({
          entity_type: 'categorization',
          entity_oid: rowOidInput,
          stage: 'categorization',
        }),
      })
    );
    expect(namespaceOf).toHaveBeenCalledWith('/voicebot');
    expect(roomTarget).toHaveBeenNthCalledWith(1, `voicebot:session:${sessionId.toHexString()}`);
    expect(roomTarget).toHaveBeenNthCalledWith(2, `voicebot:session:${sessionId.toHexString()}`);
    expect(roomEmit).toHaveBeenNthCalledWith(
      1,
      'message_update',
      expect.objectContaining({
        message_id: 'msg-runtime-1',
        message: expect.objectContaining({
          _id: messageId.toHexString(),
        }),
      })
    );
    expect(roomEmit).toHaveBeenNthCalledWith(
      2,
      'session_update',
      expect.objectContaining({
        session_id: sessionId.toHexString(),
        is_messages_processed: false,
      })
    );
  });

  it('logs categorization_chunk_deleted and emits realtime updates on successful delete', async () => {
    const sessionId = new ObjectId();
    const messageId = new ObjectId();
    const rowSegmentId = new ObjectId();
    const rowOidInput = `ch_${rowSegmentId.toHexString()}`;
    const insertedEvents: Array<Record<string, unknown>> = [];
    const roomEmit = jest.fn();
    const roomTarget = jest.fn(() => ({ emit: roomEmit }));
    const namespaceOf = jest.fn(() => ({ to: roomTarget }));
    const sessionFindOne = jest.fn(async () => buildSessionDoc(sessionId));
    const messageDoc: Record<string, unknown> & { _id: ObjectId } = {
      _id: messageId,
      message_id: 'msg-runtime-2',
      session_id: sessionId,
      runtime_tag: 'prod-p2',
      categorization: [
        { segment_oid: rowOidInput, text: 'row to delete', is_deleted: false },
        { segment_oid: `ch_${new ObjectId().toHexString()}`, text: 'row to keep', is_deleted: false },
      ],
      transcription: {
        text: 'row to delete row to keep',
        segments: [
          { id: rowOidInput, text: 'row to delete', is_deleted: false },
          { id: `ch_${new ObjectId().toHexString()}`, text: 'row to keep', is_deleted: false },
        ],
      },
      transcription_chunks: [
        { id: rowOidInput, text: 'row to delete', is_deleted: false },
        { id: `ch_${new ObjectId().toHexString()}`, text: 'row to keep', is_deleted: false },
      ],
    };
    const messageFindOne = jest.fn(async () => messageDoc);
    const messageUpdateOne = jest.fn(async (_query: Record<string, unknown>, update: Record<string, unknown>) => {
      const setPayload = update.$set as Record<string, unknown> | undefined;
      if (setPayload && setPayload.categorization) {
        messageDoc.categorization = setPayload.categorization;
      }
      if (setPayload && setPayload.updated_at) {
        messageDoc.updated_at = setPayload.updated_at;
      }
      if (setPayload && setPayload.is_finalized !== undefined) {
        messageDoc.is_finalized = setPayload.is_finalized;
      }
      return { matchedCount: 1, modifiedCount: 1 };
    });
    const sessionLogInsertOne = jest.fn(async (doc: Record<string, unknown>) => {
      insertedEvents.push(doc);
      return { insertedId: new ObjectId() };
    });

    const dbStub = {
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) return { findOne: sessionFindOne };
        if (name === VOICEBOT_COLLECTIONS.MESSAGES) return { findOne: messageFindOne, updateOne: messageUpdateOne };
        if (name === VOICEBOT_COLLECTIONS.SESSION_LOG) return { insertOne: sessionLogInsertOne };
        return {
          findOne: jest.fn(async () => null),
          updateOne: jest.fn(async () => ({ matchedCount: 0, modifiedCount: 0 })),
          insertOne: jest.fn(async () => ({ insertedId: new ObjectId() })),
        };
      },
    };

    getRawDbMock.mockReturnValue(dbStub);
    getDbMock.mockReturnValue(dbStub);

    const app = buildApp();
    app.set('io', { of: namespaceOf });

    const response = await request(app)
      .post('/voicebot/delete_categorization_chunk')
      .send({
        session_id: sessionId.toHexString(),
        message_id: messageId.toHexString(),
        row_oid: rowOidInput,
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(insertedEvents).toHaveLength(2);
    expect(insertedEvents[0]).toEqual(
      expect.objectContaining({
        event_name: 'categorization_chunk_deleted',
        event_group: 'categorization',
        metadata: expect.objectContaining({
          rollback_policy: 'compensating_revert_on_log_failure',
          categorization_row_path: 'categorization',
          categorization_row_index: 0,
          deletion_reason: 'user_decision',
          cascade: expect.objectContaining({
            requested: true,
            linked_segment_oid: rowOidInput,
          }),
        }),
        target: expect.objectContaining({
          entity_type: 'categorization',
          entity_oid: rowOidInput,
          stage: 'categorization',
        }),
      })
    );
    expect(insertedEvents[1]).toEqual(
      expect.objectContaining({
        event_name: 'transcript_segment_deleted',
        target: expect.objectContaining({
          entity_type: 'transcript_segment',
          entity_oid: rowOidInput,
        }),
      })
    );
    expect(namespaceOf).toHaveBeenCalledWith('/voicebot');
    expect(roomTarget).toHaveBeenNthCalledWith(1, `voicebot:session:${sessionId.toHexString()}`);
    expect(roomTarget).toHaveBeenNthCalledWith(2, `voicebot:session:${sessionId.toHexString()}`);
    expect(roomEmit).toHaveBeenNthCalledWith(
      1,
      'message_update',
      expect.objectContaining({
        message_id: 'msg-runtime-2',
      })
    );
    expect(roomEmit).toHaveBeenNthCalledWith(
      2,
      'session_update',
      expect.objectContaining({
        session_id: sessionId.toHexString(),
        is_messages_processed: false,
      })
    );
  });

  it('cascades transcript deletion when the last categorization row is removed', async () => {
    const sessionId = new ObjectId();
    const messageId = new ObjectId();
    const rowSegmentId = new ObjectId();
    const rowOidInput = `ch_${rowSegmentId.toHexString()}`;
    const insertedEvents: Array<Record<string, unknown>> = [];
    const roomEmit = jest.fn();
    const roomTarget = jest.fn(() => ({ emit: roomEmit }));
    const namespaceOf = jest.fn(() => ({ to: roomTarget }));
    const sessionFindOne = jest.fn(async () => buildSessionDoc(sessionId));
    const messageDoc: Record<string, unknown> & { _id: ObjectId } = {
      _id: messageId,
      message_id: 'msg-runtime-3',
      session_id: sessionId,
      runtime_tag: 'prod-p2',
      categorization: [{ segment_oid: rowOidInput, text: 'last row', is_deleted: false }],
      transcription: {
        segments: [{ id: rowOidInput, text: 'segment text', is_deleted: false }],
        text: 'segment text',
      },
      transcription_chunks: [{ id: rowOidInput, text: 'segment text', is_deleted: false }],
      transcription_text: 'segment text',
      text: 'segment text',
    };
    const messageFindOne = jest.fn(async () => messageDoc);
    const messageUpdateOne = jest.fn(async (_query: Record<string, unknown>, update: Record<string, unknown>) => {
      const setPayload = update.$set as Record<string, unknown> | undefined;
      if (setPayload) {
        for (const [field, value] of Object.entries(setPayload)) {
          messageDoc[field] = value;
        }
      }
      return { matchedCount: 1, modifiedCount: 1 };
    });
    const sessionLogInsertOne = jest.fn(async (doc: Record<string, unknown>) => {
      insertedEvents.push(doc);
      return { insertedId: new ObjectId() };
    });

    const dbStub = {
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) return { findOne: sessionFindOne };
        if (name === VOICEBOT_COLLECTIONS.MESSAGES) return { findOne: messageFindOne, updateOne: messageUpdateOne };
        if (name === VOICEBOT_COLLECTIONS.SESSION_LOG) return { insertOne: sessionLogInsertOne };
        return {
          findOne: jest.fn(async () => null),
          updateOne: jest.fn(async () => ({ matchedCount: 0, modifiedCount: 0 })),
          insertOne: jest.fn(async () => ({ insertedId: new ObjectId() })),
        };
      },
    };

    getRawDbMock.mockReturnValue(dbStub);
    getDbMock.mockReturnValue(dbStub);

    const app = buildApp();
    app.set('io', { of: namespaceOf });

    const response = await request(app)
      .post('/voicebot/delete_categorization_chunk')
      .send({
        session_id: sessionId.toHexString(),
        message_id: messageId.toHexString(),
        row_oid: rowOidInput,
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.cascade).toEqual(
      expect.objectContaining({
        requested: true,
        linked_segment_oid: rowOidInput,
        applied: true,
      })
    );
    expect(insertedEvents.map((event) => event.event_name)).toEqual([
      'categorization_chunk_deleted',
      'transcript_segment_deleted',
    ]);
    const updatedCategorization = messageDoc.categorization as Array<Record<string, unknown>>;
    const updatedSegments = (messageDoc.transcription as { segments?: Array<Record<string, unknown>> }).segments ?? [];
    expect(updatedCategorization[0]?.is_deleted).toBe(true);
    expect(updatedSegments[0]?.is_deleted).toBe(true);
    expect(messageUpdateOne.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it('reverts cascaded state when transcript cascade log write fails', async () => {
    const sessionId = new ObjectId();
    const messageId = new ObjectId();
    const rowSegmentId = new ObjectId();
    const rowOidInput = `ch_${rowSegmentId.toHexString()}`;
    const insertedEvents: Array<Record<string, unknown>> = [];
    const roomEmit = jest.fn();
    const roomTarget = jest.fn(() => ({ emit: roomEmit }));
    const namespaceOf = jest.fn(() => ({ to: roomTarget }));
    const sessionFindOne = jest.fn(async () => buildSessionDoc(sessionId));
    const initialMessage: Record<string, unknown> & { _id: ObjectId } = {
      _id: messageId,
      message_id: 'msg-runtime-4',
      session_id: sessionId,
      runtime_tag: 'prod-p2',
      categorization: [{ segment_oid: rowOidInput, text: 'last row', is_deleted: false }],
      transcription: {
        segments: [{ id: rowOidInput, text: 'segment text', is_deleted: false }],
        text: 'segment text',
      },
      transcription_chunks: [{ id: rowOidInput, text: 'segment text', is_deleted: false }],
      transcription_text: 'segment text',
      text: 'segment text',
      is_finalized: true,
    };
    const messageDoc: Record<string, unknown> & { _id: ObjectId } = {
      ...initialMessage,
      categorization: [...(initialMessage.categorization as Array<Record<string, unknown>>)],
      transcription: {
        ...(initialMessage.transcription as Record<string, unknown>),
        segments: [
          ...(
            ((initialMessage.transcription as { segments?: Array<Record<string, unknown>> }).segments as
              | Array<Record<string, unknown>>
              | undefined) ?? []
          ),
        ],
      },
      transcription_chunks: [...(initialMessage.transcription_chunks as Array<Record<string, unknown>>)],
    };
    const messageFindOne = jest.fn(async () => messageDoc);
    const messageUpdateOne = jest.fn(async (_query: Record<string, unknown>, update: Record<string, unknown>) => {
      const setPayload = update.$set as Record<string, unknown> | undefined;
      if (setPayload) {
        for (const [field, value] of Object.entries(setPayload)) {
          messageDoc[field] = value;
        }
      }
      return { matchedCount: 1, modifiedCount: 1 };
    });
    let logInsertCallCount = 0;
    const sessionLogInsertOne = jest.fn(async (doc: Record<string, unknown>) => {
      logInsertCallCount += 1;
      if (logInsertCallCount === 2) {
        throw new Error('simulated transcript log failure');
      }
      insertedEvents.push(doc);
      return { insertedId: new ObjectId() };
    });

    const dbStub = {
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) return { findOne: sessionFindOne };
        if (name === VOICEBOT_COLLECTIONS.MESSAGES) return { findOne: messageFindOne, updateOne: messageUpdateOne };
        if (name === VOICEBOT_COLLECTIONS.SESSION_LOG) return { insertOne: sessionLogInsertOne };
        return {
          findOne: jest.fn(async () => null),
          updateOne: jest.fn(async () => ({ matchedCount: 0, modifiedCount: 0 })),
          insertOne: jest.fn(async () => ({ insertedId: new ObjectId() })),
        };
      },
    };

    getRawDbMock.mockReturnValue(dbStub);
    getDbMock.mockReturnValue(dbStub);

    const app = buildApp();
    app.set('io', { of: namespaceOf });

    const response = await request(app)
      .post('/voicebot/delete_categorization_chunk')
      .send({
        session_id: sessionId.toHexString(),
        message_id: messageId.toHexString(),
        row_oid: rowOidInput,
      });

    expect(response.status).toBe(500);
    expect(response.body.error_code).toBe('internal_error');
    expect(insertedEvents.map((event) => event.event_name)).toEqual(['categorization_chunk_deleted']);
    expect(messageUpdateOne.mock.calls.length).toBeGreaterThanOrEqual(2);
    const currentCategorization = messageDoc.categorization as Array<Record<string, unknown>>;
    const currentSegments = (messageDoc.transcription as { segments?: Array<Record<string, unknown>> }).segments ?? [];
    expect(currentCategorization[0]?.is_deleted).toBe(false);
    expect(currentSegments[0]?.is_deleted).toBe(false);
    expect(roomEmit).not.toHaveBeenCalled();
  });
});
