import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ObjectId } from 'mongodb';

import {
  VOICEBOT_COLLECTIONS,
  VOICEBOT_JOBS,
  VOICEBOT_QUEUES,
} from '../../../src/constants.js';

const getDbMock = jest.fn();
const createResponseMock = jest.fn();
const getVoicebotQueuesMock = jest.fn();
const openAiCtorMock = jest.fn(() => ({
  responses: {
    create: createResponseMock,
  },
}));

jest.unstable_mockModule('../../../src/services/db.js', () => ({
  getDb: getDbMock,
}));

jest.unstable_mockModule('../../../src/services/voicebotQueues.js', () => ({
  getVoicebotQueues: getVoicebotQueuesMock,
}));

jest.unstable_mockModule('openai', () => ({
  default: openAiCtorMock,
}));

const { handleCategorizeJob } = await import('../../../src/workers/voicebot/handlers/categorizeHandler.js');

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
    expect(categorization[0]?.start).toBe('00:00');
    expect(categorization[0]?.end).toBe('00:30');
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

  it('marks invalid_api_key with retry metadata', async () => {
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
      status: 401,
      error: {
        code: 'invalid_api_key',
      },
      message: 'Incorrect API key provided.',
    });

    const result = await handleCategorizeJob({ message_id: messageId.toString() });
    expect(result).toMatchObject({
      ok: false,
      error: 'invalid_api_key',
      message_id: messageId.toString(),
      session_id: sessionId.toString(),
    });

    const updatePayload = messagesUpdateOne.mock.calls[messagesUpdateOne.mock.calls.length - 1]?.[1] as Record<string, unknown>;
    const setPayload = (updatePayload.$set as Record<string, unknown>) || {};
    expect(setPayload.categorization_error).toBe('invalid_api_key');
    expect(setPayload.categorization_retry_reason).toBe('invalid_api_key');
    expect(setPayload.categorization_next_attempt_at).toBeInstanceOf(Date);
    expect(String(setPayload.categorization_error_message || '')).toContain('API key is invalid');
  });

  it('normalizes empty start/end timestamps to 00:00', async () => {
    const messageId = new ObjectId();
    const sessionId = new ObjectId();
    const messagesFindOne = jest.fn(async () => ({
      _id: messageId,
      session_id: sessionId,
      transcription_text: 'Quick update',
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

    createResponseMock.mockResolvedValue({
      output_text: JSON.stringify([
        {
          start: '',
          end: '',
          text: 'Quick update',
          topic_keywords: [],
        },
      ]),
    });

    const result = await handleCategorizeJob({ message_id: messageId.toString() });
    expect(result.ok).toBe(true);

    const updatePayload = messagesUpdateOne.mock.calls[messagesUpdateOne.mock.calls.length - 1]?.[1] as Record<string, unknown>;
    const setPayload = (updatePayload.$set as Record<string, unknown>) || {};
    const categorization = (setPayload.categorization as Array<Record<string, unknown>>) || [];

    expect(categorization).toHaveLength(1);
    expect(categorization[0]?.start).toBe('00:00');
    expect(categorization[0]?.end).toBe('00:00');
  });

  it('produces equivalent normalized categorization for voice and ready_text sources with same content', async () => {
    const sessionId = new ObjectId();
    const voiceMessageId = new ObjectId();
    const textMessageId = new ObjectId();
    const sharedText = 'Discussed pricing reset and outreach pipeline.';

    const messagesStore = new Map<string, Record<string, unknown>>([
      [voiceMessageId.toHexString(), {
        _id: voiceMessageId,
        session_id: sessionId,
        transcription_text: sharedText,
        transcription_method: 'direct',
        transcription: {
          provider: 'openai',
          model: 'gpt-4o-transcribe',
          text: sharedText,
        },
        categorization_attempts: 0,
        speaker: 'Alex',
      }],
      [textMessageId.toHexString(), {
        _id: textMessageId,
        session_id: sessionId,
        transcription_text: sharedText,
        transcription_method: 'ready_text',
        transcription: {
          provider: 'legacy',
          model: 'ready_text',
          text: sharedText,
        },
        categorization_attempts: 0,
        speaker: 'Alex',
      }],
    ]);

    const updatesByMessageId = new Map<string, Record<string, unknown>>();
    const messagesFindOne = jest.fn(async (query: Record<string, unknown>) => {
      const key = String((query?._id as ObjectId | undefined)?.toHexString?.() || '');
      return messagesStore.get(key) || null;
    });
    const messagesUpdateOne = jest.fn(async (query: Record<string, unknown>, update: Record<string, unknown>) => {
      const key = String((query?._id as ObjectId | undefined)?.toHexString?.() || '');
      updatesByMessageId.set(key, update);
      return { matchedCount: 1, modifiedCount: 1 };
    });
    const sessionsFindOne = jest.fn(async () => ({ _id: sessionId }));
    const eventsQueueAdd = jest.fn(async () => ({ id: 'events-job-parity' }));

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
          topic_keywords: ['pricing', 'pipeline'],
          keywords_grouped: { sales: ['pricing', 'pipeline'] },
          mentioned_roles: ['PM'],
          referenced_systems: ['CRM'],
          certainty_level: 'high',
          start: '0',
          end: '30',
          text: 'Discussed pricing reset and outreach pipeline.',
          related_goal: 'Align commercial plan',
        },
      ]),
    });

    const voiceResult = await handleCategorizeJob({ message_id: voiceMessageId.toHexString() });
    const textResult = await handleCategorizeJob({ message_id: textMessageId.toHexString() });

    expect(voiceResult.ok).toBe(true);
    expect(textResult.ok).toBe(true);

    const voiceUpdate = updatesByMessageId.get(voiceMessageId.toHexString()) || {};
    const textUpdate = updatesByMessageId.get(textMessageId.toHexString()) || {};
    const voiceSetPayload = (voiceUpdate.$set as Record<string, unknown>) || {};
    const textSetPayload = (textUpdate.$set as Record<string, unknown>) || {};

    const pickCategorizationFields = (entry: Record<string, unknown>) => ({
      topic_keywords: entry.topic_keywords,
      keywords_grouped: entry.keywords_grouped,
      mentioned_roles: entry.mentioned_roles,
      referenced_systems: entry.referenced_systems,
      certainty_level: entry.certainty_level,
      start: entry.start,
      end: entry.end,
      text: entry.text,
      related_goal: entry.related_goal,
      speaker: entry.speaker,
    });

    const voiceCategorization = ((voiceSetPayload.categorization as Array<Record<string, unknown>>) || [])
      .map(pickCategorizationFields);
    const textCategorization = ((textSetPayload.categorization as Array<Record<string, unknown>>) || [])
      .map(pickCategorizationFields);

    expect(voiceCategorization).toEqual(textCategorization);
    expect(eventsQueueAdd).toHaveBeenCalledWith(
      VOICEBOT_JOBS.events.SEND_TO_SOCKET,
      expect.objectContaining({
        session_id: sessionId.toHexString(),
        event: 'message_update',
      })
    );
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
