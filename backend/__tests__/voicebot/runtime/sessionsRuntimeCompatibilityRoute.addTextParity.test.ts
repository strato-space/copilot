import request from 'supertest';
import { ObjectId } from 'mongodb';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import {
  detectGarbageTranscriptionMock,
  VOICEBOT_COLLECTIONS,
  buildApp,
  getDbMock,
  getRawDbMock,
  getVoicebotQueuesMock,
  resetSessionsRuntimeCompatibilityMocks,
} from './sessionsRuntimeCompatibilityRoute.test.helpers.js';
import { VOICEBOT_JOBS, VOICEBOT_QUEUES } from '../../../src/constants.js';

describe('VoiceBot add_text runtime parity', () => {
  beforeEach(() => {
    resetSessionsRuntimeCompatibilityMocks();
    delete process.env.OPENAI_API_KEY;
  });

  const buildWritableSessionState = (sessionId: ObjectId) => ({
    _id: sessionId,
    is_active: true,
    to_finalize: false,
    done_at: null,
  });

  it('stores canonical text transcription payload and enqueues categorization/create_tasks parity jobs for non-garbage detector result', async () => {
    const sessionId = new ObjectId();
    const insertedMessageId = new ObjectId();
    const sourceText = 'Parity payload from web add_text';
    process.env.OPENAI_API_KEY = 'test-openai-key';
    detectGarbageTranscriptionMock.mockResolvedValueOnce({
      checked_at: new Date('2026-01-01T00:00:00.000Z'),
      detector_version: 'post_transcribe_garbage_v1',
      model: 'gpt-5.4-nano',
      skipped: false,
      skip_reason: null,
      is_garbage: false,
      code: 'ok',
      reason: 'clean_speech',
      raw_output: '{"is_garbage":false}',
    });

    const processorsQueueAdd = jest.fn(async () => ({ id: 'categorize-job' }));
    const postprocessorsQueueAdd = jest.fn(async () => ({ id: 'create-tasks-job' }));
    getVoicebotQueuesMock.mockReturnValue({
      [VOICEBOT_QUEUES.PROCESSORS]: {
        add: processorsQueueAdd,
      },
      [VOICEBOT_QUEUES.POSTPROCESSORS]: {
        add: postprocessorsQueueAdd,
      },
    });

    const rawDbStub = {
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return {
            findOne: jest.fn(async () => ({
              _id: sessionId,
              chat_id: 123456,
              user_id: new ObjectId(),
              processors: ['transcription', 'categorization'],
              session_processors: ['CREATE_TASKS'],
              is_deleted: false,
            })),
          };
        }
        return {
          findOne: jest.fn(async () => null),
        };
      },
    };

    const messagesInsertOne = jest.fn(async () => ({ insertedId: insertedMessageId }));
    const messagesUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
    const sessionsUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
    const dbStub = {
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.MESSAGES) {
          return {
            insertOne: messagesInsertOne,
            updateOne: messagesUpdateOne,
          };
        }
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return {
            findOne: jest.fn(async () => buildWritableSessionState(sessionId)),
            updateOne: sessionsUpdateOne,
          };
        }
        return {
          find: jest.fn(() => ({ project: () => ({ toArray: async () => [] }) })),
          findOne: jest.fn(async () => null),
          updateOne: jest.fn(async () => ({ matchedCount: 0, modifiedCount: 0 })),
          insertOne: jest.fn(async () => ({ insertedId: new ObjectId() })),
        };
      },
    };

    getRawDbMock.mockReturnValue(rawDbStub);
    getDbMock.mockReturnValue(dbStub);

    const app = buildApp();
    const response = await request(app).post('/voicebot/add_text').send({
      session_id: sessionId.toHexString(),
      text: sourceText,
    });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.message_id).toBe(insertedMessageId.toHexString());
    expect(detectGarbageTranscriptionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        transcriptionText: sourceText,
      })
    );

    expect(messagesInsertOne).toHaveBeenCalledTimes(1);
    const inserted = messagesInsertOne.mock.calls[0]?.[0] as Record<string, unknown>;
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
    expect(inserted.garbage_detected).toBe(false);
    expect(inserted.garbage_detection).toEqual(
      expect.objectContaining({
        is_garbage: false,
        code: 'ok',
        reason: 'clean_speech',
      })
    );
    const segments = ((inserted.transcription as Record<string, unknown>).segments || []) as Array<Record<string, unknown>>;
    expect(Array.isArray(segments)).toBe(true);
    expect(String(segments[0]?.id || '')).toMatch(/^ch_/);

    expect(messagesUpdateOne).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: insertedMessageId,
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
        message_id: insertedMessageId.toHexString(),
        session_id: sessionId.toHexString(),
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

    const createTasksRefreshCall = sessionsUpdateOne.mock.calls.find((call) => {
      const update = call?.[1] as Record<string, unknown> | undefined;
      const setPayload = (update?.$set || {}) as Record<string, unknown>;
      return typeof setPayload['processors_data.CREATE_TASKS.auto_requested_at'] === 'number';
    });
    expect(createTasksRefreshCall).toBeTruthy();
    const createTasksRefreshUpdate = createTasksRefreshCall?.[1] as Record<string, unknown>;
    expect((createTasksRefreshUpdate.$unset as Record<string, unknown>)['processors_data.CREATE_TASKS.no_task_reason_code']).toBe(1);
    expect((createTasksRefreshUpdate.$unset as Record<string, unknown>)['processors_data.CREATE_TASKS.no_task_decision']).toBe(1);
    expect((createTasksRefreshUpdate.$unset as Record<string, unknown>)['processors_data.CREATE_TASKS.last_tasks_count']).toBe(1);
  });

  it('does not enqueue categorization/create_tasks for add_text when detector marks message as garbage', async () => {
    const sessionId = new ObjectId();
    const insertedMessageId = new ObjectId();
    const sourceText = 'uh uh uh';
    process.env.OPENAI_API_KEY = 'test-openai-key';
    detectGarbageTranscriptionMock.mockResolvedValueOnce({
      checked_at: new Date('2026-01-01T00:00:00.000Z'),
      detector_version: 'post_transcribe_garbage_v1',
      model: 'gpt-5.4-nano',
      skipped: false,
      skip_reason: null,
      is_garbage: true,
      code: 'noise_or_garbage',
      reason: 'repetitive_noise',
      raw_output: '{"is_garbage":true}',
    });

    const processorsQueueAdd = jest.fn(async () => ({ id: 'categorize-job' }));
    const postprocessorsQueueAdd = jest.fn(async () => ({ id: 'create-tasks-job' }));
    getVoicebotQueuesMock.mockReturnValue({
      [VOICEBOT_QUEUES.PROCESSORS]: {
        add: processorsQueueAdd,
      },
      [VOICEBOT_QUEUES.POSTPROCESSORS]: {
        add: postprocessorsQueueAdd,
      },
    });

    const rawDbStub = {
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return {
            findOne: jest.fn(async () => ({
              _id: sessionId,
              chat_id: 123456,
              user_id: new ObjectId(),
              processors: ['transcription', 'categorization'],
              session_processors: ['CREATE_TASKS'],
              is_deleted: false,
            })),
          };
        }
        return {
          findOne: jest.fn(async () => null),
        };
      },
    };

    const messagesInsertOne = jest.fn(async () => ({ insertedId: insertedMessageId }));
    const messagesUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
    const sessionsUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
    const dbStub = {
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.MESSAGES) {
          return {
            insertOne: messagesInsertOne,
            updateOne: messagesUpdateOne,
          };
        }
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return {
            findOne: jest.fn(async () => buildWritableSessionState(sessionId)),
            updateOne: sessionsUpdateOne,
          };
        }
        return {
          find: jest.fn(() => ({ project: () => ({ toArray: async () => [] }) })),
          findOne: jest.fn(async () => null),
          updateOne: jest.fn(async () => ({ matchedCount: 0, modifiedCount: 0 })),
          insertOne: jest.fn(async () => ({ insertedId: new ObjectId() })),
        };
      },
    };

    getRawDbMock.mockReturnValue(rawDbStub);
    getDbMock.mockReturnValue(dbStub);

    const app = buildApp();
    const response = await request(app).post('/voicebot/add_text').send({
      session_id: sessionId.toHexString(),
      text: sourceText,
    });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(detectGarbageTranscriptionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        transcriptionText: sourceText,
      })
    );

    expect(processorsQueueAdd).not.toHaveBeenCalled();
    expect(postprocessorsQueueAdd).not.toHaveBeenCalled();
    expect(messagesUpdateOne).not.toHaveBeenCalled();
    const createTasksRefreshCall = sessionsUpdateOne.mock.calls.find((call) => {
      const update = call?.[1] as Record<string, unknown> | undefined;
      const setPayload = (update?.$set || {}) as Record<string, unknown>;
      return typeof setPayload['processors_data.CREATE_TASKS.auto_requested_at'] === 'number';
    });
    expect(createTasksRefreshCall).toBeUndefined();

    const inserted = messagesInsertOne.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(inserted.garbage_detected).toBe(true);
    expect(inserted.is_deleted).toBe(true);
    expect(inserted.deletion_reason).toBe('garbage_detected');
    expect(inserted.garbage_detection).toEqual(
      expect.objectContaining({
        is_garbage: true,
        code: 'noise_or_garbage',
        reason: 'repetitive_noise',
      })
    );
    expect(inserted.categorization).toEqual([]);
    expect(inserted.processors_data).toEqual(
      expect.objectContaining({
        categorization: expect.objectContaining({
          is_processing: false,
          is_processed: true,
          is_finished: true,
          skipped_reason: 'garbage_detected',
        }),
      })
    );
  });

  it('does not enqueue CREATE_TASKS refresh when session processor config disables it', async () => {
    const sessionId = new ObjectId();
    const insertedMessageId = new ObjectId();

    const processorsQueueAdd = jest.fn(async () => ({ id: 'categorize-job' }));
    const postprocessorsQueueAdd = jest.fn(async () => ({ id: 'create-tasks-job' }));
    getVoicebotQueuesMock.mockReturnValue({
      [VOICEBOT_QUEUES.PROCESSORS]: {
        add: processorsQueueAdd,
      },
      [VOICEBOT_QUEUES.POSTPROCESSORS]: {
        add: postprocessorsQueueAdd,
      },
    });

    const rawDbStub = {
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return {
            findOne: jest.fn(async () => ({
              _id: sessionId,
              chat_id: 123456,
              user_id: new ObjectId(),
              processors: ['transcription', 'categorization'],
              session_processors: ['SUMMARY'],
              is_deleted: false,
            })),
          };
        }
        return {
          findOne: jest.fn(async () => null),
        };
      },
    };

    const messagesInsertOne = jest.fn(async () => ({ insertedId: insertedMessageId }));
    const messagesUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
    const sessionsUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
    const dbStub = {
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.MESSAGES) {
          return {
            insertOne: messagesInsertOne,
            updateOne: messagesUpdateOne,
          };
        }
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return {
            findOne: jest.fn(async () => buildWritableSessionState(sessionId)),
            updateOne: sessionsUpdateOne,
          };
        }
        return {
          find: jest.fn(() => ({ project: () => ({ toArray: async () => [] }) })),
          findOne: jest.fn(async () => null),
          updateOne: jest.fn(async () => ({ matchedCount: 0, modifiedCount: 0 })),
          insertOne: jest.fn(async () => ({ insertedId: new ObjectId() })),
        };
      },
    };

    getRawDbMock.mockReturnValue(rawDbStub);
    getDbMock.mockReturnValue(dbStub);

    const app = buildApp();
    const response = await request(app).post('/voicebot/add_text').send({
      session_id: sessionId.toHexString(),
      text: 'Create tasks should remain disabled',
    });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(processorsQueueAdd).toHaveBeenCalledTimes(1);
    expect(postprocessorsQueueAdd).not.toHaveBeenCalled();

    const createTasksRefreshCall = sessionsUpdateOne.mock.calls.find((call) => {
      const update = call?.[1] as Record<string, unknown> | undefined;
      const setPayload = (update?.$set || {}) as Record<string, unknown>;
      return typeof setPayload['processors_data.CREATE_TASKS.auto_requested_at'] === 'number';
    });
    expect(createTasksRefreshCall).toBeUndefined();
  });

  it('rolls back categorization processing flags when enqueue fails', async () => {
    const sessionId = new ObjectId();
    const insertedMessageId = new ObjectId();

    const processorsQueueAdd = jest.fn(async () => {
      throw new Error('processors queue down');
    });
    const postprocessorsQueueAdd = jest.fn(async () => ({ id: 'create-tasks-job' }));
    getVoicebotQueuesMock.mockReturnValue({
      [VOICEBOT_QUEUES.PROCESSORS]: {
        add: processorsQueueAdd,
      },
      [VOICEBOT_QUEUES.POSTPROCESSORS]: {
        add: postprocessorsQueueAdd,
      },
    });

    const rawDbStub = {
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return {
            findOne: jest.fn(async () => ({
              _id: sessionId,
              chat_id: 123456,
              user_id: new ObjectId(),
              processors: ['transcription', 'categorization'],
              session_processors: ['CREATE_TASKS'],
              is_deleted: false,
            })),
          };
        }
        return {
          findOne: jest.fn(async () => null),
        };
      },
    };

    const messagesInsertOne = jest.fn(async () => ({ insertedId: insertedMessageId }));
    const messagesUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
    const sessionsUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
    const dbStub = {
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.MESSAGES) {
          return {
            insertOne: messagesInsertOne,
            updateOne: messagesUpdateOne,
          };
        }
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return {
            findOne: jest.fn(async () => buildWritableSessionState(sessionId)),
            updateOne: sessionsUpdateOne,
          };
        }
        return {
          find: jest.fn(() => ({ project: () => ({ toArray: async () => [] }) })),
          findOne: jest.fn(async () => null),
          updateOne: jest.fn(async () => ({ matchedCount: 0, modifiedCount: 0 })),
          insertOne: jest.fn(async () => ({ insertedId: new ObjectId() })),
        };
      },
    };

    getRawDbMock.mockReturnValue(rawDbStub);
    getDbMock.mockReturnValue(dbStub);

    const app = buildApp();
    const response = await request(app).post('/voicebot/add_text').send({
      session_id: sessionId.toHexString(),
      text: 'Rollback categorization state on enqueue error',
    });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(processorsQueueAdd).toHaveBeenCalledTimes(1);
    expect(messagesUpdateOne).toHaveBeenCalledTimes(2);

    const firstUpdate = messagesUpdateOne.mock.calls[0]?.[1] as Record<string, unknown>;
    expect((firstUpdate.$set as Record<string, unknown>)['processors_data.categorization.is_processing']).toBe(true);

    const rollbackUpdate = messagesUpdateOne.mock.calls[1]?.[1] as Record<string, unknown>;
    expect((rollbackUpdate.$set as Record<string, unknown>)['processors_data.categorization.is_processing']).toBe(false);
    expect((rollbackUpdate.$set as Record<string, unknown>)['processors_data.categorization.is_processed']).toBe(false);
    expect((rollbackUpdate.$unset as Record<string, unknown>)['processors_data.categorization.job_queued_timestamp']).toBe(1);
    expect(postprocessorsQueueAdd).not.toHaveBeenCalled();

    const createTasksRefreshCall = sessionsUpdateOne.mock.calls.find((call) => {
      const update = call?.[1] as Record<string, unknown> | undefined;
      const setPayload = (update?.$set || {}) as Record<string, unknown>;
      return typeof setPayload['processors_data.CREATE_TASKS.auto_requested_at'] === 'number';
    });
    expect(createTasksRefreshCall).toBeUndefined();
    const noTaskDecisionPersistCall = sessionsUpdateOne.mock.calls.find((call) => {
      const update = call?.[1] as Record<string, unknown> | undefined;
      const setPayload = (update?.$set || {}) as Record<string, unknown>;
      return setPayload['processors_data.CREATE_TASKS.no_task_reason_code'] === 'categorization_not_queued';
    });
    expect(noTaskDecisionPersistCall).toBeTruthy();
  });

  it('still enqueues CREATE_TASKS refresh when categorization is disabled for session processors', async () => {
    const sessionId = new ObjectId();
    const insertedMessageId = new ObjectId();

    const processorsQueueAdd = jest.fn(async () => ({ id: 'categorize-job' }));
    const postprocessorsQueueAdd = jest.fn(async () => ({ id: 'create-tasks-job' }));
    getVoicebotQueuesMock.mockReturnValue({
      [VOICEBOT_QUEUES.PROCESSORS]: {
        add: processorsQueueAdd,
      },
      [VOICEBOT_QUEUES.POSTPROCESSORS]: {
        add: postprocessorsQueueAdd,
      },
    });

    const rawDbStub = {
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return {
            findOne: jest.fn(async () => ({
              _id: sessionId,
              chat_id: 123456,
              user_id: new ObjectId(),
              processors: ['transcription'],
              session_processors: ['CREATE_TASKS'],
              is_deleted: false,
            })),
          };
        }
        return {
          findOne: jest.fn(async () => null),
        };
      },
    };

    const messagesInsertOne = jest.fn(async () => ({ insertedId: insertedMessageId }));
    const sessionsUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
    const dbStub = {
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.MESSAGES) {
          return {
            insertOne: messagesInsertOne,
            updateOne: jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 })),
          };
        }
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return {
            findOne: jest.fn(async () => buildWritableSessionState(sessionId)),
            updateOne: sessionsUpdateOne,
          };
        }
        return {
          find: jest.fn(() => ({ project: () => ({ toArray: async () => [] }) })),
          findOne: jest.fn(async () => null),
          updateOne: jest.fn(async () => ({ matchedCount: 0, modifiedCount: 0 })),
          insertOne: jest.fn(async () => ({ insertedId: new ObjectId() })),
        };
      },
    };

    getRawDbMock.mockReturnValue(rawDbStub);
    getDbMock.mockReturnValue(dbStub);

    const app = buildApp();
    const response = await request(app).post('/voicebot/add_text').send({
      session_id: sessionId.toHexString(),
      text: 'Categorization disabled but CREATE_TASKS enabled',
    });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(processorsQueueAdd).not.toHaveBeenCalled();
    expect(postprocessorsQueueAdd).toHaveBeenCalledTimes(1);
  });

  it('still enqueues CREATE_TASKS refresh for add_attachment when categorization is disabled for session processors', async () => {
    const sessionId = new ObjectId();
    const insertedMessageId = new ObjectId();

    const processorsQueueAdd = jest.fn(async () => ({ id: 'categorize-job' }));
    const postprocessorsQueueAdd = jest.fn(async () => ({ id: 'create-tasks-job' }));
    getVoicebotQueuesMock.mockReturnValue({
      [VOICEBOT_QUEUES.PROCESSORS]: {
        add: processorsQueueAdd,
      },
      [VOICEBOT_QUEUES.POSTPROCESSORS]: {
        add: postprocessorsQueueAdd,
      },
    });

    const rawDbStub = {
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return {
            findOne: jest.fn(async () => ({
              _id: sessionId,
              chat_id: 123456,
              user_id: new ObjectId(),
              processors: ['transcription'],
              session_processors: ['CREATE_TASKS'],
              is_deleted: false,
            })),
          };
        }
        return {
          findOne: jest.fn(async () => null),
        };
      },
    };

    const messagesInsertOne = jest.fn(async () => ({ insertedId: insertedMessageId }));
    const sessionsUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
    const dbStub = {
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.MESSAGES) {
          return {
            insertOne: messagesInsertOne,
            updateOne: jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 })),
          };
        }
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return {
            findOne: jest.fn(async () => buildWritableSessionState(sessionId)),
            updateOne: sessionsUpdateOne,
          };
        }
        return {
          find: jest.fn(() => ({ project: () => ({ toArray: async () => [] }) })),
          findOne: jest.fn(async () => null),
          updateOne: jest.fn(async () => ({ matchedCount: 0, modifiedCount: 0 })),
          insertOne: jest.fn(async () => ({ insertedId: new ObjectId() })),
        };
      },
    };

    getRawDbMock.mockReturnValue(rawDbStub);
    getDbMock.mockReturnValue(dbStub);

    const app = buildApp();
    const response = await request(app).post('/voicebot/add_attachment').send({
      session_id: sessionId.toHexString(),
      text: 'Attachment text: categorization disabled, create_tasks enabled',
      kind: 'document',
      attachments: [
        {
          kind: 'file',
          source: 'web',
          name: 'spec.pdf',
        },
      ],
    });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(processorsQueueAdd).not.toHaveBeenCalled();
    expect(postprocessorsQueueAdd).toHaveBeenCalledTimes(1);
    const createTasksRefreshCall = sessionsUpdateOne.mock.calls.find((call) => {
      const update = call?.[1] as Record<string, unknown> | undefined;
      const setPayload = (update?.$set || {}) as Record<string, unknown>;
      return typeof setPayload['processors_data.CREATE_TASKS.auto_requested_at'] === 'number';
    });
    expect(createTasksRefreshCall).toBeTruthy();
    const createTasksRefreshUpdate = createTasksRefreshCall?.[1] as Record<string, unknown>;
    expect((createTasksRefreshUpdate.$unset as Record<string, unknown>)['processors_data.CREATE_TASKS.no_task_reason_code']).toBe(1);
    expect((createTasksRefreshUpdate.$unset as Record<string, unknown>)['processors_data.CREATE_TASKS.no_task_decision']).toBe(1);
    expect((createTasksRefreshUpdate.$unset as Record<string, unknown>)['processors_data.CREATE_TASKS.last_tasks_count']).toBe(1);
  });

  it('continues regular add_text flow when garbage detector is unavailable (no OPENAI key)', async () => {
    const sessionId = new ObjectId();
    const insertedMessageId = new ObjectId();
    const sourceText = 'Regular flow without detector key';
    delete process.env.OPENAI_API_KEY;

    const processorsQueueAdd = jest.fn(async () => ({ id: 'categorize-job' }));
    const postprocessorsQueueAdd = jest.fn(async () => ({ id: 'create-tasks-job' }));
    getVoicebotQueuesMock.mockReturnValue({
      [VOICEBOT_QUEUES.PROCESSORS]: {
        add: processorsQueueAdd,
      },
      [VOICEBOT_QUEUES.POSTPROCESSORS]: {
        add: postprocessorsQueueAdd,
      },
    });

    const rawDbStub = {
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return {
            findOne: jest.fn(async () => ({
              _id: sessionId,
              chat_id: 123456,
              user_id: new ObjectId(),
              processors: ['transcription', 'categorization'],
              session_processors: ['CREATE_TASKS'],
              is_deleted: false,
            })),
          };
        }
        return {
          findOne: jest.fn(async () => null),
        };
      },
    };

    const messagesInsertOne = jest.fn(async () => ({ insertedId: insertedMessageId }));
    const dbStub = {
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.MESSAGES) {
          return {
            insertOne: messagesInsertOne,
            updateOne: jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 })),
          };
        }
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return {
            findOne: jest.fn(async () => buildWritableSessionState(sessionId)),
            updateOne: jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 })),
          };
        }
        return {
          find: jest.fn(() => ({ project: () => ({ toArray: async () => [] }) })),
          findOne: jest.fn(async () => null),
          updateOne: jest.fn(async () => ({ matchedCount: 0, modifiedCount: 0 })),
          insertOne: jest.fn(async () => ({ insertedId: new ObjectId() })),
        };
      },
    };

    getRawDbMock.mockReturnValue(rawDbStub);
    getDbMock.mockReturnValue(dbStub);

    const app = buildApp();
    const response = await request(app).post('/voicebot/add_text').send({
      session_id: sessionId.toHexString(),
      text: sourceText,
    });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(detectGarbageTranscriptionMock).not.toHaveBeenCalled();
    expect(processorsQueueAdd).toHaveBeenCalledTimes(1);
    expect(postprocessorsQueueAdd).toHaveBeenCalledTimes(1);

    const inserted = messagesInsertOne.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(inserted, 'garbage_detection')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(inserted, 'garbage_detected')).toBe(false);
    expect(inserted.is_transcribed).toBe(true);
    expect(inserted.transcription_method).toBe('ready_text');
    expect(inserted.transcription_text).toBe(sourceText);
    expect(inserted.transcription).toEqual(
      expect.objectContaining({
        provider: 'legacy',
        model: 'ready_text',
        text: sourceText,
      })
    );
  });

  it('continues regular add_attachment flow when garbage detector throws', async () => {
    const sessionId = new ObjectId();
    const insertedMessageId = new ObjectId();
    const sourceText = 'Attachment fallback flow';
    process.env.OPENAI_API_KEY = 'test-openai-key';
    detectGarbageTranscriptionMock.mockRejectedValueOnce(new Error('detector unavailable'));

    const processorsQueueAdd = jest.fn(async () => ({ id: 'categorize-job' }));
    const postprocessorsQueueAdd = jest.fn(async () => ({ id: 'create-tasks-job' }));
    getVoicebotQueuesMock.mockReturnValue({
      [VOICEBOT_QUEUES.PROCESSORS]: {
        add: processorsQueueAdd,
      },
      [VOICEBOT_QUEUES.POSTPROCESSORS]: {
        add: postprocessorsQueueAdd,
      },
    });

    const rawDbStub = {
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return {
            findOne: jest.fn(async () => ({
              _id: sessionId,
              chat_id: 123456,
              user_id: new ObjectId(),
              processors: ['transcription', 'categorization'],
              session_processors: ['CREATE_TASKS'],
              is_deleted: false,
            })),
          };
        }
        return {
          findOne: jest.fn(async () => null),
        };
      },
    };

    const messagesInsertOne = jest.fn(async () => ({ insertedId: insertedMessageId }));
    const dbStub = {
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.MESSAGES) {
          return {
            insertOne: messagesInsertOne,
            updateOne: jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 })),
          };
        }
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return {
            findOne: jest.fn(async () => buildWritableSessionState(sessionId)),
            updateOne: jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 })),
          };
        }
        return {
          find: jest.fn(() => ({ project: () => ({ toArray: async () => [] }) })),
          findOne: jest.fn(async () => null),
          updateOne: jest.fn(async () => ({ matchedCount: 0, modifiedCount: 0 })),
          insertOne: jest.fn(async () => ({ insertedId: new ObjectId() })),
        };
      },
    };

    getRawDbMock.mockReturnValue(rawDbStub);
    getDbMock.mockReturnValue(dbStub);

    const app = buildApp();
    const response = await request(app).post('/voicebot/add_attachment').send({
      session_id: sessionId.toHexString(),
      text: sourceText,
      kind: 'document',
      attachments: [
        {
          kind: 'file',
          source: 'web',
          name: 'fallback.pdf',
        },
      ],
    });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(detectGarbageTranscriptionMock).toHaveBeenCalledTimes(1);
    expect(processorsQueueAdd).toHaveBeenCalledTimes(1);
    expect(postprocessorsQueueAdd).toHaveBeenCalledTimes(1);

    const inserted = messagesInsertOne.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(inserted, 'garbage_detection')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(inserted, 'garbage_detected')).toBe(false);
    expect(inserted.is_transcribed).toBe(true);
    expect(inserted.transcription_method).toBe('ready_text');
    expect(inserted.transcription_text).toBe(sourceText);
    expect(inserted.transcription).toEqual(
      expect.objectContaining({
        provider: 'legacy',
        model: 'ready_text',
        text: sourceText,
      })
    );
  });

  it('continues regular add_attachment flow when garbage detector is unavailable (no OPENAI key)', async () => {
    const sessionId = new ObjectId();
    const insertedMessageId = new ObjectId();
    const sourceText = 'Attachment no-key fallback';
    delete process.env.OPENAI_API_KEY;

    const processorsQueueAdd = jest.fn(async () => ({ id: 'categorize-job' }));
    const postprocessorsQueueAdd = jest.fn(async () => ({ id: 'create-tasks-job' }));
    getVoicebotQueuesMock.mockReturnValue({
      [VOICEBOT_QUEUES.PROCESSORS]: {
        add: processorsQueueAdd,
      },
      [VOICEBOT_QUEUES.POSTPROCESSORS]: {
        add: postprocessorsQueueAdd,
      },
    });

    const rawDbStub = {
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return {
            findOne: jest.fn(async () => ({
              _id: sessionId,
              chat_id: 123456,
              user_id: new ObjectId(),
              processors: ['transcription', 'categorization'],
              session_processors: ['CREATE_TASKS'],
              is_deleted: false,
            })),
          };
        }
        return {
          findOne: jest.fn(async () => null),
        };
      },
    };

    const messagesInsertOne = jest.fn(async () => ({ insertedId: insertedMessageId }));
    const dbStub = {
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.MESSAGES) {
          return {
            insertOne: messagesInsertOne,
            updateOne: jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 })),
          };
        }
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return {
            findOne: jest.fn(async () => buildWritableSessionState(sessionId)),
            updateOne: jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 })),
          };
        }
        return {
          find: jest.fn(() => ({ project: () => ({ toArray: async () => [] }) })),
          findOne: jest.fn(async () => null),
          updateOne: jest.fn(async () => ({ matchedCount: 0, modifiedCount: 0 })),
          insertOne: jest.fn(async () => ({ insertedId: new ObjectId() })),
        };
      },
    };

    getRawDbMock.mockReturnValue(rawDbStub);
    getDbMock.mockReturnValue(dbStub);

    const app = buildApp();
    const response = await request(app).post('/voicebot/add_attachment').send({
      session_id: sessionId.toHexString(),
      text: sourceText,
      kind: 'document',
      attachments: [
        {
          kind: 'file',
          source: 'web',
          name: 'no-key.pdf',
        },
      ],
    });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(detectGarbageTranscriptionMock).not.toHaveBeenCalled();
    expect(processorsQueueAdd).toHaveBeenCalledTimes(1);
    expect(postprocessorsQueueAdd).toHaveBeenCalledTimes(1);

    const inserted = messagesInsertOne.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(inserted, 'garbage_detection')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(inserted, 'garbage_detected')).toBe(false);
    expect(inserted.is_transcribed).toBe(true);
    expect(inserted.transcription_method).toBe('ready_text');
    expect(inserted.transcription_text).toBe(sourceText);
    expect(inserted.transcription).toEqual(
      expect.objectContaining({
        provider: 'legacy',
        model: 'ready_text',
        text: sourceText,
      })
    );
  });

  it('rejects add_text for inactive/finalized sessions with session_inactive', async () => {
    const sessionId = new ObjectId();
    const insertedMessageId = new ObjectId();

    const rawDbStub = {
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return {
            findOne: jest.fn(async () => ({
              _id: sessionId,
              chat_id: 123456,
              user_id: new ObjectId(),
              is_active: false,
              to_finalize: true,
              done_at: new Date(),
              is_deleted: false,
            })),
          };
        }
        return {
          findOne: jest.fn(async () => null),
        };
      },
    };

    const messagesInsertOne = jest.fn(async () => ({ insertedId: insertedMessageId }));
    const dbStub = {
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.MESSAGES) {
          return {
            insertOne: messagesInsertOne,
            updateOne: jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 })),
          };
        }
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return {
            updateOne: jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 })),
          };
        }
        return {
          find: jest.fn(() => ({ project: () => ({ toArray: async () => [] }) })),
          findOne: jest.fn(async () => null),
          updateOne: jest.fn(async () => ({ matchedCount: 0, modifiedCount: 0 })),
          insertOne: jest.fn(async () => ({ insertedId: new ObjectId() })),
        };
      },
    };

    getRawDbMock.mockReturnValue(rawDbStub);
    getDbMock.mockReturnValue(dbStub);

    const app = buildApp();
    const response = await request(app).post('/voicebot/add_text').send({
      session_id: sessionId.toHexString(),
      text: 'Must be rejected for inactive session',
    });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe('session_inactive');
    expect(messagesInsertOne).not.toHaveBeenCalled();
  });

  it('rejects add_attachment for inactive/finalized sessions with session_inactive', async () => {
    const sessionId = new ObjectId();
    const insertedMessageId = new ObjectId();

    const rawDbStub = {
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return {
            findOne: jest.fn(async () => ({
              _id: sessionId,
              chat_id: 123456,
              user_id: new ObjectId(),
              is_active: false,
              to_finalize: true,
              done_at: new Date(),
              is_deleted: false,
            })),
          };
        }
        return {
          findOne: jest.fn(async () => null),
        };
      },
    };

    const messagesInsertOne = jest.fn(async () => ({ insertedId: insertedMessageId }));
    const dbStub = {
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.MESSAGES) {
          return {
            insertOne: messagesInsertOne,
            updateOne: jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 })),
          };
        }
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return {
            updateOne: jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 })),
          };
        }
        return {
          find: jest.fn(() => ({ project: () => ({ toArray: async () => [] }) })),
          findOne: jest.fn(async () => null),
          updateOne: jest.fn(async () => ({ matchedCount: 0, modifiedCount: 0 })),
          insertOne: jest.fn(async () => ({ insertedId: new ObjectId() })),
        };
      },
    };

    getRawDbMock.mockReturnValue(rawDbStub);
    getDbMock.mockReturnValue(dbStub);

    const app = buildApp();
    const response = await request(app).post('/voicebot/add_attachment').send({
      session_id: sessionId.toHexString(),
      text: 'Must be rejected for inactive session',
      kind: 'document',
      attachments: [
        {
          kind: 'file',
          source: 'web',
          name: 'spec.pdf',
        },
      ],
    });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe('session_inactive');
    expect(messagesInsertOne).not.toHaveBeenCalled();
  });

  it('rolls back inserted add_text message when session becomes inactive after insert', async () => {
    const sessionId = new ObjectId();
    const insertedMessageId = new ObjectId();

    const rawDbStub = {
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return {
            findOne: jest.fn(async () => ({
              _id: sessionId,
              chat_id: 123456,
              user_id: new ObjectId(),
              processors: ['transcription', 'categorization'],
              session_processors: ['CREATE_TASKS'],
              is_deleted: false,
            })),
          };
        }
        return {
          findOne: jest.fn(async () => null),
        };
      },
    };

    const messagesInsertOne = jest.fn(async () => ({ insertedId: insertedMessageId }));
    const messagesUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
    const sessionsUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
    const dbStub = {
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.MESSAGES) {
          return {
            insertOne: messagesInsertOne,
            updateOne: messagesUpdateOne,
          };
        }
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return {
            findOne: jest.fn(async () => ({
              _id: sessionId,
              is_active: false,
              to_finalize: true,
              done_at: new Date(),
            })),
            updateOne: sessionsUpdateOne,
          };
        }
        return {
          find: jest.fn(() => ({ project: () => ({ toArray: async () => [] }) })),
          findOne: jest.fn(async () => null),
          updateOne: jest.fn(async () => ({ matchedCount: 0, modifiedCount: 0 })),
          insertOne: jest.fn(async () => ({ insertedId: new ObjectId() })),
        };
      },
    };

    getRawDbMock.mockReturnValue(rawDbStub);
    getDbMock.mockReturnValue(dbStub);

    const app = buildApp();
    const response = await request(app).post('/voicebot/add_text').send({
      session_id: sessionId.toHexString(),
      text: 'Must rollback when inactive right after insert',
    });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe('session_inactive');
    expect(messagesInsertOne).toHaveBeenCalledTimes(1);
    expect(sessionsUpdateOne).not.toHaveBeenCalled();
    expect(messagesUpdateOne).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: insertedMessageId,
      }),
      expect.objectContaining({
        $set: expect.objectContaining({
          is_deleted: true,
          dedup_reason: 'session_inactive_post_insert',
        }),
      })
    );
  });

  it('rolls back inserted add_attachment message when session becomes inactive after insert', async () => {
    const sessionId = new ObjectId();
    const insertedMessageId = new ObjectId();

    const rawDbStub = {
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return {
            findOne: jest.fn(async () => ({
              _id: sessionId,
              chat_id: 123456,
              user_id: new ObjectId(),
              processors: ['transcription', 'categorization'],
              session_processors: ['CREATE_TASKS'],
              is_deleted: false,
            })),
          };
        }
        return {
          findOne: jest.fn(async () => null),
        };
      },
    };

    const messagesInsertOne = jest.fn(async () => ({ insertedId: insertedMessageId }));
    const messagesUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
    const sessionsUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
    const dbStub = {
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.MESSAGES) {
          return {
            insertOne: messagesInsertOne,
            updateOne: messagesUpdateOne,
          };
        }
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return {
            findOne: jest.fn(async () => ({
              _id: sessionId,
              is_active: false,
              to_finalize: true,
              done_at: new Date(),
            })),
            updateOne: sessionsUpdateOne,
          };
        }
        return {
          find: jest.fn(() => ({ project: () => ({ toArray: async () => [] }) })),
          findOne: jest.fn(async () => null),
          updateOne: jest.fn(async () => ({ matchedCount: 0, modifiedCount: 0 })),
          insertOne: jest.fn(async () => ({ insertedId: new ObjectId() })),
        };
      },
    };

    getRawDbMock.mockReturnValue(rawDbStub);
    getDbMock.mockReturnValue(dbStub);

    const app = buildApp();
    const response = await request(app).post('/voicebot/add_attachment').send({
      session_id: sessionId.toHexString(),
      text: 'Must rollback attachment message when inactive right after insert',
      kind: 'document',
      attachments: [
        {
          kind: 'file',
          source: 'web',
          name: 'rollback-check.pdf',
        },
      ],
    });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe('session_inactive');
    expect(messagesInsertOne).toHaveBeenCalledTimes(1);
    expect(sessionsUpdateOne).not.toHaveBeenCalled();
    expect(messagesUpdateOne).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: insertedMessageId,
      }),
      expect.objectContaining({
        $set: expect.objectContaining({
          is_deleted: true,
          dedup_reason: 'session_inactive_post_insert',
        }),
      })
    );
  });

  it('add_attachment with text uses canonical text payload and parity categorization/create_tasks queueing', async () => {
    const sessionId = new ObjectId();
    const insertedMessageId = new ObjectId();
    const sourceText = 'Attachment text parity payload';
    process.env.OPENAI_API_KEY = 'test-openai-key';
    detectGarbageTranscriptionMock.mockResolvedValueOnce({
      checked_at: new Date('2026-01-01T00:00:00.000Z'),
      detector_version: 'post_transcribe_garbage_v1',
      model: 'gpt-5.4-nano',
      skipped: false,
      skip_reason: null,
      is_garbage: false,
      code: 'ok',
      reason: 'clean_speech',
      raw_output: '{"is_garbage":false}',
    });

    const processorsQueueAdd = jest.fn(async () => ({ id: 'categorize-job' }));
    const postprocessorsQueueAdd = jest.fn(async () => ({ id: 'create-tasks-job' }));
    getVoicebotQueuesMock.mockReturnValue({
      [VOICEBOT_QUEUES.PROCESSORS]: {
        add: processorsQueueAdd,
      },
      [VOICEBOT_QUEUES.POSTPROCESSORS]: {
        add: postprocessorsQueueAdd,
      },
    });

    const rawDbStub = {
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return {
            findOne: jest.fn(async () => ({
              _id: sessionId,
              chat_id: 123456,
              user_id: new ObjectId(),
              processors: ['transcription', 'categorization'],
              session_processors: ['CREATE_TASKS'],
              is_deleted: false,
            })),
          };
        }
        return {
          findOne: jest.fn(async () => null),
        };
      },
    };

    const messagesInsertOne = jest.fn(async () => ({ insertedId: insertedMessageId }));
    const messagesUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
    const sessionsUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
    const dbStub = {
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.MESSAGES) {
          return {
            insertOne: messagesInsertOne,
            updateOne: messagesUpdateOne,
          };
        }
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return {
            findOne: jest.fn(async () => buildWritableSessionState(sessionId)),
            updateOne: sessionsUpdateOne,
          };
        }
        return {
          find: jest.fn(() => ({ project: () => ({ toArray: async () => [] }) })),
          findOne: jest.fn(async () => null),
          updateOne: jest.fn(async () => ({ matchedCount: 0, modifiedCount: 0 })),
          insertOne: jest.fn(async () => ({ insertedId: new ObjectId() })),
        };
      },
    };

    getRawDbMock.mockReturnValue(rawDbStub);
    getDbMock.mockReturnValue(dbStub);

    const app = buildApp();
    const response = await request(app).post('/voicebot/add_attachment').send({
      session_id: sessionId.toHexString(),
      text: sourceText,
      kind: 'document',
      attachments: [
        {
          kind: 'file',
          source: 'web',
          name: 'spec.pdf',
        },
      ],
    });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.message_id).toBe(insertedMessageId.toHexString());
    expect(detectGarbageTranscriptionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        transcriptionText: sourceText,
      })
    );

    const inserted = messagesInsertOne.mock.calls[0]?.[0] as Record<string, unknown>;
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
    expect(inserted.garbage_detected).toBe(false);
    expect(inserted.garbage_detection).toEqual(
      expect.objectContaining({
        is_garbage: false,
        code: 'ok',
        reason: 'clean_speech',
      })
    );

    expect(processorsQueueAdd).toHaveBeenCalledWith(
      VOICEBOT_JOBS.voice.CATEGORIZE,
      expect.objectContaining({
        message_id: insertedMessageId.toHexString(),
        session_id: sessionId.toHexString(),
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

    const createTasksRefreshCall = sessionsUpdateOne.mock.calls.find((call) => {
      const update = call?.[1] as Record<string, unknown> | undefined;
      const setPayload = (update?.$set || {}) as Record<string, unknown>;
      return typeof setPayload['processors_data.CREATE_TASKS.auto_requested_at'] === 'number';
    });
    expect(createTasksRefreshCall).toBeTruthy();
    const createTasksRefreshUpdate = createTasksRefreshCall?.[1] as Record<string, unknown>;
    expect((createTasksRefreshUpdate.$unset as Record<string, unknown>)['processors_data.CREATE_TASKS.no_task_reason_code']).toBe(1);
    expect((createTasksRefreshUpdate.$unset as Record<string, unknown>)['processors_data.CREATE_TASKS.no_task_decision']).toBe(1);
    expect((createTasksRefreshUpdate.$unset as Record<string, unknown>)['processors_data.CREATE_TASKS.last_tasks_count']).toBe(1);
  });

  it('does not enqueue categorization/create_tasks for add_attachment text when detector marks message as garbage', async () => {
    const sessionId = new ObjectId();
    const insertedMessageId = new ObjectId();
    const sourceText = 'noisy caption';
    process.env.OPENAI_API_KEY = 'test-openai-key';
    detectGarbageTranscriptionMock.mockResolvedValueOnce({
      checked_at: new Date('2026-01-01T00:00:00.000Z'),
      detector_version: 'post_transcribe_garbage_v1',
      model: 'gpt-5.4-nano',
      skipped: false,
      skip_reason: null,
      is_garbage: true,
      code: 'noise_or_garbage',
      reason: 'junk_caption',
      raw_output: '{"is_garbage":true}',
    });

    const processorsQueueAdd = jest.fn(async () => ({ id: 'categorize-job' }));
    const postprocessorsQueueAdd = jest.fn(async () => ({ id: 'create-tasks-job' }));
    getVoicebotQueuesMock.mockReturnValue({
      [VOICEBOT_QUEUES.PROCESSORS]: {
        add: processorsQueueAdd,
      },
      [VOICEBOT_QUEUES.POSTPROCESSORS]: {
        add: postprocessorsQueueAdd,
      },
    });

    const rawDbStub = {
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return {
            findOne: jest.fn(async () => ({
              _id: sessionId,
              chat_id: 123456,
              user_id: new ObjectId(),
              processors: ['transcription', 'categorization'],
              session_processors: ['CREATE_TASKS'],
              is_deleted: false,
            })),
          };
        }
        return {
          findOne: jest.fn(async () => null),
        };
      },
    };

    const messagesInsertOne = jest.fn(async () => ({ insertedId: insertedMessageId }));
    const messagesUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
    const sessionsUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
    const dbStub = {
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.MESSAGES) {
          return {
            insertOne: messagesInsertOne,
            updateOne: messagesUpdateOne,
          };
        }
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return {
            findOne: jest.fn(async () => buildWritableSessionState(sessionId)),
            updateOne: sessionsUpdateOne,
          };
        }
        return {
          find: jest.fn(() => ({ project: () => ({ toArray: async () => [] }) })),
          findOne: jest.fn(async () => null),
          updateOne: jest.fn(async () => ({ matchedCount: 0, modifiedCount: 0 })),
          insertOne: jest.fn(async () => ({ insertedId: new ObjectId() })),
        };
      },
    };

    getRawDbMock.mockReturnValue(rawDbStub);
    getDbMock.mockReturnValue(dbStub);

    const app = buildApp();
    const response = await request(app).post('/voicebot/add_attachment').send({
      session_id: sessionId.toHexString(),
      text: sourceText,
      kind: 'document',
      attachments: [
        {
          kind: 'file',
          source: 'web',
          name: 'noise.pdf',
        },
      ],
    });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(detectGarbageTranscriptionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        transcriptionText: sourceText,
      })
    );
    expect(processorsQueueAdd).not.toHaveBeenCalled();
    expect(postprocessorsQueueAdd).not.toHaveBeenCalled();
    expect(messagesUpdateOne).not.toHaveBeenCalled();

    const createTasksRefreshCall = sessionsUpdateOne.mock.calls.find((call) => {
      const update = call?.[1] as Record<string, unknown> | undefined;
      const setPayload = (update?.$set || {}) as Record<string, unknown>;
      return typeof setPayload['processors_data.CREATE_TASKS.auto_requested_at'] === 'number';
    });
    expect(createTasksRefreshCall).toBeUndefined();

    const inserted = messagesInsertOne.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(inserted.garbage_detected).toBe(true);
    expect(inserted.is_deleted).toBe(true);
    expect(inserted.deletion_reason).toBe('garbage_detected');
    expect(inserted.garbage_detection).toEqual(
      expect.objectContaining({
        is_garbage: true,
        code: 'noise_or_garbage',
        reason: 'junk_caption',
      })
    );
    expect(inserted.categorization).toEqual([]);
    expect(inserted.processors_data).toEqual(
      expect.objectContaining({
        categorization: expect.objectContaining({
          is_processing: false,
          is_processed: true,
          is_finished: true,
          skipped_reason: 'garbage_detected',
        }),
      })
    );
  });
});
