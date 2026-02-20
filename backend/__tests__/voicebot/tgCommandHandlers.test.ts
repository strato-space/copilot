import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ObjectId } from 'mongodb';
import { VOICEBOT_COLLECTIONS, VOICEBOT_JOBS } from '../../src/constants.js';
import {
  NO_ACTIVE_SESSION_MESSAGE,
  getHelpMessage,
  handleDoneCommand,
  handleLoginCommand,
  handleSessionCommand,
  handleStartCommand,
} from '../../src/voicebot_tgbot/commandHandlers.js';

type MockCollection = {
  findOne?: jest.Mock;
  insertOne?: jest.Mock;
  updateOne?: jest.Mock;
  updateMany?: jest.Mock;
};

const createMockDb = (collections: Record<string, MockCollection>) =>
  ({
    collection: (name: string) => collections[name] || {},
  }) as any;

describe('voicebot_tgbot command handlers', () => {
  const telegramUserId = 3045664;
  const performerId = new ObjectId('6994ae109d4d36a850c87899');

  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it('issues one-time /login link independent from active session', async () => {
    const insertOne = jest.fn(async () => ({ insertedId: new ObjectId() }));
    const db = createMockDb({
      [VOICEBOT_COLLECTIONS.ONE_USE_TOKENS]: { insertOne },
    });

    const result = await handleLoginCommand({
      db,
      telegram_user_id: telegramUserId,
    });

    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/^https:\/\/voice\.stratospace\.fun\/tg_auth\?token=[a-f0-9]{64}$/);
    expect(insertOne).toHaveBeenCalledTimes(1);
    const [payload] = insertOne.mock.calls[0] as [Record<string, unknown>];
    expect(payload).toMatchObject({
      chat_id: String(telegramUserId),
      is_used: false,
    });
    expect(payload.token).toMatch(/^[a-f0-9]{64}$/);
    expect(payload.runtime_tag).toBeDefined();
  });

  it('creates session on /start, activates it and enqueues START_MULTIPROMPT', async () => {
    const sessionId = new ObjectId();
    const performersFindOne = jest.fn(async () => ({
      _id: performerId,
      telegram_id: String(telegramUserId),
    }));
    const sessionsInsertOne = jest.fn(async () => ({ insertedId: sessionId }));
    const projectsFindOne = jest.fn(async () => null);
    const tgMappingUpdateOne = jest.fn(async () => ({ matchedCount: 1 }));
    const commonQueue = {
      add: jest.fn(async () => ({})),
    };
    const db = createMockDb({
      [VOICEBOT_COLLECTIONS.PERFORMERS]: { findOne: performersFindOne },
      [VOICEBOT_COLLECTIONS.SESSIONS]: { insertOne: sessionsInsertOne },
      [VOICEBOT_COLLECTIONS.PROJECTS]: { findOne: projectsFindOne },
      [VOICEBOT_COLLECTIONS.TG_VOICE_SESSIONS]: { updateOne: tgMappingUpdateOne },
    });

    const result = await handleStartCommand({
      db,
      context: {
        telegram_user_id: telegramUserId,
        chat_id: telegramUserId,
        username: 'tonybit',
      },
      commonQueue,
    });

    expect(result.ok).toBe(true);
    expect(result.session_id).toBe(String(sessionId));
    expect(result.message.split('\n')).toHaveLength(4);
    expect(result.message.split('\n')[0]).toBe('Сессия создана');
    expect(commonQueue.add).toHaveBeenCalledWith(
      VOICEBOT_JOBS.common.START_MULTIPROMPT,
      expect.objectContaining({ _id: String(sessionId) }),
      expect.any(Object)
    );
  });

  it('/session with explicit id activates accessible session', async () => {
    const sessionId = new ObjectId('6994ae109d4d36a850c87809');
    const performersFindOne = jest.fn(async () => ({
      _id: performerId,
      telegram_id: String(telegramUserId),
    }));
    const sessionsFindOne = jest.fn(async () => ({
      _id: sessionId,
      user_id: performerId,
      is_deleted: false,
      is_active: true,
    }));
    const tgMappingUpdateOne = jest.fn(async () => ({ matchedCount: 1 }));
    const projectsFindOne = jest.fn(async () => null);

    const db = createMockDb({
      [VOICEBOT_COLLECTIONS.PERFORMERS]: { findOne: performersFindOne },
      [VOICEBOT_COLLECTIONS.SESSIONS]: { findOne: sessionsFindOne },
      [VOICEBOT_COLLECTIONS.TG_VOICE_SESSIONS]: { updateOne: tgMappingUpdateOne },
      [VOICEBOT_COLLECTIONS.PROJECTS]: { findOne: projectsFindOne },
    });

    const result = await handleSessionCommand({
      db,
      context: {
        telegram_user_id: telegramUserId,
        chat_id: telegramUserId,
        text: `/session ${String(sessionId)}`,
      },
    });

    expect(result.ok).toBe(true);
    expect(result.session_id).toBe(String(sessionId));
    expect(result.message.split('\n')[0]).toBe('Сессия активирована');
  });

  it('/session without mapping returns no-active message', async () => {
    const performersFindOne = jest.fn(async () => ({
      _id: performerId,
      telegram_id: String(telegramUserId),
    }));
    const tgMappingFindOne = jest.fn(async () => null);
    const db = createMockDb({
      [VOICEBOT_COLLECTIONS.PERFORMERS]: { findOne: performersFindOne },
      [VOICEBOT_COLLECTIONS.TG_VOICE_SESSIONS]: { findOne: tgMappingFindOne },
    });

    const result = await handleSessionCommand({
      db,
      context: {
        telegram_user_id: telegramUserId,
        chat_id: telegramUserId,
        text: '/session',
      },
    });

    expect(result.ok).toBe(false);
    expect(result.message).toBe(NO_ACTIVE_SESSION_MESSAGE);
  });

  it('/session does not fallback to arbitrary open sessions when mapping is absent', async () => {
    const performersFindOne = jest.fn(async () => ({
      _id: performerId,
      telegram_id: String(telegramUserId),
    }));
    const tgMappingFindOne = jest.fn(async () => null);
    const sessionsFindOne = jest.fn(async () => ({
      _id: new ObjectId(),
      session_name: 'Should not be used',
      is_active: true,
    }));

    const db = createMockDb({
      [VOICEBOT_COLLECTIONS.PERFORMERS]: { findOne: performersFindOne },
      [VOICEBOT_COLLECTIONS.TG_VOICE_SESSIONS]: { findOne: tgMappingFindOne },
      [VOICEBOT_COLLECTIONS.SESSIONS]: { findOne: sessionsFindOne },
    });

    const result = await handleSessionCommand({
      db,
      context: {
        telegram_user_id: telegramUserId,
        chat_id: telegramUserId,
        text: '/session',
      },
    });

    expect(result.ok).toBe(false);
    expect(result.message).toBe(NO_ACTIVE_SESSION_MESSAGE);
    expect(sessionsFindOne).not.toHaveBeenCalled();
  });

  it('/done closes active session, queues DONE_MULTIPROMPT and clears mapping', async () => {
    const sessionId = new ObjectId('6994ae109d4d36a850c87809');
    const tgMappingFindOne = jest.fn(async () => ({ active_session_id: sessionId }));
    const tgMappingUpdateMany = jest.fn(async () => ({ matchedCount: 1 }));
    const sessionsUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
    const sessionsFindOne = jest.fn(async () => ({
      _id: sessionId,
      session_name: 'Test',
      is_active: true,
    }));
    const projectsFindOne = jest.fn(async () => null);
    const commonQueue = {
      add: jest.fn(async () => ({})),
    };

    const db = createMockDb({
      [VOICEBOT_COLLECTIONS.TG_VOICE_SESSIONS]: {
        findOne: tgMappingFindOne,
        updateMany: tgMappingUpdateMany,
      },
      [VOICEBOT_COLLECTIONS.SESSIONS]: { findOne: sessionsFindOne, updateOne: sessionsUpdateOne },
      [VOICEBOT_COLLECTIONS.PROJECTS]: { findOne: projectsFindOne },
    });

    const result = await handleDoneCommand({
      db,
      context: {
        telegram_user_id: telegramUserId,
        chat_id: telegramUserId,
      },
      commonQueue,
    });

    expect(result.ok).toBe(true);
    expect(result.session_id).toBe(String(sessionId));
    expect(result.message.split('\n')[0]).toBe('Сессия завершена');
    expect(commonQueue.add).toHaveBeenCalledWith(
      VOICEBOT_JOBS.common.DONE_MULTIPROMPT,
      expect.objectContaining({
        session_id: String(sessionId),
        telegram_user_id: String(telegramUserId),
        already_closed: true,
      }),
      expect.any(Object)
    );
    expect(sessionsUpdateOne).toHaveBeenCalledTimes(1);
    expect(tgMappingUpdateMany).toHaveBeenCalledTimes(2);
  });

  it('returns help text with /login command', () => {
    const help = getHelpMessage();
    expect(help).toContain('/start');
    expect(help).toContain('/session');
    expect(help).toContain('/done');
    expect(help).toContain('/login');
  });
});
