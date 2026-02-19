import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ObjectId } from 'mongodb';
import fs from 'node:fs';
import path from 'node:path';

import {
  VOICEBOT_COLLECTIONS,
  VOICEBOT_JOBS,
  VOICEBOT_QUEUES,
} from '../../src/constants.js';

const getDbMock = jest.fn();
const getVoicebotQueuesMock = jest.fn();
const createResponseMock = jest.fn();
const openAiCtorMock = jest.fn(() => ({
  responses: {
    create: createResponseMock,
  },
}));

jest.unstable_mockModule('../../src/services/db.js', () => ({
  getDb: getDbMock,
}));

jest.unstable_mockModule('../../src/services/voicebotQueues.js', () => ({
  getVoicebotQueues: getVoicebotQueuesMock,
}));

jest.unstable_mockModule('openai', () => ({
  default: openAiCtorMock,
}));

const { handleAllCustomPromptsJob } = await import(
  '../../src/workers/voicebot/handlers/allCustomPrompts.js'
);
const { handleOneCustomPromptJob } = await import(
  '../../src/workers/voicebot/handlers/oneCustomPrompt.js'
);
const { VOICEBOT_WORKER_MANIFEST } = await import('../../src/workers/voicebot/manifest.js');

describe('postprocessing custom prompt handlers', () => {
  const fixturesDir = path.resolve(process.cwd(), '__tests__/fixtures/custom-prompts-postprocessing');

  beforeEach(() => {
    getDbMock.mockReset();
    getVoicebotQueuesMock.mockReset();
    createResponseMock.mockReset();
    openAiCtorMock.mockClear();

    process.env.OPENAI_API_KEY = 'sk-test-key';
    process.env.VOICEBOT_CUSTOM_PROMPTS_DIR = fixturesDir;

    fs.mkdirSync(fixturesDir, { recursive: true });
    fs.writeFileSync(path.join(fixturesDir, 'alpha.md'), 'alpha prompt', 'utf8');
    fs.writeFileSync(path.join(fixturesDir, 'beta.md'), 'beta prompt', 'utf8');
  });

  it('queues one_custom_prompt only for pending configured processors', async () => {
    const sessionId = new ObjectId();
    const sessionsFindOne = jest.fn(async () => ({
      _id: sessionId,
      session_processors: ['alpha', 'beta', 'outside'],
      processors_data: {
        alpha: { is_processing: false, is_processed: false },
        beta: { is_processed: true },
      },
    }));
    const sessionsUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
    const postprocessorsAdd = jest.fn(async () => ({ id: 'job-1' }));

    getDbMock.mockReturnValue({
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return { findOne: sessionsFindOne, updateOne: sessionsUpdateOne };
        }
        return {};
      },
    });

    getVoicebotQueuesMock.mockReturnValue({
      [VOICEBOT_QUEUES.POSTPROCESSORS]: {
        add: postprocessorsAdd,
      },
    });

    const result = await handleAllCustomPromptsJob({
      session_id: sessionId.toString(),
    });

    expect(result).toMatchObject({
      ok: true,
      session_id: sessionId.toString(),
      queued: 1,
      skipped: 1,
      skipped_no_queue: 0,
    });

    expect(sessionsUpdateOne).toHaveBeenCalledTimes(1);
    const updatePayload = sessionsUpdateOne.mock.calls[0]?.[1] as Record<string, unknown>;
    const setPayload = (updatePayload.$set as Record<string, unknown>) || {};
    expect(setPayload['processors_data.alpha.is_processing']).toBe(true);

    expect(postprocessorsAdd).toHaveBeenCalledWith(
      VOICEBOT_JOBS.postprocessing.ONE_CUSTOM_PROMPT,
      expect.objectContaining({
        session_id: sessionId.toString(),
        processor_name: 'alpha',
      }),
      expect.objectContaining({ deduplication: expect.any(Object) })
    );
  });

  it('one_custom_prompt stores processor data and enqueues final when all prompts are done', async () => {
    const sessionId = new ObjectId();
    const sessionsFindOne = jest
      .fn()
      .mockResolvedValueOnce({
        _id: sessionId,
        processors_data: {
          alpha: { is_processed: false },
          beta: { is_processed: true },
        },
      })
      .mockResolvedValueOnce({
        _id: sessionId,
        processors_data: {
          alpha: { is_processed: true },
          beta: { is_processed: true },
          [VOICEBOT_JOBS.postprocessing.FINAL_CUSTOM_PROMPT]: { is_processed: false },
        },
      });
    const sessionsUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));

    const messagesFind = jest.fn(() => ({
      sort: () => ({
        toArray: async () => [
          {
            _id: new ObjectId(),
            session_id: sessionId,
            categorization: [{ text: 'chunk 1' }],
            message_timestamp: 100,
            message_id: '1',
          },
        ],
      }),
    }));

    const postprocessorsAdd = jest.fn(async () => ({ id: 'final-job' }));

    getDbMock.mockReturnValue({
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return { findOne: sessionsFindOne, updateOne: sessionsUpdateOne };
        }
        if (name === VOICEBOT_COLLECTIONS.MESSAGES) {
          return { find: messagesFind };
        }
        return {};
      },
    });

    getVoicebotQueuesMock.mockReturnValue({
      [VOICEBOT_QUEUES.POSTPROCESSORS]: {
        add: postprocessorsAdd,
      },
    });

    createResponseMock.mockResolvedValue({
      output_text: JSON.stringify([{ result: 'insight' }]),
    });

    const result = await handleOneCustomPromptJob({
      session_id: sessionId.toString(),
      processor_name: 'alpha',
    });

    expect(result).toMatchObject({
      ok: true,
      session_id: sessionId.toString(),
      processor_name: 'alpha',
      data_count: 1,
      enqueued_final: true,
    });

    expect(sessionsUpdateOne).toHaveBeenCalledTimes(1);
    const updatePayload = sessionsUpdateOne.mock.calls[0]?.[1] as Record<string, unknown>;
    const setPayload = (updatePayload.$set as Record<string, unknown>) || {};
    expect(setPayload['processors_data.alpha.is_processed']).toBe(true);
    expect(setPayload['processors_data.alpha.data']).toEqual([{ result: 'insight' }]);

    expect(postprocessorsAdd).toHaveBeenCalledWith(
      VOICEBOT_JOBS.postprocessing.FINAL_CUSTOM_PROMPT,
      expect.objectContaining({ session_id: sessionId.toString() }),
      expect.objectContaining({ deduplication: expect.any(Object), delay: 1000 })
    );
  });

  it('manifest includes ALL_CUSTOM_PROMPTS and ONE_CUSTOM_PROMPT bindings', () => {
    expect(VOICEBOT_WORKER_MANIFEST[VOICEBOT_JOBS.postprocessing.ALL_CUSTOM_PROMPTS]).toBeDefined();
    expect(VOICEBOT_WORKER_MANIFEST[VOICEBOT_JOBS.postprocessing.ONE_CUSTOM_PROMPT]).toBeDefined();
  });
});
