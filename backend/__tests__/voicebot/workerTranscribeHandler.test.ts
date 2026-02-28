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
    delete process.env.TG_VOICE_BOT_TOKEN;
    delete process.env.TG_VOICE_BOT_BETA_TOKEN;
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
    const eventsQueueAdd = jest.fn(async () => ({ id: 'events-job-1' }));
    getVoicebotQueuesMock.mockReturnValue({
      [VOICEBOT_QUEUES.PROCESSORS]: {
        add: processorsQueueAdd,
      },
      [VOICEBOT_QUEUES.EVENTS]: {
        add: eventsQueueAdd,
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

  it('creates deferred codex task when transcription starts with Кодекс trigger word', async () => {
    const messageId = new ObjectId();
    const sessionId = new ObjectId();
    const actorId = new ObjectId();
    const codexPerformerId = new ObjectId();
    const projectId = new ObjectId();
    const codexTaskId = new ObjectId();
    const dir = mkdtempSync(join(tmpdir(), 'copilot-transcribe-codex-trigger-'));
    const filePath = join(dir, 'chunk.webm');
    writeFileSync(filePath, 'fake-audio');

    const messagesFindOne = jest.fn(async () => ({
      _id: messageId,
      session_id: sessionId,
      user_id: actorId,
      source_type: 'web',
      message_type: 'voice',
      is_transcribed: false,
      transcribe_attempts: 0,
      file_path: filePath,
      message_timestamp: 1770489126,
      duration: 12,
    }));
    const messagesUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
    const sessionsFindOne = jest.fn(async () => ({
      _id: sessionId,
      project_id: projectId,
      user_id: actorId,
    }));
    const sessionsUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
    const projectsFindOne = jest.fn(async () => ({
      _id: projectId,
      name: 'Copilot',
      git_repo: 'git@github.com:strato-space/copilot.git',
    }));
    const performersFindOne = jest.fn(async () => ({
      _id: codexPerformerId,
      id: 'codex',
      name: 'Codex',
      real_name: 'Codex',
    }));
    const tasksFindOne = jest.fn(async () => null);
    const tasksInsertOne = jest.fn(async () => ({ insertedId: codexTaskId }));

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
        if (name === VOICEBOT_COLLECTIONS.PROJECTS) {
          return {
            findOne: projectsFindOne,
          };
        }
        if (name === VOICEBOT_COLLECTIONS.PERFORMERS) {
          return {
            findOne: performersFindOne,
          };
        }
        if (name === COLLECTIONS.TASKS) {
          return {
            findOne: tasksFindOne,
            insertOne: tasksInsertOne,
          };
        }
        return {};
      },
    });

    createTranscriptionMock.mockResolvedValue({ text: 'Кодекс подготовь план релиза' });
    getAudioDurationFromFileMock.mockResolvedValue(12);

    const result = await handleTranscribeJob({ message_id: messageId.toString() });
    expect(result).toMatchObject({
      ok: true,
      message_id: messageId.toString(),
      session_id: sessionId.toString(),
    });

    expect(tasksFindOne).toHaveBeenCalledTimes(1);
    expect(tasksInsertOne).toHaveBeenCalledTimes(1);
    const insertedTask = tasksInsertOne.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(insertedTask.source_kind).toBe('voice_session');
    expect(insertedTask.created_by_performer_id).toEqual(actorId);
    expect(insertedTask.priority_reason).toBe('voice_command');
    expect(insertedTask.codex_review_state).toBe('deferred');
    expect(insertedTask.external_ref).toBe(`https://copilot.stratospace.fun/voice/session/${sessionId.toHexString()}`);

    const sourceData = insertedTask.source_data as Record<string, unknown>;
    const payload = sourceData.payload as Record<string, unknown>;
    expect(payload.trigger).toBe('voice_command');
    expect(payload.trigger_word).toBe('кодекс');
    expect(payload.session_id).toBe(sessionId.toHexString());
    expect(payload.message_db_id).toBe(messageId.toHexString());
    expect(payload.normalized_text).toBe('подготовь план релиза');

    const codexPayloadUpdate = sessionsUpdateOne.mock.calls.find((call) => {
      const update = call[1] as Record<string, unknown> | undefined;
      const push = update?.$push as Record<string, unknown> | undefined;
      return Boolean(push && Object.prototype.hasOwnProperty.call(push, 'processors_data.CODEX_TASKS.data'));
    });
    expect(codexPayloadUpdate).toBeDefined();
    const codexTaskIdUpdate = sessionsUpdateOne.mock.calls.find((call) => {
      const update = call[1] as Record<string, unknown> | undefined;
      const setPayload = (update?.$set || {}) as Record<string, unknown>;
      return setPayload['processors_data.CODEX_TASKS.last_task_id'] === codexTaskId.toHexString();
    });
    expect(codexTaskIdUpdate).toBeDefined();
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
