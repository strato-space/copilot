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
const persistPossibleTasksForSessionMock = jest.fn();

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
}));

jest.unstable_mockModule('../../../src/services/voicebot/persistPossibleTasks.js', async () => {
  return {
    POSSIBLE_TASKS_REFRESH_MODE_VALUES: ['full_recompute', 'incremental_refresh'],
    persistPossibleTasksForSession: persistPossibleTasksForSessionMock,
  };
});

const { default: sessionsRouter } = await import('../../../src/api/routes/voicebot/sessions.js');

type StubCollection = {
  findOne?: jest.Mock;
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
    persistPossibleTasksForSessionMock.mockReset();

    getUserPermissionsMock.mockResolvedValue([PERMISSIONS.VOICEBOT_SESSIONS.READ_ALL]);
    generateDataFilterMock.mockResolvedValue({});
  });

  it('routes session Tasks generation through backend runCreateTasksAgent and persists canonical items', async () => {
    const fixture = buildFixture();
    getDbMock.mockReturnValue(fixture.dbStub);
    getRawDbMock.mockReturnValue(fixture.dbStub);

    runCreateTasksAgentMock.mockResolvedValue([
      { id: 'T1', row_id: 'row-1', name: 'Task 1', priority: 'P2' },
    ]);
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

    expect(runCreateTasksAgentMock).toHaveBeenCalledWith({
      sessionId: fixture.sessionId.toString(),
      projectId: fixture.projectId.toHexString(),
    });

    expect(persistPossibleTasksForSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        db: fixture.dbStub,
        sessionId: fixture.sessionId.toString(),
        defaultProjectId: fixture.projectId.toHexString(),
        refreshMode: 'full_recompute',
      })
    );
  });
});
