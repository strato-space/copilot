import express from 'express';
import request from 'supertest';
import { ObjectId } from 'mongodb';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { VOICEBOT_COLLECTIONS, VOICEBOT_JOBS, VOICEBOT_QUEUES } from '../../../src/constants.js';
import { PERMISSIONS } from '../../../src/permissions/permissions-config.js';

const getDbMock = jest.fn();
const getRawDbMock = jest.fn();
const getUserPermissionsMock = jest.fn();
const generateDataFilterMock = jest.fn();
const getVoicebotQueuesMock = jest.fn();

jest.unstable_mockModule('../../../src/services/db.js', () => ({
  getDb: getDbMock,
  getRawDb: getRawDbMock,
}));

jest.unstable_mockModule('../../../src/permissions/permission-manager.js', () => ({
  PermissionManager: {
    getUserPermissions: getUserPermissionsMock,
    generateDataFilter: generateDataFilterMock,
  },
}));

jest.unstable_mockModule('../../../src/services/voicebotQueues.js', () => ({
  getVoicebotQueues: getVoicebotQueuesMock,
}));

const { default: sessionsRouter } = await import('../../../src/api/routes/voicebot/sessions.js');

type StubCollection = {
  findOne?: jest.Mock;
  updateOne?: jest.Mock;
  insertOne?: jest.Mock;
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

const buildDbStub = ({
  withPersistedSummary = false,
  withExistingSummaryCorrelation = false,
} : {
  withPersistedSummary?: boolean;
  withExistingSummaryCorrelation?: boolean;
} = {}) => {
  const sessionId = new ObjectId();
  const performerId = new ObjectId('507f1f77bcf86cd799439012');
  const oldProjectId = new ObjectId();
  const newProjectId = new ObjectId();
  const insertedLogs: Array<Record<string, unknown>> = [];

  const sessionDoc: Record<string, unknown> = {
    _id: sessionId,
    chat_id: 987654,
    user_id: performerId.toString(),
    is_deleted: false,
    is_active: false,
    project_id: oldProjectId,
    summary_correlation_id: withExistingSummaryCorrelation ? 'existing-corr-1' : null,
    ...(withPersistedSummary ? {
      summary_md_text: 'Saved summary body',
      summary_saved_at: new Date('2026-03-30T14:51:52.709Z'),
    } : {}),
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
      for (const [key, value] of Object.entries(setPayload)) {
        sessionDoc[key] = value;
      }
      return { matchedCount: 1, modifiedCount: 1 };
    }),
  };

  const sessionLogCollection: StubCollection = {
    findOne: jest.fn(async () => null),
    updateOne: jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 })),
    insertOne: jest.fn(async (doc: Record<string, unknown>) => {
      insertedLogs.push(doc);
      return { insertedId: new ObjectId() };
    }),
  };

  const defaultCollection: StubCollection = {
    findOne: jest.fn(async () => null),
    updateOne: jest.fn(async () => ({ matchedCount: 0, modifiedCount: 0 })),
    insertOne: jest.fn(async () => ({ insertedId: new ObjectId() })),
  };

  const dbStub = {
    collection: (name: string): StubCollection => {
      if (name === VOICEBOT_COLLECTIONS.SESSIONS) return sessionsCollection;
      if (name === VOICEBOT_COLLECTIONS.SESSION_LOG) return sessionLogCollection;
      return defaultCollection;
    },
  };

  return {
    dbStub,
    sessionId,
    performerId,
    oldProjectId,
    newProjectId,
    sessionsCollection,
    insertedLogs,
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

describe('POST /voicebot/update_project summarize audit parity', () => {
  beforeEach(() => {
    getDbMock.mockReset();
    getRawDbMock.mockReset();
    getUserPermissionsMock.mockReset();
    generateDataFilterMock.mockReset();
    getVoicebotQueuesMock.mockReset();
    getUserPermissionsMock.mockResolvedValue([PERMISSIONS.VOICEBOT_SESSIONS.READ_ALL]);
    generateDataFilterMock.mockResolvedValue({});
  });

  it('writes correlated summarize audit rows and enqueues summarize notify with idempotency envelope for done sessions', async () => {
    const fixture = buildDbStub();
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
      .post('/voicebot/update_project')
      .send({
        session_id: fixture.sessionId.toString(),
        project_id: fixture.newProjectId.toString(),
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.project_changed).toBe(true);
    expect(response.body.project_id).toBe(fixture.newProjectId.toString());
    expect(response.body.old_project_id).toBe(fixture.oldProjectId.toString());

    expect(addNotifyJobMock).toHaveBeenCalledTimes(2);
    expect(addNotifyJobMock).toHaveBeenNthCalledWith(
      1,
      VOICEBOT_JOBS.notifies.SESSION_PROJECT_ASSIGNED,
      expect.objectContaining({
        session_id: fixture.sessionId.toString(),
        payload: {
          project_id: fixture.newProjectId.toString(),
          old_project_id: fixture.oldProjectId.toString(),
        },
      }),
      expect.objectContaining({ attempts: 1 })
    );

    const summarizeCall = addNotifyJobMock.mock.calls[1];
    expect(summarizeCall?.[0]).toBe(VOICEBOT_JOBS.notifies.SESSION_READY_TO_SUMMARIZE);
    const summarizePayload = (summarizeCall?.[1] as { payload?: Record<string, unknown> })?.payload || {};
    expect(summarizePayload.project_id).toBe(fixture.newProjectId.toString());
    expect(typeof summarizePayload.correlation_id).toBe('string');
    expect(typeof summarizePayload.idempotency_key).toBe('string');
    expect(summarizePayload.idempotency_key).toBe(
      `${fixture.sessionId.toString()}:summary_telegram_send:${String(summarizePayload.correlation_id)}`
    );

    const sessionSetPayload = (fixture.sessionsCollection.updateOne?.mock.calls[0]?.[1]?.$set || {}) as Record<string, unknown>;
    expect(sessionSetPayload.summary_correlation_id).toEqual(expect.any(String));

    const summaryTelegramSendEvent = fixture.insertedLogs.find(
      (event) => event.event_name === 'summary_telegram_send'
    );
    expect(summaryTelegramSendEvent).toBeDefined();
    expect(summaryTelegramSendEvent?.status).toBe('queued');
    const correlationId = String(summaryTelegramSendEvent?.correlation_id || '');
    expect(correlationId.length).toBeGreaterThan(0);
    expect((summaryTelegramSendEvent?.metadata as Record<string, unknown>)?.idempotency_key).toBe(
      `${fixture.sessionId.toString()}:summary_telegram_send:${correlationId}`
    );

    const summarySaveEvent = fixture.insertedLogs.find((event) => event.event_name === 'summary_save');
    expect(summarySaveEvent).toBeDefined();
    expect(summarySaveEvent?.status).toBe('pending');
    expect((summarySaveEvent?.metadata as Record<string, unknown>)?.idempotency_key).toBe(
      `${fixture.sessionId.toString()}:summary_save:${correlationId}`
    );

    const summarizeNotifyEvent = fixture.insertedLogs.find(
      (event) =>
        event.event_name === 'notify_requested'
        && (event.metadata as Record<string, unknown>)?.source === 'project_update_after_done'
    );
    expect(summarizeNotifyEvent).toBeDefined();
    expect(summarizeNotifyEvent?.correlation_id).toBe(correlationId);
    expect((summarizeNotifyEvent?.metadata as Record<string, unknown>)?.notify_event).toBe(
      VOICEBOT_JOBS.notifies.SESSION_READY_TO_SUMMARIZE
    );
    expect((summarizeNotifyEvent?.metadata as Record<string, unknown>)?.notify_payload).toEqual({
      project_id: fixture.newProjectId.toString(),
      correlation_id: correlationId,
      idempotency_key: `${fixture.sessionId.toString()}:summary_telegram_send:${correlationId}`,
    });
  });

  it('does not inject summary correlation side effects when project does not change', async () => {
    const fixture = buildDbStub();
    getDbMock.mockReturnValue(fixture.dbStub);
    getRawDbMock.mockReturnValue(fixture.dbStub);

    const addNotifyJobMock = jest.fn(async () => ({ id: 'notify-job-noop' }));
    getVoicebotQueuesMock.mockReturnValue({
      [VOICEBOT_QUEUES.NOTIFIES]: {
        add: addNotifyJobMock,
      },
    });

    const app = createApp(fixture.performerId);
    const response = await request(app)
      .post('/voicebot/update_project')
      .send({
        session_id: fixture.sessionId.toString(),
        project_id: fixture.oldProjectId.toString(),
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.project_changed).toBe(false);
    expect(addNotifyJobMock).not.toHaveBeenCalled();

    const sessionSetPayload = (fixture.sessionsCollection.updateOne?.mock.calls[0]?.[1]?.$set || {}) as Record<string, unknown>;
    expect(sessionSetPayload.summary_correlation_id).toBeUndefined();
    expect(fixture.insertedLogs).toHaveLength(0);
  });

  it('keeps summary_save as done when a persisted summary already exists', async () => {
    const fixture = buildDbStub({ withPersistedSummary: true });
    getDbMock.mockReturnValue(fixture.dbStub);
    getRawDbMock.mockReturnValue(fixture.dbStub);

    const addNotifyJobMock = jest.fn(async () => ({ id: 'notify-job-summary-done' }));
    getVoicebotQueuesMock.mockReturnValue({
      [VOICEBOT_QUEUES.NOTIFIES]: {
        add: addNotifyJobMock,
      },
    });

    const app = createApp(fixture.performerId);
    const response = await request(app)
      .post('/voicebot/update_project')
      .send({
        session_id: fixture.sessionId.toString(),
        project_id: fixture.newProjectId.toString(),
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);

    const summarySaveEvent = fixture.insertedLogs.find((event) => event.event_name === 'summary_save');
    expect(summarySaveEvent).toBeDefined();
    expect(summarySaveEvent?.status).toBe('done');
    expect((summarySaveEvent?.metadata as Record<string, unknown>)?.persisted_summary_present).toBe(true);
  });
});
