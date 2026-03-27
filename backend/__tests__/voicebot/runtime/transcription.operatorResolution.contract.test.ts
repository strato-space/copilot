import express from 'express';
import request from 'supertest';
import { ObjectId } from 'mongodb';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { VOICEBOT_COLLECTIONS } from '../../../src/constants.js';
import { PERMISSIONS } from '../../../src/permissions/permissions-config.js';

const getDbMock = jest.fn();
const getRawDbMock = jest.fn();
const getUserPermissionsMock = jest.fn();

jest.unstable_mockModule('../../../src/services/db.js', () => ({
  getDb: getDbMock,
  getRawDb: getRawDbMock,
}));

jest.unstable_mockModule('../../../src/permissions/permission-manager.js', () => ({
  PermissionManager: {
    getUserPermissions: getUserPermissionsMock,
  },
}));

const { default: transcriptionRouter } = await import('../../../src/api/routes/voicebot/transcription.js');

const buildApp = (performerId: ObjectId) => {
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
      name: 'Operator Name',
    };
    vreq.user = {
      userId: performerId.toHexString(),
      email: 'operator@example.com',
    };
    next();
  });
  app.use('/voicebot/transcription', transcriptionRouter);
  return app;
};

describe('VoiceBot transcription operator classification resolution contract', () => {
  beforeEach(() => {
    getDbMock.mockReset();
    getRawDbMock.mockReset();
    getUserPermissionsMock.mockReset();
    getUserPermissionsMock.mockResolvedValue([PERMISSIONS.VOICEBOT_SESSIONS.PROCESS]);
  });

  it('resolves pending classification to eligible and honors eligible primary override with persisted operator evidence', async () => {
    const performerId = new ObjectId('507f1f77bcf86cd799439111');
    const sessionId = new ObjectId();
    const messageId = new ObjectId();

    const sessionDoc = {
      _id: sessionId,
      user_id: performerId.toHexString(),
      chat_id: 123,
      is_deleted: false,
    };
    const messageDoc = {
      _id: messageId,
      session_id: sessionId,
      source_type: 'telegram',
      message_type: 'document',
      is_deleted: false,
      is_transcribed: false,
      to_transcribe: false,
      transcribe_attempts: 2,
      classification_resolution_state: 'pending',
      transcription_eligibility: null,
      transcription_processing_state: 'pending_classification',
      transcription_skip_reason: 'stale_skip',
      transcription_error: 'empty_result',
      primary_transcription_attachment_index: 0,
      attachments: [
        {
          source: 'telegram',
          kind: 'file',
          file_id: 'tg-eligible-1',
          file_unique_id: 'tg-eligible-uniq-1',
          name: 'candidate-1.webm',
          mimeType: 'video/webm',
        },
        {
          source: 'telegram',
          kind: 'file',
          file_id: 'tg-eligible-2',
          file_unique_id: 'tg-eligible-uniq-2',
          name: 'candidate-2.mp3',
          mimeType: 'audio/mpeg',
          transcription_eligibility: 'eligible',
        },
        {
          source: 'telegram',
          kind: 'file',
          file_id: 'tg-pdf-1',
          file_unique_id: 'tg-pdf-uniq-1',
          name: 'brief.pdf',
          mimeType: 'application/pdf',
        },
      ],
    };

    const messagesUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
    const sessionsUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));

    const dbStub = {
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.MESSAGES) {
          return {
            findOne: jest.fn(async () => messageDoc),
            updateOne: messagesUpdateOne,
          };
        }
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return {
            findOne: jest.fn(async () => sessionDoc),
            updateOne: sessionsUpdateOne,
          };
        }
        return {};
      },
    };
    getDbMock.mockReturnValue(dbStub);
    getRawDbMock.mockReturnValue(dbStub);

    const app = buildApp(performerId);

    const response = await request(app)
      .post('/voicebot/transcription/resolve_classification')
      .send({
        message_id: messageId.toHexString(),
        resolution: 'eligible',
        transcription_eligibility_basis: 'manual_probe_speech',
        classification_rule_ref: 'manual_review_v1',
        evidence_type: 'manual_playback_review',
        evidence: {
          source: 'operator_playback',
          note: 'speech confirmed',
        },
        primary_transcription_attachment_index: 1,
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.classification_resolution_state).toBe('resolved');
    expect(response.body.transcription_eligibility).toBe('eligible');
    expect(response.body.transcription_processing_state).toBe('pending_transcription');
    expect(response.body.primary_transcription_attachment_index).toBe(1);

    expect(messagesUpdateOne).toHaveBeenCalledTimes(1);
    const updatePayload = messagesUpdateOne.mock.calls[0]?.[1] as Record<string, unknown>;
    const setPayload = (updatePayload.$set || {}) as Record<string, unknown>;
    const unsetPayload = (updatePayload.$unset || {}) as Record<string, unknown>;
    const pushPayload = (updatePayload.$push || {}) as Record<string, unknown>;

    expect(setPayload.classification_resolution_state).toBe('resolved');
    expect(setPayload.transcription_eligibility).toBe('eligible');
    expect(setPayload.transcription_eligibility_basis).toBe('manual_probe_speech');
    expect(setPayload.classification_rule_ref).toBe('manual_review_v1');
    expect(setPayload.classification_resolution_evidence_type).toBe('manual_playback_review');
    expect(setPayload.classification_resolution_evidence).toEqual({
      source: 'operator_playback',
      note: 'speech confirmed',
    });
    expect(setPayload.classification_resolution_actor).toEqual(expect.objectContaining({
      performer_id: performerId.toHexString(),
      performer_telegram_id: '123',
      user_id: performerId.toHexString(),
      user_email: 'operator@example.com',
    }));
    expect(setPayload.primary_transcription_attachment_index).toBe(1);
    expect(setPayload.file_id).toBe('tg-eligible-2');
    expect(setPayload.file_unique_id).toBe('tg-eligible-uniq-2');
    expect(setPayload.file_name).toBe('candidate-2.mp3');
    expect(setPayload.mime_type).toBe('audio/mpeg');
    expect(setPayload.to_transcribe).toBe(true);
    expect(setPayload.transcribe_attempts).toBe(0);
    expect(setPayload.is_transcribed).toBe(false);

    const persistedAttachments = (setPayload.attachments || []) as Array<Record<string, unknown>>;
    expect(persistedAttachments).toHaveLength(3);
    expect(persistedAttachments[0]?.transcription_eligibility).toBe('eligible');
    expect(persistedAttachments[1]?.transcription_eligibility).toBe('eligible');
    expect(persistedAttachments[2]?.transcription_eligibility).toBe('ineligible');
    expect(persistedAttachments[2]?.transcription_processing_state).toBe('classified_skip');

    expect(unsetPayload.transcription_error).toBe(1);
    expect(unsetPayload.transcription_error_context).toBe(1);
    expect(unsetPayload.transcription_skip_reason).toBe(1);
    expect(unsetPayload.transcription_pending_probe_requested_at).toBe(1);
    expect(unsetPayload.transcription_pending_probe_request_source).toBe(1);

    expect(pushPayload.classification_resolution_audit).toEqual(expect.objectContaining({
      $each: expect.any(Array),
      $slice: -50,
    }));

    expect(sessionsUpdateOne).toHaveBeenCalledTimes(1);
    const sessionUpdateSet = ((sessionsUpdateOne.mock.calls[0]?.[1] as Record<string, unknown>)?.$set || {}) as Record<string, unknown>;
    expect(sessionUpdateSet.is_messages_processed).toBe(false);
    expect(sessionUpdateSet.is_corrupted).toBe(false);
  });

  it('rejects primary override that is not eligible under deterministic attachment eligibility', async () => {
    const performerId = new ObjectId('507f1f77bcf86cd799439121');
    const sessionId = new ObjectId();
    const messageId = new ObjectId();

    const messageDoc = {
      _id: messageId,
      session_id: sessionId,
      source_type: 'telegram',
      message_type: 'document',
      is_deleted: false,
      attachments: [
        {
          source: 'telegram',
          kind: 'file',
          file_id: 'tg-pdf-1',
          file_unique_id: 'tg-pdf-uniq-1',
          name: 'brief.pdf',
          mimeType: 'application/pdf',
          transcription_eligibility: 'ineligible',
        },
      ],
    };

    const messagesUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
    const dbStub = {
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.MESSAGES) {
          return {
            findOne: jest.fn(async () => messageDoc),
            updateOne: messagesUpdateOne,
          };
        }
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return {
            findOne: jest.fn(async () => ({ _id: sessionId, is_deleted: false })),
            updateOne: jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 })),
          };
        }
        return {};
      },
    };
    getDbMock.mockReturnValue(dbStub);
    getRawDbMock.mockReturnValue(dbStub);

    const app = buildApp(performerId);

    const response = await request(app)
      .post('/voicebot/transcription/resolve_classification')
      .send({
        message_id: messageId.toHexString(),
        resolution: 'eligible',
        transcription_eligibility_basis: 'manual_probe_speech',
        classification_rule_ref: 'manual_review_v1',
        evidence_type: 'manual_playback_review',
        primary_transcription_attachment_index: 0,
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('eligible attachment');
    expect(messagesUpdateOne).not.toHaveBeenCalled();
  });

  it('regresses resolved message back to pending and clears stale skip/error artifacts', async () => {
    const performerId = new ObjectId('507f1f77bcf86cd799439131');
    const sessionId = new ObjectId();
    const messageId = new ObjectId();

    const messageDoc = {
      _id: messageId,
      session_id: sessionId,
      source_type: 'telegram',
      message_type: 'document',
      is_deleted: false,
      classification_resolution_state: 'resolved',
      transcription_eligibility: 'ineligible',
      transcription_processing_state: 'classified_skip',
      transcription_skip_reason: 'ineligible_payload_media_kind',
      transcription_error: 'empty_result',
      primary_transcription_attachment_index: 0,
      attachments: [
        {
          source: 'telegram',
          kind: 'file',
          file_id: 'tg-candidate-1',
          file_unique_id: 'tg-candidate-uniq-1',
          name: 'candidate-1.webm',
          mimeType: 'video/webm',
          classification_resolution_state: 'resolved',
          transcription_eligibility: 'ineligible',
          transcription_processing_state: 'classified_skip',
        },
      ],
    };

    const messagesUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
    const dbStub = {
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.MESSAGES) {
          return {
            findOne: jest.fn(async () => messageDoc),
            updateOne: messagesUpdateOne,
          };
        }
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return {
            findOne: jest.fn(async () => ({ _id: sessionId, is_deleted: false })),
            updateOne: jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 })),
          };
        }
        return {};
      },
    };
    getDbMock.mockReturnValue(dbStub);
    getRawDbMock.mockReturnValue(dbStub);

    const app = buildApp(performerId);

    const response = await request(app)
      .post('/voicebot/transcription/resolve_classification')
      .send({
        message_id: messageId.toHexString(),
        resolution: 'pending',
        transcription_eligibility_basis: 'evidence_invalidated',
        classification_rule_ref: 'manual_recheck_v1',
        evidence_type: 'manual_review_regression',
        evidence: 'prior probe deemed insufficient',
      });

    expect(response.status).toBe(200);
    expect(response.body.classification_resolution_state).toBe('pending');
    expect(response.body.transcription_eligibility).toBeNull();
    expect(response.body.transcription_processing_state).toBe('pending_classification');
    expect(response.body.primary_transcription_attachment_index).toBeNull();

    const updatePayload = messagesUpdateOne.mock.calls[0]?.[1] as Record<string, unknown>;
    const setPayload = (updatePayload.$set || {}) as Record<string, unknown>;
    const unsetPayload = (updatePayload.$unset || {}) as Record<string, unknown>;

    expect(setPayload.classification_resolution_state).toBe('pending');
    expect(setPayload.transcription_eligibility).toBeNull();
    expect(setPayload.transcription_processing_state).toBe('pending_classification');
    expect(setPayload.to_transcribe).toBe(false);
    expect(setPayload.primary_transcription_attachment_index).toBeNull();
    expect(setPayload.file_id).toBeNull();
    expect(setPayload.file_unique_id).toBeNull();
    expect(setPayload.file_name).toBeNull();
    expect(setPayload.mime_type).toBeNull();
    expect(setPayload.transcription_pending_probe_requested_at).toEqual(expect.any(Date));
    expect(setPayload.transcription_pending_probe_request_source).toBe('operator_resolution');

    expect(unsetPayload.transcription_error).toBe(1);
    expect(unsetPayload.transcription_error_context).toBe(1);
    expect(unsetPayload.transcription_skip_reason).toBe(1);

    const persistedAttachments = (setPayload.attachments || []) as Array<Record<string, unknown>>;
    expect(persistedAttachments[0]?.classification_resolution_state).toBe('pending');
    expect(persistedAttachments[0]?.transcription_eligibility).toBeNull();
    expect(persistedAttachments[0]?.transcription_processing_state).toBe('pending_classification');
  });
});
