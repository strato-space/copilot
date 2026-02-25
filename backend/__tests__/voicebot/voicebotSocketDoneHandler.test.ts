import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ObjectId } from 'mongodb';
import jwt from 'jsonwebtoken';

import { VOICEBOT_COLLECTIONS, VOICEBOT_QUEUES } from '../../src/constants.js';

const getDbMock = jest.fn();
const getUserPermissionsMock = jest.fn();
const computeSessionAccessMock = jest.fn();
const buildDoneNotifyPreviewMock = jest.fn();
const writeDoneNotifyRequestedLogMock = jest.fn();
const clearActiveVoiceSessionBySessionIdMock = jest.fn();
const clearActiveVoiceSessionForUserMock = jest.fn();

jest.unstable_mockModule('../../src/services/db.js', () => ({
  getDb: getDbMock,
}));

jest.unstable_mockModule('../../src/permissions/permission-manager.js', () => ({
  PermissionManager: {
    getUserPermissions: getUserPermissionsMock,
  },
}));

jest.unstable_mockModule('../../src/services/session-socket-auth.js', () => ({
  computeSessionAccess: computeSessionAccessMock,
}));

jest.unstable_mockModule('../../src/services/voicebotDoneNotify.js', () => ({
  buildDoneNotifyPreview: buildDoneNotifyPreviewMock,
  writeDoneNotifyRequestedLog: writeDoneNotifyRequestedLogMock,
}));

jest.unstable_mockModule('../../src/voicebot_tgbot/activeSessionMapping.js', () => ({
  clearActiveVoiceSessionBySessionId: clearActiveVoiceSessionBySessionIdMock,
  clearActiveVoiceSessionForUser: clearActiveVoiceSessionForUserMock,
}));

const { registerVoicebotSocketHandlers } = await import('../../src/api/socket/voicebot.js');

type SocketHandler = (...args: Array<any>) => any;

type FakeSocket = {
  id: string;
  handshake: { auth: { token: string } };
  user?: { userId: string };
  on: jest.Mock;
  join: jest.Mock;
  leave: jest.Mock;
  emit: jest.Mock;
  disconnect: jest.Mock;
};

const setupSocketServer = () => {
  let connectionHandler: SocketHandler | null = null;
  const namespace = {
    on: jest.fn((event: string, handler: SocketHandler) => {
      if (event === 'connection') connectionHandler = handler;
    }),
    sockets: new Map<string, FakeSocket>(),
  };

  const io = {
    of: jest.fn(() => namespace),
  };

  return {
    io,
    namespace,
    getConnectionHandler: () => {
      if (!connectionHandler) throw new Error('Connection handler was not registered');
      return connectionHandler;
    },
  };
};

const createSocket = ({ userId }: { userId: string }): { socket: FakeSocket; handlers: Record<string, SocketHandler> } => {
  const secret = process.env.APP_ENCRYPTION_KEY || 'test-secret';
  const token = jwt.sign({ userId }, secret, { expiresIn: '1h' });
  const handlers: Record<string, SocketHandler> = {};

  const socket: FakeSocket = {
    id: 'socket-1',
    handshake: { auth: { token } },
    on: jest.fn((event: string, handler: SocketHandler) => {
      handlers[event] = handler;
    }),
    join: jest.fn(),
    leave: jest.fn(),
    emit: jest.fn(),
    disconnect: jest.fn(),
  };

  return { socket, handlers };
};

