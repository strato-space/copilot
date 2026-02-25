import express from 'express';
import request from 'supertest';
import { ObjectId } from 'mongodb';
import { describe, it, expect, beforeEach, jest } from '@jest/globals';

import { VOICEBOT_COLLECTIONS, VOICEBOT_JOBS, VOICEBOT_QUEUES } from '../../src/constants.js';
import { PERMISSIONS } from '../../src/permissions/permissions-config.js';

const getDbMock = jest.fn();
const getRawDbMock = jest.fn();
const getUserPermissionsMock = jest.fn();
const generateDataFilterMock = jest.fn();
const getVoicebotQueuesMock = jest.fn();

jest.unstable_mockModule('../../src/services/db.js', () => ({
  getDb: getDbMock,
  getRawDb: getRawDbMock,
}));

jest.unstable_mockModule('../../src/permissions/permission-manager.js', () => ({
  PermissionManager: {
    getUserPermissions: getUserPermissionsMock,
    generateDataFilter: generateDataFilterMock,
  },
}));

jest.unstable_mockModule('../../src/services/voicebotQueues.js', () => ({
  getVoicebotQueues: getVoicebotQueuesMock,
}));

const { default: sessionsRouter } = await import('../../src/api/routes/voicebot/sessions.js');

type StubCollection = {
  findOne?: jest.Mock;
  updateOne?: jest.Mock;
  insertOne?: jest.Mock;
  aggregate?: jest.Mock;
};

const extractQueryObjectId = (query: unknown): ObjectId | null => {
  if (!query || typeof query !== 'object') return null;
  const record = query as Record<string, unknown>;
  if (record._id instanceof ObjectId) return record._id;
  if (Array.isArray(record.$and)) {
    for (const part of record.$and) {
      const nested = extractQueryObjectId(part);
      if (nested) return nested;
    }
  }
  return null;
};

const buildDbStub = ({ withProject }: { withProject: boolean }) => {
  const sessionId = new ObjectId();
  const performerId = new ObjectId('507f1f77bcf86cd799439011');
  const pmoProjectId = new ObjectId();
  const insertedLogs: Array<Record<string, unknown>> = [];

  const sessionDoc: Record<string, unknown> = {
    _id: sessionId,
    chat_id: 123,
    user_id: performerId.toString(),
    is_deleted: false,
    access_level: 'private',
    project_id: withProject ? pmoProjectId : null,
  };

  const sessionsCollection: StubCollection = {
    findOne: jest.fn(async (query: Record<string, unknown>) => {
      const id = extractQueryObjectId(query);
      if (id instanceof ObjectId && id.equals(sessionId)) {
        return { ...sessionDoc };
      }
      return null;
    }),
    updateOne: jest.fn(async (query: Record<string, unknown>, update: Record<string, unknown>) => {
      const id = extractQueryObjectId(query);
      if (!(id instanceof ObjectId) || !id.equals(sessionId)) {
        return { matchedCount: 0, modifiedCount: 0 };
      }
      const setPayload = (update.$set || {}) as Record<string, unknown>;
      if (setPayload.project_id instanceof ObjectId) {
        sessionDoc.project_id = setPayload.project_id;
      }
      if (setPayload.updated_at) {
        sessionDoc.updated_at = setPayload.updated_at;
      }
      return { matchedCount: 1, modifiedCount: 1 };
    }),
  };

  const projectsCollection: StubCollection = {
    findOne: jest.fn(async () => ({
      _id: pmoProjectId,
      name: 'PMO',
      is_active: true,
      is_deleted: false,
    })),
  };

  const sessionLogCollection: StubCollection = {
    insertOne: jest.fn(async (doc: Record<string, unknown>) => {
      insertedLogs.push(doc);
      return { insertedId: new ObjectId() };
    }),
  };

  const defaultCollection: StubCollection = {
    findOne: jest.fn(async () => null),
    updateOne: jest.fn(async () => ({ matchedCount: 0, modifiedCount: 0 })),
    insertOne: jest.fn(async () => ({ insertedId: new ObjectId() })),
    aggregate: jest.fn(() => ({ toArray: async () => [] })),
  };

  const dbStub = {
    collection: (name: string): StubCollection => {
      if (name === VOICEBOT_COLLECTIONS.SESSIONS) return sessionsCollection;
      if (name === VOICEBOT_COLLECTIONS.PROJECTS) return projectsCollection;
      if (name === VOICEBOT_COLLECTIONS.SESSION_LOG) return sessionLogCollection;
      return defaultCollection;
    },
  };

  return {
    dbStub,
    sessionId,
    performerId,
    pmoProjectId,
    sessionsCollection,
    projectsCollection,
    sessionLogCollection,
    insertedLogs,
    sessionDoc,
  };
};

