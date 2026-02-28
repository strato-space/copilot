import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ObjectId } from 'mongodb';
import fs from 'node:fs';
import path from 'node:path';

import { VOICEBOT_COLLECTIONS, VOICEBOT_JOBS } from '../../../src/constants.js';

const getDbMock = jest.fn();
const createResponseMock = jest.fn();
const openAiCtorMock = jest.fn(() => ({
  responses: {
    create: createResponseMock,
  },
}));

jest.unstable_mockModule('../../../src/services/db.js', () => ({
  getDb: getDbMock,
}));

jest.unstable_mockModule('openai', () => ({
  default: openAiCtorMock,
}));

const { handleCustomPromptJob } = await import('../../../src/workers/voicebot/handlers/customPrompt.js');
const { VOICEBOT_WORKER_MANIFEST } = await import('../../../src/workers/voicebot/manifest.js');

describe('handleCustomPromptJob', () => {
  const fixturesDir = path.resolve(process.cwd(), '__tests__/fixtures/custom-prompts');

  beforeEach(() => {
    getDbMock.mockReset();
    createResponseMock.mockReset();
    openAiCtorMock.mockClear();
    process.env.OPENAI_API_KEY = 'sk-test-key';
    process.env.VOICEBOT_CUSTOM_PROMPTS_DIR = fixturesDir;
    fs.mkdirSync(fixturesDir, { recursive: true });
    fs.writeFileSync(path.join(fixturesDir, 'demo_prompt.md'), 'You are demo prompt', 'utf8');
  });

  it('returns invalid_processor_name when processor_name is missing', async () => {
    const messageId = new ObjectId();
    const result = await handleCustomPromptJob({
      message_id: messageId.toString(),
    });

    expect(result).toMatchObject({
      ok: false,
      error: 'invalid_processor_name',
      message_id: messageId.toString(),
    });
  });

  it('stores processors_data.<processor_name> from custom prompt response', async () => {
    const messageId = new ObjectId();
    const sessionId = new ObjectId();
    const messageFindOne = jest.fn(async () => ({
      _id: messageId,
      session_id: sessionId,
      categorization: [{ text: 'segment' }],
    }));
    const sessionFindOne = jest.fn(async () => ({ _id: sessionId }));
    const messageUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));

    getDbMock.mockReturnValue({
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.MESSAGES) {
          return { findOne: messageFindOne, updateOne: messageUpdateOne };
        }
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return { findOne: sessionFindOne };
        }
        return {};
      },
    });

    createResponseMock.mockResolvedValue({
      output_text: JSON.stringify([{ result: 'R1' }]),
    });

    const result = await handleCustomPromptJob({
      message_id: messageId.toString(),
      processor_name: 'demo_prompt',
    });

    expect(result).toMatchObject({
      ok: true,
      message_id: messageId.toString(),
      session_id: sessionId.toString(),
      processor_name: 'demo_prompt',
    });

    const updatePayload = messageUpdateOne.mock.calls[0]?.[1] as Record<string, unknown>;
    const setPayload = (updatePayload.$set as Record<string, unknown>) || {};
    expect(setPayload['processors_data.demo_prompt.is_processed']).toBe(true);
    expect(setPayload['processors_data.demo_prompt.data']).toEqual([{ result: 'R1' }]);
  });

  it('marks custom_prompt_not_found when prompt file is absent', async () => {
    const messageId = new ObjectId();
    const sessionId = new ObjectId();
    const messageFindOne = jest.fn(async () => ({
      _id: messageId,
      session_id: sessionId,
      categorization: [{ text: 'segment' }],
    }));
    const sessionFindOne = jest.fn(async () => ({ _id: sessionId }));
    const messageUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));

    getDbMock.mockReturnValue({
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.MESSAGES) {
          return { findOne: messageFindOne, updateOne: messageUpdateOne };
        }
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return { findOne: sessionFindOne };
        }
        return {};
      },
    });

    const result = await handleCustomPromptJob({
      message_id: messageId.toString(),
      processor_name: 'missing_prompt',
    });

    expect(result).toMatchObject({
      ok: false,
      error: 'custom_prompt_not_found',
      message_id: messageId.toString(),
      session_id: sessionId.toString(),
      processor_name: 'missing_prompt',
    });

    const updatePayload = messageUpdateOne.mock.calls[0]?.[1] as Record<string, unknown>;
    const setPayload = (updatePayload.$set as Record<string, unknown>) || {};
    expect(setPayload['processors_data.missing_prompt.error']).toBe('custom_prompt_not_found');
  });

  it('marks openai_api_key_missing when key is absent', async () => {
    const messageId = new ObjectId();
    const sessionId = new ObjectId();
    const messageFindOne = jest.fn(async () => ({
      _id: messageId,
      session_id: sessionId,
      categorization: [{ text: 'segment' }],
    }));
    const sessionFindOne = jest.fn(async () => ({ _id: sessionId }));
    const messageUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));

    getDbMock.mockReturnValue({
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.MESSAGES) {
          return { findOne: messageFindOne, updateOne: messageUpdateOne };
        }
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return { findOne: sessionFindOne };
        }
        return {};
      },
    });

    delete process.env.OPENAI_API_KEY;

    const result = await handleCustomPromptJob({
      message_id: messageId.toString(),
      processor_name: 'demo_prompt',
    });

    expect(result).toMatchObject({
      ok: false,
      error: 'openai_api_key_missing',
      message_id: messageId.toString(),
      session_id: sessionId.toString(),
      processor_name: 'demo_prompt',
    });

    const updatePayload = messageUpdateOne.mock.calls[0]?.[1] as Record<string, unknown>;
    const setPayload = (updatePayload.$set as Record<string, unknown>) || {};
    expect(setPayload['processors_data.demo_prompt.error']).toBe('openai_api_key_missing');
  });

  it('manifest includes CUSTOM_PROMPT handler binding', () => {
    expect(VOICEBOT_WORKER_MANIFEST[VOICEBOT_JOBS.voice.CUSTOM_PROMPT]).toBeDefined();
  });
});
