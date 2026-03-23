import express from 'express';
import request from 'supertest';
import { ObjectId } from 'mongodb';
import { describe, it, expect, beforeEach, jest } from '@jest/globals';

import { VOICEBOT_COLLECTIONS } from '../../../src/constants.js';
import { PERMISSIONS } from '../../../src/permissions/permissions-config.js';

const getDbMock = jest.fn();
const getRawDbMock = jest.fn();
const getUserPermissionsMock = jest.fn();
const generateDataFilterMock = jest.fn();
const runCreateTasksAgentMock = jest.fn();
const runCreateTasksCompositeAgentMock = jest.fn();
const persistPossibleTasksForSessionMock = jest.fn();
const loggerInfoMock = jest.fn();
const loggerErrorMock = jest.fn();

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

jest.unstable_mockModule('../../../src/services/voicebot/createTasksAgent.js', () => ({
  runCreateTasksAgent: runCreateTasksAgentMock,
  runCreateTasksCompositeAgent: runCreateTasksCompositeAgentMock,
}));

jest.unstable_mockModule('../../../src/services/voicebot/persistPossibleTasks.js', async () => {
  return {
    POSSIBLE_TASKS_REFRESH_MODE_VALUES: ['full_recompute', 'incremental_refresh'],
    persistPossibleTasksForSession: persistPossibleTasksForSessionMock,
  };
});

jest.unstable_mockModule('../../../src/utils/logger.js', () => ({
  getLogger: () => ({
    info: loggerInfoMock,
    error: loggerErrorMock,
    warn: jest.fn(),
    debug: jest.fn(),
  }),
}));

const { default: sessionsRouter } = await import('../../../src/api/routes/voicebot/sessions.js');

type StubCollection = {
  findOne?: jest.Mock;
  updateOne?: jest.Mock;
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

const buildFixture = () => {
  const sessionId = new ObjectId();
  const performerId = new ObjectId('507f1f77bcf86cd799439011');
  const projectId = new ObjectId();
  const sessionDoc: Record<string, unknown> = {
    _id: sessionId,
    session_name: 'Morning Session',
    project_id: projectId,
    user_id: performerId.toHexString(),
    is_deleted: false,
    access_level: 'private',
  };

  const sessionsCollection: StubCollection = {
    findOne: jest.fn(async (query: Record<string, unknown>) => {
      const id = extractQueryObjectId(query);
      if (id instanceof ObjectId && id.equals(sessionId)) {
        return { ...sessionDoc };
      }
      return null;
    }),
    updateOne: jest.fn(async () => ({ acknowledged: true, matchedCount: 1, modifiedCount: 1 })),
  };

  const defaultCollection: StubCollection = {
    findOne: jest.fn(async () => null),
  };

  const dbStub = {
    collection: (name: string): StubCollection => {
      if (name === VOICEBOT_COLLECTIONS.SESSIONS) return sessionsCollection;
      return defaultCollection;
    },
  };

  return { dbStub, sessionId, performerId, projectId };
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
      real_name: 'Valery',
      projects_access: [],
    };
    request.user = { userId: performerId.toString(), email: 'tester@strato.space' };
    next();
  });
  app.use('/voicebot', sessionsRouter);
  return app;
};

