import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ObjectId } from 'mongodb';

import { VOICEBOT_COLLECTIONS, VOICEBOT_JOBS } from '../../src/constants.js';

const getDbMock = jest.fn();

jest.unstable_mockModule('../../src/services/db.js', () => ({
  getDb: getDbMock,
}));

const { handleTranscribeJob } = await import('../../src/workers/voicebot/handlers/transcribe.js');
const { handleCategorizeJob } = await import('../../src/workers/voicebot/handlers/categorize.js');
const { handleFinalizationJob } = await import('../../src/workers/voicebot/handlers/finalization.js');
const { handleProcessingLoopJob } = await import('../../src/workers/voicebot/handlers/processingLoop.js');
const { VOICEBOT_WORKER_MANIFEST } = await import('../../src/workers/voicebot/manifest.js');

describe('voicebot worker scaffold handlers', () => {
  beforeEach(() => {
    getDbMock.mockReset();
  });

  it('transcribe handler returns scaffold skip for existing message', async () => {
    const messageId = new ObjectId();
    const sessionId = new ObjectId();
    const messageFindOne = jest.fn(async () => ({
      _id: messageId,
      session_id: sessionId,
      is_transcribed: false,
    }));
    const sessionFindOne = jest.fn(async () => ({ _id: sessionId }));

    getDbMock.mockReturnValue({
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.MESSAGES) return { findOne: messageFindOne };
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) return { findOne: sessionFindOne };
        return {};
      },
    });

    const result = await handleTranscribeJob({ message_id: messageId.toString() });
    expect(result.ok).toBe(true);
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('missing_file_path');
  });

  it('categorize handler skips when transcription text is absent', async () => {
    const messageId = new ObjectId();
    const sessionId = new ObjectId();
    const messageFindOne = jest.fn(async () => ({
      _id: messageId,
      session_id: sessionId,
      transcription_text: '',
    }));
    const sessionFindOne = jest.fn(async () => ({ _id: sessionId }));

    getDbMock.mockReturnValue({
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.MESSAGES) return { findOne: messageFindOne };
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) return { findOne: sessionFindOne };
        return {};
      },
    });

    const result = await handleCategorizeJob({ message_id: messageId.toString() });
    expect(result.ok).toBe(true);
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('missing_transcription_text');
  });

  it('finalization handler skips with no_custom_data when no custom buckets exist', async () => {
    const sessionId = new ObjectId();
    const findOne = jest.fn(async () => ({
      _id: sessionId,
      is_messages_processed: true,
    }));
    const updateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));

    getDbMock.mockReturnValue({
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) return { findOne, updateOne };
        return {};
      },
    });

    const result = await handleFinalizationJob({ session_id: sessionId.toString() });
    expect(result.ok).toBe(true);
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('no_custom_data');
  });

  it('processing loop handler returns runtime counters', async () => {
    const find = jest
      .fn()
      .mockImplementationOnce(() => ({
        limit: () => ({
          toArray: async () => [{ _id: new ObjectId() }, { _id: new ObjectId() }],
        }),
      }))
      .mockImplementationOnce(() => ({
        limit: () => ({
          toArray: async () => [],
        }),
      }));

    const messagesFind = jest.fn(() => ({
      sort: () => ({
        toArray: async () => [],
      }),
    }));

    const countDocuments = jest.fn().mockResolvedValueOnce(4).mockResolvedValueOnce(2);

    getDbMock.mockReturnValue({
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) return { find, updateOne: jest.fn() };
        if (name === VOICEBOT_COLLECTIONS.MESSAGES) return { find: messagesFind, countDocuments, updateOne: jest.fn() };
        return {};
      },
    });

    const result = await handleProcessingLoopJob({ limit: 20 });
    expect(result.ok).toBe(true);
    expect(result.mode).toBe('runtime');
    expect(result.scanned_sessions).toBe(2);
    expect(result.pending_transcriptions).toBe(4);
    expect(result.pending_categorizations).toBe(2);
  });

  it('manifest includes processing/transcribe/categorize/finalization handlers', () => {
    expect(VOICEBOT_WORKER_MANIFEST[VOICEBOT_JOBS.common.PROCESSING]).toBeDefined();
    expect(VOICEBOT_WORKER_MANIFEST[VOICEBOT_JOBS.voice.TRANSCRIBE]).toBeDefined();
    expect(VOICEBOT_WORKER_MANIFEST[VOICEBOT_JOBS.voice.CATEGORIZE]).toBeDefined();
    expect(VOICEBOT_WORKER_MANIFEST[VOICEBOT_JOBS.postprocessing.FINAL_CUSTOM_PROMPT]).toBeDefined();
    expect(VOICEBOT_WORKER_MANIFEST[VOICEBOT_JOBS.postprocessing.CREATE_TASKS]).toBeDefined();
  });
});
