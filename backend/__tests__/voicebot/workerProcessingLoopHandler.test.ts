import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ObjectId } from 'mongodb';

import {
  VOICEBOT_COLLECTIONS,
  VOICEBOT_JOBS,
  VOICEBOT_QUEUES,
} from '../../src/constants.js';

const getDbMock = jest.fn();
const getVoicebotQueuesMock = jest.fn();

jest.unstable_mockModule('../../src/services/db.js', () => ({
  getDb: getDbMock,
}));
jest.unstable_mockModule('../../src/services/voicebotQueues.js', () => ({
  getVoicebotQueues: getVoicebotQueuesMock,
}));

const { handleProcessingLoopJob } = await import('../../src/workers/voicebot/handlers/processingLoop.js');

const makeFindCursor = (rows: unknown[]) => {
  let scopedRows = [...rows];
  const cursor = {
    sort: (spec?: Record<string, 1 | -1>) => {
      if (spec && typeof spec === 'object') {
        const entries = Object.entries(spec);
        scopedRows.sort((left, right) => {
          for (const [field, direction] of entries) {
            const lVal = (left as Record<string, unknown>)[field];
            const rVal = (right as Record<string, unknown>)[field];
            if (lVal === rVal) continue;
            const cmp = lVal && rVal && lVal > rVal ? 1 : -1;
            return direction === -1 ? -cmp : cmp;
          }
          return 0;
        });
      }
      return cursor;
    },
    limit: (value?: number) => {
      if (typeof value === 'number') {
        scopedRows = scopedRows.slice(0, value);
      }
      return cursor;
    },
    project: () => cursor,
    toArray: async () => scopedRows,
  };
  return cursor;
};