const createApp = (performerId: ObjectId) => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const request = req as unknown as {
      performer: Record<string, unknown>;
      user: Record<string, unknown>;
    };
    request.performer = {
      _id: performerId,
      telegram_id: '123',
      projects_access: [],
    };
    request.user = { userId: performerId.toString() };
    next();
  });
  app.use('/voicebot', sessionsRouter);
  return app;
};

describe('POST /voicebot/trigger_session_ready_to_summarize', () => {
  beforeEach(() => {
    getDbMock.mockReset();
    getRawDbMock.mockReset();
    getUserPermissionsMock.mockReset();
    generateDataFilterMock.mockReset();
    getVoicebotQueuesMock.mockReset();
    getUserPermissionsMock.mockResolvedValue([PERMISSIONS.VOICEBOT_SESSIONS.READ_ALL]);
    generateDataFilterMock.mockResolvedValue({});
    getVoicebotQueuesMock.mockReturnValue(null);
  });

  it('assigns PMO project when session has no project and emits notify event metadata', async () => {
    const fixture = buildDbStub({ withProject: false });
    getDbMock.mockReturnValue(fixture.dbStub);
    getRawDbMock.mockReturnValue(fixture.dbStub);
    const addNotifyJobMock = jest.fn(async () => ({ id: 'notify-job-1' }));
    getVoicebotQueuesMock.mockReturnValue({
      [VOICEBOT_QUEUES.NOTIFIES]: {
        add: addNotifyJobMock,
      },
    });

    const app = createApp(fixture.performerId);
    const response = await request(app)
      .post('/voicebot/trigger_session_ready_to_summarize')
      .send({ session_id: fixture.sessionId.toString() });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.project_assigned).toBe(true);
    expect(response.body.project_id).toBe(fixture.pmoProjectId.toString());
    expect(response.body.notify_event).toBe(VOICEBOT_JOBS.notifies.SESSION_READY_TO_SUMMARIZE);
    expect(response.body.notify_enqueued).toBe(true);

    expect(fixture.projectsCollection.findOne).toHaveBeenCalled();
    expect(fixture.sessionsCollection.updateOne).toHaveBeenCalled();
    expect(fixture.sessionLogCollection.insertOne).toHaveBeenCalledTimes(1);

    expect(fixture.insertedLogs[0]?.event_name).toBe('notify_requested');
    const metadata = fixture.insertedLogs[0]?.metadata as Record<string, unknown>;
    expect(metadata.notify_event).toBe(VOICEBOT_JOBS.notifies.SESSION_READY_TO_SUMMARIZE);
    expect(addNotifyJobMock).toHaveBeenCalledTimes(1);
    expect(addNotifyJobMock).toHaveBeenCalledWith(
      VOICEBOT_JOBS.notifies.SESSION_READY_TO_SUMMARIZE,
      expect.objectContaining({
        session_id: fixture.sessionId.toString(),
        payload: { project_id: fixture.pmoProjectId.toString() },
      }),
      expect.objectContaining({ attempts: 1 })
    );
  });

  it('does not reassign project when session already has project', async () => {
    const fixture = buildDbStub({ withProject: true });
    getDbMock.mockReturnValue(fixture.dbStub);
    getRawDbMock.mockReturnValue(fixture.dbStub);

    const app = createApp(fixture.performerId);
    const response = await request(app)
      .post('/voicebot/trigger_session_ready_to_summarize')
      .send({ session_id: fixture.sessionId.toString() });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.project_assigned).toBe(false);
    expect(response.body.project_id).toBe(fixture.pmoProjectId.toString());
    expect(response.body.notify_enqueued).toBe(false);

    expect(fixture.projectsCollection.findOne).not.toHaveBeenCalled();
    expect(fixture.sessionsCollection.updateOne).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ $set: expect.objectContaining({ project_id: expect.any(ObjectId) }) })
    );
    expect(fixture.sessionLogCollection.insertOne).toHaveBeenCalledTimes(1);
  });

  it('returns 400 for missing session_id', async () => {
    const fixture = buildDbStub({ withProject: true });
    getDbMock.mockReturnValue(fixture.dbStub);
    getRawDbMock.mockReturnValue(fixture.dbStub);

    const app = createApp(fixture.performerId);
    const response = await request(app)
      .post('/voicebot/trigger_session_ready_to_summarize')
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('session_id is required');
  });
});
