import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ObjectId } from 'mongodb';

import {
  VOICEBOT_COLLECTIONS,
  VOICEBOT_JOBS,
  VOICEBOT_QUEUES,
} from '../../src/constants.js';

const getDbMock = jest.fn();
const createResponseMock = jest.fn();
const getVoicebotQueuesMock = jest.fn();
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

const { handleCategorizeJob } = await import('../../src/workers/voicebot/handlers/categorize.js');

describe('handleCategorizeJob', () => {
  beforeEach(() => {
    getDbMock.mockReset();
    createResponseMock.mockReset();
    getVoicebotQueuesMock.mockReset();
    openAiCtorMock.mockClear();
    process.env.OPENAI_API_KEY = 'sk-test1234567890abcd';
    getVoicebotQueuesMock.mockReturnValue(null);
  });

  it('stores normalized categorization payload on success', async () => {
    const messageId = new ObjectId();
    const sessionId = new ObjectId();
    const messagesFindOne = jest.fn(async () => ({
      _id: messageId,
      session_id: sessionId,
      transcription_text: 'Discussed product roadmap and Jira setup',
      categorization_attempts: 0,
      speaker: 'Alex',
    }));
    const sessionsFindOne = jest.fn(async () => ({ _id: sessionId }));
    const messagesUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
    const eventsQueueAdd = jest.fn(async () => ({ id: 'events-job-1' }));
    getVoicebotQueuesMock.mockReturnValue({
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
          };
        }
        return {};
      },
    });

    createResponseMock.mockResolvedValue({
      output_text: JSON.stringify([
        {
          topic_keywords: ['roadmap', 'jira'],
          keywords_grouped: { planning: ['roadmap'] },
          mentioned_roles: ['PM', 'Dev'],
          referenced_systems: ['Jira'],
          certainty_level: 'high',
          start: '0',
          end: '30',
          text: 'Discussed roadmap and Jira setup.',
          related_goal: 'Align planning',
        },
      ]),
    });

    const result = await handleCategorizeJob({ message_id: messageId.toString() });
    expect(result).toMatchObject({
      ok: true,
      message_id: messageId.toString(),
      session_id: sessionId.toString(),
    });

    const updatePayload = messagesUpdateOne.mock.calls[messagesUpdateOne.mock.calls.length - 1]?.[1] as Record<string, unknown>;
    const setPayload = (updatePayload.$set as Record<string, unknown>) || {};
    const categorization = (setPayload.categorization as Array<Record<string, unknown>>) || [];
    expect(Array.isArray(categorization)).toBe(true);
    expect(categorization).toHaveLength(1);
    expect(categorization[0]?.topic_keywords).toBe('roadmap, jira');
    expect(categorization[0]?.mentioned_roles).toBe('PM, Dev');
    expect(categorization[0]?.referenced_systems).toBe('Jira');
    expect(categorization[0]?.speaker).toBe('Alex');
    expect(String(categorization[0]?.keywords_grouped || '')).toContain('planning');
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

  it('marks insufficient_quota with retry metadata', async () => {
    const messageId = new ObjectId();
    const sessionId = new ObjectId();
    const messagesFindOne = jest.fn(async () => ({
      _id: messageId,
      session_id: sessionId,
      transcription_text: 'Need categorization',
      categorization_attempts: 1,
    }));
    const sessionsFindOne = jest.fn(async () => ({ _id: sessionId }));
    const messagesUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));

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
          };
        }
        return {};
      },
    });

    createResponseMock.mockRejectedValue({
      status: 429,
      error: {
        code: 'insufficient_quota',
      },
      message: 'You exceeded your current quota.',
    });

    const result = await handleCategorizeJob({ message_id: messageId.toString() });
    expect(result).toMatchObject({
      ok: false,
      error: 'insufficient_quota',
      message_id: messageId.toString(),
      session_id: sessionId.toString(),
    });

    const updatePayload = messagesUpdateOne.mock.calls[messagesUpdateOne.mock.calls.length - 1]?.[1] as Record<string, unknown>;
    const setPayload = (updatePayload.$set as Record<string, unknown>) || {};
    expect(setPayload.categorization_error).toBe('insufficient_quota');
    expect(setPayload.categorization_retry_reason).toBe('insufficient_quota');
    expect(setPayload.categorization_next_attempt_at).toBeInstanceOf(Date);
  });

  it('marks openai_api_key_missing when key is absent', async () => {
    const messageId = new ObjectId();
    const sessionId = new ObjectId();
    const messagesFindOne = jest.fn(async () => ({
      _id: messageId,
      session_id: sessionId,
      transcription_text: 'Need categorization',
      categorization_attempts: 0,
    }));
    const sessionsFindOne = jest.fn(async () => ({ _id: sessionId }));
    const messagesUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));

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
          };
        }
        return {};
      },
    });

    delete process.env.OPENAI_API_KEY;

    const result = await handleCategorizeJob({ message_id: messageId.toString() });
    expect(result).toMatchObject({
      ok: false,
      error: 'openai_api_key_missing',
      message_id: messageId.toString(),
      session_id: sessionId.toString(),
    });
    expect(openAiCtorMock).not.toHaveBeenCalled();

    const updatePayload = messagesUpdateOne.mock.calls[messagesUpdateOne.mock.calls.length - 1]?.[1] as Record<string, unknown>;
    const setPayload = (updatePayload.$set as Record<string, unknown>) || {};
    expect(setPayload.categorization_error).toBe('openai_api_key_missing');
    expect(setPayload.categorization_retry_reason).toBeUndefined();
  });
});
