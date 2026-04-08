import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ObjectId } from 'mongodb';

import {
  VOICEBOT_COLLECTIONS,
  VOICEBOT_JOBS,
  VOICEBOT_QUEUES,
} from '../../../src/constants.js';

const getDbMock = jest.fn();
const getVoicebotQueuesMock = jest.fn();
const runCreateTasksAgentMock = jest.fn();
const persistPossibleTasksForSessionMock = jest.fn();
const applyCreateTasksCompositeCommentSideEffectsMock = jest.fn();
const CREATE_TASKS_COMPOSITE_META_KEY = '__create_tasks_composite_meta';
const {
  extractCreateTasksRuntimeFailure: extractCreateTasksRuntimeFailureFromSource,
  isCreateTasksMessageGarbageFlagged: isCreateTasksMessageGarbageFlaggedFromSource,
} = await import('../../../src/services/voicebot/createTasksAgent.ts');

jest.unstable_mockModule('../../../src/services/db.js', () => ({
  getDb: getDbMock,
}));

jest.unstable_mockModule('../../../src/services/voicebotQueues.js', () => ({
  getVoicebotQueues: getVoicebotQueuesMock,
}));

jest.unstable_mockModule('../../../src/services/voicebot/createTasksAgent.js', async () => {
  return {
    CREATE_TASKS_COMPOSITE_META_KEY,
    extractCreateTasksRuntimeFailure: extractCreateTasksRuntimeFailureFromSource,
    isCreateTasksMessageGarbageFlagged: isCreateTasksMessageGarbageFlaggedFromSource,
    runCreateTasksAgent: runCreateTasksAgentMock,
  };
});

jest.unstable_mockModule('../../../src/services/voicebot/persistPossibleTasks.js', () => ({
  persistPossibleTasksForSession: persistPossibleTasksForSessionMock,
}));

jest.unstable_mockModule('../../../src/services/voicebot/createTasksCompositeCommentSideEffects.js', () => ({
  applyCreateTasksCompositeCommentSideEffects: applyCreateTasksCompositeCommentSideEffectsMock,
}));

const { handleCreateTasksFromChunksJob } = await import(
  '../../../src/workers/voicebot/handlers/createTasksFromChunks.js'
);

