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
import {
  buildIngressDeps as buildTgIngressDeps,
  getActiveVoiceSessionForUserMock,
  handleTextIngress,
  makeDb as makeIngressDb,
  resetTgIngressMocks,
} from '../runtime/tgIngressHandlers.test.helpers.js';

const getDbMock = jest.fn();
const getAudioDurationFromFileMock = jest.fn();
const getFileSha256FromPathMock = jest.fn(async () => 'sha256-transcribe-test');
const splitAudioFileByDurationMock = jest.fn();
const createTranscriptionMock = jest.fn();
const getVoicebotQueuesMock = jest.fn();
const detectGarbageTranscriptionMock = jest.fn();
const insertSessionLogEventMock = jest.fn(async () => ({ _id: new ObjectId() }));
const spawnSyncMock = jest.fn();
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

jest.unstable_mockModule('../../../src/services/voicebot/transcriptionGarbageDetector.js', () => ({
  detectGarbageTranscription: detectGarbageTranscriptionMock,
}));

jest.unstable_mockModule('../../../src/services/voicebotSessionLog.js', () => ({
  insertSessionLogEvent: insertSessionLogEventMock,
}));

jest.unstable_mockModule('node:child_process', () => ({
  spawnSync: spawnSyncMock,
}));

jest.unstable_mockModule('openai', () => ({
  default: openAiCtorMock,
}));

const { handleTranscribeJob } = await import('../../../src/workers/voicebot/handlers/transcribeHandler.js');

