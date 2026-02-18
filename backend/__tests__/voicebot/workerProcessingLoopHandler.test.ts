import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ObjectId } from 'mongodb';

import {
  VOICEBOT_COLLECTIONS,
  VOICEBOT_JOBS,
  VOICEBOT_QUEUES,
} from '../../src/constants.js';

const getDbMock = jest.fn();

jest.unstable_mockModule('../../src/services/db.js', () => ({
  getDb: getDbMock,
}));

const { handleProcessingLoopJob } = await import('../../src/workers/voicebot/handlers/processingLoop.js');

const makeFindLimitCursor = (rows: unknown[]) => ({
  limit: () => ({
    toArray: async () => rows,
  }),
});

const makeFindSortCursor = (rows: unknown[]) => ({
  sort: () => ({
    toArray: async () => rows,
  }),
});

describe('handleProcessingLoopJob', () => {
  beforeEach(() => {
    getDbMock.mockReset();
  });

  it('clears quota session block and requeues quota-blocked transcriptions', async () => {
    const sessionId = new ObjectId();
    const messageId = new ObjectId();

    const sessionsFind = jest
      .fn()
      .mockImplementationOnce(() =>
        makeFindLimitCursor([
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
      .mockImplementationOnce(() => makeFindLimitCursor([]));
    const sessionsUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));

    const messagesFind = jest.fn(() =>
      makeFindSortCursor([
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
            find: messagesFind,
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
      .mockImplementationOnce(() => makeFindLimitCursor([{ _id: sessionId, is_messages_processed: false }]))
      .mockImplementationOnce(() => makeFindLimitCursor([]));

    const messagesFind = jest.fn(() =>
      makeFindSortCursor([
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
      .mockImplementationOnce(() => makeFindLimitCursor([{ _id: sessionId, is_messages_processed: false }]))
      .mockImplementationOnce(() => makeFindLimitCursor([]));

    const messagesFind = jest.fn(() =>
      makeFindSortCursor([
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
      .mockImplementationOnce(() => makeFindLimitCursor([{ _id: sessionId, is_messages_processed: false }]))
      .mockImplementationOnce(() => makeFindLimitCursor([]));
    const messagesUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));

    const messagesFind = jest.fn(() =>
      makeFindSortCursor([
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
});