describe('handleCreateTasksFromChunksJob', () => {
  beforeEach(() => {
    getDbMock.mockReset();
    getVoicebotQueuesMock.mockReset();
    runCreateTasksAgentMock.mockReset();
    persistPossibleTasksForSessionMock.mockReset();
    applyCreateTasksCompositeCommentSideEffectsMock.mockReset();
    applyCreateTasksCompositeCommentSideEffectsMock.mockResolvedValue({
      insertedEnrichmentComments: 0,
      dedupedEnrichmentComments: 0,
      insertedCodexEnrichmentNotes: 0,
      dedupedCodexEnrichmentNotes: 0,
      unresolvedEnrichmentLookupIds: [],
    });
  });

  it('recomputes full-session possible tasks when chunks_to_process is empty', async () => {
    const sessionId = new ObjectId();
    const generatedProjectId = new ObjectId().toString();
    const sessionsFindOne = jest.fn(async () => ({
      _id: sessionId,
      session_name: 'Demo session',
      project_id: 'proj-1',
      user_id: 'user-1',
    }));
    const sessionsUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
    const eventsAdd = jest.fn(async () => ({ id: 'event-job' }));

    getDbMock.mockReturnValue({
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return {
            findOne: sessionsFindOne,
            updateOne: sessionsUpdateOne,
          };
        }
        return {};
      },
    });

    getVoicebotQueuesMock.mockReturnValue({
      [VOICEBOT_QUEUES.EVENTS]: { add: eventsAdd },
    });

    const generatedTasks = [
      {
        row_id: 'TASK-1',
        id: 'TASK-1',
        name: 'Ship parity',
        description: 'Implement parity',
        priority: 'P2',
      },
    ] as Array<Record<string, unknown>>;
    (generatedTasks as unknown as Record<string, unknown>)[CREATE_TASKS_COMPOSITE_META_KEY] = {
      summary_md_text: 'Summary body',
      scholastic_review_md: 'Review body',
      session_name: 'Demo session with generated title',
      project_id: generatedProjectId,
    };
    runCreateTasksAgentMock.mockResolvedValue(generatedTasks);
    persistPossibleTasksForSessionMock.mockResolvedValue({
      items: [{ id: 'TASK-1', row_id: 'TASK-1', name: 'Ship parity' }],
      rows: [{ id: 'TASK-1', row_id: 'TASK-1', name: 'Ship parity' }],
      removedRowIds: [],
    });

    const result = await handleCreateTasksFromChunksJob({
      session_id: sessionId.toString(),
      chunks_to_process: [],
    });

    expect(result).toMatchObject({
      ok: true,
      session_id: sessionId.toString(),
      tasks_count: 1,
    });
    expect(runCreateTasksAgentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: sessionId.toString(),
        projectId: 'proj-1',
      })
    );
    expect(persistPossibleTasksForSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: sessionId.toString(),
        sessionName: 'Demo session with generated title',
        defaultProjectId: generatedProjectId,
        refreshMode: 'full_recompute',
      })
    );
    expect(sessionsUpdateOne).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ _id: sessionId }),
      expect.objectContaining({
        $set: expect.objectContaining({
          summary_md_text: 'Summary body',
          review_md_text: 'Review body',
          session_name: 'Demo session with generated title',
          project_id: expect.any(ObjectId),
        }),
      })
    );
    expect(sessionsUpdateOne).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ _id: sessionId }),
      expect.objectContaining({
        $set: expect.objectContaining({
          'processors_data.CREATE_TASKS.is_processing': false,
          'processors_data.CREATE_TASKS.is_processed': true,
        }),
        $unset: expect.objectContaining({
          'processors_data.CREATE_TASKS.error': 1,
          'processors_data.CREATE_TASKS.error_message': 1,
          'processors_data.CREATE_TASKS.error_timestamp': 1,
        }),
      })
    );
    expect(applyCreateTasksCompositeCommentSideEffectsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: sessionId.toString(),
        drafts: undefined,
      })
    );
  });

  it('filters garbage-flagged rows out of full-recompute raw_text context', async () => {
    const sessionId = new ObjectId();
    const sessionsFindOne = jest.fn(async () => ({
      _id: sessionId,
      session_name: 'Garbage filter session',
      project_id: 'proj-1',
      user_id: 'user-1',
    }));
    const sessionsUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
    const messagesFind = jest.fn(() => ({
      sort: () => ({
        toArray: async () => [
          {
            _id: new ObjectId(),
            transcription: {
              text: 'Keep this executor-ready transcript.',
            },
            garbage_detected: false,
            garbage_detection: {
              is_garbage: false,
              code: 'valid_speech',
            },
          },
          {
            _id: new ObjectId(),
            transcription: {
              text: 'Drop this garbage loop.',
            },
            garbage_detected: true,
            garbage_detection: {
              is_garbage: true,
              code: 'noise_or_garbage',
            },
          },
          {
            _id: new ObjectId(),
            transcription: {
              text: 'Legacy clean text fallback.',
            },
            garbage_detection: {
              is_garbage: false,
              code: 'valid_speech_ru',
            },
          },
        ],
      }),
    }));
    const eventsAdd = jest.fn(async () => ({ id: 'event-job' }));

    getDbMock.mockReturnValue({
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return {
            findOne: sessionsFindOne,
            updateOne: sessionsUpdateOne,
          };
        }
        if (name === VOICEBOT_COLLECTIONS.MESSAGES) {
          return {
            find: messagesFind,
          };
        }
        return {};
      },
    });

    getVoicebotQueuesMock.mockReturnValue({
      [VOICEBOT_QUEUES.EVENTS]: { add: eventsAdd },
    });

    const generatedTasks = [
      {
        row_id: 'TASK-1',
        id: 'TASK-1',
        name: 'Ship parity',
        description: 'Implement parity',
        priority: 'P2',
      },
    ] as Array<Record<string, unknown>>;
    (generatedTasks as unknown as Record<string, unknown>)[CREATE_TASKS_COMPOSITE_META_KEY] = {
      summary_md_text: 'Summary body',
      scholastic_review_md: 'Review body',
      session_name: 'Garbage filter session',
      project_id: 'proj-1',
    };
    runCreateTasksAgentMock.mockResolvedValue(generatedTasks);
    persistPossibleTasksForSessionMock.mockResolvedValue({
      items: [{ id: 'TASK-1', row_id: 'TASK-1', name: 'Ship parity' }],
      rows: [{ id: 'TASK-1', row_id: 'TASK-1', name: 'Ship parity' }],
      removedRowIds: [],
    });

    await handleCreateTasksFromChunksJob({
      session_id: sessionId.toString(),
      chunks_to_process: [],
    });

    expect(runCreateTasksAgentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: sessionId.toString(),
        projectId: 'proj-1',
        rawText: 'Keep this executor-ready transcript.\n\nLegacy clean text fallback.',
      })
    );
  });

  it('uses raw_text mode when explicit chunks are provided and emits session_update refresh', async () => {
    const sessionId = new ObjectId();
    const sessionsFindOne = jest.fn(async () => ({
      _id: sessionId,
      session_name: 'Demo session',
      project_id: 'proj-1',
      user_id: 'user-1',
    }));
    const eventsAdd = jest.fn(async () => ({ id: 'event-job' }));

    getDbMock.mockReturnValue({
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return {
            findOne: sessionsFindOne,
            updateOne: jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 })),
          };
        }
        return {};
      },
    });

    getVoicebotQueuesMock.mockReturnValue({
      [VOICEBOT_QUEUES.EVENTS]: { add: eventsAdd },
    });

    runCreateTasksAgentMock.mockResolvedValue([
      {
        row_id: 'TASK-1',
        id: 'TASK-1',
        name: 'Ship parity',
        description: 'Implement parity',
        priority: 'P2',
      },
    ]);
    persistPossibleTasksForSessionMock.mockResolvedValue({
      items: [{ id: 'TASK-1', row_id: 'TASK-1', name: 'Ship parity' }],
      rows: [{ id: 'TASK-1', row_id: 'TASK-1', name: 'Ship parity' }],
      removedRowIds: [],
    });

    const result = await handleCreateTasksFromChunksJob({
      session_id: sessionId.toString(),
      chunks_to_process: [{ text: 'Need to ship parity this week' }],
    });

    expect(result).toMatchObject({
      ok: true,
      session_id: sessionId.toString(),
      tasks_count: 1,
    });
    expect(runCreateTasksAgentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: sessionId.toString(),
        projectId: 'proj-1',
        rawText: 'Need to ship parity this week',
      })
    );
    expect(persistPossibleTasksForSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: sessionId.toString(),
        refreshMode: 'incremental_refresh',
      })
    );
    expect(eventsAdd).toHaveBeenCalledWith(
      VOICEBOT_JOBS.events.SEND_TO_SOCKET,
      expect.objectContaining({
        session_id: sessionId.toString(),
        event: 'session_update',
        payload: expect.objectContaining({
          session_id: sessionId.toString(),
          taskflow_refresh: expect.objectContaining({
            reason: 'auto_transcription_chunk',
            possible_tasks: true,
          }),
        }),
      }),
      expect.objectContaining({ attempts: 1 })
    );
  });

  it('returns and persists explicit no_task_decision when zero drafts are produced for 69c37a231f1bc03e330f9641', async () => {
    const sessionId = new ObjectId('69c37a231f1bc03e330f9641');
    const sessionsFindOne = jest.fn(async () => ({
      _id: sessionId,
      session_name: 'Repro session',
      project_id: 'proj-repro',
      user_id: 'user-1',
    }));
    const sessionsUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
    const eventsAdd = jest.fn(async () => ({ id: 'event-job' }));

    getDbMock.mockReturnValue({
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return {
            findOne: sessionsFindOne,
            updateOne: sessionsUpdateOne,
          };
        }
        return {};
      },
    });
    getVoicebotQueuesMock.mockReturnValue({
      [VOICEBOT_QUEUES.EVENTS]: { add: eventsAdd },
    });

    const generatedTasks: Array<Record<string, unknown>> = [];
    (generatedTasks as unknown as Record<string, unknown>)[CREATE_TASKS_COMPOSITE_META_KEY] = {
      summary_md_text: 'Summary exists',
      scholastic_review_md: 'Review exists',
      session_name: '',
      project_id: 'proj-repro',
      no_task_decision: {
        code: 'discussion-only',
        reason: 'No bounded owner-driven action extracted.',
        evidence: ['Strategic discussion only'],
      },
    };
    runCreateTasksAgentMock.mockResolvedValue(generatedTasks);
    persistPossibleTasksForSessionMock.mockResolvedValue({
      items: [],
      rows: [],
      removedRowIds: [],
    });

    const result = await handleCreateTasksFromChunksJob({
      session_id: sessionId.toHexString(),
      chunks_to_process: [],
    });

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        session_id: sessionId.toHexString(),
        tasks_count: 0,
        skipped: true,
        reason: 'no_tasks',
        no_task_decision: expect.objectContaining({
          code: 'discussion_only',
          inferred: false,
          source: 'agent_explicit',
        }),
      })
    );

    expect(sessionsUpdateOne).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ _id: sessionId }),
      expect.objectContaining({
        $set: expect.objectContaining({
          'processors_data.CREATE_TASKS.last_tasks_count': 0,
          'processors_data.CREATE_TASKS.no_task_reason_code': 'discussion_only',
          'processors_data.CREATE_TASKS.no_task_reason': 'No bounded owner-driven action extracted.',
        }),
      })
    );
    expect(eventsAdd).toHaveBeenCalledTimes(1);
  });

  it('marks processor error when agent execution fails', async () => {
    const sessionId = new ObjectId();
    const sessionsFindOne = jest.fn(async () => ({
      _id: sessionId,
      session_name: 'Demo session',
      project_id: 'proj-1',
      user_id: 'user-1',
    }));
    const sessionsUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));

    getDbMock.mockReturnValue({
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return {
            findOne: sessionsFindOne,
            updateOne: sessionsUpdateOne,
          };
        }
        return {};
      },
    });
    getVoicebotQueuesMock.mockReturnValue(null);

    runCreateTasksAgentMock.mockRejectedValue(new Error('create_tasks_agent_error: insufficient_quota'));

    const result = await handleCreateTasksFromChunksJob({
      session_id: sessionId.toString(),
      chunks_to_process: ['need this task'],
    });

    expect(result).toMatchObject({
      ok: false,
      error: 'create_tasks_agent_error: insufficient_quota',
      session_id: sessionId.toString(),
    });
    const updatePayload = sessionsUpdateOne.mock.calls[0]?.[1] as Record<string, unknown>;
    const setPayload = (updatePayload.$set as Record<string, unknown>) || {};
    expect(setPayload['processors_data.CREATE_TASKS.job_finished_timestamp']).toEqual(expect.any(Number));
    expect(setPayload['processors_data.CREATE_TASKS.error']).toBe('create_tasks_agent_error: insufficient_quota');
  });

  it('persists machine-readable transition rejection payload instead of flattening to string', async () => {
    const sessionId = new ObjectId();
    const sessionsFindOne = jest.fn(async () => ({
      _id: sessionId,
      session_name: 'Demo session',
      project_id: 'proj-1',
      user_id: 'user-1',
    }));
    const sessionsUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));

    getDbMock.mockReturnValue({
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return {
            findOne: sessionsFindOne,
            updateOne: sessionsUpdateOne,
          };
        }
        return {};
      },
    });
    getVoicebotQueuesMock.mockReturnValue(null);

    const transitionFailure = {
      code: 'create_tasks_transition_retries_exhausted',
      message: 'Runtime transition reformulation budget exhausted',
      runtime_rejections: [
        {
          candidate_id: 'TASK-INVALID',
          attempted_surface: 'task_draft',
          candidate_class: 'coordination_only',
          violated_invariant_code: 'task_draft_class_not_materializable',
          message: 'Task draft candidate class is not materializable',
          recovery_action: 'reattribute',
        },
      ],
      retry_budget: {
        transition_reformulation_attempts: 1,
        transition_reformulation_limit: 1,
      },
    };
    runCreateTasksAgentMock.mockRejectedValue(
      Object.assign(new Error('transition failed'), { details: transitionFailure })
    );

    const result = await handleCreateTasksFromChunksJob({
      session_id: sessionId.toString(),
      chunks_to_process: ['need this task'],
    });

    expect(result).toMatchObject({
      ok: false,
      error: 'Runtime transition reformulation budget exhausted',
      error_details: expect.objectContaining({
        code: 'create_tasks_transition_retries_exhausted',
      }),
    });
    const updatePayload = sessionsUpdateOne.mock.calls[0]?.[1] as Record<string, unknown>;
    const setPayload = (updatePayload.$set as Record<string, unknown>) || {};
    expect(setPayload['processors_data.CREATE_TASKS.error']).toEqual(
      expect.objectContaining({
        code: 'create_tasks_transition_retries_exhausted',
        runtime_rejections: expect.any(Array),
      })
    );
    expect(setPayload['processors_data.CREATE_TASKS.error_message']).toBe(
      'Runtime transition reformulation budget exhausted'
    );
  });

  it('returns a deterministic malformed runtime_rejections machine code when runtime failure payload is malformed', async () => {
    const sessionId = new ObjectId();
    const sessionsFindOne = jest.fn(async () => ({
      _id: sessionId,
      session_name: 'Demo session',
      project_id: 'proj-1',
      user_id: 'user-1',
    }));
    const sessionsUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));

    getDbMock.mockReturnValue({
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return {
            findOne: sessionsFindOne,
            updateOne: sessionsUpdateOne,
          };
        }
        return {};
      },
    });
    getVoicebotQueuesMock.mockReturnValue(null);

    runCreateTasksAgentMock.mockRejectedValue(
      Object.assign(new Error('malformed transition payload'), {
        details: {
          code: 'create_tasks_transition_rejection',
          message: 'Runtime transition rejected non-materializable task_draft candidates',
          runtime_rejections: 'malformed',
          retry_budget: {
            transition_reformulation_attempts: 0,
            transition_reformulation_limit: 1,
          },
        },
      })
    );

    const result = await handleCreateTasksFromChunksJob({
      session_id: sessionId.toString(),
      chunks_to_process: ['need this task'],
    });

    expect(result).toMatchObject({
      ok: false,
      error: 'Malformed runtime_rejections payload',
      error_details: expect.objectContaining({
        code: 'create_tasks_runtime_rejections_malformed',
      }),
    });
    const updatePayload = sessionsUpdateOne.mock.calls[0]?.[1] as Record<string, unknown>;
    const setPayload = (updatePayload.$set as Record<string, unknown>) || {};
    expect(setPayload['processors_data.CREATE_TASKS.error']).toEqual(
      expect.objectContaining({
        code: 'create_tasks_runtime_rejections_malformed',
      })
    );
  });

  it('does not persist or emit no_tasks when agent returns a semantically empty composite failure', async () => {
    const sessionId = new ObjectId();
    const sessionsFindOne = jest.fn(async () => ({
      _id: sessionId,
      session_name: 'Demo session',
      project_id: 'proj-1',
      user_id: 'user-1',
    }));
    const sessionsUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));

    getDbMock.mockReturnValue({
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return {
            findOne: sessionsFindOne,
            updateOne: sessionsUpdateOne,
          };
        }
        return {};
      },
    });
    getVoicebotQueuesMock.mockReturnValue({
      [VOICEBOT_QUEUES.EVENTS]: { add: jest.fn(async () => ({ id: 'event-job' })) },
    });

    runCreateTasksAgentMock.mockRejectedValue(new Error('create_tasks_empty_mcp_result'));

    const result = await handleCreateTasksFromChunksJob({
      session_id: sessionId.toString(),
      chunks_to_process: [],
    });

    expect(result).toMatchObject({
      ok: false,
      error: 'create_tasks_empty_mcp_result',
      session_id: sessionId.toString(),
    });
    expect(persistPossibleTasksForSessionMock).not.toHaveBeenCalled();
    expect(applyCreateTasksCompositeCommentSideEffectsMock).not.toHaveBeenCalled();
    expect(sessionsUpdateOne).toHaveBeenCalledTimes(1);
    const updatePayload = sessionsUpdateOne.mock.calls[0]?.[1] as Record<string, unknown>;
    const setPayload = (updatePayload.$set as Record<string, unknown>) || {};
    expect(setPayload['processors_data.CREATE_TASKS.is_processed']).toBe(false);
    expect(setPayload['processors_data.CREATE_TASKS.error']).toBe('create_tasks_empty_mcp_result');
  });
});
