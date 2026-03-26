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
