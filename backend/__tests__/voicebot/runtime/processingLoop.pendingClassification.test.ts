import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ObjectId } from 'mongodb';

import {
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

describe('handleProcessingLoopJob pending classification gating', () => {
  beforeEach(() => {
    getDbMock.mockReset();
    getVoicebotQueuesMock.mockReset();
    getVoicebotQueuesMock.mockReturnValue({});
  });

  it('does not ASR-arm pending_classification media while requeuing eligible media', async () => {
    const sessionId = new ObjectId();
    const eligibleMessageId = new ObjectId();
    const pendingMessageId = new ObjectId();
    const now = Date.now();

    const sessionsFind = jest
      .fn()
      .mockImplementationOnce(() =>
        makeFindCursor([
          {
            _id: sessionId,
            is_messages_processed: false,
            is_waiting: false,
            is_corrupted: false,
            session_processors: [],
          },
        ])
      )
      .mockImplementationOnce(() => makeFindCursor([]));
    const sessionsUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));

    const messagesFind = jest.fn((query: Record<string, unknown>) => {
      if (query?.session_id) {
        return makeFindCursor([
          {
            _id: eligibleMessageId,
            session_id: sessionId,
            chat_id: 3045664,
            message_id: 42,
            message_timestamp: 1770000000,
            created_at: new Date(now - 60_000),
            transcribe_timestamp: now - 60_000,
            is_transcribed: false,
            transcribe_attempts: 0,
            to_transcribe: true,
            classification_resolution_state: 'resolved',
            transcription_eligibility: 'eligible',
            transcription_processing_state: 'pending_transcription',
            transcription_eligibility_basis: 'manual_probe_speech',
          },
          {
            _id: pendingMessageId,
            session_id: sessionId,
            chat_id: 3045664,
            message_id: 43,
            message_timestamp: 1770000001,
            created_at: new Date(now - 60_000),
            is_transcribed: false,
            transcribe_attempts: 0,
            to_transcribe: true,
            classification_resolution_state: 'pending',
            transcription_eligibility: null,
            transcription_processing_state: 'pending_classification',
            transcription_eligibility_basis: 'ingress_requires_speech_probe',
            message_type: 'document',
            source_type: 'telegram',
            attachments: [
              {
                source: 'telegram',
                kind: 'file',
                file_id: 'tg-pending-1',
                file_unique_id: 'tg-pending-uniq-1',
                name: 'telemost-pending.webm',
                mimeType: 'video/webm',
              },
            ],
          },
        ]);
      }

      return makeFindCursor([{ session_id: sessionId }]);
    });
    const messagesUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
    const messagesCountDocuments = jest
      .fn()
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0);

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
    expect(voiceQueueAdd).toHaveBeenCalledTimes(1);
    expect(voiceQueueAdd).toHaveBeenCalledWith(
      VOICEBOT_JOBS.voice.TRANSCRIBE,
      expect.objectContaining({
        message_id: eligibleMessageId.toString(),
        session_id: sessionId.toString(),
      }),
      expect.objectContaining({ deduplication: expect.any(Object) })
    );
    expect(
      voiceQueueAdd.mock.calls.some((call) => String((call?.[1] as Record<string, unknown>)?.message_id || '') === pendingMessageId.toString())
    ).toBe(false);

    const pendingRefreshCall = messagesUpdateOne.mock.calls.find((call) => {
      const filter = call?.[0] as Record<string, unknown> | undefined;
      const id = filter?._id instanceof ObjectId ? filter._id.toHexString() : '';
      if (id !== pendingMessageId.toHexString()) return false;
      const update = call?.[1] as Record<string, unknown> | undefined;
      const setPayload = (update?.$set || {}) as Record<string, unknown>;
      return setPayload.transcription_processing_state === 'pending_classification';
    });
    expect(pendingRefreshCall).toBeTruthy();
    const pendingSetPayload = ((pendingRefreshCall?.[1] as Record<string, unknown>).$set || {}) as Record<string, unknown>;
    expect(pendingSetPayload.to_transcribe).toBe(false);
    expect(pendingSetPayload.transcription_eligibility).toBeNull();
    expect(pendingSetPayload.classification_resolution_state).toBe('pending');
  });
});
