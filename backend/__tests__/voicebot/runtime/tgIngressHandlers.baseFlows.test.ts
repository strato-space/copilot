import { ObjectId } from 'mongodb';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import {
  FORWARDED_CHAT_ID,
  VOICEBOT_JOBS,
  VOICEBOT_QUEUES,
  getActiveVoiceSessionForUserMock,
  setActiveVoiceSessionMock,
  makeDb,
  buildIngressDeps,
  handleAttachmentIngress,
  handleTextIngress,
  handleVoiceIngress,
  resetTgIngressMocks,
} from './tgIngressHandlers.test.helpers.js';

describe('voicebot tgbot ingress handlers', () => {
  beforeEach(() => {
    resetTgIngressMocks();
  });

  it('routes text ingress into existing active session', async () => {
    const performerId = new ObjectId();
    const sessionId = new ObjectId();

    getActiveVoiceSessionForUserMock.mockResolvedValue({
      active_session_id: sessionId,
    });

    const { db, spies } = makeDb({
      performer: { _id: performerId, telegram_id: '1001' },
      activeSession: {
        _id: sessionId,
        session_type: 'multiprompt_voice_session',
        is_active: true,
      },
    });

    const result = await handleTextIngress({
      deps: buildIngressDeps({ db }),
      input: {
        telegram_user_id: 1001,
        chat_id: 1001,
        username: 'tester',
        message_id: 55,
        message_timestamp: 1770500000,
        text: 'hello from tg',
      },
    });

    expect(result.ok).toBe(true);
    expect(result.created_session).toBe(false);
    expect(spies.sessionsInsertOne).not.toHaveBeenCalled();
    expect(spies.messagesInsertOne).toHaveBeenCalledTimes(1);

    const inserted = spies.messagesInsertOne.mock.calls[0]?.[0] as Record<string, unknown>;
    expect((inserted.session_id as ObjectId).toHexString()).toBe(sessionId.toHexString());
    expect(inserted.is_transcribed).toBe(true);
    expect(setActiveVoiceSessionMock).not.toHaveBeenCalled();
  });

  it('queues categorization and create_tasks refresh for text ingress with canonical transcription shape', async () => {
    const performerId = new ObjectId();
    const sessionId = new ObjectId();
    const processorsQueueAdd = jest.fn(async () => ({ id: 'categorize-job' }));
    const postprocessorsQueueAdd = jest.fn(async () => ({ id: 'create-tasks-job' }));
    const sourceText = 'text parity payload';

    getActiveVoiceSessionForUserMock.mockResolvedValue({
      active_session_id: sessionId,
    });

    const { db, spies } = makeDb({
      performer: { _id: performerId, telegram_id: '1101' },
      activeSession: {
        _id: sessionId,
        session_type: 'multiprompt_voice_session',
        is_active: true,
        processors: ['transcription', 'categorization'],
        session_processors: ['CREATE_TASKS'],
      },
    });

    const result = await handleTextIngress({
      deps: buildIngressDeps({
        db,
        queues: {
          [VOICEBOT_QUEUES.PROCESSORS]: {
            add: processorsQueueAdd,
          },
          [VOICEBOT_QUEUES.POSTPROCESSORS]: {
            add: postprocessorsQueueAdd,
          },
        },
      }),
      input: {
        telegram_user_id: 1101,
        chat_id: 1101,
        username: 'queue-user',
        message_id: 5001,
        message_timestamp: 1770501111,
        text: sourceText,
      },
    });

    expect(result.ok).toBe(true);
    expect(result.message_id).toBeTruthy();

    const inserted = spies.messagesInsertOne.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(inserted.is_transcribed).toBe(true);
    expect(inserted.transcription_text).toBe(sourceText);
    expect(inserted.transcription_method).toBe('ready_text');
    expect(inserted.transcription).toEqual(
      expect.objectContaining({
        provider: 'legacy',
        model: 'ready_text',
        text: sourceText,
      })
    );
    expect(inserted.transcription_chunks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          text: sourceText,
        }),
      ])
    );
    const segments = ((inserted.transcription as Record<string, unknown>).segments || []) as Array<Record<string, unknown>>;
    expect(Array.isArray(segments)).toBe(true);
    expect(String(segments[0]?.id || '')).toMatch(/^ch_/);

    expect(spies.messagesUpdateOne).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: expect.any(ObjectId),
      }),
      expect.objectContaining({
        $set: expect.objectContaining({
          'processors_data.categorization.is_processing': true,
          'processors_data.categorization.is_processed': false,
        }),
      })
    );

    expect(processorsQueueAdd).toHaveBeenCalledWith(
      VOICEBOT_JOBS.voice.CATEGORIZE,
      expect.objectContaining({
        session_id: sessionId.toHexString(),
        message_id: result.message_id,
      }),
      expect.objectContaining({
        deduplication: expect.any(Object),
      })
    );
    expect(postprocessorsQueueAdd).toHaveBeenCalledWith(
      VOICEBOT_JOBS.postprocessing.CREATE_TASKS,
      expect.objectContaining({
        session_id: sessionId.toHexString(),
        refresh_mode: 'incremental_refresh',
      }),
      expect.objectContaining({
        deduplication: expect.any(Object),
      })
    );
    const createTasksRefreshCall = spies.sessionsUpdateOne.mock.calls.find((call) => {
      const update = call?.[1] as Record<string, unknown> | undefined;
      const setPayload = (update?.$set || {}) as Record<string, unknown>;
      return Object.prototype.hasOwnProperty.call(setPayload, 'processors_data.CREATE_TASKS.auto_requested_at');
    });
    expect(createTasksRefreshCall).toBeTruthy();
    const createTasksRefreshUpdate = createTasksRefreshCall?.[1] as Record<string, unknown>;
    expect((createTasksRefreshUpdate.$unset as Record<string, unknown>)['processors_data.CREATE_TASKS.no_task_reason_code']).toBe(1);
    expect((createTasksRefreshUpdate.$unset as Record<string, unknown>)['processors_data.CREATE_TASKS.no_task_decision']).toBe(1);
    expect((createTasksRefreshUpdate.$unset as Record<string, unknown>)['processors_data.CREATE_TASKS.last_tasks_count']).toBe(1);
  });

  it('rolls back categorization processing flags and skips create_tasks refresh when text ingress categorization enqueue fails', async () => {
    const performerId = new ObjectId();
    const sessionId = new ObjectId();
    const processorsQueueAdd = jest.fn(async () => {
      throw new Error('processors queue down');
    });
    const postprocessorsQueueAdd = jest.fn(async () => ({ id: 'create-tasks-job' }));

    getActiveVoiceSessionForUserMock.mockResolvedValue({
      active_session_id: sessionId,
    });

    const { db, spies } = makeDb({
      performer: { _id: performerId, telegram_id: '1102' },
      activeSession: {
        _id: sessionId,
        session_type: 'multiprompt_voice_session',
        is_active: true,
        processors: ['transcription', 'categorization'],
        session_processors: ['CREATE_TASKS'],
      },
    });

    const result = await handleTextIngress({
      deps: buildIngressDeps({
        db,
        queues: {
          [VOICEBOT_QUEUES.PROCESSORS]: {
            add: processorsQueueAdd,
          },
          [VOICEBOT_QUEUES.POSTPROCESSORS]: {
            add: postprocessorsQueueAdd,
          },
        },
      }),
      input: {
        telegram_user_id: 1102,
        chat_id: 1102,
        username: 'queue-fail-user',
        message_id: 5002,
        message_timestamp: 1770502222,
        text: 'queue rollback check',
      },
    });

    expect(result.ok).toBe(true);
    expect(processorsQueueAdd).toHaveBeenCalledTimes(1);
    expect(postprocessorsQueueAdd).not.toHaveBeenCalled();

    const setProcessingCall = spies.messagesUpdateOne.mock.calls.find((call) => {
      const update = call?.[1] as Record<string, unknown> | undefined;
      const setPayload = (update?.$set || {}) as Record<string, unknown>;
      return setPayload['processors_data.categorization.is_processing'] === true;
    });
    expect(setProcessingCall).toBeTruthy();

    const rollbackCall = spies.messagesUpdateOne.mock.calls.find((call) => {
      const update = call?.[1] as Record<string, unknown> | undefined;
      const setPayload = (update?.$set || {}) as Record<string, unknown>;
      return setPayload['processors_data.categorization.is_processing'] === false;
    });
    expect(rollbackCall).toBeTruthy();
    const rollbackUpdate = rollbackCall?.[1] as Record<string, unknown>;
    expect((rollbackUpdate.$unset as Record<string, unknown>)['processors_data.categorization.job_queued_timestamp']).toBe(1);

    const createTasksRefreshCall = spies.sessionsUpdateOne.mock.calls.find((call) => {
      const update = call?.[1] as Record<string, unknown> | undefined;
      const setPayload = (update?.$set || {}) as Record<string, unknown>;
      return Object.prototype.hasOwnProperty.call(setPayload, 'processors_data.CREATE_TASKS.auto_requested_at');
    });
    expect(createTasksRefreshCall).toBeUndefined();
    const noTaskDecisionPersistCall = spies.sessionsUpdateOne.mock.calls.find((call) => {
      const update = call?.[1] as Record<string, unknown> | undefined;
      const setPayload = (update?.$set || {}) as Record<string, unknown>;
      return setPayload['processors_data.CREATE_TASKS.no_task_reason_code'] === 'categorization_not_queued';
    });
    expect(noTaskDecisionPersistCall).toBeTruthy();
  });

  it('keeps create_tasks refresh enabled when categorization processor is disabled for session', async () => {
    const performerId = new ObjectId();
    const sessionId = new ObjectId();
    const processorsQueueAdd = jest.fn(async () => ({ id: 'categorize-job' }));
    const postprocessorsQueueAdd = jest.fn(async () => ({ id: 'create-tasks-job' }));

    getActiveVoiceSessionForUserMock.mockResolvedValue({
      active_session_id: sessionId,
    });

    const { db } = makeDb({
      performer: { _id: performerId, telegram_id: '1103' },
      activeSession: {
        _id: sessionId,
        session_type: 'multiprompt_voice_session',
        is_active: true,
        processors: ['transcription'],
        session_processors: ['CREATE_TASKS'],
      },
    });

    const result = await handleTextIngress({
      deps: buildIngressDeps({
        db,
        queues: {
          [VOICEBOT_QUEUES.PROCESSORS]: {
            add: processorsQueueAdd,
          },
          [VOICEBOT_QUEUES.POSTPROCESSORS]: {
            add: postprocessorsQueueAdd,
          },
        },
      }),
      input: {
        telegram_user_id: 1103,
        chat_id: 1103,
        username: 'categorization-disabled-user',
        message_id: 5003,
        message_timestamp: 1770503333,
        text: 'create_tasks should still refresh',
      },
    });

    expect(result.ok).toBe(true);
    expect(processorsQueueAdd).not.toHaveBeenCalled();
    expect(postprocessorsQueueAdd).toHaveBeenCalledTimes(1);
  });

  it('creates and activates session for voice ingress when mapping is missing', async () => {
    const performerId = new ObjectId();
    const createdSessionId = new ObjectId();
    const voiceQueueAdd = jest.fn(async () => ({ id: 'voice-job-1' }));

    getActiveVoiceSessionForUserMock.mockResolvedValue(null);

    const { db, spies } = makeDb({
      performer: { _id: performerId, telegram_id: '1002' },
      createdSessionId,
    });

    const result = await handleVoiceIngress({
      deps: buildIngressDeps({
        db,
        queues: {
          [VOICEBOT_QUEUES.VOICE]: {
            add: voiceQueueAdd,
          },
        },
      }),
      input: {
        telegram_user_id: 1002,
        chat_id: 1002,
        username: 'voice-user',
        message_id: 77,
        message_timestamp: 1770500100,
        file_id: 'voice-file-1',
        duration: 12,
      },
    });

    expect(result.ok).toBe(true);
    expect(result.created_session).toBe(true);
    expect(spies.sessionsInsertOne).toHaveBeenCalledTimes(1);
    expect(setActiveVoiceSessionMock).toHaveBeenCalledTimes(1);
    expect(voiceQueueAdd).toHaveBeenCalledWith(
      VOICEBOT_JOBS.voice.TRANSCRIBE,
      expect.objectContaining({
        session_id: createdSessionId.toHexString(),
      }),
      expect.objectContaining({ deduplication: expect.any(Object) })
    );
  });

  it('uses explicit session reference for attachment ingress and updates active mapping', async () => {
    const performerId = new ObjectId();
    const explicitSessionId = new ObjectId();

    getActiveVoiceSessionForUserMock.mockResolvedValue(null);

    const { db, spies } = makeDb({
      performer: { _id: performerId, telegram_id: '1003' },
      explicitSession: {
        _id: explicitSessionId,
        session_type: 'multiprompt_voice_session',
        user_id: performerId,
      },
    });

    const result = await handleAttachmentIngress({
      deps: buildIngressDeps({ db }),
      input: {
        telegram_user_id: 1003,
        chat_id: 1003,
        username: 'att-user',
        message_id: 88,
        message_timestamp: 1770500200,
        text: `please attach to /session/${explicitSessionId.toHexString()}`,
        message_type: 'document',
        attachments: [
          {
            kind: 'file',
            source: 'telegram',
            file_id: 'doc-file-1',
            file_unique_id: 'uniq-1',
            name: 'spec.pdf',
            mimeType: 'application/pdf',
            size: 1024,
          },
        ],
      },
    });

    expect(result.ok).toBe(true);
    expect(result.created_session).toBe(false);
    expect(spies.sessionsInsertOne).not.toHaveBeenCalled();
    expect(spies.messagesInsertOne).toHaveBeenCalledTimes(1);

    const inserted = spies.messagesInsertOne.mock.calls[0]?.[0] as Record<string, unknown>;
    expect((inserted.session_id as ObjectId).toHexString()).toBe(explicitSessionId.toHexString());
    expect(Array.isArray(inserted.attachments)).toBe(true);
    expect(setActiveVoiceSessionMock).toHaveBeenCalledTimes(1);
  });

  it('classifies telemost-style webm attachment as pending media without legacy transcript fallback', async () => {
    const performerId = new ObjectId();
    const sessionId = new ObjectId();

    getActiveVoiceSessionForUserMock.mockResolvedValue({
      active_session_id: sessionId,
    });

    const { db, spies } = makeDb({
      performer: { _id: performerId, telegram_id: '1301' },
      activeSession: {
        _id: sessionId,
        session_type: 'multiprompt_voice_session',
        is_active: true,
      },
    });

    const result = await handleAttachmentIngress({
      deps: buildIngressDeps({ db }),
      input: {
        telegram_user_id: 1301,
        chat_id: 1301,
        username: 'telemost-user',
        message_id: 5201,
        message_timestamp: 1770511111,
        message_type: 'document',
        attachments: [
          {
            kind: 'file',
            source: 'telegram',
            file_id: 'telemost-file-1',
            file_unique_id: 'telemost-uniq-1',
            name: 'telemost-recording.webm',
            mimeType: 'video/webm',
            size: 4_096_000,
            duration_ms: 85_000,
          },
        ],
      },
    });

    expect(result.ok).toBe(true);
    const inserted = spies.messagesInsertOne.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(inserted.is_transcribed).toBe(false);
    expect(inserted.to_transcribe).toBe(false);
    expect(inserted.transcribe_attempts).toBe(0);
    expect(inserted.source_note_text).toBeNull();
    expect(inserted.primary_payload_media_kind).toBe('video');
    expect(inserted.primary_transcription_attachment_index).toBeNull();
    expect(inserted.classification_resolution_state).toBe('pending');
    expect(inserted.transcription_eligibility).toBeNull();
    expect(inserted.transcription_processing_state).toBe('pending_classification');
    expect(inserted.file_id).toBe('telemost-file-1');
    expect(inserted.file_unique_id).toBe('telemost-uniq-1');
    expect(inserted.file_name).toBe('telemost-recording.webm');
    expect(inserted.mime_type).toBe('video/webm');
    expect(inserted.transcription_method).toBeUndefined();
    expect(inserted.transcription_text).toBeUndefined();
    expect(inserted.transcription).toBeUndefined();

    const insertedAttachments = inserted.attachments as Array<Record<string, unknown>>;
    expect(Array.isArray(insertedAttachments)).toBe(true);
    expect(insertedAttachments[0]).toEqual(
      expect.objectContaining({
        payload_media_kind: 'video',
        speech_bearing_assessment: 'unresolved',
        classification_resolution_state: 'pending',
        transcription_eligibility: null,
        transcription_eligibility_basis: 'ingress_requires_speech_probe',
      })
    );
  });

  it('stores telemost caption as source note without fabricating transcript while media stays pending', async () => {
    const performerId = new ObjectId();
    const sessionId = new ObjectId();

    getActiveVoiceSessionForUserMock.mockResolvedValue({
      active_session_id: sessionId,
    });

    const { db, spies } = makeDb({
      performer: { _id: performerId, telegram_id: '1302' },
      activeSession: {
        _id: sessionId,
        session_type: 'multiprompt_voice_session',
        is_active: true,
      },
    });

    const result = await handleAttachmentIngress({
      deps: buildIngressDeps({ db }),
      input: {
        telegram_user_id: 1302,
        chat_id: 1302,
        username: 'telemost-caption-user',
        message_id: 5202,
        message_timestamp: 1770512222,
        message_type: 'document',
        caption: 'meeting recap from sender',
        attachments: [
          {
            kind: 'file',
            source: 'telegram',
            file_id: 'telemost-file-2',
            file_unique_id: 'telemost-uniq-2',
            name: 'telemost-caption.webm',
            mimeType: 'video/webm',
            size: 4_096_100,
            duration_ms: 95_000,
          },
        ],
      },
    });

    expect(result.ok).toBe(true);
    const inserted = spies.messagesInsertOne.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(inserted.source_note_text).toBe('meeting recap from sender');
    expect(inserted.classification_resolution_state).toBe('pending');
    expect(inserted.transcription_eligibility).toBeNull();
    expect(inserted.transcription_processing_state).toBe('pending_classification');
    expect(inserted.is_transcribed).toBe(false);
    expect(inserted.to_transcribe).toBe(false);
    expect(inserted.transcription_method).toBeUndefined();
    expect(inserted.transcription_text).toBeUndefined();
    expect(inserted.transcription).toBeUndefined();
  });

  it('classifies video document without audio track as ineligible with no_audio_track skip reason', async () => {
    const performerId = new ObjectId();
    const sessionId = new ObjectId();

    getActiveVoiceSessionForUserMock.mockResolvedValue({
      active_session_id: sessionId,
    });

    const { db, spies } = makeDb({
      performer: { _id: performerId, telegram_id: '1304' },
      activeSession: {
        _id: sessionId,
        session_type: 'multiprompt_voice_session',
        is_active: true,
      },
    });

    const result = await handleAttachmentIngress({
      deps: buildIngressDeps({ db }),
      input: {
        telegram_user_id: 1304,
        chat_id: 1304,
        username: 'video-no-audio-user',
        message_id: 5204,
        message_timestamp: 1770514444,
        message_type: 'document',
        attachments: [
          {
            kind: 'file',
            source: 'telegram',
            file_id: 'video-no-audio-file-1',
            file_unique_id: 'video-no-audio-uniq-1',
            name: 'silent-recording.webm',
            mimeType: 'video/webm',
            size: 1_024_000,
            has_audio: false,
            audio_track_state: 'missing',
          },
        ],
      },
    });

    expect(result.ok).toBe(true);
    const inserted = spies.messagesInsertOne.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(inserted.primary_transcription_attachment_index).toBe(0);
    expect(inserted.primary_payload_media_kind).toBe('video');
    expect(inserted.classification_resolution_state).toBe('resolved');
    expect(inserted.transcription_eligibility).toBe('ineligible');
    expect(inserted.transcription_processing_state).toBe('classified_skip');
    expect(inserted.transcription_skip_reason).toBe('no_audio_track');
    expect(inserted.to_transcribe).toBe(false);
    expect(inserted.is_transcribed).toBe(false);
    const insertedAttachments = inserted.attachments as Array<Record<string, unknown>>;
    expect(insertedAttachments[0]).toEqual(
      expect.objectContaining({
        payload_media_kind: 'video',
        classification_resolution_state: 'resolved',
        transcription_eligibility: 'ineligible',
        transcription_skip_reason: 'no_audio_track',
        transcription_eligibility_basis: 'ingress_video_no_audio_track',
      })
    );
  });

  it('treats extension-only .webm without audio as video and skips transcription', async () => {
    const performerId = new ObjectId();
    const sessionId = new ObjectId();

    getActiveVoiceSessionForUserMock.mockResolvedValue({
      active_session_id: sessionId,
    });

    const { db, spies } = makeDb({
      performer: { _id: performerId, telegram_id: '1305' },
      activeSession: {
        _id: sessionId,
        session_type: 'multiprompt_voice_session',
        is_active: true,
      },
    });

    const result = await handleAttachmentIngress({
      deps: buildIngressDeps({ db }),
      input: {
        telegram_user_id: 1305,
        chat_id: 1305,
        username: 'silent-webm-no-mime-user',
        message_id: 5205,
        message_timestamp: 1770515555,
        message_type: 'document',
        attachments: [
          {
            kind: 'file',
            source: 'telegram',
            file_id: 'video-no-audio-file-2',
            file_unique_id: 'video-no-audio-uniq-2',
            name: 'silent-extension-only.webm',
            size: 1_024_001,
            has_audio: false,
            audio_track_state: 'none',
          },
        ],
      },
    });

    expect(result.ok).toBe(true);
    const inserted = spies.messagesInsertOne.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(inserted.primary_payload_media_kind).toBe('video');
    expect(inserted.transcription_eligibility).toBe('ineligible');
    expect(inserted.transcription_processing_state).toBe('classified_skip');
    expect(inserted.transcription_skip_reason).toBe('no_audio_track');
    expect(inserted.to_transcribe).toBe(false);
  });

  it('projects deterministic primary attachment for all-ineligible multi-attachment ingress', async () => {
    const performerId = new ObjectId();
    const sessionId = new ObjectId();

    getActiveVoiceSessionForUserMock.mockResolvedValue({
      active_session_id: sessionId,
    });

    const { db, spies } = makeDb({
      performer: { _id: performerId, telegram_id: '1303' },
      activeSession: {
        _id: sessionId,
        session_type: 'multiprompt_voice_session',
        is_active: true,
      },
    });

    const result = await handleAttachmentIngress({
      deps: buildIngressDeps({ db }),
      input: {
        telegram_user_id: 1303,
        chat_id: 1303,
        username: 'multi-ineligible-user',
        message_id: 5203,
        message_timestamp: 1770513333,
        message_type: 'document',
        attachments: [
          {
            kind: 'file',
            source: 'telegram',
            file_id: 'doc-file-idx0',
            file_unique_id: 'doc-uniq-idx0',
            name: 'a.pdf',
            mimeType: 'application/pdf',
            duration_ms: 30_000,
            size: 500,
          },
          {
            kind: 'file',
            source: 'telegram',
            file_id: 'doc-file-idx1',
            file_unique_id: 'doc-uniq-idx1',
            name: 'b.docx',
            mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            duration_ms: 30_000,
            size: 900,
          },
          {
            kind: 'file',
            source: 'telegram',
            file_id: 'doc-file-idx2',
            file_unique_id: 'doc-uniq-idx2',
            name: 'c.xlsx',
            mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            duration_ms: 30_000,
            size: 900,
          },
        ],
      },
    });

    expect(result.ok).toBe(true);
    const inserted = spies.messagesInsertOne.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(inserted.primary_transcription_attachment_index).toBe(1);
    expect(inserted.primary_payload_media_kind).toBe('binary_document');
    expect(inserted.classification_resolution_state).toBe('resolved');
    expect(inserted.transcription_eligibility).toBe('ineligible');
    expect(inserted.transcription_processing_state).toBe('classified_skip');
    expect(inserted.transcription_skip_reason).toBe('ineligible_payload_media_kind');
    expect(inserted.file_id).toBe('doc-file-idx1');
    expect(inserted.file_unique_id).toBe('doc-uniq-idx1');
    expect(inserted.file_name).toBe('b.docx');
    expect(inserted.mime_type).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(inserted.transcription_text).toBeUndefined();
    expect(inserted.transcription).toBeUndefined();
    const insertedAttachments = inserted.attachments as Array<Record<string, unknown>>;
    expect(insertedAttachments.map((attachment) => attachment.transcription_eligibility)).toEqual([
      'ineligible',
      'ineligible',
      'ineligible',
    ]);
    expect(insertedAttachments.map((attachment) => attachment.classification_resolution_state)).toEqual([
      'resolved',
      'resolved',
      'resolved',
    ]);
  });

  it('queues categorization and create_tasks refresh for add_attachment text with canonical transcription shape', async () => {
    const performerId = new ObjectId();
    const sessionId = new ObjectId();
    const processorsQueueAdd = jest.fn(async () => ({ id: 'categorize-job' }));
    const postprocessorsQueueAdd = jest.fn(async () => ({ id: 'create-tasks-job' }));
    const sourceText = 'attachment text parity payload';

    getActiveVoiceSessionForUserMock.mockResolvedValue({
      active_session_id: sessionId,
    });

    const { db, spies } = makeDb({
      performer: { _id: performerId, telegram_id: '1201' },
      activeSession: {
        _id: sessionId,
        session_type: 'multiprompt_voice_session',
        is_active: true,
        processors: ['transcription', 'categorization'],
        session_processors: ['CREATE_TASKS'],
      },
    });

    const result = await handleAttachmentIngress({
      deps: buildIngressDeps({
        db,
        queues: {
          [VOICEBOT_QUEUES.PROCESSORS]: {
            add: processorsQueueAdd,
          },
          [VOICEBOT_QUEUES.POSTPROCESSORS]: {
            add: postprocessorsQueueAdd,
          },
        },
      }),
      input: {
        telegram_user_id: 1201,
        chat_id: 1201,
        username: 'attachment-queue-user',
        message_id: 5101,
        message_timestamp: 1770504444,
        text: sourceText,
        message_type: 'document',
        attachments: [
          {
            kind: 'file',
            source: 'telegram',
            file_id: 'doc-file-2',
            file_unique_id: 'uniq-2',
            name: 'notes.txt',
            mimeType: 'text/plain',
          },
        ],
      },
    });

    expect(result.ok).toBe(true);
    expect(result.message_id).toBeTruthy();

    const inserted = spies.messagesInsertOne.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(inserted.transcription_text).toBe(sourceText);
    expect(inserted.transcription_method).toBe('ready_text');
    expect(inserted.transcription).toEqual(
      expect.objectContaining({
        provider: 'legacy',
        model: 'ready_text',
        text: sourceText,
      })
    );

    expect(spies.messagesUpdateOne).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: expect.any(ObjectId),
      }),
      expect.objectContaining({
        $set: expect.objectContaining({
          'processors_data.categorization.is_processing': true,
          'processors_data.categorization.is_processed': false,
        }),
      })
    );

    expect(processorsQueueAdd).toHaveBeenCalledWith(
      VOICEBOT_JOBS.voice.CATEGORIZE,
      expect.objectContaining({
        session_id: sessionId.toHexString(),
        message_id: result.message_id,
      }),
      expect.objectContaining({
        deduplication: expect.any(Object),
      })
    );

    expect(postprocessorsQueueAdd).toHaveBeenCalledWith(
      VOICEBOT_JOBS.postprocessing.CREATE_TASKS,
      expect.objectContaining({
        session_id: sessionId.toHexString(),
        refresh_mode: 'incremental_refresh',
      }),
      expect.objectContaining({
        deduplication: expect.any(Object),
      })
    );
    const createTasksRefreshCall = spies.sessionsUpdateOne.mock.calls.find((call) => {
      const update = call?.[1] as Record<string, unknown> | undefined;
      const setPayload = (update?.$set || {}) as Record<string, unknown>;
      return Object.prototype.hasOwnProperty.call(setPayload, 'processors_data.CREATE_TASKS.auto_requested_at');
    });
    expect(createTasksRefreshCall).toBeTruthy();
    const createTasksRefreshUpdate = createTasksRefreshCall?.[1] as Record<string, unknown>;
    expect((createTasksRefreshUpdate.$unset as Record<string, unknown>)['processors_data.CREATE_TASKS.no_task_reason_code']).toBe(1);
    expect((createTasksRefreshUpdate.$unset as Record<string, unknown>)['processors_data.CREATE_TASKS.no_task_decision']).toBe(1);
    expect((createTasksRefreshUpdate.$unset as Record<string, unknown>)['processors_data.CREATE_TASKS.last_tasks_count']).toBe(1);
  });

  it('keeps create_tasks refresh enabled for add_attachment text when categorization processor is disabled', async () => {
    const performerId = new ObjectId();
    const sessionId = new ObjectId();
    const processorsQueueAdd = jest.fn(async () => ({ id: 'categorize-job' }));
    const postprocessorsQueueAdd = jest.fn(async () => ({ id: 'create-tasks-job' }));

    getActiveVoiceSessionForUserMock.mockResolvedValue({
      active_session_id: sessionId,
    });

    const { db, spies } = makeDb({
      performer: { _id: performerId, telegram_id: '1203' },
      activeSession: {
        _id: sessionId,
        session_type: 'multiprompt_voice_session',
        is_active: true,
        processors: ['transcription'],
        session_processors: ['CREATE_TASKS'],
      },
    });

    const result = await handleAttachmentIngress({
      deps: buildIngressDeps({
        db,
        queues: {
          [VOICEBOT_QUEUES.PROCESSORS]: {
            add: processorsQueueAdd,
          },
          [VOICEBOT_QUEUES.POSTPROCESSORS]: {
            add: postprocessorsQueueAdd,
          },
        },
      }),
      input: {
        telegram_user_id: 1203,
        chat_id: 1203,
        username: 'attachment-categorization-disabled-user',
        message_id: 5103,
        message_timestamp: 1770506666,
        text: 'attachment with disabled categorization',
        message_type: 'document',
        attachments: [
          {
            kind: 'file',
            source: 'telegram',
            file_id: 'doc-file-33',
            file_unique_id: 'uniq-33',
            name: 'disabled.txt',
            mimeType: 'text/plain',
          },
        ],
      },
    });

    expect(result.ok).toBe(true);
    expect(processorsQueueAdd).not.toHaveBeenCalled();
    expect(postprocessorsQueueAdd).toHaveBeenCalledTimes(1);
    const createTasksRefreshCall = spies.sessionsUpdateOne.mock.calls.find((call) => {
      const update = call?.[1] as Record<string, unknown> | undefined;
      const setPayload = (update?.$set || {}) as Record<string, unknown>;
      return Object.prototype.hasOwnProperty.call(setPayload, 'processors_data.CREATE_TASKS.auto_requested_at');
    });
    expect(createTasksRefreshCall).toBeTruthy();
    const createTasksRefreshUpdate = createTasksRefreshCall?.[1] as Record<string, unknown>;
    expect((createTasksRefreshUpdate.$unset as Record<string, unknown>)['processors_data.CREATE_TASKS.no_task_reason_code']).toBe(1);
    expect((createTasksRefreshUpdate.$unset as Record<string, unknown>)['processors_data.CREATE_TASKS.no_task_decision']).toBe(1);
    expect((createTasksRefreshUpdate.$unset as Record<string, unknown>)['processors_data.CREATE_TASKS.last_tasks_count']).toBe(1);
  });

  it('continues add_attachment regular flow when garbage detector is unavailable', async () => {
    const performerId = new ObjectId();
    const sessionId = new ObjectId();
    const processorsQueueAdd = jest.fn(async () => ({ id: 'categorize-job' }));
    const postprocessorsQueueAdd = jest.fn(async () => ({ id: 'create-tasks-job' }));
    delete process.env.OPENAI_API_KEY;

    getActiveVoiceSessionForUserMock.mockResolvedValue({
      active_session_id: sessionId,
    });

    const { db, spies } = makeDb({
      performer: { _id: performerId, telegram_id: '1204' },
      activeSession: {
        _id: sessionId,
        session_type: 'multiprompt_voice_session',
        is_active: true,
        processors: ['transcription', 'categorization'],
        session_processors: ['CREATE_TASKS'],
      },
    });

    const result = await handleAttachmentIngress({
      deps: buildIngressDeps({
        db,
        queues: {
          [VOICEBOT_QUEUES.PROCESSORS]: {
            add: processorsQueueAdd,
          },
          [VOICEBOT_QUEUES.POSTPROCESSORS]: {
            add: postprocessorsQueueAdd,
          },
        },
      }),
      input: {
        telegram_user_id: 1204,
        chat_id: 1204,
        username: 'attachment-detector-unavailable-user',
        message_id: 5104,
        message_timestamp: 1770507777,
        text: 'regular attachment flow without detector',
        message_type: 'document',
        attachments: [
          {
            kind: 'file',
            source: 'telegram',
            file_id: 'doc-file-44',
            file_unique_id: 'uniq-44',
            name: 'no-detector.txt',
            mimeType: 'text/plain',
          },
        ],
      },
    });

    expect(result.ok).toBe(true);
    expect(processorsQueueAdd).toHaveBeenCalledTimes(1);
    expect(postprocessorsQueueAdd).toHaveBeenCalledTimes(1);
    const inserted = spies.messagesInsertOne.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(inserted, 'garbage_detection')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(inserted, 'garbage_detected')).toBe(false);
    expect(inserted.is_transcribed).toBe(true);
    expect(inserted.transcription_method).toBe('ready_text');
    expect(inserted.transcription_text).toBe('regular attachment flow without detector');
    expect(inserted.transcription).toEqual(
      expect.objectContaining({
        provider: 'legacy',
        model: 'ready_text',
        text: 'regular attachment flow without detector',
      })
    );
  });

  it('continues add_attachment regular flow when garbage detector throws', async () => {
    const performerId = new ObjectId();
    const sessionId = new ObjectId();
    const processorsQueueAdd = jest.fn(async () => ({ id: 'categorize-job' }));
    const postprocessorsQueueAdd = jest.fn(async () => ({ id: 'create-tasks-job' }));
    const garbageDetector = jest.fn(async () => {
      throw new Error('detector down');
    });

    getActiveVoiceSessionForUserMock.mockResolvedValue({
      active_session_id: sessionId,
    });

    const { db, spies } = makeDb({
      performer: { _id: performerId, telegram_id: '1205' },
      activeSession: {
        _id: sessionId,
        session_type: 'multiprompt_voice_session',
        is_active: true,
        processors: ['transcription', 'categorization'],
        session_processors: ['CREATE_TASKS'],
      },
    });

    const result = await handleAttachmentIngress({
      deps: buildIngressDeps({
        db,
        queues: {
          [VOICEBOT_QUEUES.PROCESSORS]: {
            add: processorsQueueAdd,
          },
          [VOICEBOT_QUEUES.POSTPROCESSORS]: {
            add: postprocessorsQueueAdd,
          },
        },
        garbageDetector,
      }),
      input: {
        telegram_user_id: 1205,
        chat_id: 1205,
        username: 'attachment-detector-error-user',
        message_id: 5105,
        message_timestamp: 1770508888,
        text: 'regular attachment flow on detector error',
        message_type: 'document',
        attachments: [
          {
            kind: 'file',
            source: 'telegram',
            file_id: 'doc-file-55',
            file_unique_id: 'uniq-55',
            name: 'detector-error.txt',
            mimeType: 'text/plain',
          },
        ],
      },
    });

    expect(result.ok).toBe(true);
    expect(garbageDetector).toHaveBeenCalledTimes(1);
    expect(processorsQueueAdd).toHaveBeenCalledTimes(1);
    expect(postprocessorsQueueAdd).toHaveBeenCalledTimes(1);
    const inserted = spies.messagesInsertOne.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(inserted, 'garbage_detection')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(inserted, 'garbage_detected')).toBe(false);
    expect(inserted.is_transcribed).toBe(true);
    expect(inserted.transcription_method).toBe('ready_text');
    expect(inserted.transcription_text).toBe('regular attachment flow on detector error');
    expect(inserted.transcription).toEqual(
      expect.objectContaining({
        provider: 'legacy',
        model: 'ready_text',
        text: 'regular attachment flow on detector error',
      })
    );
  });

  it('skips create_tasks refresh for add_attachment text when categorization enqueue fails', async () => {
    const performerId = new ObjectId();
    const sessionId = new ObjectId();
    const processorsQueueAdd = jest.fn(async () => {
      throw new Error('processors queue down');
    });
    const postprocessorsQueueAdd = jest.fn(async () => ({ id: 'create-tasks-job' }));

    getActiveVoiceSessionForUserMock.mockResolvedValue({
      active_session_id: sessionId,
    });

    const { db, spies } = makeDb({
      performer: { _id: performerId, telegram_id: '1202' },
      activeSession: {
        _id: sessionId,
        session_type: 'multiprompt_voice_session',
        is_active: true,
        processors: ['transcription', 'categorization'],
        session_processors: ['CREATE_TASKS'],
      },
    });

    const result = await handleAttachmentIngress({
      deps: buildIngressDeps({
        db,
        queues: {
          [VOICEBOT_QUEUES.PROCESSORS]: {
            add: processorsQueueAdd,
          },
          [VOICEBOT_QUEUES.POSTPROCESSORS]: {
            add: postprocessorsQueueAdd,
          },
        },
      }),
      input: {
        telegram_user_id: 1202,
        chat_id: 1202,
        username: 'attachment-queue-fail-user',
        message_id: 5102,
        message_timestamp: 1770505555,
        text: 'attachment queue rollback check',
        message_type: 'document',
        attachments: [
          {
            kind: 'file',
            source: 'telegram',
            file_id: 'doc-file-3',
            file_unique_id: 'uniq-3',
            name: 'rollback.txt',
            mimeType: 'text/plain',
          },
        ],
      },
    });

    expect(result.ok).toBe(true);
    expect(processorsQueueAdd).toHaveBeenCalledTimes(1);
    expect(postprocessorsQueueAdd).not.toHaveBeenCalled();

    const rollbackCall = spies.messagesUpdateOne.mock.calls.find((call) => {
      const update = call?.[1] as Record<string, unknown> | undefined;
      const setPayload = (update?.$set || {}) as Record<string, unknown>;
      const unsetPayload = (update?.$unset || {}) as Record<string, unknown>;
      return setPayload['processors_data.categorization.is_processing'] === false
        && unsetPayload['processors_data.categorization.job_queued_timestamp'] === 1;
    });
    expect(rollbackCall).toBeTruthy();

    const createTasksRefreshCall = spies.sessionsUpdateOne.mock.calls.find((call) => {
      const update = call?.[1] as Record<string, unknown> | undefined;
      const setPayload = (update?.$set || {}) as Record<string, unknown>;
      return Object.prototype.hasOwnProperty.call(setPayload, 'processors_data.CREATE_TASKS.auto_requested_at');
    });
    expect(createTasksRefreshCall).toBeUndefined();
    const noTaskDecisionPersistCall = spies.sessionsUpdateOne.mock.calls.find((call) => {
      const update = call?.[1] as Record<string, unknown> | undefined;
      const setPayload = (update?.$set || {}) as Record<string, unknown>;
      return setPayload['processors_data.CREATE_TASKS.no_task_reason_code'] === 'categorization_not_queued';
    });
    expect(noTaskDecisionPersistCall).toBeTruthy();
  });

  it('resolves explicit session from reply_text reference for text ingress', async () => {
    const performerId = new ObjectId();
    const explicitSessionId = new ObjectId();

    getActiveVoiceSessionForUserMock.mockResolvedValue(null);

    const { db, spies } = makeDb({
      performer: { _id: performerId, telegram_id: '1004' },
      explicitSession: {
        _id: explicitSessionId,
        session_type: 'multiprompt_voice_session',
        user_id: performerId,
      },
    });

    const result = await handleTextIngress({
      deps: buildIngressDeps({ db }),
      input: {
        telegram_user_id: 1004,
        chat_id: 1004,
        username: 'reply-user',
        message_id: 99,
        message_timestamp: 1770500300,
        text: 'follow up answer',
        reply_text: `context: /session/${explicitSessionId.toHexString()}`,
      },
    });

    expect(result.ok).toBe(true);
    expect(result.created_session).toBe(false);
    expect(spies.sessionsInsertOne).not.toHaveBeenCalled();

    const inserted = spies.messagesInsertOne.mock.calls[0]?.[0] as Record<string, unknown>;
    expect((inserted.session_id as ObjectId).toHexString()).toBe(explicitSessionId.toHexString());
    expect(setActiveVoiceSessionMock).toHaveBeenCalledTimes(1);
  });

  it('stores forwarded_context for forwarded text ingress', async () => {
    const performerId = new ObjectId();
    const sessionId = new ObjectId();

    getActiveVoiceSessionForUserMock.mockResolvedValue({
      active_session_id: sessionId,
    });

    const { db, spies } = makeDb({
      performer: { _id: performerId, telegram_id: '1005' },
      activeSession: {
        _id: sessionId,
        session_type: 'multiprompt_voice_session',
        is_active: true,
      },
    });

    const forwardedContext = {
      forward_origin: {
        type: 'channel',
        chat: { id: FORWARDED_CHAT_ID, title: 'Forward Source' },
      },
      forward_from_message_id: 741,
    };

    const result = await handleTextIngress({
      deps: buildIngressDeps({ db }),
      input: {
        telegram_user_id: 1005,
        chat_id: 1005,
        username: 'forward-user',
        message_id: 101,
        message_timestamp: 1770500400,
        text: 'forwarded block text',
        forwarded_context: forwardedContext,
      },
    });

    expect(result.ok).toBe(true);
    const inserted = spies.messagesInsertOne.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(inserted.forwarded_context).toEqual(forwardedContext);
  });

});
