import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ObjectId } from 'mongodb';

import {
  COLLECTIONS,
  VOICEBOT_COLLECTIONS,
  VOICEBOT_JOBS,
  VOICEBOT_QUEUES,
} from '../../../src/constants.js';

const getDbMock = jest.fn();
const getVoicebotQueuesMock = jest.fn();

jest.unstable_mockModule('../../../src/services/db.js', () => ({
  getDb: getDbMock,
}));
jest.unstable_mockModule('../../../src/services/voicebotQueues.js', () => ({
  getVoicebotQueues: getVoicebotQueuesMock,
}));

const { handleProcessingLoopJob } = await import('../../../src/workers/voicebot/handlers/processingLoop.js');

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

  it('queues due deferred codex tasks for review on common queue', async () => {
    const deferredTaskId = new ObjectId();

    const sessionsFind = jest
      .fn()
      .mockImplementationOnce(() => makeFindCursor([]))
      .mockImplementationOnce(() => makeFindCursor([]));

    const messagesFind = jest
      .fn()
      .mockImplementationOnce(() =>
        makeFindCursor([])
      )
      .mockImplementation(() =>
        makeFindCursor([])
      );

    const tasksCountDocuments = jest.fn().mockResolvedValue(1);
    const tasksFind = jest.fn(() =>
      makeFindCursor([
        {
          _id: deferredTaskId,
        },
      ])
    );

    const commonQueueAdd = jest.fn(async () => ({ id: 'common-job-codex-review' }));

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
            countDocuments: jest.fn().mockResolvedValue(0),
          };
        }
        if (name === COLLECTIONS.TASKS) {
          return {
            countDocuments: tasksCountDocuments,
            find: tasksFind,
          };
        }
        return {};
      },
    });

    const result = await handleProcessingLoopJob(
      {},
      {
        queues: {
          [VOICEBOT_QUEUES.COMMON]: {
            add: commonQueueAdd,
          },
        },
      }
    );

    expect(result.ok).toBe(true);
    expect(result.pending_codex_deferred_reviews).toBe(1);
    expect(result.queued_codex_deferred_reviews).toBe(1);
    expect(result.skipped_codex_deferred_reviews_no_queue).toBe(0);
    expect(commonQueueAdd).toHaveBeenCalledWith(
      VOICEBOT_JOBS.common.CODEX_DEFERRED_REVIEW,
      expect.objectContaining({
        task_id: deferredTaskId.toHexString(),
      }),
      expect.objectContaining({
        deduplication: expect.any(Object),
      })
    );
  });

  it('keeps deferred-review retry gating on next_attempt_at without depending on error metadata fields', async () => {
    const sessionsFind = jest
      .fn()
      .mockImplementationOnce(() => makeFindCursor([]))
      .mockImplementationOnce(() => makeFindCursor([]));

    const messagesFind = jest
      .fn()
      .mockImplementationOnce(() => makeFindCursor([]))
      .mockImplementation(() => makeFindCursor([]));

    const tasksCountDocuments = jest.fn().mockResolvedValue(0);
    const tasksFind = jest.fn(() => makeFindCursor([]));

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
            countDocuments: jest.fn().mockResolvedValue(0),
          };
        }
        if (name === COLLECTIONS.TASKS) {
          return {
            countDocuments: tasksCountDocuments,
            find: tasksFind,
          };
        }
        return {};
      },
    });

    const result = await handleProcessingLoopJob({});

    expect(result.ok).toBe(true);
    expect(tasksCountDocuments).toHaveBeenCalledTimes(1);
    expect(tasksFind).toHaveBeenCalledTimes(1);

    const countFilter = tasksCountDocuments.mock.calls[0]?.[0] as Record<string, unknown>;
    const scopedClauses = Array.isArray(countFilter?.$and) ? (countFilter.$and as Record<string, unknown>[]) : [];
    const dueFilter = scopedClauses.find((clause) => clause.codex_review_state === 'deferred');

    expect(dueFilter).toBeTruthy();
    const dueFilterJson = JSON.stringify(dueFilter);
    expect(dueFilterJson).toContain('codex_review_summary_next_attempt_at');
    expect(dueFilterJson).not.toContain('codex_review_summary_last_runner_error');
    expect(dueFilterJson).not.toContain('codex_review_summary_error_code');
    expect(dueFilterJson).not.toContain('codex_review_summary_error_message');
    expect(tasksFind.mock.calls[0]?.[0]).toEqual(countFilter);
  });
});
