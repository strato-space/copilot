import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ObjectId } from 'mongodb';

import {
  VOICEBOT_COLLECTIONS,
  VOICEBOT_JOBS,
  VOICEBOT_QUEUES,
} from '../../../src/constants.js';

const getDbMock = jest.fn();
const getUserPermissionsMock = jest.fn();
const computeSessionAccessMock = jest.fn();
const getVoicebotQueuesMock = jest.fn();
const jwtVerifyMock = jest.fn();

jest.unstable_mockModule('../../../src/services/db.js', () => ({
  getDb: getDbMock,
}));

jest.unstable_mockModule('../../../src/permissions/permission-manager.js', () => ({
  PermissionManager: {
    getUserPermissions: getUserPermissionsMock,
  },
}));

jest.unstable_mockModule('../../../src/services/voicebot/session-socket-auth.js', () => ({
  computeSessionAccess: computeSessionAccessMock,
}));

jest.unstable_mockModule('../../../src/services/voicebotQueues.js', () => ({
  getVoicebotQueues: getVoicebotQueuesMock,
}));

jest.unstable_mockModule('jsonwebtoken', () => ({
  default: {
    verify: jwtVerifyMock,
  },
}));

const { registerVoicebotSocketHandlers } = await import('../../../src/api/socket/voicebot.js');

type DbFixture = {
  performer?: Record<string, unknown> | null;
  session?: Record<string, unknown> | null;
};

const createDbFixture = ({ performer = null, session = null }: DbFixture) => {
  const performersFindOne = jest.fn(async () => performer);
  const sessionsFindOne = jest.fn(async () => session);

  return {
    db: {
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.PERFORMERS) return { findOne: performersFindOne };
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) return { findOne: sessionsFindOne };
        return { findOne: jest.fn(async () => null) };
      },
    },
  };
};

const setupSocketHarness = () => {
  const connectionHandlers: Array<(socket: any) => void | Promise<void>> = [];
  const namespace = {
    on: jest.fn((event: string, handler: (socket: any) => void | Promise<void>) => {
      if (event === 'connection') connectionHandlers.push(handler);
    }),
    sockets: new Map<string, { emit: jest.Mock }>(),
  };
  const io = {
    of: jest.fn(() => namespace),
  } as any;

  registerVoicebotSocketHandlers(io);

  const socketHandlers = new Map<string, (...args: any[]) => unknown>();
  const socket = {
    id: 'socket-1',
    user: { userId: new ObjectId().toString() },
    handshake: {
      auth: {
        token: 'test-token',
      },
    },
    on: jest.fn((event: string, handler: (...args: any[]) => unknown) => {
      socketHandlers.set(event, handler);
    }),
    join: jest.fn(),
    leave: jest.fn(),
    emit: jest.fn(),
    disconnect: jest.fn(),
  };

  return {
    namespace,
    socket,
    socketHandlers,
    connect: async () => {
      const handler = connectionHandlers[0];
      if (!handler) throw new Error('missing connection handler');
      await handler(socket);
    },
  };
};

describe('voicebot socket create_tasks_from_chunks', () => {
  beforeEach(() => {
    getDbMock.mockReset();
    getUserPermissionsMock.mockReset();
    computeSessionAccessMock.mockReset();
    getVoicebotQueuesMock.mockReset();
    jwtVerifyMock.mockReset();
    process.env.APP_ENCRYPTION_KEY = 'test-secret';
  });

  it('queues canonical CREATE_TASKS_FROM_CHUNKS work after authorization', async () => {
    const performer = { _id: new ObjectId(), telegram_id: '12345' };
    const session = { _id: new ObjectId(), user_id: performer._id };
    getDbMock.mockReturnValue(createDbFixture({ performer, session }).db);
    getUserPermissionsMock.mockResolvedValue(['VOICEBOT_READ', 'VOICEBOT_UPDATE']);
    computeSessionAccessMock.mockReturnValue({ hasAccess: true, canUpdateSession: true });
    jwtVerifyMock.mockReturnValue({ userId: performer._id.toString() });

    const commonAdd = jest.fn(async () => ({ id: 'job-1' }));
    getVoicebotQueuesMock.mockReturnValue({
      [VOICEBOT_QUEUES.COMMON]: {
        add: commonAdd,
      },
    });

    const harness = setupSocketHarness();
    harness.socket.user.userId = performer._id.toString();
    await harness.connect();

    const handler = harness.socketHandlers.get('create_tasks_from_chunks');
    expect(handler).toBeDefined();

    const ack = jest.fn();
    await handler?.(
      {
        session_id: session._id.toString(),
        chunks_to_process: [{ text: 'Need parity task' }],
      },
      ack
    );

    expect(commonAdd).toHaveBeenCalledWith(
      VOICEBOT_JOBS.common.CREATE_TASKS_FROM_CHUNKS,
      expect.objectContaining({
        session_id: session._id.toString(),
        chunks_to_process: [{ text: 'Need parity task' }],
      }),
      expect.objectContaining({ attempts: 1 })
    );
    expect(ack).toHaveBeenCalledWith({ ok: true });
  });
});
