import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ObjectId } from 'mongodb';

import {
  VOICEBOT_COLLECTIONS,
  VOICEBOT_PROCESSORS,
} from '../../../src/constants.js';

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

const { handleSummarizeJob } = await import('../../../src/workers/voicebot/handlers/summarizeHandler.js');
const { handleQuestionsJob } = await import('../../../src/workers/voicebot/handlers/questionsHandler.js');

describe('voice worker summarize/questions handlers', () => {
  beforeEach(() => {
    getDbMock.mockReset();
    createResponseMock.mockReset();
    openAiCtorMock.mockClear();
    process.env.OPENAI_API_KEY = 'sk-test-key';
  });

  it('summarize skips when categorization is missing', async () => {
    const messageId = new ObjectId();
    const sessionId = new ObjectId();

    const messageFindOne = jest.fn(async () => ({
      _id: messageId,
      session_id: sessionId,
      categorization: [],
    }));
    const sessionFindOne = jest.fn(async () => ({ _id: sessionId }));

    getDbMock.mockReturnValue({
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.MESSAGES) {
          return { findOne: messageFindOne, updateOne: jest.fn() };
        }
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return { findOne: sessionFindOne };
        }
        return {};
      },
    });

    const result = await handleSummarizeJob({ message_id: messageId.toString() });
    expect(result).toMatchObject({
      ok: true,
      skipped: true,
      reason: 'missing_categorization',
      message_id: messageId.toString(),
      session_id: sessionId.toString(),
    });
    expect(createResponseMock).not.toHaveBeenCalled();
  });

  it('summarize stores processors_data.summarization data', async () => {
    const messageId = new ObjectId();
    const sessionId = new ObjectId();
    const messageFindOne = jest.fn(async () => ({
      _id: messageId,
      session_id: sessionId,
      categorization: [{ text: 'item' }],
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
      output_text: JSON.stringify([{ goal: 'G1', summary: 'S1' }]),
    });

    const result = await handleSummarizeJob({ message_id: messageId.toString() });
    expect(result).toMatchObject({
      ok: true,
      message_id: messageId.toString(),
      session_id: sessionId.toString(),
    });

    const updatePayload = messageUpdateOne.mock.calls[0]?.[1] as Record<string, unknown>;
    const setPayload = (updatePayload.$set as Record<string, unknown>) || {};
    expect(setPayload[`processors_data.${VOICEBOT_PROCESSORS.SUMMARIZATION}.is_processed`]).toBe(true);
    expect(setPayload[`processors_data.${VOICEBOT_PROCESSORS.SUMMARIZATION}.data`]).toEqual([
      { goal: 'G1', summary: 'S1' },
    ]);
  });

  it('questions stores processors_data.questioning data and normalizes fields', async () => {
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
      output_text: JSON.stringify([
        { topic: 'Process', question: 'Why?', priority: 'high', level: 'Middle' },
      ]),
    });

    const result = await handleQuestionsJob({ message_id: messageId.toString() });
    expect(result).toMatchObject({
      ok: true,
      message_id: messageId.toString(),
      session_id: sessionId.toString(),
    });

    const updatePayload = messageUpdateOne.mock.calls[0]?.[1] as Record<string, unknown>;
    const setPayload = (updatePayload.$set as Record<string, unknown>) || {};
    expect(setPayload[`processors_data.${VOICEBOT_PROCESSORS.QUESTIONING}.is_processed`]).toBe(true);
    expect(setPayload[`processors_data.${VOICEBOT_PROCESSORS.QUESTIONING}.data`]).toEqual([
      { topic: 'Process', question: 'Why?', priority: 'high', level: 'Middle' },
    ]);
  });

  it('questions marks openai_api_key_missing when key is absent', async () => {
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

    const result = await handleQuestionsJob({ message_id: messageId.toString() });
    expect(result).toMatchObject({
      ok: false,
      error: 'openai_api_key_missing',
      message_id: messageId.toString(),
      session_id: sessionId.toString(),
    });

    const updatePayload = messageUpdateOne.mock.calls[0]?.[1] as Record<string, unknown>;
    const setPayload = (updatePayload.$set as Record<string, unknown>) || {};
    expect(setPayload.questioning_error).toBe('openai_api_key_missing');
  });
});
