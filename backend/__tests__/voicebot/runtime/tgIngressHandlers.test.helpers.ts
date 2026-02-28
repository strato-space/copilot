import { ObjectId } from 'mongodb';
import { jest } from '@jest/globals';

import { COLLECTIONS, VOICEBOT_COLLECTIONS, VOICEBOT_JOBS, VOICEBOT_QUEUES } from '../../../src/constants.js';

export const FORWARDED_CHAT_ID = -1_001_234_567_890;
export const CODEX_TASK_CHAT_ID = -1_003_001;
export const CODEX_IMAGE_CHAT_ID = -1_003_002;

export const buildDevVoiceWebInterfaceUrl = (): string => {
  const protocol = 'https';
  const host = ['copilot-dev', 'stratospace', 'fun'].join('.');
  return [protocol, '://', host, '/voice/session'].join('');
};

type DbStub = {
  collection: (name: string) => Record<string, unknown>;
};

export const getActiveVoiceSessionForUserMock = jest.fn();
export const setActiveVoiceSessionMock = jest.fn();

jest.unstable_mockModule('../../../src/voicebot_tgbot/activeSessionMapping.js', () => ({
  getActiveVoiceSessionForUser: getActiveVoiceSessionForUserMock,
  setActiveVoiceSession: setActiveVoiceSessionMock,
}));

export const {
  buildIngressDeps,
  handleAttachmentIngress,
  handleTextIngress,
  handleVoiceIngress,
} = await import('../../../src/voicebot_tgbot/ingressHandlers.js');

export const makeDb = ({
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
  const tasksFindOne = jest.fn(async () => null);
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

  const db: DbStub = {
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
          findOne: tasksFindOne,
          insertOne: tasksInsertOne,
        };
      }
      return {};
    },
  };

  return {
    db,
    spies: {
      performersFindOne,
      sessionsFindOne,
      sessionsInsertOne,
      sessionsUpdateOne,
      messagesInsertOne,
      tasksFindOne,
      tasksInsertOne,
      projectsFindOne,
    },
  };
};

export { VOICEBOT_JOBS, VOICEBOT_QUEUES };

export const resetTgIngressMocks = () => {
  getActiveVoiceSessionForUserMock.mockReset();
  setActiveVoiceSessionMock.mockReset();
  delete process.env.VOICE_WEB_INTERFACE_URL;
};