describe('POST /voicebot/generate_possible_tasks', () => {
  beforeEach(() => {
    getDbMock.mockReset();
    getRawDbMock.mockReset();
    getUserPermissionsMock.mockReset();
    generateDataFilterMock.mockReset();
    runCreateTasksAgentMock.mockReset();
    runCreateTasksCompositeAgentMock.mockReset();
    persistPossibleTasksForSessionMock.mockReset();
    loggerInfoMock.mockReset();
    loggerErrorMock.mockReset();

    getUserPermissionsMock.mockResolvedValue([PERMISSIONS.VOICEBOT_SESSIONS.READ_ALL]);
    generateDataFilterMock.mockResolvedValue({});
    runCreateTasksCompositeAgentMock.mockResolvedValue({
      summary_md_text: '',
      scholastic_review_md: '',
      task_draft: [],
      enrich_ready_task_comments: [],
      session_name: '',
      project_id: '',
    });
  });

  it('routes session Tasks generation through backend runCreateTasksAgent and persists canonical items', async () => {
    const fixture = buildFixture();
    getDbMock.mockReturnValue(fixture.dbStub);
    getRawDbMock.mockReturnValue(fixture.dbStub);

    const generatedTasks = [
      { id: 'T1', row_id: 'row-1', name: 'Task 1', priority: 'P2' },
    ] as Array<Record<string, unknown>>;
    Object.defineProperty(generatedTasks, '__create_tasks_composite_meta', {
      value: {
        summary_md_text: 'Короткое саммари по диалогу.',
        scholastic_review_md: 'Review markdown',
        task_draft: [],
        enrich_ready_task_comments: [],
        session_name: 'Morning Session about bounded task planning',
        project_id: fixture.projectId.toHexString(),
      },
      enumerable: false,
      configurable: true,
    });
    runCreateTasksAgentMock.mockResolvedValue(generatedTasks);
    persistPossibleTasksForSessionMock.mockResolvedValue({
      items: [{ id: 'T1', row_id: 'row-1', name: 'Task 1', priority: 'P2' }],
    });

    const app = createApp(fixture.performerId);
    const response = await request(app)
      .post('/voicebot/generate_possible_tasks')
      .send({ session_id: fixture.sessionId.toString() });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.generated_count).toBe(1);
    expect(response.body.saved_count).toBe(1);
    expect(Array.isArray(response.body.items)).toBe(true);
    expect(response.body.summary_md_text).toBe('Короткое саммари по диалогу.');
    expect(response.body.review_md_text).toBe('Review markdown');
    expect(response.body.summary_saved).toBe(true);
    expect(response.body.review_saved).toBe(true);
    expect(response.body.title_updated).toBe(true);

    expect(runCreateTasksAgentMock).toHaveBeenCalledWith({
      sessionId: fixture.sessionId.toString(),
      projectId: fixture.projectId.toHexString(),
      db: fixture.dbStub,
    });

    expect(persistPossibleTasksForSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        db: fixture.dbStub,
        sessionId: fixture.sessionId.toString(),
        defaultProjectId: fixture.projectId.toHexString(),
        refreshMode: 'full_recompute',
      })
    );
    const sessionsCollection = fixture.dbStub.collection(VOICEBOT_COLLECTIONS.SESSIONS) as StubCollection;
    expect(sessionsCollection.updateOne).toHaveBeenCalledWith(
      { _id: fixture.sessionId },
      {
        $set: expect.objectContaining({
          summary_md_text: 'Короткое саммари по диалогу.',
          summary_saved_at: expect.any(String),
          review_md_text: 'Review markdown',
          session_name: 'Morning Session about bounded task planning',
          updated_at: expect.any(Date),
        }),
      }
    );
  });

  it('logs completion correlation/e2e fields for manual generate_possible_tasks refresh', async () => {
    const fixture = buildFixture();
    getDbMock.mockReturnValue(fixture.dbStub);
    getRawDbMock.mockReturnValue(fixture.dbStub);

    runCreateTasksAgentMock.mockResolvedValue([
      { id: 'T1', row_id: 'row-1', name: 'Task 1', priority: 'P2' },
    ]);
    persistPossibleTasksForSessionMock.mockResolvedValue({
      items: [{ id: 'T1', row_id: 'row-1', name: 'Task 1', priority: 'P2' }],
    });

    const clickedAtMs = Date.now() - 250;
    const app = createApp(fixture.performerId);
    const response = await request(app)
      .post('/voicebot/generate_possible_tasks')
      .send({
        session_id: fixture.sessionId.toString(),
        refresh_correlation_id: 'corr-manual-1',
        refresh_clicked_at_ms: clickedAtMs,
      });

    expect(response.status).toBe(200);

    const completionCall = loggerInfoMock.mock.calls.find(
      ([eventName]) => eventName === '[voicebot.sessions] generate_possible_tasks_completed'
    );
    expect(completionCall).toBeDefined();
    expect(completionCall?.[1]).toEqual(
      expect.objectContaining({
        session_id: fixture.sessionId.toString(),
        correlation_id: 'corr-manual-1',
        clicked_at_ms: clickedAtMs,
      })
    );
    expect(typeof (completionCall?.[1] as Record<string, unknown>).e2e_from_click_ms).toBe('number');
    expect(((completionCall?.[1] as Record<string, unknown>).e2e_from_click_ms as number)).toBeGreaterThanOrEqual(0);
  });
});
