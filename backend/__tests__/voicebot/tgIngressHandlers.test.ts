import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ObjectId } from 'mongodb';

import { VOICEBOT_COLLECTIONS, VOICEBOT_JOBS, VOICEBOT_QUEUES } from '../../src/constants.js';

const getActiveVoiceSessionForUserMock = jest.fn();
const setActiveVoiceSessionMock = jest.fn();

jest.unstable_mockModule('../../src/voicebot_tgbot/activeSessionMapping.js', () => ({
  getActiveVoiceSessionForUser: getActiveVoiceSessionForUserMock,
  setActiveVoiceSession: setActiveVoiceSessionMock,
}));

const {
  buildIngressDeps,
  handleAttachmentIngress,
  handleTextIngress,
  handleVoiceIngress,
} = await import('../../src/voicebot_tgbot/ingressHandlers.js');

const makeDb = ({
  performer,
  activeSession,
  explicitSession,
  createdSessionId,
}: {
  performer?: Record<string, unknown> | null;
  activeSession?: Record<string, unknown> | null;
  explicitSession?: Record<string, unknown> | null;
  createdSessionId?: ObjectId;
}) => {
  const messagesInsertOne = jest.fn(async () => ({ insertedId: new ObjectId() }));
  const sessionsInsertOne = jest.fn(async () => ({ insertedId: createdSessionId || new ObjectId() }));
  const sessionsUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));

  const sessionsFindOne = jest.fn(async (query: Record<string, unknown>) => {
    const queryAnd = Array.isArray(query?.$and) ? (query.$and as Record<string, unknown>[]) : [];
    const firstClause = (queryAnd[0] || query) as Record<string, unknown>;
    const id = firstClause?._id as ObjectId | undefined;
    if (!id) return null;

    if (explicitSession && String(explicitSession._id) === id.toHexString()) {
      return explicitSession;
    }
    if (activeSession && String(activeSession._id) === id.toHexString()) {
      return activeSession;
    }
    return null;
  });

  const performersFindOne = jest.fn(async () => performer || null);

  const db = {
    collection: (name: string) => {
      if (name === VOICEBOT_COLLECTIONS.PERFORMERS) {
        return {
          findOne: performersFindOne,
        };
      }
      if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
        return {
          findOne: sessionsFindOne,
          insertOne: sessionsInsertOne,
          updateOne: sessionsUpdateOne,
        };
      }
      if (name === VOICEBOT_COLLECTIONS.MESSAGES) {
        return {
          insertOne: messagesInsertOne,
        };
      }
      return {};
    },
  } as any;

  return {
    db,
    spies: {
      performersFindOne,
      sessionsFindOne,
      sessionsInsertOne,
      sessionsUpdateOne,
      messagesInsertOne,
    },
  };
};

