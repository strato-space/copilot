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
const applyCreateTasksCompositeLinkSideEffectsMock = jest.fn();
const applyCreateTasksCompositeCommentSideEffectsMock = jest.fn();
const loggerInfoMock = jest.fn();
const loggerErrorMock = jest.fn();
const {
  extractCreateTasksRuntimeFailure: extractCreateTasksRuntimeFailureFromSource,
} = await import('../../../src/services/voicebot/createTasksAgent.ts');

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

jest.unstable_mockModule('../../../src/services/voicebot/createTasksAgent.js', async () => {
  return {
    extractCreateTasksRuntimeFailure: extractCreateTasksRuntimeFailureFromSource,
    runCreateTasksAgent: runCreateTasksAgentMock,
    runCreateTasksCompositeAgent: runCreateTasksCompositeAgentMock,
  };
});

jest.unstable_mockModule('../../../src/services/voicebot/persistPossibleTasks.js', async () => {
  return {
    POSSIBLE_TASKS_REFRESH_MODE_VALUES: ['full_recompute', 'incremental_refresh'],
    PossibleTaskStaleWriteError: class PossibleTaskStaleWriteError extends Error {},
    persistPossibleTasksForSession: persistPossibleTasksForSessionMock,
    validatePossibleTaskMasterDocs: jest.fn(async (docs: Array<Record<string, unknown>>) => docs),
  };
});

jest.unstable_mockModule('../../../src/services/voicebot/createTasksCompositeCommentSideEffects.js', () => ({
  applyCreateTasksCompositeCommentSideEffects: applyCreateTasksCompositeCommentSideEffectsMock,
}));

