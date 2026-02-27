import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ObjectId } from 'mongodb';

import { COLLECTIONS, VOICEBOT_COLLECTIONS, VOICEBOT_JOBS, VOICEBOT_QUEUES } from '../../src/constants.js';

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
  codexPerformer,
  activeSession,
  explicitSession,
  codexProject,
  createdSessionId,
}: {
  performer?: Record<string, unknown> | null;
  codexPerformer?: Record<string, unknown> | null;
  activeSession?: Record<string, unknown> | null;
  explicitSession?: Record<string, unknown> | null;
  codexProject?: Record<string, unknown> | null;
  createdSessionId?: ObjectId;
}) => {
  const messagesInsertOne = jest.fn(async () => ({ insertedId: new ObjectId() }));
  const sessionsInsertOne = jest.fn(async () => ({ insertedId: createdSessionId || new ObjectId() }));
  const sessionsUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
  const tasksInsertOne = jest.fn(async () => ({ insertedId: new ObjectId() }));

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

  const performersFindOne = jest.fn(async (query: Record<string, unknown>) => {
    if (query && Object.prototype.hasOwnProperty.call(query, 'telegram_id')) {
      return performer || null;
    }
    if (query && Object.prototype.hasOwnProperty.call(query, '$or')) {
      return codexPerformer || null;
    }
    return performer || null;
  });
  const projectsFindOne = jest.fn(async (query: Record<string, unknown>) => {
    const queryAnd = Array.isArray(query?.$and) ? (query.$and as Record<string, unknown>[]) : [];
    const firstClause = (queryAnd[0] || query) as Record<string, unknown>;
    const projectId = firstClause?._id as ObjectId | undefined;

    if (projectId && codexProject && String(codexProject._id) === projectId.toHexString()) {
      return codexProject;
    }
    if (firstClause?.name && codexProject) {
      return codexProject;
    }
    return null;
  });

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
      if (name === VOICEBOT_COLLECTIONS.PROJECTS) {
        return {
          findOne: projectsFindOne,
        };
      }
      if (name === COLLECTIONS.TASKS) {
        return {
          insertOne: tasksInsertOne,
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
      tasksInsertOne,
      projectsFindOne,
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

  it('stores @task payload on session and creates codex task from that payload', async () => {
    const performerId = new ObjectId();
    const codexPerformerId = new ObjectId();
    const projectId = new ObjectId();
    const sessionId = new ObjectId();

    getActiveVoiceSessionForUserMock.mockResolvedValue({
      active_session_id: sessionId,
    });

    const { db, spies } = makeDb({
      performer: { _id: performerId, telegram_id: '2010' },
      codexPerformer: { _id: codexPerformerId, id: 'codex', name: 'Codex', real_name: 'Codex' },
      activeSession: {
        _id: sessionId,
        session_type: 'multiprompt_voice_session',
        project_id: projectId,
        is_active: true,
      },
      codexProject: {
        _id: projectId,
        name: 'Copilot',
        git_repo: 'git@github.com:strato-space/copilot.git',
      },
    });

    const result = await handleTextIngress({
      deps: buildIngressDeps({ db }),
      input: {
        telegram_user_id: 2010,
        chat_id: -1003001,
        username: 'codex-task-user',
        message_id: 120,
        message_timestamp: 1770500500,
        text: '@task Investigate billing mismatch for February',
      },
    });

    expect(result.ok).toBe(true);
    expect(spies.tasksInsertOne).toHaveBeenCalledTimes(1);

    const insertedTask = spies.tasksInsertOne.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(insertedTask.source_kind).toBe('telegram');
    expect(insertedTask.created_by_performer_id).toEqual(performerId);
    expect(insertedTask.external_ref).toBe(`https://copilot.stratospace.fun/voice/session/${sessionId.toHexString()}`);
    expect(insertedTask.description).toContain('Investigate billing mismatch for February');

    const sourceData = insertedTask.source_data as Record<string, unknown>;
    const payload = sourceData.payload as Record<string, unknown>;
    expect(payload.trigger).toBe('@task');
    expect(payload.session_id).toBe(sessionId.toHexString());
    expect(payload.message_db_id).toBe(result.message_id);

    const codexPayloadUpdate = spies.sessionsUpdateOne.mock.calls.find((call) => {
      const update = call[1] as Record<string, unknown> | undefined;
      const push = update?.$push as Record<string, unknown> | undefined;
      return Boolean(push && Object.prototype.hasOwnProperty.call(push, 'processors_data.CODEX_TASKS.data'));
    });
    expect(codexPayloadUpdate).toBeDefined();
  });

  it('auto-creates session with Codex project for @task when active session is missing', async () => {
    const performerId = new ObjectId();
    const codexPerformerId = new ObjectId();
    const createdSessionId = new ObjectId();
    const projectId = new ObjectId();

    getActiveVoiceSessionForUserMock.mockResolvedValue(null);

    const { db, spies } = makeDb({
      performer: { _id: performerId, telegram_id: '3010' },
      codexPerformer: { _id: codexPerformerId, id: 'codex', name: 'Codex', real_name: 'Codex' },
      createdSessionId,
      codexProject: {
        _id: projectId,
        name: 'Codex',
        git_repo: 'git@github.com:strato-space/copilot.git',
      },
    });

    const result = await handleTextIngress({
      deps: buildIngressDeps({ db }),
      input: {
        telegram_user_id: 3010,
        chat_id: 3010,
        username: 'codex-autocreate-user',
        message_id: 150,
        message_timestamp: 1770500600,
        text: '@task Prepare Codex delivery checklist',
      },
    });

    expect(result.ok).toBe(true);
    expect(result.created_session).toBe(true);
    expect(spies.sessionsInsertOne).toHaveBeenCalledTimes(1);
    expect(spies.tasksInsertOne).toHaveBeenCalledTimes(1);
    expect(setActiveVoiceSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        session_id: createdSessionId,
      })
    );

    const insertedSession = spies.sessionsInsertOne.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(insertedSession.project_id).toEqual(projectId);

    const insertedTask = spies.tasksInsertOne.mock.calls[0]?.[0] as Record<string, unknown>;
    const sourceData = insertedTask.source_data as Record<string, unknown>;
    expect(sourceData.session_id).toEqual(createdSessionId);
    expect(insertedTask.external_ref).toBe(`https://copilot.stratospace.fun/voice/session/${createdSessionId.toHexString()}`);
  });
});