describe('voicebot tgbot ingress handlers', () => {
  beforeEach(() => {
    getActiveVoiceSessionForUserMock.mockReset();
    setActiveVoiceSessionMock.mockReset();
  });

  it('routes text ingress into existing active session', async () => {
    const performerId = new ObjectId();
    const sessionId = new ObjectId();

    getActiveVoiceSessionForUserMock.mockResolvedValue({
      active_session_id: sessionId,
    });

    const { db, spies } = makeDb({
      performer: { _id: performerId, telegram_id: '1001' },
      activeSession: {
        _id: sessionId,
        session_type: 'multiprompt_voice_session',
        is_active: true,
      },
    });

    const result = await handleTextIngress({
      deps: buildIngressDeps({ db }),
      input: {
        telegram_user_id: 1001,
        chat_id: 1001,
        username: 'tester',
        message_id: 55,
        message_timestamp: 1770500000,
        text: 'hello from tg',
      },
    });

    expect(result.ok).toBe(true);
    expect(result.created_session).toBe(false);
    expect(spies.sessionsInsertOne).not.toHaveBeenCalled();
    expect(spies.messagesInsertOne).toHaveBeenCalledTimes(1);

    const inserted = spies.messagesInsertOne.mock.calls[0]?.[0] as Record<string, unknown>;
    expect((inserted.session_id as ObjectId).toHexString()).toBe(sessionId.toHexString());
    expect(inserted.is_transcribed).toBe(true);
    expect(setActiveVoiceSessionMock).not.toHaveBeenCalled();
  });

  it('creates and activates session for voice ingress when mapping is missing', async () => {
    const performerId = new ObjectId();
    const createdSessionId = new ObjectId();
    const voiceQueueAdd = jest.fn(async () => ({ id: 'voice-job-1' }));

    getActiveVoiceSessionForUserMock.mockResolvedValue(null);

    const { db, spies } = makeDb({
      performer: { _id: performerId, telegram_id: '1002' },
      createdSessionId,
    });

    const result = await handleVoiceIngress({
      deps: buildIngressDeps({
        db,
        queues: {
          [VOICEBOT_QUEUES.VOICE]: {
            add: voiceQueueAdd,
          },
        },
      }),
      input: {
        telegram_user_id: 1002,
        chat_id: 1002,
        username: 'voice-user',
        message_id: 77,
        message_timestamp: 1770500100,
        file_id: 'voice-file-1',
        duration: 12,
      },
    });

    expect(result.ok).toBe(true);
    expect(result.created_session).toBe(true);
    expect(spies.sessionsInsertOne).toHaveBeenCalledTimes(1);
    expect(setActiveVoiceSessionMock).toHaveBeenCalledTimes(1);
    expect(voiceQueueAdd).toHaveBeenCalledWith(
      VOICEBOT_JOBS.voice.TRANSCRIBE,
      expect.objectContaining({
        session_id: createdSessionId.toHexString(),
      }),
      expect.objectContaining({ deduplication: expect.any(Object) })
    );
  });

  it('uses explicit session reference for attachment ingress and updates active mapping', async () => {
    const performerId = new ObjectId();
    const explicitSessionId = new ObjectId();

    getActiveVoiceSessionForUserMock.mockResolvedValue(null);

    const { db, spies } = makeDb({
      performer: { _id: performerId, telegram_id: '1003' },
      explicitSession: {
        _id: explicitSessionId,
        session_type: 'multiprompt_voice_session',
        user_id: performerId,
      },
    });

    const result = await handleAttachmentIngress({
      deps: buildIngressDeps({ db }),
      input: {
        telegram_user_id: 1003,
        chat_id: 1003,
        username: 'att-user',
        message_id: 88,
        message_timestamp: 1770500200,
        text: `please attach to /session/${explicitSessionId.toHexString()}`,
        message_type: 'document',
        attachments: [
          {
            kind: 'file',
            source: 'telegram',
            file_id: 'doc-file-1',
            file_unique_id: 'uniq-1',
            name: 'spec.pdf',
            mimeType: 'application/pdf',
            size: 1024,
          },
        ],
      },
    });

    expect(result.ok).toBe(true);
    expect(result.created_session).toBe(false);
    expect(spies.sessionsInsertOne).not.toHaveBeenCalled();
    expect(spies.messagesInsertOne).toHaveBeenCalledTimes(1);

    const inserted = spies.messagesInsertOne.mock.calls[0]?.[0] as Record<string, unknown>;
    expect((inserted.session_id as ObjectId).toHexString()).toBe(explicitSessionId.toHexString());
    expect(Array.isArray(inserted.attachments)).toBe(true);
    expect(setActiveVoiceSessionMock).toHaveBeenCalledTimes(1);
  });

  it('resolves explicit session from reply_text reference for text ingress', async () => {
    const performerId = new ObjectId();
    const explicitSessionId = new ObjectId();

    getActiveVoiceSessionForUserMock.mockResolvedValue(null);

    const { db, spies } = makeDb({
      performer: { _id: performerId, telegram_id: '1004' },
      explicitSession: {
        _id: explicitSessionId,
        session_type: 'multiprompt_voice_session',
        user_id: performerId,
      },
    });

    const result = await handleTextIngress({
      deps: buildIngressDeps({ db }),
      input: {
        telegram_user_id: 1004,
        chat_id: 1004,
        username: 'reply-user',
        message_id: 99,
        message_timestamp: 1770500300,
        text: 'follow up answer',
        reply_text: `context: /session/${explicitSessionId.toHexString()}`,
      },
    });

    expect(result.ok).toBe(true);
    expect(result.created_session).toBe(false);
    expect(spies.sessionsInsertOne).not.toHaveBeenCalled();

    const inserted = spies.messagesInsertOne.mock.calls[0]?.[0] as Record<string, unknown>;
    expect((inserted.session_id as ObjectId).toHexString()).toBe(explicitSessionId.toHexString());
    expect(setActiveVoiceSessionMock).toHaveBeenCalledTimes(1);
  });

  it('stores forwarded_context for forwarded text ingress', async () => {
    const performerId = new ObjectId();
    const sessionId = new ObjectId();

    getActiveVoiceSessionForUserMock.mockResolvedValue({
      active_session_id: sessionId,
    });

    const { db, spies } = makeDb({
      performer: { _id: performerId, telegram_id: '1005' },
      activeSession: {
        _id: sessionId,
        session_type: 'multiprompt_voice_session',
        is_active: true,
      },
    });

    const forwardedContext = {
      forward_origin: {
        type: 'channel',
        chat: { id: -1001234567890, title: 'Forward Source' },
      },
      forward_from_message_id: 741,
    };

    const result = await handleTextIngress({
      deps: buildIngressDeps({ db }),
      input: {
        telegram_user_id: 1005,
        chat_id: 1005,
        username: 'forward-user',
        message_id: 101,
        message_timestamp: 1770500400,
        text: 'forwarded block text',
        forwarded_context: forwardedContext,
      },
    });

    expect(result.ok).toBe(true);
    const inserted = spies.messagesInsertOne.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(inserted.forwarded_context).toEqual(forwardedContext);
  });
});
