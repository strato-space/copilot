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

describe('VoiceBot transcription retry smoke', () => {
  beforeEach(() => {
    getDbMock.mockReset();
    getRawDbMock.mockReset();
    getUserPermissionsMock.mockReset();
    getUserPermissionsMock.mockResolvedValue([PERMISSIONS.VOICEBOT_SESSIONS.PROCESS]);
  });

  it('keeps pending_classification media out of ASR re-arm while retrying eligible media', async () => {
    const performerId = new ObjectId('507f1f77bcf86cd799439013');
    const sessionId = new ObjectId();
    const pendingMessageId = new ObjectId();
    const eligibleMessageId = new ObjectId();

    const sessionDoc = {
      _id: sessionId,
      user_id: performerId.toString(),
      chat_id: 123,
      is_deleted: false,
    };

    const pendingTelemostMessage = {
      _id: pendingMessageId,
      session_id: sessionId,
      source_type: 'telegram',
      message_type: 'document',
      is_transcribed: false,
      to_transcribe: false,
      transcribe_attempts: 0,
      classification_resolution_state: 'pending',
      transcription_eligibility: null,
      transcription_processing_state: 'pending_classification',
      transcription_eligibility_basis: 'ingress_requires_speech_probe',
      primary_payload_media_kind: 'video',
      primary_transcription_attachment_index: 0,
      file_id: 'tg-pending-file',
      file_unique_id: 'tg-pending-uniq',
      file_name: 'telemost-pending.webm',
      mime_type: 'video/webm',
      attachments: [
        {
          source: 'telegram',
          kind: 'file',
          file_id: 'tg-pending-file',
          file_unique_id: 'tg-pending-uniq',
          name: 'telemost-pending.webm',
          mimeType: 'video/webm',
          payload_media_kind: 'video',
          classification_resolution_state: 'pending',
          transcription_eligibility: null,
        },
      ],
    };

    const eligibleTelemostMessage = {
      _id: eligibleMessageId,
      session_id: sessionId,
      source_type: 'telegram',
      message_type: 'document',
      is_transcribed: false,
      to_transcribe: false,
      transcribe_attempts: 2,
      classification_resolution_state: 'resolved',
      transcription_eligibility: 'eligible',
      transcription_processing_state: 'pending_transcription',
      transcription_eligibility_basis: 'manual_probe_speech',
      primary_payload_media_kind: 'video',
      primary_transcription_attachment_index: 0,
      file_id: 'tg-eligible-file',
      file_unique_id: 'tg-eligible-uniq',
      file_name: 'telemost-eligible.webm',
      mime_type: 'video/webm',
      attachments: [
        {
          source: 'telegram',
          kind: 'file',
          file_id: 'tg-eligible-file',
          file_unique_id: 'tg-eligible-uniq',
          name: 'telemost-eligible.webm',
          mimeType: 'video/webm',
          payload_media_kind: 'video',
          classification_resolution_state: 'resolved',
          transcription_eligibility: 'eligible',
        },
      ],
    };

    const sessionsUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
    const messagesUpdateMany = jest.fn(async (query: Record<string, unknown>) => {
      const ids = ((query._id as { $in?: ObjectId[] } | undefined)?.$in || []) as ObjectId[];
      return { matchedCount: ids.length, modifiedCount: ids.length };
    });

    const dbStub = {
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return {
            findOne: jest.fn(async () => sessionDoc),
            updateOne: sessionsUpdateOne,
          };
        }
        if (name === VOICEBOT_COLLECTIONS.MESSAGES) {
          return {
            find: jest.fn(() => ({
              toArray: async () => [pendingTelemostMessage, eligibleTelemostMessage],
            })),
            updateMany: messagesUpdateMany,
          };
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
      vreq.performer = {
        _id: performerId,
        telegram_id: '123',
        projects_access: [],
      };
      vreq.user = { userId: performerId.toString() };
      next();
    });
    app.use('/voicebot/transcription', transcriptionRouter);

    const response = await request(app)
      .post('/voicebot/transcription/retry')
      .send({ session_id: sessionId.toHexString() });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.messages_marked_for_retry).toBe(1);
    expect(response.body.pending_classification_messages).toBe(1);
    expect(response.body.pending_probe_marked).toBe(1);

    const retryUpdateCall = messagesUpdateMany.mock.calls.find((call) => {
      const update = call?.[1] as Record<string, unknown> | undefined;
      const setPayload = (update?.$set || {}) as Record<string, unknown>;
      return setPayload.transcription_processing_state === 'pending_transcription';
    });
    expect(retryUpdateCall).toBeTruthy();
    const retryIds = ((((retryUpdateCall?.[0] as Record<string, unknown>)._id as { $in?: ObjectId[] } | undefined)?.$in) || [])
      .map((id) => id.toHexString());
    expect(retryIds).toContain(eligibleMessageId.toHexString());
    expect(retryIds).not.toContain(pendingMessageId.toHexString());

    const pendingUpdateCall = messagesUpdateMany.mock.calls.find((call) => {
      const update = call?.[1] as Record<string, unknown> | undefined;
      const setPayload = (update?.$set || {}) as Record<string, unknown>;
      return setPayload.transcription_processing_state === 'pending_classification';
    });
    expect(pendingUpdateCall).toBeTruthy();
    const pendingIds = ((((pendingUpdateCall?.[0] as Record<string, unknown>)._id as { $in?: ObjectId[] } | undefined)?.$in) || [])
      .map((id) => id.toHexString());
    expect(pendingIds).toEqual([pendingMessageId.toHexString()]);
    const pendingSetPayload = ((pendingUpdateCall?.[1] as Record<string, unknown>).$set || {}) as Record<string, unknown>;
    expect(pendingSetPayload.to_transcribe).toBe(false);
    expect(pendingSetPayload.transcription_eligibility).toBeNull();
    expect(pendingSetPayload.classification_resolution_state).toBe('pending');
  });

  it('refreshes ineligible media as classified_skip without ASR re-arm on retry', async () => {
    const performerId = new ObjectId('507f1f77bcf86cd799439014');
    const sessionId = new ObjectId();
    const ineligibleMessageId = new ObjectId();

    const sessionDoc = {
      _id: sessionId,
      user_id: performerId.toString(),
      chat_id: 124,
      is_deleted: false,
    };

    const ineligibleMessage = {
      _id: ineligibleMessageId,
      session_id: sessionId,
      source_type: 'telegram',
      message_type: 'document',
      is_transcribed: false,
      to_transcribe: false,
      transcribe_attempts: 3,
      classification_resolution_state: 'resolved',
      transcription_eligibility: 'ineligible',
      transcription_processing_state: 'classified_skip',
      transcription_skip_reason: 'no_speech_audio',
      transcription_error: 'missing_transport',
      transcription_retry_reason: 'manual_retry',
      file_id: 'tg-ineligible-file',
      file_unique_id: 'tg-ineligible-uniq',
      file_name: 'silent-track.webm',
      mime_type: 'video/webm',
      attachments: [
        {
          source: 'telegram',
          kind: 'file',
          file_id: 'tg-ineligible-file',
          file_unique_id: 'tg-ineligible-uniq',
          name: 'silent-track.webm',
          mimeType: 'video/webm',
          payload_media_kind: 'video',
          classification_resolution_state: 'resolved',
          transcription_eligibility: 'ineligible',
        },
      ],
    };

    const sessionsUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
    const messagesUpdateMany = jest.fn(async (query: Record<string, unknown>) => {
      const ids = ((query._id as { $in?: ObjectId[] } | undefined)?.$in || []) as ObjectId[];
      return { matchedCount: ids.length, modifiedCount: ids.length };
    });

    const dbStub = {
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return {
            findOne: jest.fn(async () => sessionDoc),
            updateOne: sessionsUpdateOne,
          };
        }
        if (name === VOICEBOT_COLLECTIONS.MESSAGES) {
          return {
            find: jest.fn(() => ({
              toArray: async () => [ineligibleMessage],
            })),
            updateMany: messagesUpdateMany,
          };
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
      vreq.performer = {
        _id: performerId,
        telegram_id: '124',
        projects_access: [],
      };
      vreq.user = { userId: performerId.toString() };
      next();
    });
    app.use('/voicebot/transcription', transcriptionRouter);

    const response = await request(app)
      .post('/voicebot/transcription/retry')
      .send({ session_id: sessionId.toHexString() });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.messages_marked_for_retry).toBe(0);
    expect(response.body.pending_classification_messages).toBe(0);
    expect(response.body.ineligible_refreshed).toBe(1);

    const ineligibleUpdateCall = messagesUpdateMany.mock.calls.find((call) => {
      const update = call?.[1] as Record<string, unknown> | undefined;
      const setPayload = (update?.$set || {}) as Record<string, unknown>;
      return setPayload.transcription_processing_state === 'classified_skip';
    });
    expect(ineligibleUpdateCall).toBeTruthy();
    const ineligibleIds = ((((ineligibleUpdateCall?.[0] as Record<string, unknown>)._id as { $in?: ObjectId[] } | undefined)?.$in) || [])
      .map((id) => id.toHexString());
    expect(ineligibleIds).toEqual([ineligibleMessageId.toHexString()]);

    const setPayload = ((ineligibleUpdateCall?.[1] as Record<string, unknown>).$set || {}) as Record<string, unknown>;
    expect(setPayload.to_transcribe).toBe(false);
    expect(setPayload.transcription_eligibility).toBe('ineligible');
    expect(setPayload.classification_resolution_state).toBe('resolved');
    expect(setPayload.transcription_processing_state).toBe('classified_skip');

    const unsetPayload = ((ineligibleUpdateCall?.[1] as Record<string, unknown>).$unset || {}) as Record<string, unknown>;
    expect(unsetPayload.transcription_error).toBe(1);
    expect(unsetPayload.transcription_error_context).toBe(1);
    expect(unsetPayload.transcription_retry_reason).toBe(1);
    expect(unsetPayload.transcription_next_attempt_at).toBe(1);
  });
});