describe('handleTranscribeJob', () => {
  beforeEach(() => {
    resetTgIngressMocks();
    getDbMock.mockReset();
    getAudioDurationFromFileMock.mockReset();
    getFileSha256FromPathMock.mockReset();
    splitAudioFileByDurationMock.mockReset();
    createTranscriptionMock.mockReset();
    getVoicebotQueuesMock.mockReset();
    detectGarbageTranscriptionMock.mockReset();
    insertSessionLogEventMock.mockReset();
    spawnSyncMock.mockReset();
    openAiCtorMock.mockClear();
    process.env.OPENAI_API_KEY = 'sk-test1234567890abcd';
    delete process.env.TG_VOICE_BOT_TOKEN;
    delete process.env.TG_VOICE_BOT_BETA_TOKEN;
    delete process.env.VOICE_WEB_INTERFACE_URL;
    spawnSyncMock.mockImplementation((_command: string, args: string[]) => {
      const outputPath = Array.isArray(args) ? args[args.length - 1] : null;
      if (typeof outputPath === 'string' && outputPath) {
        writeFileSync(outputPath, 'ffmpeg-output');
      }
      return {
        status: 0,
        stdout: '',
        stderr: '',
      };
    });
    getFileSha256FromPathMock.mockResolvedValue('sha256-transcribe-test');
    getVoicebotQueuesMock.mockReturnValue(null);
    detectGarbageTranscriptionMock.mockResolvedValue({
      checked_at: new Date('2026-03-25T12:00:00.000Z'),
      detector_version: 'post_transcribe_garbage_v1',
      model: 'gpt-5.4-nano',
      skipped: false,
      skip_reason: null,
      is_garbage: false,
      code: 'ok',
      reason: 'valid_speech',
      raw_output: '{"is_garbage":false}',
    });
    insertSessionLogEventMock.mockResolvedValue({ _id: new ObjectId() });
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
    const postprocessorsQueueAdd = jest.fn(async () => ({ id: 'postprocessors-job-1' }));
    const eventsQueueAdd = jest.fn(async () => ({ id: 'events-job-1' }));
    getVoicebotQueuesMock.mockReturnValue({
      [VOICEBOT_QUEUES.PROCESSORS]: {
        add: processorsQueueAdd,
      },
      [VOICEBOT_QUEUES.POSTPROCESSORS]: {
        add: postprocessorsQueueAdd,
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
    expect(setPayload.source_media_type).toBe('audio');
    expect(setPayload.audio_extracted).toBe(false);
    expect(setPayload.asr_chunk_count).toBe(1);
    expect(setPayload.chunk_policy).toBe('single_file_first');
    expect(setPayload.chunk_cap_applied).toBe(false);
    expect(processorsQueueAdd).toHaveBeenCalledWith(
      VOICEBOT_JOBS.voice.CATEGORIZE,
      expect.objectContaining({
        message_id: messageId.toString(),
        session_id: sessionId.toString(),
      }),
      expect.objectContaining({ deduplication: expect.any(Object) })
    );
    expect(postprocessorsQueueAdd).toHaveBeenCalledWith(
      VOICEBOT_JOBS.postprocessing.CREATE_TASKS,
      expect.objectContaining({
        session_id: sessionId.toString(),
        auto_requested_at: expect.any(Number),
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

  it('extracts audio for video inputs before ASR and persists forensic fields', async () => {
    const messageId = new ObjectId();
    const sessionId = new ObjectId();
    const dir = mkdtempSync(join(tmpdir(), 'copilot-transcribe-video-'));
    const filePath = join(dir, 'input.webm');
    writeFileSync(filePath, 'fake-video');

    const messagesFindOne = jest.fn(async () => ({
      _id: messageId,
      session_id: sessionId,
      is_transcribed: false,
      transcribe_attempts: 0,
      file_path: filePath,
      mime_type: 'video/webm',
      message_timestamp: 1770489126,
      duration: 9,
    }));
    const messagesUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
    const sessionsFindOne = jest.fn(async () => ({ _id: sessionId }));
    const sessionsUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
    const processorsQueueAdd = jest.fn(async () => ({ id: 'processors-job-video' }));
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
            updateOne: sessionsUpdateOne,
          };
        }
        return {};
      },
    });

    createTranscriptionMock.mockImplementation(async ({ file }: { file?: { once?: (...args: unknown[]) => unknown; destroy?: () => void } }) => {
      if (file && typeof file.once === 'function') {
        await new Promise<void>((resolve) => {
          let settled = false;
          const settle = () => {
            if (settled) return;
            settled = true;
            resolve();
          };
          file.once?.('error', settle);
          file.once?.('open', () => {
            file.destroy?.();
            settle();
          });
        });
      }
      return { text: 'video speech' };
    });
    const result = await handleTranscribeJob({ message_id: messageId.toString() });
    expect(result).toMatchObject({
      ok: true,
      message_id: messageId.toString(),
      session_id: sessionId.toString(),
    });

    expect(spawnSyncMock).toHaveBeenCalled();
    expect(spawnSyncMock.mock.calls[0]?.[1]).toEqual(expect.arrayContaining(['-vn']));

    const transcriptionInput = createTranscriptionMock.mock.calls[0]?.[0] as { file?: { path?: string } };
    expect(typeof transcriptionInput.file?.path).toBe('string');
    expect(String(transcriptionInput.file?.path || '')).toContain('copilot-transcribe-stage-');
    expect(String(transcriptionInput.file?.path || '')).not.toBe(filePath);

    const transcriptionUpdateCall = messagesUpdateOne.mock.calls.find((call) => {
      const update = call?.[1] as Record<string, unknown> | undefined;
      const setPayload = (update?.$set || {}) as Record<string, unknown>;
      return setPayload.is_transcribed === true;
    });
    expect(transcriptionUpdateCall).toBeTruthy();
    const setPayload = (((transcriptionUpdateCall?.[1] as Record<string, unknown>)?.$set || {}) as Record<string, unknown>);
    expect(setPayload.source_media_type).toBe('video');
    expect(setPayload.audio_extracted).toBe(true);
    expect(setPayload.asr_chunk_count).toBe(1);
    expect(setPayload.chunk_policy).toBe('single_file_first');
    expect(setPayload.chunk_cap_applied).toBe(false);
    expect(processorsQueueAdd).toHaveBeenCalledTimes(1);
  });

  it('demotes stale completion when in-flight key was revoked after operator reclassification', async () => {
    const messageId = new ObjectId();
    const sessionId = new ObjectId();
    const dir = mkdtempSync(join(tmpdir(), 'copilot-transcribe-stale-'));
    const filePath = join(dir, 'chunk.webm');
    writeFileSync(filePath, 'fake-audio');

    const initialMessage = {
      _id: messageId,
      session_id: sessionId,
      is_transcribed: false,
      to_transcribe: true,
      transcribe_attempts: 0,
      file_path: filePath,
      source_type: 'telegram',
      message_type: 'document',
      file_id: 'tg-stale-file',
      file_unique_id: 'tg-stale-uniq',
      file_name: 'meeting.ogg',
      mime_type: 'audio/ogg',
      primary_payload_media_kind: 'audio',
      primary_transcription_attachment_index: 0,
      transcription_eligibility: 'eligible',
      classification_resolution_state: 'resolved',
      transcription_processing_state: 'pending_transcription',
      attachments: [
        {
          kind: 'file',
          source: 'telegram',
          file_id: 'tg-stale-file',
          file_unique_id: 'tg-stale-uniq',
          name: 'meeting.ogg',
          mimeType: 'audio/ogg',
          payload_media_kind: 'audio',
          transcription_eligibility: 'eligible',
          classification_resolution_state: 'resolved',
          transcription_processing_state: 'pending_transcription',
          duration_ms: 60_000,
          size: 2_000_000,
        },
      ],
      message_timestamp: 1770489126,
      duration: 60,
    };
    const latestMessageAfterOperatorChange = {
      ...initialMessage,
      to_transcribe: false,
      transcription_eligibility: 'ineligible',
      classification_resolution_state: 'resolved',
      transcription_processing_state: 'classified_skip',
      transcription_skip_reason: 'operator_ineligible_classification',
      transcription_inflight_job_key: null,
      attachments: [
        {
          ...(initialMessage.attachments[0] as Record<string, unknown>),
          transcription_eligibility: 'ineligible',
          transcription_processing_state: 'classified_skip',
          transcription_skip_reason: 'operator_ineligible_classification',
        },
      ],
    };

    const messagesFindOne = jest.fn(async () => initialMessage)
      .mockImplementationOnce(async () => initialMessage)
      .mockImplementation(async () => latestMessageAfterOperatorChange);
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

    createTranscriptionMock.mockResolvedValue({ text: 'obsolete transcript' });
    getAudioDurationFromFileMock.mockResolvedValue(60);

    const result = await handleTranscribeJob({ message_id: messageId.toString() });
    expect(result).toMatchObject({
      ok: true,
      skipped: true,
      reason: 'stale_job_demoted',
      message_id: messageId.toString(),
      session_id: sessionId.toString(),
    });

    const staleDemotionCall = messagesUpdateOne.mock.calls.find((call) => {
      const update = call?.[1] as Record<string, unknown> | undefined;
      const setPayload = (update?.$set || {}) as Record<string, unknown>;
      const slot = setPayload['transcription_results_by_attachment.idx_0'] as Record<string, unknown> | undefined;
      return Boolean(slot?.stale_result);
    });
    expect(staleDemotionCall).toBeTruthy();
    const staleSetPayload = ((staleDemotionCall?.[1] as Record<string, unknown>).$set || {}) as Record<string, unknown>;
    const staleSlot = staleSetPayload['transcription_results_by_attachment.idx_0'] as Record<string, unknown>;
    expect(staleSlot.stale_reason).toBe('eligibility_changed');
    expect(staleSlot.text).toBe('obsolete transcript');

    const committedTranscriptionCall = messagesUpdateOne.mock.calls.find((call) => {
      const update = call?.[1] as Record<string, unknown> | undefined;
      const setPayload = (update?.$set || {}) as Record<string, unknown>;
      return setPayload.is_transcribed === true;
    });
    expect(committedTranscriptionCall).toBeUndefined();
  });

  it('demotes completion when atomic commit guard fails at write time', async () => {
    const messageId = new ObjectId();
    const sessionId = new ObjectId();
    const dir = mkdtempSync(join(tmpdir(), 'copilot-transcribe-atomic-'));
    const filePath = join(dir, 'chunk.ogg');
    writeFileSync(filePath, 'fake-audio');

    let capturedInflightJobKey = '';
    const baseEligibleMessage = {
      _id: messageId,
      session_id: sessionId,
      is_transcribed: false,
      to_transcribe: true,
      transcribe_attempts: 0,
      file_path: filePath,
      source_type: 'telegram',
      message_type: 'voice',
      file_id: 'tg-atomic-file',
      file_unique_id: 'tg-atomic-uniq',
      file_name: 'atomic.ogg',
      mime_type: 'audio/ogg',
      primary_payload_media_kind: 'audio',
      primary_transcription_attachment_index: 0,
      transcription_eligibility: 'eligible',
      classification_resolution_state: 'resolved',
      transcription_processing_state: 'pending_transcription',
      transcription_inflight_job_key: '',
      attachments: [
        {
          kind: 'voice',
          source: 'telegram',
          file_id: 'tg-atomic-file',
          file_unique_id: 'tg-atomic-uniq',
          name: 'atomic.ogg',
          mimeType: 'audio/ogg',
          payload_media_kind: 'audio',
          transcription_eligibility: 'eligible',
          classification_resolution_state: 'resolved',
          transcription_processing_state: 'pending_transcription',
          duration_ms: 20_000,
          size: 500_000,
        },
      ],
      message_timestamp: 1770489126,
      duration: 20,
    };

    const messagesFindOne = jest.fn(async () => ({
      ...baseEligibleMessage,
      transcription_inflight_job_key: capturedInflightJobKey || '',
    }));
    const messagesUpdateOne = jest.fn(async (_filter: unknown, update: unknown) => {
      const setPayload = ((update as Record<string, unknown>)?.$set || {}) as Record<string, unknown>;
      if (typeof setPayload.transcription_inflight_job_key === 'string') {
        capturedInflightJobKey = setPayload.transcription_inflight_job_key;
      }
      if (setPayload.is_transcribed === true) {
        return { matchedCount: 0, modifiedCount: 0 };
      }
      return { matchedCount: 1, modifiedCount: 1 };
    });
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

    createTranscriptionMock.mockResolvedValue({ text: 'atomic transcript' });
    getAudioDurationFromFileMock.mockResolvedValue(20);

    const result = await handleTranscribeJob({ message_id: messageId.toString() });
    expect(result).toMatchObject({
      ok: true,
      skipped: true,
      reason: 'stale_job_demoted',
      message_id: messageId.toString(),
      session_id: sessionId.toString(),
    });

    const staleDemotionCall = messagesUpdateOne.mock.calls.find((call) => {
      const setPayload = (((call?.[1] as Record<string, unknown>)?.$set || {}) as Record<string, unknown>);
      const slot = setPayload['transcription_results_by_attachment.idx_0'] as Record<string, unknown> | undefined;
      return Boolean(slot?.stale_result);
    });
    expect(staleDemotionCall).toBeTruthy();
    const staleSetPayload = ((staleDemotionCall?.[1] as Record<string, unknown>).$set || {}) as Record<string, unknown>;
    const staleSlot = staleSetPayload['transcription_results_by_attachment.idx_0'] as Record<string, unknown>;
    expect(staleSlot.stale_reason).toBe('atomic_guard_failed');
    expect(staleSlot.text).toBe('atomic transcript');
  });

  it('drops downstream processors when post-transcribe detector marks chunk as garbage', async () => {
    const messageId = new ObjectId();
    const sessionId = new ObjectId();
    const dir = mkdtempSync(join(tmpdir(), 'copilot-transcribe-garbage-'));
    const filePath = join(dir, 'chunk.webm');
    writeFileSync(filePath, 'fake-audio');

    detectGarbageTranscriptionMock.mockResolvedValueOnce({
      checked_at: new Date('2026-03-25T12:00:00.000Z'),
      detector_version: 'post_transcribe_garbage_v1',
      model: 'gpt-5.4-nano',
      skipped: false,
      skip_reason: null,
      is_garbage: true,
      code: 'noise_or_garbage',
      reason: 'repetitive_non_speech',
      raw_output: '{"is_garbage":true}',
    });

    const messagesFindOne = jest.fn(async () => ({
      _id: messageId,
      session_id: sessionId,
      is_transcribed: false,
      transcribe_attempts: 0,
      file_path: filePath,
      message_timestamp: 1770489126,
      duration: 8,
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

    createTranscriptionMock.mockResolvedValue({ text: 'some garbage output' });
    getAudioDurationFromFileMock.mockResolvedValue(8);
    const processorsQueueAdd = jest.fn(async () => ({ id: 'processors-job-1' }));
    const postprocessorsQueueAdd = jest.fn(async () => ({ id: 'postprocessors-job-1' }));
    const eventsQueueAdd = jest.fn(async () => ({ id: 'events-job-1' }));
    getVoicebotQueuesMock.mockReturnValue({
      [VOICEBOT_QUEUES.PROCESSORS]: {
        add: processorsQueueAdd,
      },
      [VOICEBOT_QUEUES.POSTPROCESSORS]: {
        add: postprocessorsQueueAdd,
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

    const transcriptionUpdateCall = messagesUpdateOne.mock.calls.find((call) => {
      const update = call?.[1] as Record<string, unknown> | undefined;
      const setPayload = (update?.$set || {}) as Record<string, unknown>;
      return setPayload.is_transcribed === true;
    });
    expect(transcriptionUpdateCall).toBeTruthy();
    const updatePayload = transcriptionUpdateCall?.[1] as Record<string, unknown>;
    const setPayload = (updatePayload.$set as Record<string, unknown>) || {};
    expect(setPayload.garbage_detected).toBe(true);
    expect(setPayload.is_deleted).toBe(true);
    expect(setPayload.deletion_reason).toBe('garbage_detected');
    expect(setPayload.deleted_at).toEqual(expect.any(Date));
    expect(setPayload['processors_data.categorization.is_processed']).toBe(true);
    expect(setPayload['processors_data.categorization.skipped_reason']).toBe('garbage_detected');

    expect(processorsQueueAdd).not.toHaveBeenCalled();
    expect(postprocessorsQueueAdd).not.toHaveBeenCalled();
    expect(eventsQueueAdd).toHaveBeenCalledTimes(1);
    expect(insertSessionLogEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event_name: 'transcription_garbage_detected',
        metadata: expect.objectContaining({
          message_deleted: true,
          deletion_reason: 'garbage_detected',
        }),
      })
    );
  });

  it('skips CREATE_TASKS auto refresh when categorization is not queued after transcribe', async () => {
    const messageId = new ObjectId();
    const sessionId = new ObjectId();
    const dir = mkdtempSync(join(tmpdir(), 'copilot-transcribe-no-categorize-queue-'));
    const filePath = join(dir, 'chunk.webm');
    writeFileSync(filePath, 'fake-audio');

    const messagesFindOne = jest.fn(async () => ({
      _id: messageId,
      session_id: sessionId,
      is_transcribed: false,
      transcribe_attempts: 0,
      file_path: filePath,
      message_timestamp: 1770489126,
      duration: 10,
    }));
    const messagesUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
    const sessionsFindOne = jest.fn(async () => ({
      _id: sessionId,
      processors: ['transcription', 'categorization'],
      session_processors: ['CREATE_TASKS'],
    }));
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

    createTranscriptionMock.mockResolvedValue({ text: 'queue parity payload' });
    getAudioDurationFromFileMock.mockResolvedValue(10);
    const postprocessorsQueueAdd = jest.fn(async () => ({ id: 'postprocessors-job-1' }));
    const eventsQueueAdd = jest.fn(async () => ({ id: 'events-job-1' }));
    getVoicebotQueuesMock.mockReturnValue({
      [VOICEBOT_QUEUES.POSTPROCESSORS]: {
        add: postprocessorsQueueAdd,
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

    expect(postprocessorsQueueAdd).not.toHaveBeenCalled();
    const createTasksRefreshCall = sessionsUpdateOne.mock.calls.find((call) => {
      const update = call?.[1] as Record<string, unknown> | undefined;
      const setPayload = (update?.$set || {}) as Record<string, unknown>;
      return Object.prototype.hasOwnProperty.call(setPayload, 'processors_data.CREATE_TASKS.auto_requested_at');
    });
    expect(createTasksRefreshCall).toBeUndefined();
    const noTaskDecisionPersistCall = sessionsUpdateOne.mock.calls.find((call) => {
      const update = call?.[1] as Record<string, unknown> | undefined;
      const setPayload = (update?.$set || {}) as Record<string, unknown>;
      return setPayload['processors_data.CREATE_TASKS.no_task_reason_code'] === 'categorization_not_queued';
    });
    expect(noTaskDecisionPersistCall).toBeTruthy();
  });

  it('keeps CREATE_TASKS auto refresh enabled when categorization is disabled after transcribe', async () => {
    const messageId = new ObjectId();
    const sessionId = new ObjectId();
    const dir = mkdtempSync(join(tmpdir(), 'copilot-transcribe-categorization-disabled-'));
    const filePath = join(dir, 'chunk.webm');
    writeFileSync(filePath, 'fake-audio');

    const messagesFindOne = jest.fn(async () => ({
      _id: messageId,
      session_id: sessionId,
      is_transcribed: false,
      transcribe_attempts: 0,
      file_path: filePath,
      message_timestamp: 1770489126,
      duration: 10,
    }));
    const messagesUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
    const sessionsFindOne = jest.fn(async () => ({
      _id: sessionId,
      processors: ['transcription'],
      session_processors: ['CREATE_TASKS'],
    }));
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

    createTranscriptionMock.mockResolvedValue({ text: 'disabled categorization parity payload' });
    getAudioDurationFromFileMock.mockResolvedValue(10);
    const processorsQueueAdd = jest.fn(async () => ({ id: 'processors-job-1' }));
    const postprocessorsQueueAdd = jest.fn(async () => ({ id: 'postprocessors-job-1' }));
    const eventsQueueAdd = jest.fn(async () => ({ id: 'events-job-1' }));
    getVoicebotQueuesMock.mockReturnValue({
      [VOICEBOT_QUEUES.PROCESSORS]: {
        add: processorsQueueAdd,
      },
      [VOICEBOT_QUEUES.POSTPROCESSORS]: {
        add: postprocessorsQueueAdd,
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

    expect(processorsQueueAdd).not.toHaveBeenCalled();
    expect(postprocessorsQueueAdd).toHaveBeenCalledTimes(1);
    const createTasksRefreshCall = sessionsUpdateOne.mock.calls.find((call) => {
      const update = call?.[1] as Record<string, unknown> | undefined;
      const setPayload = (update?.$set || {}) as Record<string, unknown>;
      return Object.prototype.hasOwnProperty.call(setPayload, 'processors_data.CREATE_TASKS.auto_requested_at');
    });
    expect(createTasksRefreshCall).toBeTruthy();
  });

  it('keeps voice and text garbage decisions equivalent for downstream categorization/create_tasks', async () => {
    const parityText = 'garbage parity fixture';
    const garbageDecision = {
      checked_at: new Date('2026-03-25T12:00:00.000Z'),
      detector_version: 'post_transcribe_garbage_v1',
      model: 'gpt-5.4-nano',
      skipped: false,
      skip_reason: null,
      is_garbage: true,
      code: 'noise_or_garbage',
      reason: 'repetitive_non_speech',
      raw_output: '{"is_garbage":true}',
    };

    const voiceMessageId = new ObjectId();
    const voiceSessionId = new ObjectId();
    const voiceDir = mkdtempSync(join(tmpdir(), 'copilot-parity-voice-garbage-'));
    const voiceFilePath = join(voiceDir, 'chunk.webm');
    writeFileSync(voiceFilePath, 'fake-audio');
    detectGarbageTranscriptionMock.mockResolvedValueOnce(garbageDecision);

    const voiceMessagesFindOne = jest.fn(async () => ({
      _id: voiceMessageId,
      session_id: voiceSessionId,
      is_transcribed: false,
      transcribe_attempts: 0,
      file_path: voiceFilePath,
      message_timestamp: 1770489126,
      duration: 8,
    }));
    const voiceMessagesUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
    const voiceSessionsFindOne = jest.fn(async () => ({ _id: voiceSessionId }));
    const voiceSessionsUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
    getDbMock.mockReturnValue({
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.MESSAGES) {
          return {
            findOne: voiceMessagesFindOne,
            updateOne: voiceMessagesUpdateOne,
          };
        }
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return {
            findOne: voiceSessionsFindOne,
            updateOne: voiceSessionsUpdateOne,
          };
        }
        return {};
      },
    });

    createTranscriptionMock.mockResolvedValueOnce({ text: parityText });
    getAudioDurationFromFileMock.mockResolvedValue(8);
    const voiceProcessorsQueueAdd = jest.fn(async () => ({ id: 'voice-processors-job' }));
    const voicePostprocessorsQueueAdd = jest.fn(async () => ({ id: 'voice-postprocessors-job' }));
    const voiceEventsQueueAdd = jest.fn(async () => ({ id: 'voice-events-job' }));
    getVoicebotQueuesMock.mockReturnValue({
      [VOICEBOT_QUEUES.PROCESSORS]: {
        add: voiceProcessorsQueueAdd,
      },
      [VOICEBOT_QUEUES.POSTPROCESSORS]: {
        add: voicePostprocessorsQueueAdd,
      },
      [VOICEBOT_QUEUES.EVENTS]: {
        add: voiceEventsQueueAdd,
      },
    });

    const voiceResult = await handleTranscribeJob({ message_id: voiceMessageId.toString() });
    expect(voiceResult).toMatchObject({
      ok: true,
      message_id: voiceMessageId.toString(),
      session_id: voiceSessionId.toString(),
    });
    expect(voiceProcessorsQueueAdd).not.toHaveBeenCalled();
    expect(voicePostprocessorsQueueAdd).not.toHaveBeenCalled();

    const voiceTranscriptionUpdateCall = voiceMessagesUpdateOne.mock.calls.find((call) => {
      const update = call?.[1] as Record<string, unknown> | undefined;
      const setPayload = (update?.$set || {}) as Record<string, unknown>;
      return setPayload.is_transcribed === true;
    });
    expect(voiceTranscriptionUpdateCall).toBeTruthy();
    const voiceSetPayload = (((voiceTranscriptionUpdateCall?.[1] as Record<string, unknown>)?.$set || {}) as Record<
      string,
      unknown
    >);

    const textSessionId = new ObjectId();
    getActiveVoiceSessionForUserMock.mockResolvedValue({
      active_session_id: textSessionId,
    });
    const { db: ingressDb, spies: ingressSpies } = makeIngressDb({
      performer: { _id: new ObjectId(), telegram_id: '9911' },
      activeSession: {
        _id: textSessionId,
        session_type: 'multiprompt_voice_session',
        is_active: true,
        processors: ['transcription', 'categorization'],
        session_processors: ['CREATE_TASKS'],
      },
    });
    const textProcessorsQueueAdd = jest.fn(async () => ({ id: 'text-processors-job' }));
    const textPostprocessorsQueueAdd = jest.fn(async () => ({ id: 'text-postprocessors-job' }));

    const textResult = await handleTextIngress({
      deps: buildTgIngressDeps({
        db: ingressDb as any,
        queues: {
          [VOICEBOT_QUEUES.PROCESSORS]: {
            add: textProcessorsQueueAdd,
          },
          [VOICEBOT_QUEUES.POSTPROCESSORS]: {
            add: textPostprocessorsQueueAdd,
          },
        },
        garbageDetector: async () => garbageDecision,
      }),
      input: {
        telegram_user_id: 9911,
        chat_id: 9911,
        username: 'parity-user',
        message_id: 6401,
        message_timestamp: 1770509191,
        text: parityText,
      },
    });
    expect(textResult.ok).toBe(true);
    expect(textProcessorsQueueAdd).not.toHaveBeenCalled();
    expect(textPostprocessorsQueueAdd).not.toHaveBeenCalled();

    const insertedText = ingressSpies.messagesInsertOne.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(insertedText.garbage_detected).toBe(true);
    const textCategorizationState = ((insertedText.processors_data as Record<string, unknown>)?.categorization ||
      {}) as Record<string, unknown>;
    expect(textCategorizationState.is_processed).toBe(true);
    expect(textCategorizationState.skipped_reason).toBe('garbage_detected');
    expect(textCategorizationState.skipped_reason).toBe(voiceSetPayload['processors_data.categorization.skipped_reason']);
  });

  it('keeps voice and text non-garbage downstream behavior equivalent for same valid content', async () => {
    const parityText = 'valid parity fixture content';
    const nonGarbageDecision = {
      checked_at: new Date('2026-03-25T12:00:00.000Z'),
      detector_version: 'post_transcribe_garbage_v1',
      model: 'gpt-5.4-nano',
      skipped: false,
      skip_reason: null,
      is_garbage: false,
      code: 'ok',
      reason: 'valid_speech',
      raw_output: '{"is_garbage":false}',
    };

    const voiceMessageId = new ObjectId();
    const voiceSessionId = new ObjectId();
    const voiceDir = mkdtempSync(join(tmpdir(), 'copilot-parity-voice-valid-'));
    const voiceFilePath = join(voiceDir, 'chunk.webm');
    writeFileSync(voiceFilePath, 'fake-audio');
    detectGarbageTranscriptionMock.mockResolvedValueOnce(nonGarbageDecision);

    const voiceMessagesFindOne = jest.fn(async () => ({
      _id: voiceMessageId,
      session_id: voiceSessionId,
      is_transcribed: false,
      transcribe_attempts: 0,
      file_path: voiceFilePath,
      message_timestamp: 1770489126,
      duration: 11,
    }));
    const voiceMessagesUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
    const voiceSessionsFindOne = jest.fn(async () => ({
      _id: voiceSessionId,
      processors: ['transcription', 'categorization'],
      session_processors: ['CREATE_TASKS'],
    }));
    const voiceSessionsUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
    getDbMock.mockReturnValue({
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.MESSAGES) {
          return {
            findOne: voiceMessagesFindOne,
            updateOne: voiceMessagesUpdateOne,
          };
        }
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return {
            findOne: voiceSessionsFindOne,
            updateOne: voiceSessionsUpdateOne,
          };
        }
        return {};
      },
    });

    createTranscriptionMock.mockResolvedValueOnce({ text: parityText });
    getAudioDurationFromFileMock.mockResolvedValue(11);
    const voiceProcessorsQueueAdd = jest.fn(async () => ({ id: 'voice-processors-job' }));
    const voicePostprocessorsQueueAdd = jest.fn(async () => ({ id: 'voice-postprocessors-job' }));
    const voiceEventsQueueAdd = jest.fn(async () => ({ id: 'voice-events-job' }));
    getVoicebotQueuesMock.mockReturnValue({
      [VOICEBOT_QUEUES.PROCESSORS]: {
        add: voiceProcessorsQueueAdd,
      },
      [VOICEBOT_QUEUES.POSTPROCESSORS]: {
        add: voicePostprocessorsQueueAdd,
      },
      [VOICEBOT_QUEUES.EVENTS]: {
        add: voiceEventsQueueAdd,
      },
    });

    const voiceResult = await handleTranscribeJob({ message_id: voiceMessageId.toString() });
    expect(voiceResult).toMatchObject({
      ok: true,
      message_id: voiceMessageId.toString(),
      session_id: voiceSessionId.toString(),
    });
    expect(voiceProcessorsQueueAdd).toHaveBeenCalledTimes(1);
    expect(voicePostprocessorsQueueAdd).toHaveBeenCalledTimes(1);
    expect(voicePostprocessorsQueueAdd).toHaveBeenCalledWith(
      VOICEBOT_JOBS.postprocessing.CREATE_TASKS,
      expect.objectContaining({
        session_id: voiceSessionId.toHexString(),
        refresh_mode: 'incremental_refresh',
      }),
      expect.objectContaining({ deduplication: expect.any(Object) })
    );

    const voiceRefreshStateCall = voiceSessionsUpdateOne.mock.calls.find((call) => {
      const update = call?.[1] as Record<string, unknown> | undefined;
      const setPayload = (update?.$set || {}) as Record<string, unknown>;
      return Object.prototype.hasOwnProperty.call(setPayload, 'processors_data.CREATE_TASKS.auto_requested_at');
    });
    expect(voiceRefreshStateCall).toBeTruthy();
    const voiceRefreshUpdate = voiceRefreshStateCall?.[1] as Record<string, unknown>;
    expect((voiceRefreshUpdate.$set as Record<string, unknown>)['processors_data.CREATE_TASKS.is_processed']).toBe(false);
    expect((voiceRefreshUpdate.$set as Record<string, unknown>)['processors_data.CREATE_TASKS.is_processing']).toBe(false);
    expect((voiceRefreshUpdate.$unset as Record<string, unknown>)['processors_data.CREATE_TASKS.error']).toBe(1);
    expect((voiceRefreshUpdate.$unset as Record<string, unknown>)['processors_data.CREATE_TASKS.no_task_reason_code']).toBe(1);
    expect((voiceRefreshUpdate.$unset as Record<string, unknown>)['processors_data.CREATE_TASKS.no_task_decision']).toBe(1);
    expect((voiceRefreshUpdate.$unset as Record<string, unknown>)['processors_data.CREATE_TASKS.last_tasks_count']).toBe(1);

    const textSessionId = new ObjectId();
    getActiveVoiceSessionForUserMock.mockResolvedValue({
      active_session_id: textSessionId,
    });
    const { db: ingressDb, spies: ingressSpies } = makeIngressDb({
      performer: { _id: new ObjectId(), telegram_id: '9922' },
      activeSession: {
        _id: textSessionId,
        session_type: 'multiprompt_voice_session',
        is_active: true,
        processors: ['transcription', 'categorization'],
        session_processors: ['CREATE_TASKS'],
      },
    });
    const textProcessorsQueueAdd = jest.fn(async () => ({ id: 'text-processors-job' }));
    const textPostprocessorsQueueAdd = jest.fn(async () => ({ id: 'text-postprocessors-job' }));

    const textResult = await handleTextIngress({
      deps: buildTgIngressDeps({
        db: ingressDb as any,
        queues: {
          [VOICEBOT_QUEUES.PROCESSORS]: {
            add: textProcessorsQueueAdd,
          },
          [VOICEBOT_QUEUES.POSTPROCESSORS]: {
            add: textPostprocessorsQueueAdd,
          },
        },
        garbageDetector: async () => nonGarbageDecision,
      }),
      input: {
        telegram_user_id: 9922,
        chat_id: 9922,
        username: 'valid-parity-user',
        message_id: 6402,
        message_timestamp: 1770509292,
        text: parityText,
      },
    });
    expect(textResult.ok).toBe(true);
    expect(textProcessorsQueueAdd).toHaveBeenCalledTimes(1);
    expect(textPostprocessorsQueueAdd).toHaveBeenCalledTimes(1);
    expect(textPostprocessorsQueueAdd).toHaveBeenCalledWith(
      VOICEBOT_JOBS.postprocessing.CREATE_TASKS,
      expect.objectContaining({
        session_id: textSessionId.toHexString(),
        refresh_mode: 'incremental_refresh',
      }),
      expect.objectContaining({ deduplication: expect.any(Object) })
    );

    const textRefreshStateCall = ingressSpies.sessionsUpdateOne.mock.calls.find((call) => {
      const update = call?.[1] as Record<string, unknown> | undefined;
      const setPayload = (update?.$set || {}) as Record<string, unknown>;
      return Object.prototype.hasOwnProperty.call(setPayload, 'processors_data.CREATE_TASKS.auto_requested_at');
    });
    expect(textRefreshStateCall).toBeTruthy();
    const textRefreshUpdate = textRefreshStateCall?.[1] as Record<string, unknown>;
    expect((textRefreshUpdate.$set as Record<string, unknown>)['processors_data.CREATE_TASKS.is_processed']).toBe(false);
    expect((textRefreshUpdate.$set as Record<string, unknown>)['processors_data.CREATE_TASKS.is_processing']).toBe(false);
    expect((textRefreshUpdate.$unset as Record<string, unknown>)['processors_data.CREATE_TASKS.error']).toBe(1);
    expect((textRefreshUpdate.$unset as Record<string, unknown>)['processors_data.CREATE_TASKS.no_task_reason_code']).toBe(1);
    expect((textRefreshUpdate.$unset as Record<string, unknown>)['processors_data.CREATE_TASKS.no_task_decision']).toBe(1);
    expect((textRefreshUpdate.$unset as Record<string, unknown>)['processors_data.CREATE_TASKS.last_tasks_count']).toBe(1);
  });

  it('persists no-task decision in reuse_by_hash branch when categorization is not queued', async () => {
    const messageId = new ObjectId();
    const sessionId = new ObjectId();
    const reusedMessageId = new ObjectId();
    const dir = mkdtempSync(join(tmpdir(), 'copilot-transcribe-reuse-no-queue-'));
    const filePath = join(dir, 'chunk.webm');
    writeFileSync(filePath, 'fake-audio');

    const messagesFindOne = jest.fn()
      .mockResolvedValueOnce({
        _id: messageId,
        session_id: sessionId,
        is_transcribed: false,
        transcribe_attempts: 0,
        file_path: filePath,
        file_hash: 'shared-hash',
        message_timestamp: 1770489126,
        duration: 10,
      })
      .mockResolvedValueOnce({
        _id: reusedMessageId,
        is_transcribed: true,
        task: 'transcribe',
        text: 'reused text payload',
        transcription_text: 'reused text payload',
        transcription_raw: { provider: 'legacy' },
        transcription: { provider: 'legacy', model: 'ready_text' },
        transcription_chunks: [{ text: 'reused text payload' }],
      });
    const messagesUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
    const sessionsFindOne = jest.fn(async () => ({
      _id: sessionId,
      processors: ['transcription', 'categorization'],
      session_processors: ['CREATE_TASKS'],
    }));
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

    getVoicebotQueuesMock.mockReturnValue({
      [VOICEBOT_QUEUES.EVENTS]: {
        add: jest.fn(async () => ({ id: 'events-job-1' })),
      },
    });

    const result = await handleTranscribeJob({ message_id: messageId.toHexString() });
    expect(result).toMatchObject({
      ok: true,
      skipped: true,
      reason: 'reused_transcription_by_hash',
      message_id: messageId.toHexString(),
      session_id: sessionId.toHexString(),
    });
    const noTaskDecisionPersistCall = sessionsUpdateOne.mock.calls.find((call) => {
      const update = call?.[1] as Record<string, unknown> | undefined;
      const setPayload = (update?.$set || {}) as Record<string, unknown>;
      return setPayload['processors_data.CREATE_TASKS.no_task_reason_code'] === 'categorization_not_queued';
    });
    expect(noTaskDecisionPersistCall).toBeTruthy();
  });

  it('persists no-task decision in text_fallback branch when categorization is not queued', async () => {
    const messageId = new ObjectId();
    const sessionId = new ObjectId();

    const messagesFindOne = jest.fn(async () => ({
      _id: messageId,
      session_id: sessionId,
      is_transcribed: false,
      transcribe_attempts: 0,
      file_path: '',
      text: 'fallback text payload',
      message_timestamp: 1770489126,
      duration: 0,
    }));
    const messagesUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
    const sessionsFindOne = jest.fn(async () => ({
      _id: sessionId,
      processors: ['transcription', 'categorization'],
      session_processors: ['CREATE_TASKS'],
    }));
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

    getVoicebotQueuesMock.mockReturnValue({
      [VOICEBOT_QUEUES.EVENTS]: {
        add: jest.fn(async () => ({ id: 'events-job-1' })),
      },
    });

    const result = await handleTranscribeJob({ message_id: messageId.toHexString() });
    expect(result).toMatchObject({
      ok: true,
      skipped: true,
      reason: 'text_fallback',
      message_id: messageId.toHexString(),
      session_id: sessionId.toHexString(),
    });
    const noTaskDecisionPersistCall = sessionsUpdateOne.mock.calls.find((call) => {
      const update = call?.[1] as Record<string, unknown> | undefined;
      const setPayload = (update?.$set || {}) as Record<string, unknown>;
      return setPayload['processors_data.CREATE_TASKS.no_task_reason_code'] === 'categorization_not_queued';
    });
    expect(noTaskDecisionPersistCall).toBeTruthy();
  });

  it('does not enqueue CREATE_TASKS auto refresh when session_processors explicitly exclude it', async () => {
    const messageId = new ObjectId();
    const sessionId = new ObjectId();
    const dir = mkdtempSync(join(tmpdir(), 'copilot-transcribe-no-create-tasks-'));
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
    const sessionsFindOne = jest.fn(async () => ({
      _id: sessionId,
      session_processors: ['FINAL_CUSTOM_PROMPT'],
    }));
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
    const postprocessorsQueueAdd = jest.fn(async () => ({ id: 'postprocessors-job-1' }));
    const eventsQueueAdd = jest.fn(async () => ({ id: 'events-job-1' }));
    getVoicebotQueuesMock.mockReturnValue({
      [VOICEBOT_QUEUES.PROCESSORS]: {
        add: processorsQueueAdd,
      },
      [VOICEBOT_QUEUES.POSTPROCESSORS]: {
        add: postprocessorsQueueAdd,
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
    expect(processorsQueueAdd).toHaveBeenCalledTimes(1);
    expect(postprocessorsQueueAdd).not.toHaveBeenCalled();
    expect(eventsQueueAdd).toHaveBeenCalledTimes(1);
  });

  it('creates deferred codex task with canonical external_ref when transcription starts with Кодекс trigger word', async () => {
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
    const tasksInsertOne = jest.fn(async (doc: Record<string, unknown>) => ({
      insertedId: (doc._id as ObjectId) || codexTaskId,
    }));

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
    process.env.VOICE_WEB_INTERFACE_URL = 'https://copilot-dev.stratospace.fun/voice/session';

    const result = await handleTranscribeJob({ message_id: messageId.toString() });
    expect(result).toMatchObject({
      ok: true,
      message_id: messageId.toString(),
      session_id: sessionId.toString(),
    });

    expect(tasksFindOne.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(tasksInsertOne).toHaveBeenCalledTimes(1);
    const insertedTask = tasksInsertOne.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(String(insertedTask.id || '')).toMatch(/^[a-z0-9-]+-\d{2}-\d{2}(?:-\d+)?$/);
    expect(insertedTask.source_kind).toBe('voice_session');
    expect(insertedTask.created_by_performer_id).toEqual(actorId);
    expect(insertedTask.priority_reason).toBe('voice_command');
    expect(insertedTask.codex_review_state).toBe('deferred');
    expect(insertedTask.external_ref).toBe(`https://copilot.stratospace.fun/voice/session/${sessionId.toHexString()}`);
    const insertedTaskObjectId = insertedTask._id as ObjectId | undefined;
    expect(insertedTaskObjectId instanceof ObjectId).toBe(true);
    expect(String(insertedTask.source_ref || '')).toBe(
      `https://copilot.stratospace.fun/operops/task/${insertedTaskObjectId?.toHexString()}`
    );

    const sourceData = insertedTask.source_data as Record<string, unknown>;
    const payload = sourceData.payload as Record<string, unknown>;
    expect(payload.trigger).toBe('voice_command');
    expect(payload.trigger_word).toBe('кодекс');
    expect(payload.session_id).toBe(sessionId.toHexString());
    expect(payload.message_db_id).toBe(messageId.toHexString());
    expect(payload.normalized_text).toBe('подготовь план релиза');
    expect(payload.external_ref).toBe(`https://copilot.stratospace.fun/voice/session/${sessionId.toHexString()}`);

    const codexPayloadUpdate = sessionsUpdateOne.mock.calls.find((call) => {
      const update = call[1] as Record<string, unknown> | undefined;
      const push = update?.$push as Record<string, unknown> | undefined;
      return Boolean(push && Object.prototype.hasOwnProperty.call(push, 'processors_data.CODEX_TASKS.data'));
    });
    expect(codexPayloadUpdate).toBeDefined();
    const codexTaskIdUpdate = sessionsUpdateOne.mock.calls.find((call) => {
      const update = call[1] as Record<string, unknown> | undefined;
      const setPayload = (update?.$set || {}) as Record<string, unknown>;
      return setPayload['processors_data.CODEX_TASKS.last_task_id'] === insertedTaskObjectId?.toHexString();
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

  it('fails safely when split output exceeds hard ASR chunk cap to avoid tail loss', async () => {
    const messageId = new ObjectId();
    const sessionId = new ObjectId();
    const dir = mkdtempSync(join(tmpdir(), 'copilot-transcribe-hard-cap-'));
    const filePath = join(dir, 'oversized.webm');
    writeFileSync(filePath, Buffer.alloc(65 * 1024 * 1024, 0));

    const partPaths: string[] = [];
    for (let idx = 0; idx < 10; idx += 1) {
      const partPath = join(dir, `part_${String(idx).padStart(3, '0')}.webm`);
      writeFileSync(partPath, `part-${idx}`);
      partPaths.push(partPath);
    }

    const messagesFindOne = jest.fn(async () => ({
      _id: messageId,
      session_id: sessionId,
      is_transcribed: false,
      transcribe_attempts: 0,
      file_path: filePath,
      mime_type: 'audio/webm',
      message_timestamp: 1770489126,
      duration: 800,
    }));
    const messagesUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
    const sessionsFindOne = jest.fn(async () => ({ _id: sessionId }));
    const sessionsUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
    const processorsQueueAdd = jest.fn(async () => ({ id: 'processors-job-hard-cap' }));

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

    spawnSyncMock.mockImplementation((_command: string, args: string[]) => {
      const outputPath = Array.isArray(args) ? args[args.length - 1] : null;
      if (typeof outputPath === 'string' && outputPath) {
        const isReencode = args.includes('-b:a');
        writeFileSync(outputPath, isReencode ? Buffer.alloc(26 * 1024 * 1024, 0) : 'ffmpeg-output');
      }
      return {
        status: 0,
        stdout: '',
        stderr: '',
      };
    });

    splitAudioFileByDurationMock.mockResolvedValue(partPaths);
    getAudioDurationFromFileMock.mockResolvedValue(80);
    createTranscriptionMock.mockImplementation(async () => ({
      text: `part-${createTranscriptionMock.mock.calls.length}`,
    }));

    const result = await handleTranscribeJob({ message_id: messageId.toString() });
    expect(result).toMatchObject({
      ok: false,
      error: 'audio_too_large',
      message_id: messageId.toString(),
      session_id: sessionId.toString(),
    });
    expect(splitAudioFileByDurationMock).toHaveBeenCalledTimes(1);
    expect(createTranscriptionMock).not.toHaveBeenCalled();

    const transcriptionUpdateCall = messagesUpdateOne.mock.calls.find((call) => {
      const update = call?.[1] as Record<string, unknown> | undefined;
      const setPayload = (update?.$set || {}) as Record<string, unknown>;
      return setPayload.transcription_error === 'audio_too_large';
    });
    expect(transcriptionUpdateCall).toBeTruthy();
    const setPayload = (((transcriptionUpdateCall?.[1] as Record<string, unknown>)?.$set || {}) as Record<string, unknown>);
    expect(setPayload.is_transcribed).toBe(false);
    expect(setPayload.transcription_error).toBe('audio_too_large');
    expect(setPayload.to_transcribe).toBe(false);
    expect(setPayload.transcription_processing_state).toBe('transcription_error');
    expect(setPayload.source_media_type).toBe('audio');
    expect(setPayload.audio_extracted).toBe(false);
    expect(setPayload.asr_chunk_count).toBe(0);
    expect(setPayload.chunk_policy).toBe('reencode_then_cap_segmented');
    expect(setPayload.chunk_cap_applied).toBe(true);

    const successCommitCall = messagesUpdateOne.mock.calls.find((call) => {
      const update = call?.[1] as Record<string, unknown> | undefined;
      const payload = (update?.$set || {}) as Record<string, unknown>;
      return payload.is_transcribed === true;
    });
    expect(successCommitCall).toBeUndefined();
    expect(processorsQueueAdd).not.toHaveBeenCalled();
  });
});
