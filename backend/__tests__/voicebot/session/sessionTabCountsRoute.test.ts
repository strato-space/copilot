import express from 'express';
import request from 'supertest';
import { ObjectId } from 'mongodb';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const getDbMock = jest.fn();
const getRawDbMock = jest.fn();
const getUserPermissionsMock = jest.fn();
const generateDataFilterMock = jest.fn();
const requirePermissionMock = jest.fn(
  () =>
    (_req: express.Request, _res: express.Response, next: express.NextFunction) =>
      next()
);

const tasksCountDocumentsMock = jest.fn();
const tasksAggregateMock = jest.fn();
const tasksFindMock = jest.fn();

jest.unstable_mockModule('../../../src/services/db.js', () => ({
  getDb: getDbMock,
  getRawDb: getRawDbMock,
}));

jest.unstable_mockModule('../../../src/permissions/permission-manager.js', () => ({
  PermissionManager: {
    getUserPermissions: getUserPermissionsMock,
    generateDataFilter: generateDataFilterMock,
    requirePermission: requirePermissionMock,
  },
}));

const { PERMISSIONS } = await import('../../../src/permissions/permissions-config.js');
const { COLLECTIONS, VOICEBOT_COLLECTIONS, TASK_STATUSES } = await import('../../../src/constants.js');
const { default: sessionsRouter } = await import('../../../src/api/routes/voicebot/sessions.js');

const performerId = new ObjectId('507f1f77bcf86cd799439011');
const sessionId = new ObjectId('507f1f77bcf86cd799439012');

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const vreq = req as express.Request & {
      performer: Record<string, unknown>;
      user: Record<string, unknown>;
    };
    vreq.performer = {
      _id: performerId,
      telegram_id: '123456',
      projects_access: [],
    };
    vreq.user = {
      userId: performerId.toHexString(),
      email: 'tester@strato.space',
    };
    next();
  });
  app.use('/voicebot', sessionsRouter);
  return app;
};

