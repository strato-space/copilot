import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ObjectId } from 'mongodb';

import { VOICEBOT_COLLECTIONS, VOICEBOT_JOBS } from '../../src/constants.js';

const getDbMock = jest.fn();
const createResponseMock = jest.fn();
const openAiCtorMock = jest.fn(() => ({
  responses: {
    create: createResponseMock,
  },
}));

jest.unstable_mockModule('../../src/services/db.js', () => ({
  getDb: getDbMock,
}));

jest.unstable_mockModule('openai', () => ({
  default: openAiCtorMock,
}));

const { handleFinalizationJob } = await import('../../src/workers/voicebot/handlers/finalization.js');

describe('handleFinalizationJob', () => {
  beforeEach(() => {
    getDbMock.mockReset();
    createResponseMock.mockReset();
    openAiCtorMock.mockClear();
    process.env.OPENAI_API_KEY = 'sk-test1234567890abcd';
  });

  it('returns no_custom_data when nothing to finalize', async () => {
    const sessionId = new ObjectId();
    const sessionsFindOne = jest.fn(async () => ({
      _id: sessionId,
      is_messages_processed: true,
      processors_data: {
        categorization: { data: [{ topic: 'x' }] },
      },
    }));
    const sessionsUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));

    getDbMock.mockReturnValue({
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return {
            findOne: sessionsFindOne,
            updateOne: sessionsUpdateOne,
          };
        }
        return {};
      },
    });

    const result = await handleFinalizationJob({ session_id: sessionId.toString() });
    expect(result).toMatchObject({
      ok: true,
      skipped: true,
      reason: 'no_custom_data',
      session_id: sessionId.toString(),
    });

    const updatePayload = sessionsUpdateOne.mock.calls[0]?.[1] as Record<string, unknown>;
    const setPayload = (updatePayload.$set as Record<string, unknown>) || {};
    expect(setPayload['processors_data.FINAL_CUSTOM_PROMPT.is_processed']).toBe(true);
    expect(setPayload['processors_data.FINAL_CUSTOM_PROMPT.data']).toEqual([]);
  });

  it('runs OpenAI dedup and stores final_custom_prompt data', async () => {
    const sessionId = new ObjectId();
    const sessionsFindOne = jest.fn(async () => ({
      _id: sessionId,
      is_messages_processed: true,
      processors_data: {
        custom_a: {
          data: [{ result: 'Q1' }, { result: 'Q1 duplicate' }],
        },
      },
    }));
    const sessionsUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));

    getDbMock.mockReturnValue({
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return {
            findOne: sessionsFindOne,
            updateOne: sessionsUpdateOne,
          };
        }
        return {};
      },
    });

    createResponseMock.mockResolvedValue({
      output_text: JSON.stringify([{ result: 'Q1 unique' }]),
    });

    const result = await handleFinalizationJob({
      session_id: sessionId.toString(),
      processor_name: VOICEBOT_JOBS.postprocessing.FINAL_CUSTOM_PROMPT,
    });

    expect(result).toMatchObject({
      ok: true,
      session_id: sessionId.toString(),
    });
    expect(openAiCtorMock).toHaveBeenCalledTimes(1);
    expect(createResponseMock).toHaveBeenCalledTimes(1);

    const updatePayload = sessionsUpdateOne.mock.calls[sessionsUpdateOne.mock.calls.length - 1]?.[1] as Record<string, unknown>;
    const setPayload = (updatePayload.$set as Record<string, unknown>) || {};
    expect(setPayload['processors_data.FINAL_CUSTOM_PROMPT.is_processed']).toBe(true);
    expect(setPayload['processors_data.FINAL_CUSTOM_PROMPT.data']).toEqual([{ result: 'Q1 unique' }]);
  });

  it('marks openai_api_key_missing if key is not configured', async () => {
    const sessionId = new ObjectId();
    const sessionsFindOne = jest.fn(async () => ({
      _id: sessionId,
      is_messages_processed: true,
      processors_data: {
        custom_a: {
          data: [{ result: 'Q1' }],
        },
      },
    }));
    const sessionsUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));

    getDbMock.mockReturnValue({
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return {
            findOne: sessionsFindOne,
            updateOne: sessionsUpdateOne,
          };
        }
        return {};
      },
    });

    delete process.env.OPENAI_API_KEY;

    const result = await handleFinalizationJob({ session_id: sessionId.toString() });
    expect(result).toMatchObject({
      ok: false,
      error: 'openai_api_key_missing',
      session_id: sessionId.toString(),
    });
    expect(openAiCtorMock).not.toHaveBeenCalled();

    const updatePayload = sessionsUpdateOne.mock.calls[sessionsUpdateOne.mock.calls.length - 1]?.[1] as Record<string, unknown>;
    const setPayload = (updatePayload.$set as Record<string, unknown>) || {};
    expect(setPayload['processors_data.FINAL_CUSTOM_PROMPT.error']).toBe('openai_api_key_missing');
  });
  it('returns finalization_failed when OpenAI request throws', async () => {
    const sessionId = new ObjectId();
    const sessionsFindOne = jest.fn(async () => ({
      _id: sessionId,
      is_messages_processed: true,
      processors_data: {
        custom_a: {
          data: [{ result: 'Q1' }],
        },
      },
    }));
    const sessionsUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));

    getDbMock.mockReturnValue({
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return {
            findOne: sessionsFindOne,
            updateOne: sessionsUpdateOne,
          };
        }
        return {};
      },
    });

    createResponseMock.mockRejectedValue(new Error('openai down'));

    const result = await handleFinalizationJob({ session_id: sessionId.toString() });
    expect(result).toMatchObject({
      ok: false,
      error: 'finalization_failed',
      session_id: sessionId.toString(),
    });

    const updatePayload = sessionsUpdateOne.mock.calls[sessionsUpdateOne.mock.calls.length - 1]?.[1] as Record<string, unknown>;
    const setPayload = (updatePayload.$set as Record<string, unknown>) || {};
    expect(setPayload['processors_data.FINAL_CUSTOM_PROMPT.error']).toBe('finalization_failed');
  });

});
