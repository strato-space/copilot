import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ObjectId } from 'mongodb';

import { VOICEBOT_COLLECTIONS } from '../../src/constants.js';

const getDbMock = jest.fn();
const getUserPermissionsMock = jest.fn();
const computeSessionAccessMock = jest.fn();

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

const { resolveAuthorizedSessionForSocket } = await import('../../src/api/socket/voicebot.js');

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
    performersFindOne,
    sessionsFindOne,
  };
};

describe('resolveAuthorizedSessionForSocket', () => {
  beforeEach(() => {
    getDbMock.mockReset();
    getUserPermissionsMock.mockReset();
    computeSessionAccessMock.mockReset();
  });

  it('returns invalid_session_id for malformed session id', async () => {
    const socket = { user: { userId: new ObjectId().toString() } } as any;

    const result = await resolveAuthorizedSessionForSocket({
      socket,
      session_id: 'not-an-object-id',
      requireUpdate: true,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe('invalid_session_id');
    expect(getDbMock).not.toHaveBeenCalled();
  });

  it('returns unauthorized for malformed socket user id', async () => {
    const sessionId = new ObjectId().toString();
    const socket = { user: { userId: 'bad-user-id' } } as any;

    const result = await resolveAuthorizedSessionForSocket({
      socket,
      session_id: sessionId,
      requireUpdate: true,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe('unauthorized');
    expect(getDbMock).not.toHaveBeenCalled();
  });

  it('returns unauthorized when performer not found', async () => {
    const fixture = createDbFixture({ performer: null, session: null });
    getDbMock.mockReturnValue(fixture.db);

    const result = await resolveAuthorizedSessionForSocket({
      socket: { user: { userId: new ObjectId().toString() } } as any,
      session_id: new ObjectId().toString(),
      requireUpdate: false,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe('unauthorized');
    expect(fixture.performersFindOne).toHaveBeenCalledTimes(1);
  });

  it('returns session_not_found when runtime-scoped session is unavailable', async () => {
    const performer = { _id: new ObjectId(), telegram_id: '12345' };
    const fixture = createDbFixture({ performer, session: null });
    getDbMock.mockReturnValue(fixture.db);

    const result = await resolveAuthorizedSessionForSocket({
      socket: { user: { userId: performer._id.toString() } } as any,
      session_id: new ObjectId().toString(),
      requireUpdate: false,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe('session_not_found');
    expect(fixture.sessionsFindOne).toHaveBeenCalledTimes(1);
  });

  it('returns forbidden when access check fails', async () => {
    const performer = { _id: new ObjectId(), telegram_id: '12345' };
    const session = { _id: new ObjectId(), user_id: new ObjectId() };
    const fixture = createDbFixture({ performer, session });
    getDbMock.mockReturnValue(fixture.db);
    getUserPermissionsMock.mockResolvedValue(['VOICEBOT_READ']);
    computeSessionAccessMock.mockReturnValue({ hasAccess: false, canUpdateSession: false });

    const result = await resolveAuthorizedSessionForSocket({
      socket: { user: { userId: performer._id.toString() } } as any,
      session_id: session._id.toString(),
      requireUpdate: false,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe('forbidden');
  });

  it('returns forbidden when update permission is required but missing', async () => {
    const performer = { _id: new ObjectId(), telegram_id: '12345' };
    const session = { _id: new ObjectId(), user_id: new ObjectId() };
    const fixture = createDbFixture({ performer, session });
    getDbMock.mockReturnValue(fixture.db);
    getUserPermissionsMock.mockResolvedValue(['VOICEBOT_READ']);
    computeSessionAccessMock.mockReturnValue({ hasAccess: true, canUpdateSession: false });

    const result = await resolveAuthorizedSessionForSocket({
      socket: { user: { userId: performer._id.toString() } } as any,
      session_id: session._id.toString(),
      requireUpdate: true,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe('forbidden');
  });

  it('returns performer and session for authorized socket context', async () => {
    const performer = { _id: new ObjectId(), telegram_id: '12345' };
    const session = { _id: new ObjectId(), user_id: performer._id };
    const fixture = createDbFixture({ performer, session });
    getDbMock.mockReturnValue(fixture.db);
    getUserPermissionsMock.mockResolvedValue(['VOICEBOT_READ', 'VOICEBOT_UPDATE']);
    computeSessionAccessMock.mockReturnValue({ hasAccess: true, canUpdateSession: true });

    const result = await resolveAuthorizedSessionForSocket({
      socket: { user: { userId: performer._id.toString() } } as any,
      session_id: session._id.toString(),
      requireUpdate: true,
    });

    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.performer?._id?.toString()).toBe(performer._id.toString());
    expect(result.session?._id?.toString()).toBe(session._id.toString());
  });
});