describe('Voicebot session_tab_counts route', () => {
  beforeEach(() => {
    getDbMock.mockReset();
    getRawDbMock.mockReset();
    getUserPermissionsMock.mockReset();
    generateDataFilterMock.mockReset();
    requirePermissionMock.mockClear();
    tasksCountDocumentsMock.mockReset();
    tasksAggregateMock.mockReset();
    tasksFindMock.mockReset();

    const sessionDoc = {
      _id: sessionId,
      chat_id: 123456,
      user_id: performerId,
      is_active: true,
      access_level: 'private',
      source_ref: `https://copilot.stratospace.fun/voice/session/${sessionId.toHexString()}`,
    };
    const sessionRef = `https://copilot.stratospace.fun/voice/session/${sessionId.toHexString()}`;
    const draftDocs = [
      {
        row_id: 'draft-1',
        id: 'draft-1',
        task_status: TASK_STATUSES.DRAFT_10,
        source_kind: 'voice_possible_task',
        source_ref: sessionRef,
        source_data: { session_id: sessionId.toHexString(), refresh_state: 'active' },
        created_at: '2026-03-20T10:00:00.000Z',
        updated_at: '2026-03-20T10:00:00.000Z',
      },
      {
        row_id: 'draft-2',
        id: 'draft-2',
        task_status: TASK_STATUSES.DRAFT_10,
        source_kind: 'voice_possible_task',
        source_ref: sessionRef,
        source_data: { session_id: sessionId.toHexString(), refresh_state: 'active' },
        created_at: '2026-03-20T11:00:00.000Z',
        updated_at: '2026-03-20T11:00:00.000Z',
      },
    ];
    const nonDraftDocs = [
      { task_status: TASK_STATUSES.REVIEW_10 },
      { task_status: TASK_STATUSES.REVIEW_10 },
      { task_status: TASK_STATUSES.REVIEW_10 },
      { task_status: 'Unexpected status' },
    ];
    const sessionTasksDocs = [...draftDocs, ...nonDraftDocs];

    tasksAggregateMock.mockReturnValue({
      toArray: async () => [],
    });
    tasksCountDocumentsMock.mockResolvedValue(3);
    tasksFindMock.mockImplementation((filter?: Record<string, unknown>) => {
      const docs =
        filter?.task_status === TASK_STATUSES.DRAFT_10
          ? draftDocs
          : sessionTasksDocs;
      return {
        sort: () => ({ toArray: async () => docs }),
        toArray: async () => docs,
      };
    });

    const dbStub = {
      collection: (name: string) => {
        if (name === COLLECTIONS.TASKS) {
          return {
            countDocuments: tasksCountDocumentsMock,
            aggregate: tasksAggregateMock,
            find: tasksFindMock,
          };
        }
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return {
            findOne: jest.fn(async () => sessionDoc),
            find: jest.fn(() => ({ toArray: async () => [] })),
          };
        }
        return {
          findOne: jest.fn(async () => null),
        };
      },
    };

    getDbMock.mockReturnValue(dbStub);
    getRawDbMock.mockReturnValue(dbStub);
    getUserPermissionsMock.mockResolvedValue([
      PERMISSIONS.VOICEBOT_SESSIONS.READ_ALL,
      PERMISSIONS.VOICEBOT_SESSIONS.UPDATE,
    ]);
    generateDataFilterMock.mockResolvedValue({});
  });

  it('returns accepted-only task and codex counts for the current session scope', async () => {
    const app = buildApp();
    const response = await request(app)
      .post('/voicebot/session_tab_counts')
      .send({ session_id: sessionId.toHexString() });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      session_id: sessionId.toHexString(),
      tasks_count: 6,
      draft_count: 2,
      codex_count: 3,
      status_counts: [
        { status: 'DRAFT_10', status_key: 'DRAFT_10', label: 'Draft', count: 2 },
        { status: 'REVIEW_10', status_key: 'REVIEW_10', label: 'Review', count: 3 },
        { status: 'UNKNOWN', status_key: 'UNKNOWN', label: 'Unknown', count: 1 },
      ],
    });

    expect(tasksCountDocumentsMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        is_deleted: { $ne: true },
        codex_task: true,
        external_ref: `https://copilot.stratospace.fun/voice/session/${sessionId.toHexString()}`,
      })
    );
    const tasksFindFilter = tasksFindMock.mock.calls[0]?.[0];
    expect(JSON.stringify(tasksFindFilter || {})).toContain('"source_data.refresh_state":{"$ne":"stale"}');
    expect(tasksFindMock.mock.calls.some(([filter]) => (filter as Record<string, unknown>)?.task_status === TASK_STATUSES.DRAFT_10)).toBe(true);
  });

  it('includes no_task_decision when accepted tasks are zero and CREATE_TASKS decision is derivable', async () => {
    const zeroTasksSessionId = new ObjectId('507f1f77bcf86cd799439013');
    const tasksFind = jest.fn(() => ({
      sort: () => ({ toArray: async () => [] }),
      toArray: async () => [],
    }));
    const countDocuments = jest.fn(async () => 0);
    const dbStub = {
      collection: (name: string) => {
        if (name === COLLECTIONS.TASKS) {
          return {
            countDocuments,
            aggregate: tasksAggregateMock,
            find: tasksFind,
          };
        }
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return {
            findOne: jest.fn(async () => ({
              _id: zeroTasksSessionId,
              chat_id: 123456,
              user_id: performerId,
              is_active: true,
              summary_md_text: '',
              review_md_text: '',
              processors_data: {
                CREATE_TASKS: {
                  is_processed: true,
                  last_tasks_count: 0,
                  no_task_decision: {
                    code: 'categorization_not_queued',
                    reason: 'create_tasks refresh skipped because categorization was not queued',
                    evidence: [
                      'categorization_enqueue_outcome=not_queued',
                      'create_tasks_refresh=skipped',
                      'path=sessions_add_text',
                    ],
                    inferred: true,
                    source: 'persistence_inferred',
                  },
                },
              },
            })),
          };
        }
        return {
          findOne: jest.fn(async () => null),
        };
      },
    };

    getDbMock.mockReturnValue(dbStub);
    getRawDbMock.mockReturnValue(dbStub);

    const app = buildApp();
    const response = await request(app)
      .post('/voicebot/session_tab_counts')
      .send({ session_id: zeroTasksSessionId.toHexString() });

    expect(response.status).toBe(200);
    expect(response.body.tasks_count).toBe(0);
    expect(response.body.draft_count).toBe(0);
    expect(response.body.codex_count).toBe(0);
    expect(response.body.status_counts).toEqual([]);
    expect(response.body.no_task_decision).toEqual(
      expect.objectContaining({
        code: 'categorization_not_queued',
        inferred: true,
        source: 'persistence_inferred',
      })
    );
  });

  it('keeps draft_count deterministic with draft_horizon_days and matches session_tasks(Draft) semantics', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-03-21T00:00:00.000Z'));
    try {
      const scopedSessionId = new ObjectId('507f1f77bcf86cd799439014');
      const scopedSessionRef = `https://copilot.stratospace.fun/voice/session/${scopedSessionId.toHexString()}`;
      const draftRows = [
        {
          row_id: 'draft-in-range',
          id: 'draft-in-range',
          task_status: TASK_STATUSES.DRAFT_10,
          source_kind: 'voice_possible_task',
          source_ref: scopedSessionRef,
          source_data: { session_id: 'legacy-session-alpha', refresh_state: 'active' },
          created_at: '2024-01-20T00:00:00.000Z',
          updated_at: '2024-01-20T00:00:00.000Z',
        },
        {
          row_id: 'draft-out-of-range',
          id: 'draft-out-of-range',
          task_status: TASK_STATUSES.DRAFT_10,
          source_kind: 'voice_possible_task',
          source_ref: scopedSessionRef,
          source_data: { session_id: 'legacy-session-beta', refresh_state: 'active' },
          created_at: '2024-04-20T00:00:00.000Z',
          updated_at: '2024-04-20T00:00:00.000Z',
        },
      ];

      const tasksFind = jest.fn((filter?: Record<string, unknown>) => {
        const docs =
          filter?.task_status === TASK_STATUSES.DRAFT_10
            ? draftRows
            : [...draftRows, { task_status: TASK_STATUSES.READY_10 }];
        return {
          sort: () => ({ toArray: async () => docs }),
          toArray: async () => docs,
        };
      });

      const scopedSessionDoc = {
        _id: scopedSessionId,
        chat_id: 123456,
        user_id: performerId,
        is_active: true,
        access_level: 'private',
        source_ref: scopedSessionRef,
        created_at: '2024-01-15T00:00:00.000Z',
        last_voice_timestamp: '2024-01-15T00:00:00.000Z',
      };

      const dbStub = {
        collection: (name: string) => {
          if (name === COLLECTIONS.TASKS) {
            return {
              countDocuments: jest.fn(async () => 0),
              aggregate: tasksAggregateMock,
              find: tasksFind,
            };
          }
          if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
            return {
              findOne: jest.fn(async () => scopedSessionDoc),
              find: jest.fn(() => ({ toArray: async () => [] })),
            };
          }
          return {
            findOne: jest.fn(async () => null),
          };
        },
      };

      getDbMock.mockReturnValue(dbStub);
      getRawDbMock.mockReturnValue(dbStub);

      const app = buildApp();

      const boundedCountsResponse = await request(app)
        .post('/voicebot/session_tab_counts')
        .send({ session_id: scopedSessionId.toHexString(), draft_horizon_days: 30 });
      const boundedDraftResponse = await request(app)
        .post('/voicebot/session_tasks')
        .send({ session_id: scopedSessionId.toHexString(), bucket: 'Draft', draft_horizon_days: 30 });

      expect(boundedCountsResponse.status).toBe(200);
      expect(boundedDraftResponse.status).toBe(200);
      expect(boundedCountsResponse.body.tasks_count).toBe(2);
      expect(boundedCountsResponse.body.draft_count).toBe(1);
      expect(boundedDraftResponse.body.count).toBe(1);
      expect(boundedCountsResponse.body.draft_count).toBe(boundedDraftResponse.body.count);

      const unboundedCountsResponse = await request(app)
        .post('/voicebot/session_tab_counts')
        .send({ session_id: scopedSessionId.toHexString() });

      expect(unboundedCountsResponse.status).toBe(200);
      expect(unboundedCountsResponse.body.tasks_count).toBe(3);
      expect(unboundedCountsResponse.body.draft_count).toBe(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('hard-fails deprecated include_older_drafts on session routes', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-03-21T00:00:00.000Z'));
    try {
      const scopedSessionId = new ObjectId('507f1f77bcf86cd799439015');
      const scopedSessionRef = `https://copilot.stratospace.fun/voice/session/${scopedSessionId.toHexString()}`;
      const draftRows = [
        {
          row_id: 'draft-in-range',
          id: 'draft-in-range',
          task_status: TASK_STATUSES.DRAFT_10,
          source_kind: 'voice_possible_task',
          source_ref: scopedSessionRef,
          source_data: { session_id: 'legacy-session-alpha', refresh_state: 'active' },
          created_at: '2024-01-20T00:00:00.000Z',
          updated_at: '2024-01-20T00:00:00.000Z',
        },
        {
          row_id: 'draft-out-of-range',
          id: 'draft-out-of-range',
          task_status: TASK_STATUSES.DRAFT_10,
          source_kind: 'voice_possible_task',
          source_ref: scopedSessionRef,
          source_data: { session_id: 'legacy-session-beta', refresh_state: 'active' },
          created_at: '2024-04-20T00:00:00.000Z',
          updated_at: '2024-04-20T00:00:00.000Z',
        },
      ];

      const tasksFind = jest.fn((filter?: Record<string, unknown>) => {
        const docs =
          filter?.task_status === TASK_STATUSES.DRAFT_10
            ? draftRows
            : [...draftRows, { task_status: TASK_STATUSES.READY_10 }];
        return {
          sort: () => ({ toArray: async () => docs }),
          toArray: async () => docs,
        };
      });

      const scopedSessionDoc = {
        _id: scopedSessionId,
        chat_id: 123456,
        user_id: performerId,
        is_active: true,
        access_level: 'private',
        source_ref: scopedSessionRef,
        created_at: '2024-01-15T00:00:00.000Z',
        last_voice_timestamp: '2024-01-15T00:00:00.000Z',
      };

      const dbStub = {
        collection: (name: string) => {
          if (name === COLLECTIONS.TASKS) {
            return {
              countDocuments: jest.fn(async () => 0),
              aggregate: tasksAggregateMock,
              find: tasksFind,
            };
          }
          if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
            return {
              findOne: jest.fn(async () => scopedSessionDoc),
              find: jest.fn(() => ({ toArray: async () => [] })),
            };
          }
          return {
            findOne: jest.fn(async () => null),
          };
        },
      };

      getDbMock.mockReturnValue(dbStub);
      getRawDbMock.mockReturnValue(dbStub);

      const app = buildApp();

      const boundedResponse = await request(app)
        .post('/voicebot/session_tab_counts')
        .send({ session_id: scopedSessionId.toHexString(), draft_horizon_days: 30 });

      const includeOlderResponse = await request(app)
        .post('/voicebot/session_tab_counts')
        .send({
          session_id: scopedSessionId.toHexString(),
          draft_horizon_days: 30,
          include_older_drafts: true,
        });

      const includeOlderDraftBucketResponse = await request(app)
        .post('/voicebot/session_tasks')
        .send({
          session_id: scopedSessionId.toHexString(),
          bucket: 'Draft',
          draft_horizon_days: 30,
          include_older_drafts: true,
        });

      expect(boundedResponse.status).toBe(200);
      expect(includeOlderResponse.status).toBe(400);
      expect(boundedResponse.body.draft_count).toBe(1);
      expect(includeOlderResponse.body).toEqual({
        error: 'include_older_drafts is deprecated; omit draft_horizon_days for unbounded draft visibility',
        error_code: 'validation_error',
      });
      expect(includeOlderDraftBucketResponse.status).toBe(400);
      expect(includeOlderDraftBucketResponse.body).toEqual({
        error: 'include_older_drafts is deprecated; omit draft_horizon_days for unbounded draft visibility',
        error_code: 'validation_error',
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it('keeps draft dedupe deterministic for mixed timestamp formats in session routes', async () => {
    const mixedSessionId = new ObjectId('507f1f77bcf86cd799439016');
    const mixedSessionRef = `https://copilot.stratospace.fun/voice/session/${mixedSessionId.toHexString()}`;
    const newerIso = '2026-03-20T11:00:00.000Z';
    const olderIso = '2026-03-20T10:00:00.000Z';
    const draftDocs = [
      {
        row_id: 'draft-mixed',
        id: 'draft-mixed',
        task_status: TASK_STATUSES.DRAFT_10,
        source_kind: 'voice_possible_task',
        source_ref: mixedSessionRef,
        source_data: { session_id: mixedSessionId.toHexString(), refresh_state: 'active' },
        created_at: new Date(olderIso),
        updated_at: String(Date.parse(olderIso)),
      },
      {
        row_id: 'draft-mixed',
        id: 'draft-mixed',
        task_status: TASK_STATUSES.DRAFT_10,
        source_kind: 'voice_possible_task',
        source_ref: mixedSessionRef,
        source_data: { session_id: mixedSessionId.toHexString(), refresh_state: 'active' },
        created_at: new Date(newerIso),
        updated_at: new Date(newerIso),
      },
    ];

    const tasksFind = jest.fn((filter?: Record<string, unknown>) => {
      const docs =
        filter?.task_status === TASK_STATUSES.DRAFT_10
          ? draftDocs
          : [...draftDocs, { task_status: TASK_STATUSES.READY_10 }];
      return {
        sort: () => ({ toArray: async () => docs }),
        toArray: async () => docs,
      };
    });

    const scopedSessionDoc = {
      _id: mixedSessionId,
      chat_id: 123456,
      user_id: performerId,
      is_active: true,
      access_level: 'private',
      source_ref: mixedSessionRef,
      created_at: '2026-03-20T09:00:00.000Z',
      last_voice_timestamp: Math.trunc(Date.parse('2026-03-20T12:00:00.000Z') / 1000),
    };

    const dbStub = {
      collection: (name: string) => {
        if (name === COLLECTIONS.TASKS) {
          return {
            countDocuments: jest.fn(async () => 0),
            aggregate: tasksAggregateMock,
            find: tasksFind,
          };
        }
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return {
            findOne: jest.fn(async () => scopedSessionDoc),
            find: jest.fn(() => ({ toArray: async () => [] })),
          };
        }
        return {
          findOne: jest.fn(async () => null),
        };
      },
    };

    getDbMock.mockReturnValue(dbStub);
    getRawDbMock.mockReturnValue(dbStub);

    const app = buildApp();
    const countsResponse = await request(app)
      .post('/voicebot/session_tab_counts')
      .send({ session_id: mixedSessionId.toHexString() });
    const draftResponse = await request(app)
      .post('/voicebot/session_tasks')
      .send({ session_id: mixedSessionId.toHexString(), bucket: 'Draft' });

    expect(countsResponse.status).toBe(200);
    expect(draftResponse.status).toBe(200);
    expect(countsResponse.body.draft_count).toBe(1);
    expect(draftResponse.body.count).toBe(1);
    expect(draftResponse.body.items[0]?.row_id).toBe('draft-mixed');
  });
});
