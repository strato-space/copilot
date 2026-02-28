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
    const eventsQueueAdd = jest.fn(async () => ({ id: 'events-job-quota' }));
    getVoicebotQueuesMock.mockReturnValue({
      [VOICEBOT_QUEUES.EVENTS]: {
        add: eventsQueueAdd,
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
    expect(eventsQueueAdd).toHaveBeenCalledWith(
      VOICEBOT_JOBS.events.SEND_TO_SOCKET,
      expect.objectContaining({
        session_id: sessionId.toString(),
        event: 'message_update',
        payload: expect.objectContaining({
          message_id: messageId.toString(),
        }),
      })
    );
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

  it('downloads telegram transport by file_id and continues transcription when file_path is missing', async () => {
    const messageId = new ObjectId();
    const sessionId = new ObjectId();
    const originalFetch = global.fetch;
    process.env.TG_VOICE_BOT_TOKEN = '123456:test-token';

    const metadataResponse = {
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        result: {
          file_path: 'voice/file_11.ogg',
        },
      }),
      arrayBuffer: async () => new ArrayBuffer(0),
      headers: {
        get: (_name: string) => null,
      },
    };
    const binaryPayload = Buffer.from('fake-telegram-audio');
    const downloadResponse = {
      ok: true,
      status: 200,
      json: async () => ({}),
      arrayBuffer: async () =>
        binaryPayload.buffer.slice(binaryPayload.byteOffset, binaryPayload.byteOffset + binaryPayload.byteLength),
      headers: {
        get: (name: string) => (name.toLowerCase() === 'content-type' ? 'audio/ogg' : null),
      },
    };
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(metadataResponse as unknown)
      .mockResolvedValueOnce(downloadResponse as unknown);
    global.fetch = fetchMock as typeof global.fetch;

    try {
      const messagesFindOne = jest.fn(async () => ({
        _id: messageId,
        session_id: sessionId,
        is_transcribed: false,
        transcribe_attempts: 0,
        source_type: 'telegram',
        file_id: 'AQAD-tele-file-id',
        mime_type: 'audio/ogg',
        message_timestamp: 1770489126,
        duration: 12,
      }));
      const messagesUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
      const sessionsFindOne = jest.fn(async () => ({ _id: sessionId }));
      const sessionsUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
      const processorsQueueAdd = jest.fn(async () => ({ id: 'processors-job-tele-transport' }));
      const eventsQueueAdd = jest.fn(async () => ({ id: 'events-job-tele-transport' }));
      getVoicebotQueuesMock.mockReturnValue({
        [VOICEBOT_QUEUES.PROCESSORS]: {
          add: processorsQueueAdd,
        },
        [VOICEBOT_QUEUES.EVENTS]: {
          add: eventsQueueAdd,
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
              updateOne: sessionsUpdateOne,
            };
          }
          return {};
        },
      });

      createTranscriptionMock.mockResolvedValue({ text: 'telegram voice text' });

      const result = await handleTranscribeJob({ message_id: messageId.toString() });
      expect(result).toMatchObject({
        ok: true,
        message_id: messageId.toString(),
        session_id: sessionId.toString(),
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[0]?.[0]).toEqual(expect.stringContaining('/getFile?file_id='));
      expect(fetchMock.mock.calls[1]?.[0]).toEqual(expect.stringContaining('/file/bot'));

      const transportUpdateCall = messagesUpdateOne.mock.calls.find((call) => {
        const update = call?.[1] as Record<string, unknown> | undefined;
        const setPayload = (update?.$set || {}) as Record<string, unknown>;
        return setPayload.file_transport === 'telegram_download';
      });
      expect(transportUpdateCall).toBeTruthy();
      const transportSetPayload = ((transportUpdateCall?.[1] as Record<string, unknown>).$set ||
        {}) as Record<string, unknown>;
      const downloadedPath = String(transportSetPayload.file_path || '');
      expect(downloadedPath).toContain('/uploads/voicebot/audio/telegram/');
      expect(downloadedPath.endsWith('.ogg')).toBe(true);

      const transcribeInput = createTranscriptionMock.mock.calls[0]?.[0] as Record<string, unknown>;
      const transcribeStream = transcribeInput.file as { path?: string };
      expect(String(transcribeStream?.path || '')).toBe(downloadedPath);

      const finalUpdateCall = messagesUpdateOne.mock.calls.find((call) => {
        const update = call?.[1] as Record<string, unknown> | undefined;
        const setPayload = (update?.$set || {}) as Record<string, unknown>;
        return setPayload.is_transcribed === true;
      });
      expect(finalUpdateCall).toBeTruthy();
      const finalSetPayload = ((finalUpdateCall?.[1] as Record<string, unknown>).$set || {}) as Record<string, unknown>;
      expect(finalSetPayload.transcription_text).toBe('telegram voice text');
      expect(finalSetPayload.to_transcribe).toBe(false);
      expect(processorsQueueAdd).toHaveBeenCalledTimes(1);
      expect(eventsQueueAdd).toHaveBeenCalledWith(
        VOICEBOT_JOBS.events.SEND_TO_SOCKET,
        expect.objectContaining({
          session_id: sessionId.toString(),
          event: 'message_update',
          payload: expect.objectContaining({
            message_id: messageId.toString(),
          }),
        })
      );
    } finally {
      global.fetch = originalFetch;
    }
  });
});