describe('voicebot socket session_done contract', () => {
  beforeEach(() => {
    process.env.APP_ENCRYPTION_KEY = 'test-secret';

    getDbMock.mockReset();
    getUserPermissionsMock.mockReset();
    computeSessionAccessMock.mockReset();
    buildDoneNotifyPreviewMock.mockReset();
    writeDoneNotifyRequestedLogMock.mockReset();
    clearActiveVoiceSessionBySessionIdMock.mockReset();
    clearActiveVoiceSessionForUserMock.mockReset();

    buildDoneNotifyPreviewMock.mockResolvedValue({
      event_name: 'Сессия завершена',
      url: 'https://voice.stratospace.fun/session/test',
      session_name: 'Session',
      project_name: 'Project',
    });
    writeDoneNotifyRequestedLogMock.mockResolvedValue(undefined);
    clearActiveVoiceSessionBySessionIdMock.mockResolvedValue(undefined);
    clearActiveVoiceSessionForUserMock.mockResolvedValue(undefined);

    getUserPermissionsMock.mockResolvedValue(['voicebot:sessions:update']);
  });

  it('returns forbidden ack when access check fails', async () => {
    const performerId = new ObjectId();
    const sessionId = new ObjectId();

    const dbStub = {
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.PERFORMERS) {
          return { findOne: jest.fn(async () => ({ _id: performerId, telegram_id: '123456' })) };
        }
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return { findOne: jest.fn(async () => ({ _id: sessionId, chat_id: 123456 })) };
        }
        return { findOne: jest.fn(async () => null), updateOne: jest.fn(async () => ({ matchedCount: 1 })) };
      },
    };
    getDbMock.mockReturnValue(dbStub);
    computeSessionAccessMock.mockReturnValue({ hasAccess: false, canUpdateSession: false });

    const { io, namespace, getConnectionHandler } = setupSocketServer();
    registerVoicebotSocketHandlers(io as any);

    const { socket, handlers } = createSocket({ userId: performerId.toString() });
    namespace.sockets.set(socket.id, socket);
    await getConnectionHandler()(socket as any);

    const ack = jest.fn();
    await handlers.session_done({ session_id: sessionId.toString() }, ack);

    expect(ack).toHaveBeenCalledWith({ ok: false, error: 'forbidden' });
    expect(clearActiveVoiceSessionBySessionIdMock).not.toHaveBeenCalled();
    expect(writeDoneNotifyRequestedLogMock).not.toHaveBeenCalled();
  });

  it('uses server-side performer identity and returns ok ack on fallback done', async () => {
    const performerId = new ObjectId();
    const sessionId = new ObjectId();
    const sessionsUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));

    const dbStub = {
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.PERFORMERS) {
          return { findOne: jest.fn(async () => ({ _id: performerId, telegram_id: '999777' })) };
        }
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return {
            findOne: jest.fn(async () => ({
              _id: sessionId,
              chat_id: 999777,
              session_name: 'Socket contract session',
              project_id: new ObjectId(),
            })),
            updateOne: sessionsUpdateOne,
          };
        }
        return {
          findOne: jest.fn(async () => null),
          updateOne: jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 })),
        };
      },
    };
    getDbMock.mockReturnValue(dbStub);
    computeSessionAccessMock.mockReturnValue({ hasAccess: true, canUpdateSession: true });

    const { io, namespace, getConnectionHandler } = setupSocketServer();
    registerVoicebotSocketHandlers(io as any);

    const { socket, handlers } = createSocket({ userId: performerId.toString() });
    namespace.sockets.set(socket.id, socket);
    await getConnectionHandler()(socket as any);

    const ack = jest.fn();
    await handlers.session_done(
      {
        session_id: sessionId.toString(),
        telegram_user_id: 'malicious-payload-user',
      },
      ack
    );

    expect(ack).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: true,
        notify_preview: expect.objectContaining({ event_name: 'Сессия завершена' }),
      })
    );

    expect(sessionsUpdateOne).toHaveBeenCalled();
    expect(clearActiveVoiceSessionBySessionIdMock).toHaveBeenCalledWith(
      expect.objectContaining({ session_id: sessionId.toString() })
    );
    expect(clearActiveVoiceSessionForUserMock).toHaveBeenCalledWith(
      expect.objectContaining({ telegram_user_id: '999777' })
    );
    expect(writeDoneNotifyRequestedLogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        source: expect.objectContaining({ mode: 'fallback', event: 'session_done' }),
      })
    );
  });

  it('closes session immediately and queues DONE_MULTIPROMPT with already_closed=true', async () => {
    const performerId = new ObjectId();
    const sessionId = new ObjectId();
    const sessionsUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
    const commonQueue = { add: jest.fn(async () => ({})) };

    const dbStub = {
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.PERFORMERS) {
          return { findOne: jest.fn(async () => ({ _id: performerId, telegram_id: '4242' })) };
        }
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return {
            findOne: jest.fn(async () => ({
              _id: sessionId,
              chat_id: 4242,
              session_name: 'Queued done',
              project_id: new ObjectId(),
            })),
            updateOne: sessionsUpdateOne,
          };
        }
        return {
          findOne: jest.fn(async () => null),
          updateOne: jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 })),
        };
      },
    };
    getDbMock.mockReturnValue(dbStub);
    computeSessionAccessMock.mockReturnValue({ hasAccess: true, canUpdateSession: true });

    const { io, namespace, getConnectionHandler } = setupSocketServer();
    registerVoicebotSocketHandlers(io as any, {
      queues: {
        [VOICEBOT_QUEUES.COMMON]: commonQueue as any,
      },
    });

    const { socket, handlers } = createSocket({ userId: performerId.toString() });
    namespace.sockets.set(socket.id, socket);
    await getConnectionHandler()(socket as any);

    const subscribeAck = jest.fn();
    await handlers.subscribe_on_session({ session_id: sessionId.toString() }, subscribeAck);
    expect(subscribeAck).toHaveBeenCalledWith({ ok: true });

    const ack = jest.fn();
    await handlers.session_done({ session_id: sessionId.toString() }, ack);

    expect(ack).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: true,
      })
    );
    expect(sessionsUpdateOne).toHaveBeenCalledTimes(1);
    expect(commonQueue.add).toHaveBeenCalledWith(
      'DONE_MULTIPROMPT',
      expect.objectContaining({
        session_id: sessionId.toString(),
        telegram_user_id: '4242',
        already_closed: true,
      })
    );
    expect(commonQueue.add).toHaveBeenCalledWith(
      'PROCESSING',
      expect.objectContaining({
        session_id: sessionId.toString(),
        reason: 'session_done',
        limit: 1,
      }),
      expect.objectContaining({
        deduplication: {
          id: `${sessionId.toString()}-PROCESSING-KICK`,
        },
      })
    );
    expect(socket.emit).toHaveBeenCalledWith(
      'session_update',
      expect.objectContaining({
        _id: sessionId.toString(),
        is_active: false,
        to_finalize: true,
      })
    );
    expect(writeDoneNotifyRequestedLogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        source: expect.objectContaining({ mode: 'queued', event: 'session_done' }),
      })
    );
  });
});