jest.unstable_mockModule('../../../src/services/voicebot/createTasksCompositeLinkSideEffects.js', () => ({
  applyCreateTasksCompositeLinkSideEffects: applyCreateTasksCompositeLinkSideEffectsMock,
}));

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
    applyCreateTasksCompositeLinkSideEffectsMock.mockReset();
    applyCreateTasksCompositeCommentSideEffectsMock.mockReset();
    loggerInfoMock.mockReset();
    loggerErrorMock.mockReset();

    getUserPermissionsMock.mockResolvedValue([PERMISSIONS.VOICEBOT_SESSIONS.READ_ALL]);
    generateDataFilterMock.mockResolvedValue({});
    runCreateTasksCompositeAgentMock.mockResolvedValue({
      summary_md_text: '',
      scholastic_review_md: '',
      task_draft: [],
      link_existing_tasks: [],
      enrich_ready_task_comments: [],
      session_name: '',
      project_id: '',
    });
    applyCreateTasksCompositeLinkSideEffectsMock.mockResolvedValue({
      insertedLinkages: 0,
      dedupedLinkages: 0,
      unresolvedLinkLookupIds: [],
      rejectedMalformedLinkLookupIds: [],
    });
    applyCreateTasksCompositeCommentSideEffectsMock.mockResolvedValue({
      insertedEnrichmentComments: 0,
      dedupedEnrichmentComments: 0,
      insertedCodexEnrichmentNotes: 0,
      dedupedCodexEnrichmentNotes: 0,
      unresolvedEnrichmentLookupIds: [],
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
        link_existing_tasks: [],
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
    expect(applyCreateTasksCompositeLinkSideEffectsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: fixture.sessionId.toString(),
        session: expect.objectContaining({
          session_name: 'Morning Session about bounded task planning',
          project_id: fixture.projectId.toHexString(),
        }),
        drafts: [],
      })
    );

    expect(persistPossibleTasksForSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        db: fixture.dbStub,
        sessionId: fixture.sessionId.toString(),
        sessionName: 'Morning Session about bounded task planning',
        defaultProjectId: fixture.projectId.toHexString(),
        refreshMode: 'full_recompute',
        allowProjectSemanticReuse: false,
      })
    );
    const sessionsCollection = fixture.dbStub.collection(VOICEBOT_COLLECTIONS.SESSIONS) as StubCollection;
    expect(sessionsCollection.updateOne).toHaveBeenCalledWith(
      { _id: fixture.sessionId },
      {
        $set: expect.objectContaining({
          summary_md_text: 'Короткое саммари по диалогу.',
          summary_saved_at: expect.any(Date),
          review_md_text: 'Review markdown',
          session_name: 'Morning Session about bounded task planning',
          updated_at: expect.any(Date),
        }),
      }
    );
    expect(applyCreateTasksCompositeCommentSideEffectsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: fixture.sessionId.toString(),
        drafts: [],
      })
    );
  });

  it('treats link/comment-only composites as non-empty work and passes resolved session context to side effects', async () => {
    const fixture = buildFixture();
    const reassignedProjectId = new ObjectId().toHexString();
    getDbMock.mockReturnValue(fixture.dbStub);
    getRawDbMock.mockReturnValue(fixture.dbStub);
    applyCreateTasksCompositeLinkSideEffectsMock.mockResolvedValue({
      insertedLinkages: 1,
      dedupedLinkages: 0,
      unresolvedLinkLookupIds: [],
      rejectedMalformedLinkLookupIds: [],
    });
    applyCreateTasksCompositeCommentSideEffectsMock.mockResolvedValue({
      insertedEnrichmentComments: 1,
      dedupedEnrichmentComments: 0,
      insertedCodexEnrichmentNotes: 0,
      dedupedCodexEnrichmentNotes: 0,
      unresolvedEnrichmentLookupIds: [],
    });

    const generatedTasks: Array<Record<string, unknown>> = [];
    Object.defineProperty(generatedTasks, '__create_tasks_composite_meta', {
      value: {
        summary_md_text: 'Link existing task',
        scholastic_review_md: 'Review markdown',
        task_draft: [],
        link_existing_tasks: [{ lookup_id: 'ready-task-1', dialogue_reference: 'voice/session/x#1' }],
        enrich_ready_task_comments: [{ lookup_id: 'ready-task-1', comment: 'Need follow-up', dialogue_reference: 'voice/session/x#1' }],
        session_name: 'Link-only Session',
        project_id: reassignedProjectId,
        no_task_decision: {
          code: 'explicit_zero',
          reason: 'should be ignored when side effects exist',
          evidence: ['agent'],
          inferred: false,
          source: 'agent_explicit',
        },
      },
      enumerable: false,
      configurable: true,
    });
    runCreateTasksAgentMock.mockResolvedValue(generatedTasks);
    persistPossibleTasksForSessionMock.mockResolvedValue({
      items: [],
      removedRowIds: [],
    });

    const app = createApp(fixture.performerId);
    const response = await request(app)
      .post('/voicebot/generate_possible_tasks')
      .send({ session_id: fixture.sessionId.toString() });

    expect(response.status).toBe(200);
    expect(response.body.no_task_decision).toBeUndefined();
    expect(applyCreateTasksCompositeLinkSideEffectsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        session: expect.objectContaining({
          session_name: 'Link-only Session',
          project_id: reassignedProjectId,
        }),
        drafts: [{ lookup_id: 'ready-task-1', dialogue_reference: 'voice/session/x#1' }],
      })
    );
    expect(applyCreateTasksCompositeCommentSideEffectsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        session: expect.objectContaining({
          session_name: 'Link-only Session',
          project_id: reassignedProjectId,
        }),
        drafts: [{ lookup_id: 'ready-task-1', comment: 'Need follow-up', dialogue_reference: 'voice/session/x#1' }],
      })
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

  it('returns inferred no_task_decision when create_tasks yields zero persisted drafts without an explicit reason', async () => {
    const fixture = buildFixture();
    getDbMock.mockReturnValue(fixture.dbStub);
    getRawDbMock.mockReturnValue(fixture.dbStub);

    const generatedTasks: Array<Record<string, unknown>> = [];
    Object.defineProperty(generatedTasks, '__create_tasks_composite_meta', {
      value: {
        summary_md_text: 'Есть summary',
        scholastic_review_md: 'Есть review',
        task_draft: [],
        link_existing_tasks: [],
        enrich_ready_task_comments: [],
        session_name: '',
        project_id: fixture.projectId.toHexString(),
      },
      enumerable: false,
      configurable: true,
    });
    runCreateTasksAgentMock.mockResolvedValue(generatedTasks);
    persistPossibleTasksForSessionMock.mockResolvedValue({
      items: [],
    });

    const app = createApp(fixture.performerId);
    const response = await request(app)
      .post('/voicebot/generate_possible_tasks')
      .send({ session_id: fixture.sessionId.toHexString() });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.generated_count).toBe(0);
    expect(response.body.saved_count).toBe(0);
    expect(response.body.no_task_decision).toEqual(
      expect.objectContaining({
        code: 'no_task_reason_missing',
        inferred: true,
        source: 'agent_inferred',
      })
    );

    const sessionsCollection = fixture.dbStub.collection(VOICEBOT_COLLECTIONS.SESSIONS) as StubCollection;
    expect(sessionsCollection.updateOne).toHaveBeenCalledWith(
      { _id: fixture.sessionId },
      expect.objectContaining({
        $set: expect.objectContaining({
          'processors_data.CREATE_TASKS.last_tasks_count': 0,
          'processors_data.CREATE_TASKS.no_task_reason_code': 'no_task_reason_missing',
        }),
      })
    );
  });

  it('keeps no_task_decision when link/comment artifacts are extracted but no side effects apply', async () => {
    const fixture = buildFixture();
    const reassignedProjectId = new ObjectId().toHexString();
    getDbMock.mockReturnValue(fixture.dbStub);
    getRawDbMock.mockReturnValue(fixture.dbStub);

    const generatedTasks: Array<Record<string, unknown>> = [];
    Object.defineProperty(generatedTasks, '__create_tasks_composite_meta', {
      value: {
        summary_md_text: 'Link existing task',
        scholastic_review_md: 'Review markdown',
        task_draft: [],
        link_existing_tasks: [{ lookup_id: 'missing-task', dialogue_reference: 'voice/session/x#1' }],
        enrich_ready_task_comments: [{ lookup_id: 'missing-task', comment: 'Need follow-up', dialogue_reference: 'voice/session/x#1' }],
        session_name: 'Unapplied link-only Session',
        project_id: reassignedProjectId,
      },
      enumerable: false,
      configurable: true,
    });
    runCreateTasksAgentMock.mockResolvedValue(generatedTasks);
    persistPossibleTasksForSessionMock.mockResolvedValue({
      items: [],
      removedRowIds: [],
    });
    applyCreateTasksCompositeLinkSideEffectsMock.mockResolvedValue({
      insertedLinkages: 0,
      dedupedLinkages: 0,
      unresolvedLinkLookupIds: ['missing-task'],
      rejectedMalformedLinkLookupIds: [],
    });
    applyCreateTasksCompositeCommentSideEffectsMock.mockResolvedValue({
      insertedEnrichmentComments: 0,
      dedupedEnrichmentComments: 0,
      insertedCodexEnrichmentNotes: 0,
      dedupedCodexEnrichmentNotes: 0,
      unresolvedEnrichmentLookupIds: ['missing-task'],
    });

    const app = createApp(fixture.performerId);
    const response = await request(app)
      .post('/voicebot/generate_possible_tasks')
      .send({ session_id: fixture.sessionId.toString() });

    expect(response.status).toBe(200);
    expect(response.body.no_task_decision).toEqual(
      expect.objectContaining({
        code: 'no_task_reason_missing',
        inferred: true,
      })
    );
  });

  it('returns persistence-inferred no_persistable_drafts when extracted drafts collapse to zero persisted rows', async () => {
    const fixture = buildFixture();
    getDbMock.mockReturnValue(fixture.dbStub);
    getRawDbMock.mockReturnValue(fixture.dbStub);

    const generatedTasks: Array<Record<string, unknown>> = [
      { row_id: 'ai-row-1', id: 'ai-row-1', name: 'AI draft 1', priority: 'P2' },
    ];
    Object.defineProperty(generatedTasks, '__create_tasks_composite_meta', {
      value: {
        summary_md_text: '',
        scholastic_review_md: '',
        task_draft: [],
        link_existing_tasks: [],
        enrich_ready_task_comments: [],
        session_name: '',
        project_id: fixture.projectId.toHexString(),
      },
      enumerable: false,
      configurable: true,
    });
    runCreateTasksAgentMock.mockResolvedValue(generatedTasks);
    persistPossibleTasksForSessionMock.mockResolvedValue({
      items: [],
    });

    const app = createApp(fixture.performerId);
    const response = await request(app)
      .post('/voicebot/generate_possible_tasks')
      .send({ session_id: fixture.sessionId.toHexString() });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.generated_count).toBe(1);
    expect(response.body.saved_count).toBe(0);
    expect(response.body.no_task_decision).toEqual(
      expect.objectContaining({
        code: 'no_persistable_drafts',
        inferred: true,
        source: 'persistence_inferred',
      })
    );
    expect(response.body.no_task_decision.evidence).toEqual(
      expect.arrayContaining(['extracted_task_count=1', 'persisted_task_count=0'])
    );

    const completionCall = loggerInfoMock.mock.calls.find(
      ([eventName]) => eventName === '[voicebot.sessions] generate_possible_tasks_completed'
    );
    expect(completionCall?.[1]).toEqual(
      expect.objectContaining({
        no_task_reason_code: 'no_persistable_drafts',
        generated_count: 1,
        saved_count: 0,
      })
    );

    const sessionsCollection = fixture.dbStub.collection(VOICEBOT_COLLECTIONS.SESSIONS) as StubCollection;
    expect(sessionsCollection.updateOne).toHaveBeenCalledWith(
      { _id: fixture.sessionId },
      expect.objectContaining({
        $set: expect.objectContaining({
          'processors_data.CREATE_TASKS.last_tasks_count': 0,
          'processors_data.CREATE_TASKS.no_task_reason_code': 'no_persistable_drafts',
        }),
      })
    );
  });

  it('does not infer no_task_decision when zero extraction keeps existing persisted drafts', async () => {
    const fixture = buildFixture();
    getDbMock.mockReturnValue(fixture.dbStub);
    getRawDbMock.mockReturnValue(fixture.dbStub);

    const generatedTasks: Array<Record<string, unknown>> = [];
    Object.defineProperty(generatedTasks, '__create_tasks_composite_meta', {
      value: {
        summary_md_text: '',
        scholastic_review_md: '',
        task_draft: [],
        link_existing_tasks: [],
        enrich_ready_task_comments: [],
        session_name: '',
        project_id: fixture.projectId.toHexString(),
      },
      enumerable: false,
      configurable: true,
    });
    runCreateTasksAgentMock.mockResolvedValue(generatedTasks);
    persistPossibleTasksForSessionMock.mockResolvedValue({
      items: [{ row_id: 'existing-draft-row', id: 'existing-draft-row', name: 'Existing draft row' }],
    });

    const app = createApp(fixture.performerId);
    const response = await request(app)
      .post('/voicebot/generate_possible_tasks')
      .send({ session_id: fixture.sessionId.toHexString() });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.generated_count).toBe(0);
    expect(response.body.saved_count).toBe(1);
    expect(response.body.no_task_decision).toBeUndefined();

    const completionCall = loggerInfoMock.mock.calls.find(
      ([eventName]) => eventName === '[voicebot.sessions] generate_possible_tasks_completed'
    );
    expect(completionCall?.[1]).toEqual(
      expect.objectContaining({
        no_task_reason_code: null,
        generated_count: 0,
        saved_count: 1,
      })
    );
  });

  it('returns machine-readable transition rejection details without flattening in generate_possible_tasks API', async () => {
    const fixture = buildFixture();
    getDbMock.mockReturnValue(fixture.dbStub);
    getRawDbMock.mockReturnValue(fixture.dbStub);

    const transitionFailure = {
      code: 'create_tasks_transition_retries_exhausted',
      message: 'Runtime transition reformulation budget exhausted',
      runtime_rejections: [
        {
          candidate_id: 'TASK-INVALID',
          attempted_surface: 'task_draft',
          candidate_class: 'missing',
          violated_invariant_code: 'task_draft_class_missing',
          message: 'Task draft candidate class is required and missing.',
          recovery_action: 'reclassify',
        },
      ],
      retry_budget: {
        transition_reformulation_attempts: 1,
        transition_reformulation_limit: 1,
      },
    };
    runCreateTasksAgentMock.mockRejectedValue(
      Object.assign(new Error('transition failure'), { details: transitionFailure })
    );

    const app = createApp(fixture.performerId);
    const response = await request(app)
      .post('/voicebot/generate_possible_tasks')
      .send({ session_id: fixture.sessionId.toHexString() });

    expect(response.status).toBe(422);
    expect(response.body).toEqual(
      expect.objectContaining({
        error: 'Runtime transition reformulation budget exhausted',
        error_code: 'create_tasks_transition_retries_exhausted',
        error_details: expect.objectContaining({
          runtime_rejections: expect.any(Array),
        }),
      })
    );
    expect(loggerErrorMock).not.toHaveBeenCalledWith('Error in generate_possible_tasks:', expect.anything());
  });
});
