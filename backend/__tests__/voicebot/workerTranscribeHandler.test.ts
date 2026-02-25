import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ObjectId } from 'mongodb';

import {
  VOICEBOT_COLLECTIONS,
  VOICEBOT_JOBS,
  VOICEBOT_QUEUES,
} from '../../src/constants.js';

const getDbMock = jest.fn();
const getAudioDurationFromFileMock = jest.fn();
const getFileSha256FromPathMock = jest.fn(async () => 'sha256-transcribe-test');
const splitAudioFileByDurationMock = jest.fn();
const createTranscriptionMock = jest.fn();
const getVoicebotQueuesMock = jest.fn();
const openAiCtorMock = jest.fn(() => ({
  audio: {
    transcriptions: {
      create: createTranscriptionMock,
    },
  },
}));

jest.unstable_mockModule('../../src/services/db.js', () => ({
  getDb: getDbMock,
}));

jest.unstable_mockModule('../../src/utils/audioUtils.js', () => ({
  getAudioDurationFromFile: getAudioDurationFromFileMock,
  getFileSha256FromPath: getFileSha256FromPathMock,
  splitAudioFileByDuration: splitAudioFileByDurationMock,
}));

jest.unstable_mockModule('../../src/services/voicebotQueues.js', () => ({
  getVoicebotQueues: getVoicebotQueuesMock,
}));

jest.unstable_mockModule('openai', () => ({
  default: openAiCtorMock,
}));

const { handleTranscribeJob } = await import('../../src/workers/voicebot/handlers/transcribe.js');