describe('handleProcessingLoopJob', () => {
  beforeEach(() => {
    getDbMock.mockReset();
    getVoicebotQueuesMock.mockReset();
    getVoicebotQueuesMock.mockReturnValue({});
  });

  it('clears quota session block and requeues quota-blocked transcriptions', async () => {
    const sessionId = new ObjectId();
    const messageId = new ObjectId();

    const sessionsFind = jest
      .fn()
      .mockImplementationOnce(() =>
        makeFindCursor([
          {
            _id: sessionId,
            is_messages_processed: false,
            is_waiting: false,
            is_corrupted: true,
            error_source: 'transcription',
            transcription_error: 'insufficient_quota',
          },
        ])
      )
      .mockImplementationOnce(() => makeFindCursor([]));
    const sessionsUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));

    const messagesFind = jest.fn(() =>
      makeFindCursor([
        {
          _id: messageId,
          session_id: sessionId,
          chat_id: 3045664,
          message_id: 42,
          message_timestamp: 1770000000,
          is_transcribed: false,
          transcribe_attempts: 5,
          transcription_retry_reason: 'insufficient_quota',
          to_transcribe: false,
          created_at: 0,
          transcribe_timestamp: null,
        },
      ])
    );
    const messagesUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
    const messagesCountDocuments = jest.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(0);

    getDbMock.mockReturnValue({
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return {
            find: sessionsFind,
            updateOne: sessionsUpdateOne,
          };
        }
        if (name === VOICEBOT_COLLECTIONS.MESSAGES) {
          return {
            find: messagesFind
              .mockImplementationOnce(() =>
                makeFindCursor([
                  {
                    session_id: sessionId,
                  },
                ])
              )
              .mockImplementationOnce(() =>
                makeFindCursor([
                  {
                    _id: messageId,
                    session_id: sessionId,
                    chat_id: 3045664,
                    message_id: 42,
                    message_timestamp: 1770000000,
                    is_transcribed: false,
                    transcribe_attempts: 5,
                    transcription_retry_reason: 'insufficient_quota',
                    to_transcribe: false,
                    created_at: 0,
                    transcribe_timestamp: null,
                  },
                ])
              ),
            updateOne: messagesUpdateOne,
            countDocuments: messagesCountDocuments,
          };
        }
        return {};
      },
    });

    const voiceQueueAdd = jest.fn(async () => ({ id: 'voice-job-1' }));

    const result = await handleProcessingLoopJob(
      {},
      {
        queues: {
          [VOICEBOT_QUEUES.VOICE]: {
            add: voiceQueueAdd,
          },
        },
      }
    );

    expect(result.ok).toBe(true);
    expect(result.requeued_transcriptions).toBe(1);

    const quotaSessionReset = sessionsUpdateOne.mock.calls.find((call) => {
      const update = call?.[1] as Record<string, unknown> | undefined;
      const setPayload = (update?.$set || {}) as Record<string, unknown>;
      return setPayload.is_corrupted === false;
    });
    expect(quotaSessionReset).toBeTruthy();

    const markRetryCall = messagesUpdateOne.mock.calls.find((call) => {
      const update = call?.[1] as Record<string, unknown> | undefined;
      const setPayload = (update?.$set || {}) as Record<string, unknown>;
      return setPayload.to_transcribe === true;
    });
    expect(markRetryCall).toBeTruthy();

    expect(voiceQueueAdd).toHaveBeenCalledWith(
      VOICEBOT_JOBS.voice.TRANSCRIBE,
      expect.objectContaining({
        message_id: messageId.toString(),
        message_db_id: messageId.toString(),
        session_id: sessionId.toString(),
      }),
      expect.objectContaining({ deduplication: expect.any(Object) })
    );
  });

  it('does not requeue before transcription_next_attempt_at', async () => {
    const sessionId = new ObjectId();
    const messageId = new ObjectId();

    const sessionsFind = jest
      .fn()
      .mockImplementationOnce(() => makeFindCursor([{ _id: sessionId, is_messages_processed: false }]))
      .mockImplementationOnce(() => makeFindCursor([]));

    const messagesFind = jest
      .fn()
      .mockImplementationOnce(() =>
        makeFindCursor([
          {
            session_id: sessionId,
          },
        ])
      )
      .mockImplementationOnce(() =>
        makeFindCursor([
          {
            _id: messageId,
            session_id: sessionId,
            is_transcribed: false,
            transcribe_attempts: 1,
            to_transcribe: true,
            transcription_next_attempt_at: new Date(Date.now() + 60_000),
            created_at: Date.now() - 120_000,
          },
        ])
      );

    getDbMock.mockReturnValue({
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return {
            find: sessionsFind,
            updateOne: jest.fn(),
          };
        }
        if (name === VOICEBOT_COLLECTIONS.MESSAGES) {
          return {
            find: messagesFind,
            updateOne: jest.fn(),
            countDocuments: jest.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(0),
          };
        }
        return {};
      },
    });

    const voiceQueueAdd = jest.fn(async () => ({ id: 'voice-job-2' }));
    const result = await handleProcessingLoopJob(
      {},
      {
        queues: {
          [VOICEBOT_QUEUES.VOICE]: {
            add: voiceQueueAdd,
          },
        },
      }
    );

    expect(result.ok).toBe(true);
    expect(result.requeued_transcriptions).toBe(0);
    expect(voiceQueueAdd).not.toHaveBeenCalled();
  });

  it('does not requeue after max attempts for non-quota message', async () => {
    const sessionId = new ObjectId();
    const messageId = new ObjectId();

    const sessionsFind = jest
      .fn()
      .mockImplementationOnce(() => makeFindCursor([{ _id: sessionId, is_messages_processed: false }]))
      .mockImplementationOnce(() => makeFindCursor([]));

    const messagesFind = jest
      .fn()
      .mockImplementationOnce(() =>
        makeFindCursor([
          {
            session_id: sessionId,
          },
        ])
      )
      .mockImplementationOnce(() =>
        makeFindCursor([
          {
            _id: messageId,
            session_id: sessionId,
            is_transcribed: false,
            transcribe_attempts: 10,
            to_transcribe: true,
            created_at: Date.now() - 120_000,
          },
        ])
      );

    getDbMock.mockReturnValue({
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return {
            find: sessionsFind,
            updateOne: jest.fn(),
          };
        }
        if (name === VOICEBOT_COLLECTIONS.MESSAGES) {
          return {
            find: messagesFind,
            updateOne: jest.fn(),
            countDocuments: jest.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(0),
          };
        }
        return {};
      },
    });

    const voiceQueueAdd = jest.fn(async () => ({ id: 'voice-job-3' }));
    const result = await handleProcessingLoopJob(
      {},
      {
        queues: {
          [VOICEBOT_QUEUES.VOICE]: {
            add: voiceQueueAdd,
          },
        },
      }
    );

    expect(result.ok).toBe(true);
    expect(result.requeued_transcriptions).toBe(0);
    expect(voiceQueueAdd).not.toHaveBeenCalled();
  });

  it('resets stale categorization processing lock', async () => {
    const sessionId = new ObjectId();
    const messageId = new ObjectId();

    const sessionsFind = jest
      .fn()
      .mockImplementationOnce(() => makeFindCursor([{ _id: sessionId, is_messages_processed: false }]))
      .mockImplementationOnce(() => makeFindCursor([]));
    const messagesUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));

    const messagesFind = jest
      .fn()
      .mockImplementationOnce(() =>
        makeFindCursor([
          {
            session_id: sessionId,
          },
        ])
      )
      .mockImplementationOnce(() =>
        makeFindCursor([
          {
            _id: messageId,
            session_id: sessionId,
            is_transcribed: true,
            processors_data: {
              categorization: {
                is_processing: true,
                is_processed: false,
                is_finished: false,
                job_queued_timestamp: Date.now() - 20 * 60 * 1000,
              },
            },
          },
        ])
      );

    getDbMock.mockReturnValue({
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return {
            find: sessionsFind,
            updateOne: jest.fn(),
          };
        }
        if (name === VOICEBOT_COLLECTIONS.MESSAGES) {
          return {
            find: messagesFind,
            updateOne: messagesUpdateOne,
            countDocuments: jest.fn().mockResolvedValueOnce(0).mockResolvedValueOnce(1),
          };
        }
        return {};
      },
    });

    const result = await handleProcessingLoopJob({});

    expect(result.ok).toBe(true);
    expect(result.reset_categorization_locks).toBe(1);

    const lockResetCall = messagesUpdateOne.mock.calls.find((call) => {
      const update = call?.[1] as Record<string, unknown> | undefined;
      const setPayload = (update?.$set || {}) as Record<string, unknown>;
      return setPayload['processors_data.categorization.is_processing'] === false;
    });
    expect(lockResetCall).toBeTruthy();
  });

  it('requeues categorization after insufficient_quota retry delay', async () => {
    const sessionId = new ObjectId();
    const messageId = new ObjectId();

    const sessionsFind = jest
      .fn()
      .mockImplementationOnce(() => makeFindCursor([{ _id: sessionId, is_messages_processed: false }]))
      .mockImplementationOnce(() => makeFindCursor([]));

    const messagesUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
    const messagesFind = jest
      .fn()
      .mockImplementationOnce(() =>
        makeFindCursor([
          {
            session_id: sessionId,
          },
        ])
      )
      .mockImplementationOnce(() =>
        makeFindCursor([
          {
            _id: messageId,
            session_id: sessionId,
            is_transcribed: true,
            categorization_retry_reason: 'insufficient_quota',
            categorization_next_attempt_at: new Date(Date.now() - 60_000),
            processors_data: {
              categorization: {
                is_processing: false,
                is_processed: false,
                is_finished: false,
              },
            },
          },
        ])
      );

    const processorsQueueAdd = jest.fn(async () => ({ id: 'processors-job-1' }));

    getDbMock.mockReturnValue({
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return {
            find: sessionsFind,
            updateOne: jest.fn(),
          };
        }
        if (name === VOICEBOT_COLLECTIONS.MESSAGES) {
          return {
            find: messagesFind,
            updateOne: messagesUpdateOne,
            countDocuments: jest.fn().mockResolvedValueOnce(0).mockResolvedValueOnce(1),
          };
        }
        return {};
      },
    });

    const result = await handleProcessingLoopJob(
      {},
      {
        queues: {
          [VOICEBOT_QUEUES.PROCESSORS]: {
            add: processorsQueueAdd,
          },
        },
      }
    );

    expect(result.ok).toBe(true);
    expect(result.requeued_categorizations).toBe(1);
    expect(processorsQueueAdd).toHaveBeenCalledWith(
      VOICEBOT_JOBS.voice.CATEGORIZE,
      expect.objectContaining({
        message_id: messageId.toString(),
        session_id: sessionId.toString(),
      }),
      expect.objectContaining({ deduplication: expect.any(Object) })
    );
  });

  it('scans prioritized pending session even if session flag is_messages_processed=true', async () => {
    const sessionId = new ObjectId();
    const messageId = new ObjectId();

    const sessionsFind = jest
      .fn()
      .mockImplementationOnce(() => makeFindCursor([{ _id: sessionId, is_messages_processed: true }]))
      .mockImplementationOnce(() => makeFindCursor([]));

    const messagesFind = jest
      .fn()
      .mockImplementationOnce(() =>
        makeFindCursor([
          {
            session_id: sessionId,
          },
        ])
      )
      .mockImplementationOnce(() =>
        makeFindCursor([
          {
            _id: messageId,
            session_id: sessionId,
            is_transcribed: false,
            to_transcribe: true,
            transcribe_attempts: 0,
            transcription_next_attempt_at: new Date(Date.now() - 60_000),
            created_at: Date.now() - 120_000,
          },
        ])
      );

    const voiceQueueAdd = jest.fn(async () => ({ id: 'voice-job-prioritized' }));

    getDbMock.mockReturnValue({
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return {
            find: sessionsFind,
            updateOne: jest.fn(),
          };
        }
        if (name === VOICEBOT_COLLECTIONS.MESSAGES) {
          return {
            find: messagesFind,
            updateOne: jest.fn(),
            countDocuments: jest.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(0),
          };
        }
        return {};
      },
    });

    const result = await handleProcessingLoopJob(
      {},
      {
        queues: {
          [VOICEBOT_QUEUES.VOICE]: {
            add: voiceQueueAdd,
          },
        },
      }
    );

    expect(result.ok).toBe(true);
    expect(result.requeued_transcriptions).toBe(1);
    expect(voiceQueueAdd).toHaveBeenCalledTimes(1);
  });

  it('uses runtime queue fallback when explicit queue options are not provided', async () => {
    const sessionId = new ObjectId();
    const messageId = new ObjectId();

    const sessionsFind = jest
      .fn()
      .mockImplementationOnce(() => makeFindCursor([{ _id: sessionId, is_messages_processed: false }]))
      .mockImplementationOnce(() => makeFindCursor([]));

    const messagesFind = jest
      .fn()
      .mockImplementationOnce(() =>
        makeFindCursor([
          {
            session_id: sessionId,
          },
        ])
      )
      .mockImplementationOnce(() =>
        makeFindCursor([
          {
            _id: messageId,
            session_id: sessionId,
            is_transcribed: false,
            to_transcribe: true,
            transcription_next_attempt_at: new Date(Date.now() - 60_000),
            transcribe_attempts: 0,
          },
        ])
      );

    const runtimeVoiceQueueAdd = jest.fn(async () => ({ id: 'runtime-voice-job' }));
    getVoicebotQueuesMock.mockReturnValue({
      [VOICEBOT_QUEUES.VOICE]: {
        add: runtimeVoiceQueueAdd,
      },
    });

    getDbMock.mockReturnValue({
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return {
            find: sessionsFind,
            updateOne: jest.fn(),
          };
        }
        if (name === VOICEBOT_COLLECTIONS.MESSAGES) {
          return {
            find: messagesFind,
            updateOne: jest.fn(),
            countDocuments: jest.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(0),
          };
        }
        return {};
      },
    });

    const result = await handleProcessingLoopJob({});

    expect(result.ok).toBe(true);
    expect(result.requeued_transcriptions).toBe(1);
    expect(runtimeVoiceQueueAdd).toHaveBeenCalledTimes(1);
  });

  it('finalizes newest ready session first when finalize backlog exceeds limit', async () => {
    const oldStuckSessionId = new ObjectId();
    const newReadySessionId = new ObjectId();
    const sessionsUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));

    const sessionsFind = jest
      .fn()
      .mockImplementationOnce(() => makeFindCursor([]))
      .mockImplementationOnce(() =>
        makeFindCursor([
          {
            _id: oldStuckSessionId,
            updated_at: new Date('2026-02-01T00:00:00.000Z'),
            session_processors: ['CREATE_TASKS'],
            processors_data: {
              CREATE_TASKS: {
                is_processed: false,
              },
            },
          },
          {
            _id: newReadySessionId,
            updated_at: new Date('2026-02-20T06:00:00.000Z'),
            session_processors: ['CREATE_TASKS'],
            processors_data: {
              CREATE_TASKS: {
                is_processed: true,
              },
            },
          },
        ])
      );

    getDbMock.mockReturnValue({
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return {
            find: sessionsFind,
            updateOne: sessionsUpdateOne,
          };
        }
        if (name === VOICEBOT_COLLECTIONS.MESSAGES) {
          return {
            find: jest.fn(() => makeFindCursor([])),
            updateOne: jest.fn(),
            countDocuments: jest.fn().mockResolvedValue(0),
          };
        }
        return {};
      },
    });

    const result = await handleProcessingLoopJob({ limit: 1 });

    expect(result.ok).toBe(true);
    expect(result.finalized_sessions).toBe(1);

    expect(sessionsUpdateOne).toHaveBeenCalledWith(
      expect.objectContaining({
        $and: expect.arrayContaining([
          expect.objectContaining({ _id: newReadySessionId }),
        ]),
      }),
      expect.objectContaining({
        $set: expect.objectContaining({
          is_finalized: true,
          is_postprocessing: true,
        }),
      })
    );
  });
});
