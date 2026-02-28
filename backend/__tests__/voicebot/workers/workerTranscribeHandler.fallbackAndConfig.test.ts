import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ObjectId } from 'mongodb';

import {
  COLLECTIONS,
  VOICEBOT_COLLECTIONS,
  VOICEBOT_JOBS,
  VOICEBOT_QUEUES,
} from '../../../src/constants.js';

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

jest.unstable_mockModule('../../../src/services/db.js', () => ({
  getDb: getDbMock,
}));

jest.unstable_mockModule('../../../src/utils/audioUtils.js', () => ({
  getAudioDurationFromFile: getAudioDurationFromFileMock,
  getFileSha256FromPath: getFileSha256FromPathMock,
  splitAudioFileByDuration: splitAudioFileByDurationMock,
}));

jest.unstable_mockModule('../../../src/services/voicebotQueues.js', () => ({
  getVoicebotQueues: getVoicebotQueuesMock,
}));

jest.unstable_mockModule('openai', () => ({
  default: openAiCtorMock,
}));

const { handleTranscribeJob } = await import('../../../src/workers/voicebot/handlers/transcribeHandler.js');

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
    delete process.env.TG_VOICE_BOT_TOKEN;
    delete process.env.TG_VOICE_BOT_BETA_TOKEN;
    delete process.env.VOICE_WEB_INTERFACE_URL;
    getFileSha256FromPathMock.mockResolvedValue('sha256-transcribe-test');
    getVoicebotQueuesMock.mockReturnValue(null);
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