describe('handleTranscribeJob', () => {
  beforeEach(() => {
    getDbMock.mockReset();
    getAudioDurationFromFileMock.mockReset();
    getFileSha256FromPathMock.mockReset();
    splitAudioFileByDurationMock.mockReset();
    createTranscriptionMock.mockReset();
    getVoicebotQueuesMock.mockReset();
    openAiCtorMock.mockClear();
    process.env.OPENAI_API_KEY = 'sk-test1234567890abcd';
    getFileSha256FromPathMock.mockResolvedValue('sha256-transcribe-test');
    getVoicebotQueuesMock.mockReturnValue(null);
  });

  it('transcribes uploaded web audio and stores canonical transcription payload', async () => {
    const messageId = new ObjectId();
    const sessionId = new ObjectId();
    const dir = mkdtempSync(join(tmpdir(), 'copilot-transcribe-'));
    const filePath = join(dir, 'chunk.webm');
    writeFileSync(filePath, 'fake-audio');

    const messagesFindOne = jest.fn(async () => ({
      _id: messageId,
      session_id: sessionId,
      is_transcribed: false,
      transcribe_attempts: 0,
      file_path: filePath,
      message_timestamp: 1770489126,
      duration: 12,
    }));
    const messagesUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
    const sessionsFindOne = jest.fn(async () => ({ _id: sessionId }));
    const sessionsUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));

    getDbMock.mockReturnValue({
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.MESSAGES) {
          return {
            findOne: messagesFindOne,
            updateOne: messagesUpdateOne,
          };
        }
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return {
            findOne: sessionsFindOne,
            updateOne: sessionsUpdateOne,
          };
        }
        return {};
      },
    });

    createTranscriptionMock.mockResolvedValue({ text: 'hello world' });
    getAudioDurationFromFileMock.mockResolvedValue(12);
    const processorsQueueAdd = jest.fn(async () => ({ id: 'processors-job-1' }));
    getVoicebotQueuesMock.mockReturnValue({
      [VOICEBOT_QUEUES.PROCESSORS]: {
        add: processorsQueueAdd,
      },
    });

    const result = await handleTranscribeJob({ message_id: messageId.toString() });
    expect(result).toMatchObject({
      ok: true,
      message_id: messageId.toString(),
      session_id: sessionId.toString(),
    });
    expect(openAiCtorMock).toHaveBeenCalledTimes(1);
    expect(createTranscriptionMock).toHaveBeenCalledTimes(1);

    const transcriptionUpdateCall = messagesUpdateOne.mock.calls.find((call) => {
      const update = call?.[1] as Record<string, unknown> | undefined;
      const setPayload = (update?.$set || {}) as Record<string, unknown>;
      return setPayload.is_transcribed === true;
    });
    expect(transcriptionUpdateCall).toBeTruthy();
    const updatePayload = transcriptionUpdateCall?.[1] as Record<string, unknown>;
    const setPayload = (updatePayload.$set as Record<string, unknown>) || {};
    expect(setPayload.is_transcribed).toBe(true);
    expect(setPayload.to_transcribe).toBe(false);
    expect(setPayload.transcription_text).toBe('hello world');
    expect((setPayload.transcription as Record<string, unknown>).provider).toBe('openai');
    expect(processorsQueueAdd).toHaveBeenCalledWith(
      VOICEBOT_JOBS.voice.CATEGORIZE,
      expect.objectContaining({
        message_id: messageId.toString(),
        session_id: sessionId.toString(),
      }),
      expect.objectContaining({ deduplication: expect.any(Object) })
    );
  });

  it('splits oversized audio and transcribes it in multiple parts', async () => {
    const messageId = new ObjectId();
    const sessionId = new ObjectId();
    const dir = mkdtempSync(join(tmpdir(), 'copilot-transcribe-oversized-'));
    const filePath = join(dir, 'oversized.webm');
    writeFileSync(filePath, Buffer.alloc(27 * 1024 * 1024, 0));

    const part0 = join(dir, 'part_000.webm');
    const part1 = join(dir, 'part_001.webm');
    writeFileSync(part0, 'part-0');
    writeFileSync(part1, 'part-1');

    const messagesFindOne = jest.fn(async () => ({
      _id: messageId,
      session_id: sessionId,
      is_transcribed: false,
      transcribe_attempts: 0,
      file_path: filePath,
      message_timestamp: 1770489126,
      duration: 120,
    }));
    const messagesUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
    const sessionsFindOne = jest.fn(async () => ({ _id: sessionId }));
    const sessionsUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
    const processorsQueueAdd = jest.fn(async () => ({ id: 'processors-job-segmented' }));

    getDbMock.mockReturnValue({
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.MESSAGES) {
          return {
            findOne: messagesFindOne,
            updateOne: messagesUpdateOne,
          };
        }
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return {
            findOne: sessionsFindOne,
            updateOne: sessionsUpdateOne,
          };
        }
        return {};
      },
    });

    getVoicebotQueuesMock.mockReturnValue({
      [VOICEBOT_QUEUES.PROCESSORS]: {
        add: processorsQueueAdd,
      },
    });
    splitAudioFileByDurationMock.mockResolvedValue([part0, part1]);
    getAudioDurationFromFileMock
      .mockResolvedValueOnce(60)
      .mockResolvedValueOnce(60);
    createTranscriptionMock
      .mockResolvedValueOnce({ text: 'part one text' })
      .mockResolvedValueOnce({ text: 'part two text' });

    const result = await handleTranscribeJob({ message_id: messageId.toString() });
    expect(result).toMatchObject({
      ok: true,
      message_id: messageId.toString(),
      session_id: sessionId.toString(),
    });
    expect(splitAudioFileByDurationMock).toHaveBeenCalledTimes(1);
    expect(createTranscriptionMock).toHaveBeenCalledTimes(2);

    const transcriptionUpdateCall = messagesUpdateOne.mock.calls.find((call) => {
      const update = call?.[1] as Record<string, unknown> | undefined;
      const setPayload = (update?.$set || {}) as Record<string, unknown>;
      return setPayload.is_transcribed === true;
    });
    expect(transcriptionUpdateCall).toBeTruthy();
    const updatePayload = transcriptionUpdateCall?.[1] as Record<string, unknown>;
    const setPayload = (updatePayload.$set as Record<string, unknown>) || {};
    expect(setPayload.transcription_method).toBe('segmented_by_size');
    expect(setPayload.transcription_text).toContain('part one text');
    expect(setPayload.transcription_text).toContain('part two text');
    const chunks = setPayload.transcription_chunks as unknown[];
    expect(Array.isArray(chunks)).toBe(true);
    expect(chunks).toHaveLength(2);
    expect(processorsQueueAdd).toHaveBeenCalledTimes(1);
  });

  it('splits oversized audio even when source duration metadata is unavailable', async () => {
    const messageId = new ObjectId();
    const sessionId = new ObjectId();
    const dir = mkdtempSync(join(tmpdir(), 'copilot-transcribe-oversized-noduration-'));
    const filePath = join(dir, 'oversized.webm');
    writeFileSync(filePath, Buffer.alloc(27 * 1024 * 1024, 0));

    const part0 = join(dir, 'part_000.webm');
    const part1 = join(dir, 'part_001.webm');
    writeFileSync(part0, 'part-0');
    writeFileSync(part1, 'part-1');

    const messagesFindOne = jest.fn(async () => ({
      _id: messageId,
      session_id: sessionId,
      is_transcribed: false,
      transcribe_attempts: 0,
      file_path: filePath,
      message_timestamp: 1770489126,
    }));
    const messagesUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
    const sessionsFindOne = jest.fn(async () => ({ _id: sessionId }));
    const sessionsUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
    const processorsQueueAdd = jest.fn(async () => ({ id: 'processors-job-segmented-noduration' }));

    getDbMock.mockReturnValue({
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.MESSAGES) {
          return {
            findOne: messagesFindOne,
            updateOne: messagesUpdateOne,
          };
        }
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return {
            findOne: sessionsFindOne,
            updateOne: sessionsUpdateOne,
          };
        }
        return {};
      },
    });

    getVoicebotQueuesMock.mockReturnValue({
      [VOICEBOT_QUEUES.PROCESSORS]: {
        add: processorsQueueAdd,
      },
    });
    splitAudioFileByDurationMock.mockResolvedValue([part0, part1]);
    getAudioDurationFromFileMock
      .mockRejectedValueOnce(new Error('Duration is unavailable in ffprobe metadata'))
      .mockResolvedValueOnce(55)
      .mockResolvedValueOnce(55);
    createTranscriptionMock
      .mockResolvedValueOnce({ text: 'alpha' })
      .mockResolvedValueOnce({ text: 'beta' });

    const result = await handleTranscribeJob({ message_id: messageId.toString() });
    expect(result).toMatchObject({
      ok: true,
      message_id: messageId.toString(),
      session_id: sessionId.toString(),
    });
    expect(splitAudioFileByDurationMock).toHaveBeenCalledTimes(1);
    expect(createTranscriptionMock).toHaveBeenCalledTimes(2);
    expect(processorsQueueAdd).toHaveBeenCalledTimes(1);
  });

  it('marks insufficient quota with diagnostics context and retry metadata', async () => {
    const messageId = new ObjectId();
    const sessionId = new ObjectId();
    const dir = mkdtempSync(join(tmpdir(), 'copilot-transcribe-'));
    const filePath = join(dir, 'chunk.webm');
    writeFileSync(filePath, 'fake-audio');

    const messagesFindOne = jest.fn(async () => ({
      _id: messageId,
      session_id: sessionId,
      is_transcribed: false,
      transcribe_attempts: 1,
      file_path: filePath,
      message_timestamp: 1770489126,
    }));
    const messagesUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
    const sessionsFindOne = jest.fn(async () => ({ _id: sessionId }));
    const sessionsUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));

    getDbMock.mockReturnValue({
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.MESSAGES) {
          return {
            findOne: messagesFindOne,
            updateOne: messagesUpdateOne,
          };
        }
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return {
            findOne: sessionsFindOne,
            updateOne: sessionsUpdateOne,
          };
        }
        return {};
      },
    });

    createTranscriptionMock.mockRejectedValue({
      status: 429,
      error: {
        code: 'insufficient_quota',
      },
      message: 'You exceeded your current quota.',
    });

    const result = await handleTranscribeJob({ message_id: messageId.toString() });
    expect(result).toMatchObject({
      ok: false,
      error: 'insufficient_quota',
      message_id: messageId.toString(),
      session_id: sessionId.toString(),
    });

    const updatePayload = messagesUpdateOne.mock.calls[messagesUpdateOne.mock.calls.length - 1]?.[1] as Record<string, unknown>;
    const setPayload = (updatePayload.$set as Record<string, unknown>) || {};
    expect(setPayload.transcription_error).toBe('insufficient_quota');
    expect(setPayload.to_transcribe).toBe(true);

    const context = setPayload.transcription_error_context as Record<string, unknown>;
    expect(String(context.server_name || '')).not.toBe('');
    expect(String(context.file_path || '')).toBe(filePath);
    expect(String(context.openai_key_mask || '')).toMatch(/^sk-\.\.\.[A-Za-z0-9_-]{4}$/);
    expect(String(context.error_code || '')).toBe('insufficient_quota');
  });

  it('marks file_not_found and stores diagnostics when local file is missing', async () => {
    const messageId = new ObjectId();
    const sessionId = new ObjectId();
    const missingPath = '/tmp/copilot-transcribe-missing-file.webm';

    const messagesFindOne = jest.fn(async () => ({
      _id: messageId,
      session_id: sessionId,
      is_transcribed: false,
      transcribe_attempts: 0,
      file_path: missingPath,
      message_timestamp: 1770489126,
    }));
    const messagesUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
    const sessionsFindOne = jest.fn(async () => ({ _id: sessionId }));

    getDbMock.mockReturnValue({
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.MESSAGES) {
          return {
            findOne: messagesFindOne,
            updateOne: messagesUpdateOne,
          };
        }
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return {
            findOne: sessionsFindOne,
            updateOne: jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 })),
          };
        }
        return {};
      },
    });

    const result = await handleTranscribeJob({ message_id: messageId.toString() });
    expect(result).toMatchObject({
      ok: false,
      error: 'file_not_found',
      message_id: messageId.toString(),
      session_id: sessionId.toString(),
    });

    const updatePayload = messagesUpdateOne.mock.calls[messagesUpdateOne.mock.calls.length - 1]?.[1] as Record<string, unknown>;
    const setPayload = (updatePayload.$set as Record<string, unknown>) || {};
    expect(setPayload.transcription_error).toBe('file_not_found');
    expect(setPayload.to_transcribe).toBe(false);

    const context = setPayload.transcription_error_context as Record<string, unknown>;
    expect(String(context.server_name || '')).not.toBe('');
    expect(String(context.file_path || '')).toBe(missingPath);
    expect(String(context.error_code || '')).toBe('file_not_found');
  });

  it('marks missing_transport when telegram message has file_id but no file_path', async () => {
    const messageId = new ObjectId();
    const sessionId = new ObjectId();

    const messagesFindOne = jest.fn(async () => ({
      _id: messageId,
      session_id: sessionId,
      is_transcribed: false,
      transcribe_attempts: 0,
      source_type: 'telegram',
      file_id: 'AQAD-tele-file-id',
      message_timestamp: 1770489126,
    }));
    const messagesUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
    const sessionsFindOne = jest.fn(async () => ({ _id: sessionId }));

    getDbMock.mockReturnValue({
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.MESSAGES) {
          return {
            findOne: messagesFindOne,
            updateOne: messagesUpdateOne,
          };
        }
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return {
            findOne: sessionsFindOne,
            updateOne: jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 })),
          };
        }
        return {};
      },
    });

    const result = await handleTranscribeJob({ message_id: messageId.toString() });
    expect(result).toMatchObject({
      ok: false,
      error: 'missing_transport',
      message_id: messageId.toString(),
      session_id: sessionId.toString(),
    });

    const updatePayload = messagesUpdateOne.mock.calls[messagesUpdateOne.mock.calls.length - 1]?.[1] as Record<string, unknown>;
    const setPayload = (updatePayload.$set as Record<string, unknown>) || {};
    expect(setPayload.transcription_error).toBe('missing_transport');
    expect(setPayload.to_transcribe).toBe(false);
    const context = setPayload.transcription_error_context as Record<string, unknown>;
    expect(String(context.telegram_file_id || '')).toBe('AQAD-tele-file-id');
    expect(String(context.error_code || '')).toBe('missing_transport');
  });

  it('uses text fallback transcription when file_path is absent but text exists', async () => {
    const messageId = new ObjectId();
    const sessionId = new ObjectId();

    const messagesFindOne = jest.fn(async () => ({
      _id: messageId,
      session_id: sessionId,
      is_transcribed: false,
      transcribe_attempts: 0,
      file_path: '',
      text: 'plain text chunk',
      message_timestamp: 1770489126,
    }));
    const messagesUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
    const sessionsFindOne = jest.fn(async () => ({ _id: sessionId, processors: ['transcription', 'categorization', 'finalization'] }));
    const processorsQueueAdd = jest.fn(async () => ({ id: 'processors-job-text-fallback' }));
    getVoicebotQueuesMock.mockReturnValue({
      [VOICEBOT_QUEUES.PROCESSORS]: {
        add: processorsQueueAdd,
      },
    });

    getDbMock.mockReturnValue({
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.MESSAGES) {
          return {
            findOne: messagesFindOne,
            updateOne: messagesUpdateOne,
          };
        }
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return {
            findOne: sessionsFindOne,
            updateOne: jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 })),
          };
        }
        return {};
      },
    });

    const result = await handleTranscribeJob({ message_id: messageId.toString() });
    expect(result).toMatchObject({
      ok: true,
      skipped: true,
      reason: 'text_fallback',
      message_id: messageId.toString(),
      session_id: sessionId.toString(),
    });

    const transcriptionUpdateCall = messagesUpdateOne.mock.calls.find((call) => {
      const update = call?.[1] as Record<string, unknown> | undefined;
      const setPayload = (update?.$set || {}) as Record<string, unknown>;
      return setPayload.transcription_method === 'text_fallback';
    });
    expect(transcriptionUpdateCall).toBeTruthy();
    const updatePayload = transcriptionUpdateCall?.[1] as Record<string, unknown>;
    const setPayload = (updatePayload.$set as Record<string, unknown>) || {};
    expect(setPayload.is_transcribed).toBe(true);
    expect(setPayload.transcription_text).toBe('plain text chunk');
    expect(setPayload.transcription_method).toBe('text_fallback');
    expect(processorsQueueAdd).toHaveBeenCalledWith(
      VOICEBOT_JOBS.voice.CATEGORIZE,
      expect.objectContaining({
        message_id: messageId.toString(),
        session_id: sessionId.toString(),
      }),
      expect.objectContaining({ deduplication: expect.any(Object) })
    );
  });

  it('marks openai_api_key_missing when key is absent', async () => {
    const messageId = new ObjectId();
    const sessionId = new ObjectId();
    const dir = mkdtempSync(join(tmpdir(), 'copilot-transcribe-'));
    const filePath = join(dir, 'chunk.webm');
    writeFileSync(filePath, 'fake-audio');

    const messagesFindOne = jest.fn(async () => ({
      _id: messageId,
      session_id: sessionId,
      is_transcribed: false,
      transcribe_attempts: 0,
      file_path: filePath,
      message_timestamp: 1770489126,
    }));
    const messagesUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
    const sessionsFindOne = jest.fn(async () => ({ _id: sessionId }));

    getDbMock.mockReturnValue({
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.MESSAGES) {
          return {
            findOne: messagesFindOne,
            updateOne: messagesUpdateOne,
          };
        }
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return {
            findOne: sessionsFindOne,
            updateOne: jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 })),
          };
        }
        return {};
      },
    });

    delete process.env.OPENAI_API_KEY;

    const result = await handleTranscribeJob({ message_id: messageId.toString() });
    expect(result).toMatchObject({
      ok: false,
      error: 'openai_api_key_missing',
      message_id: messageId.toString(),
      session_id: sessionId.toString(),
    });
    expect(openAiCtorMock).not.toHaveBeenCalled();

    const updatePayload = messagesUpdateOne.mock.calls[messagesUpdateOne.mock.calls.length - 1]?.[1] as Record<string, unknown>;
    const setPayload = (updatePayload.$set as Record<string, unknown>) || {};
    expect(setPayload.transcription_error).toBe('openai_api_key_missing');
    expect(setPayload.to_transcribe).toBe(false);

    const context = setPayload.transcription_error_context as Record<string, unknown>;
    expect(String(context.error_code || '')).toBe('openai_api_key_missing');
  });

});
