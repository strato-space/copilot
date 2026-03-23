import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ObjectId } from 'mongodb';

const initializeSessionMock = jest.fn();
const callToolMock = jest.fn();
const closeSessionMock = jest.fn();
const quotaRecoveryMock = jest.fn();

jest.unstable_mockModule('../../../src/services/mcp/proxyClient.js', () => ({
  MCPProxyClient: jest.fn().mockImplementation(() => ({
    initializeSession: initializeSessionMock,
    callTool: callToolMock,
    closeSession: closeSessionMock,
  })),
}));

jest.unstable_mockModule('../../../src/services/voicebot/agentsRuntimeRecovery.js', () => ({
  attemptAgentsQuotaRecovery: quotaRecoveryMock,
  isAgentsQuotaFailure: (value: unknown) => {
    const text = value instanceof Error ? value.message : String(value || '');
    return /quota|usage_limit_reached|status=429|insufficient_quota|status=401|401 unauthorized|invalid openai api key|configured openai api key was rejected/i.test(text);
  },
}));

const { runCreateTasksAgent } = await import('../../../src/services/voicebot/createTasksAgent.js');

describe('runCreateTasksAgent quota fallback', () => {
  beforeEach(() => {
    initializeSessionMock.mockReset();
    callToolMock.mockReset();
    closeSessionMock.mockReset();
    quotaRecoveryMock.mockReset();
  });

  it('restarts agent runtime and retries once after quota-class failure', async () => {
    initializeSessionMock
      .mockResolvedValueOnce({ sessionId: 'first-session' })
      .mockResolvedValueOnce({ sessionId: 'second-session' });
    closeSessionMock.mockResolvedValue(undefined);
    callToolMock
      .mockResolvedValueOnce({
        success: true,
        data: {
          content: [
            {
              type: 'text',
              text: "I hit an internal error while calling the model: codexresponses request failed for model 'gpt-5.3-codex' (status=429): Error code: 429 - {'error': {'type': 'usage_limit_reached'}}.",
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                summary_md_text: '',
                scholastic_review_md: '',
                task_draft: [
                  {
                    id: 'TASK-1',
                    row_id: 'TASK-1',
                    name: 'Recovered task',
                    description: 'Created after backend fallback',
                    priority: 'P2',
                  },
                ],
                enrich_ready_task_comments: [],
                session_name: '',
                project_id: 'proj-1',
              }),
            },
          ],
        },
      });
    quotaRecoveryMock.mockResolvedValue(true);

    const tasks = await runCreateTasksAgent({
      sessionId: 'session-1',
      projectId: 'proj-1',
    });

    expect(quotaRecoveryMock).toHaveBeenCalledTimes(1);
    expect(callToolMock).toHaveBeenCalledTimes(2);
    expect(closeSessionMock).toHaveBeenCalledTimes(2);
    expect(tasks).toEqual([
      expect.objectContaining({
        id: 'TASK-1',
        row_id: 'TASK-1',
        name: 'Recovered task',
        project_id: 'proj-1',
      }),
    ]);
  });

  it('extracts composite create_tasks payload and attaches non-enumerable metadata to draft rows', async () => {
    initializeSessionMock.mockResolvedValue({ sessionId: 'meta-session' });
    closeSessionMock.mockResolvedValue(undefined);
    callToolMock.mockResolvedValue({
      success: true,
      data: {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              summary_md_text: 'Business summary',
              scholastic_review_md: 'Review markdown',
              task_draft: [
                {
                  id: 'TASK-C1',
                  row_id: 'TASK-C1',
                  name: 'Composite draft task',
                  description: 'Composite task description',
                  priority: 'P3',
                },
              ],
              enrich_ready_task_comments: [
                {
                  lookup_id: 'OPS-1',
                  comment: 'Комментарий по Ready задаче',
                },
              ],
              session_name: 'Composite title for the current working session',
              project_id: 'proj-composite',
            }),
          },
        ],
      },
    });

    const tasks = await runCreateTasksAgent({
      sessionId: 'session-composite',
      projectId: 'proj-composite',
    });

    const compositeMeta = (tasks as unknown as Record<string, unknown>).__create_tasks_composite_meta as
      | Record<string, unknown>
      | undefined;
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toEqual(
      expect.objectContaining({
        id: 'TASK-C1',
        row_id: 'TASK-C1',
        description: expect.stringContaining('## object_locators'),
      })
    );
    expect(compositeMeta).toEqual(
      expect.objectContaining({
        summary_md_text: 'Business summary',
        scholastic_review_md: 'Review markdown',
        session_name: 'Composite title for the current working session',
        project_id: 'proj-composite',
        enrich_ready_task_comments: [
          expect.objectContaining({
            lookup_id: 'OPS-1',
            comment: 'Комментарий по Ready задаче',
          }),
        ],
      })
    );
  });

  it('normalizes plain draft descriptions into canonical markdown enrichment template', async () => {
    initializeSessionMock.mockResolvedValue({ sessionId: 'template-session' });
    closeSessionMock.mockResolvedValue(undefined);
    callToolMock.mockResolvedValue({
      success: true,
      data: {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              summary_md_text: '',
              scholastic_review_md: '',
              task_draft: [
                {
                  id: 'TASK-TEMPLATE-1',
                  row_id: 'TASK-TEMPLATE-1',
                  name: 'Template draft task',
                  description: 'Сделать короткий executor-ready черновик.',
                  priority: 'P3',
                },
              ],
              enrich_ready_task_comments: [],
              session_name: 'Это слишком коротко',
              project_id: 'proj-template',
            }),
          },
        ],
      },
    });

    const tasks = await runCreateTasksAgent({
      sessionId: 'session-template',
      projectId: 'proj-template',
    });

    const compositeMeta = (tasks as unknown as Record<string, unknown>).__create_tasks_composite_meta as
      | Record<string, unknown>
      | undefined;

    expect(tasks).toHaveLength(1);
    expect(String(tasks[0]?.description || '')).toContain('## description');
    expect(String(tasks[0]?.description || '')).toContain('## object_locators');
    expect(String(tasks[0]?.description || '')).toContain('## acceptance_criteria');
    expect(compositeMeta).toEqual(
      expect.objectContaining({
        session_name: '',
      })
    );
  });

  it('adds bounded project CRM window to create_tasks envelope when session timing is available', async () => {
    const sessionId = new ObjectId().toHexString();
    const firstMessageAt = new Date('2026-01-10T12:00:00.000Z');
    const lastMessageAt = new Date('2026-01-14T16:30:00.000Z');
    const sessionFindOne = jest.fn(async () => ({
      _id: new ObjectId(sessionId),
      created_at: new Date('2026-01-09T09:00:00.000Z'),
      updated_at: new Date('2026-01-15T10:00:00.000Z'),
      done_at: new Date('2026-01-15T11:00:00.000Z'),
    }));
    const messagesFindOne = jest.fn(async (_query: unknown, options?: { sort?: Record<string, number> }) => {
      const sort = options?.sort || {};
      if (sort.message_timestamp === 1) {
        return {
          message_timestamp: Math.floor(firstMessageAt.getTime() / 1000),
          created_at: firstMessageAt,
        };
      }
      if (sort.message_timestamp === -1) {
        return {
          message_timestamp: Math.floor(lastMessageAt.getTime() / 1000),
          created_at: lastMessageAt,
        };
      }
      return null;
    });

    const dbStub = {
      collection: (name: string) => {
        if (name === 'automation_voice_bot_sessions') {
          return { findOne: sessionFindOne };
        }
        if (name === 'automation_voice_bot_messages') {
          return { findOne: messagesFindOne };
        }
        return { findOne: jest.fn(async () => null) };
      },
    };

    initializeSessionMock.mockResolvedValue({ sessionId: 'window-session' });
    closeSessionMock.mockResolvedValue(undefined);
    callToolMock.mockResolvedValue({
      success: true,
      data: {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              summary_md_text: '',
              scholastic_review_md: '',
              task_draft: [
                {
                  id: 'TASK-WINDOW-1',
                  row_id: 'TASK-WINDOW-1',
                  name: 'Windowed task',
                  description: 'Task from bounded window context',
                  priority: 'P3',
                },
              ],
              enrich_ready_task_comments: [],
              session_name: '',
              project_id: 'proj-window',
            }),
          },
        ],
      },
    });

    await runCreateTasksAgent({
      sessionId,
      projectId: 'proj-window',
      db: dbStub as never,
    });

    expect(callToolMock).toHaveBeenCalledTimes(1);
    const envelopeRaw = callToolMock.mock.calls[0]?.[1]?.message as string;
    const envelope = JSON.parse(envelopeRaw) as Record<string, unknown>;
    const crmWindow = envelope.project_crm_window as Record<string, unknown>;
    const lookbackMs = 14 * 24 * 60 * 60 * 1000;

    expect(envelope.project_id).toBe('proj-window');
    expect(crmWindow).toEqual({
      from_date: new Date(lastMessageAt.getTime() - lookbackMs).toISOString(),
      to_date: lastMessageAt.toISOString(),
      anchor_from: firstMessageAt.toISOString(),
      anchor_to: lastMessageAt.toISOString(),
      source: 'message_bounds',
    });
  });

  it('retries with reduced raw_text context after wrapped create_tasks_agent_error overflow', async () => {
    const sessionId = new ObjectId().toHexString();
    const sessionFindOne = jest.fn(async () => ({
      _id: new ObjectId(sessionId),
      session_name: 'Overflow Session',
      project_id: 'proj-overflow',
      summary_md_text: 'Нужно выделить только главные actionable items.',
      created_at: new Date('2026-03-23T10:00:00.000Z'),
      updated_at: new Date('2026-03-23T10:30:00.000Z'),
    }));
    const messagesFindOne = jest.fn(async () => ({
      message_timestamp: Math.floor(new Date('2026-03-23T10:30:00.000Z').getTime() / 1000),
      created_at: new Date('2026-03-23T10:30:00.000Z'),
    }));
    const messagesFind = jest.fn(() => ({
      sort: () => ({
        limit: () => ({
          toArray: async () => [
            {
              message_timestamp: Math.floor(new Date('2026-03-23T10:25:00.000Z').getTime() / 1000),
              transcription_text: 'Сфокусироваться на одном bounded deliverable.',
            },
          ],
        }),
      }),
    }));
    const dbStub = {
      collection: (name: string) => {
        if (name === 'automation_voice_bot_sessions') {
          return { findOne: sessionFindOne };
        }
        if (name === 'automation_voice_bot_messages') {
          return { findOne: messagesFindOne, find: messagesFind };
        }
        return { findOne: jest.fn(async () => null), find: jest.fn() };
      },
    };

    initializeSessionMock
      .mockResolvedValueOnce({ sessionId: 'overflow-session' })
      .mockResolvedValueOnce({ sessionId: 'reduced-session' });
    closeSessionMock.mockResolvedValue(undefined);
    callToolMock
      .mockResolvedValueOnce({
        success: true,
        data: {
          content: [
            {
              type: 'text',
              text: "I hit an internal error while calling the model: codexresponses request failed for model 'gpt-5.4' (code: context_length_exceeded): Your input exceeds the context window of this model.",
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                summary_md_text: '',
                scholastic_review_md: '',
                task_draft: [
                  {
                    id: 'TASK-R1',
                    row_id: 'TASK-R1',
                    name: 'Recovered after reduced retry',
                    description: 'Executor-ready description after reduced retry.',
                    priority: 'P2',
                  },
                ],
                enrich_ready_task_comments: [],
                session_name: '',
                project_id: 'proj-overflow',
              }),
            },
          ],
        },
      });

    const tasks = await runCreateTasksAgent({
      sessionId,
      projectId: 'proj-overflow',
      db: dbStub as never,
    });

    expect(callToolMock).toHaveBeenCalledTimes(2);
    const firstEnvelope = JSON.parse(callToolMock.mock.calls[0]?.[1]?.message as string) as Record<string, unknown>;
    const secondEnvelope = JSON.parse(callToolMock.mock.calls[1]?.[1]?.message as string) as Record<string, unknown>;
    expect(firstEnvelope.mode).toBe('session_id');
    expect(secondEnvelope.mode).toBe('raw_text');
    expect(String(secondEnvelope.raw_text || '')).toContain('Reduced create_tasks context for session');
    expect(tasks).toEqual([
      expect.objectContaining({
        id: 'TASK-R1',
        row_id: 'TASK-R1',
        project_id: 'proj-overflow',
      }),
    ]);
  });

  it('extracts nested context overflow from unsuccessful MCP results and retries with reduced context', async () => {
    const sessionId = new ObjectId().toHexString();
    const dbStub = {
      collection: (name: string) => {
        if (name === 'automation_voice_bot_sessions') {
          return {
            findOne: jest.fn(async () => ({
              _id: new ObjectId(sessionId),
              session_name: 'Nested Error Session',
              summary_md_text: 'Нужен короткий fallback review.',
              created_at: new Date('2026-03-23T12:00:00.000Z'),
              updated_at: new Date('2026-03-23T12:05:00.000Z'),
            })),
          };
        }
        if (name === 'automation_voice_bot_messages') {
          return {
            findOne: jest.fn(async () => ({
              message_timestamp: Math.floor(new Date('2026-03-23T12:05:00.000Z').getTime() / 1000),
              created_at: new Date('2026-03-23T12:05:00.000Z'),
            })),
            find: jest.fn(() => ({
              sort: () => ({
                limit: () => ({
                  toArray: async () => [
                    {
                      message_timestamp: Math.floor(new Date('2026-03-23T12:02:00.000Z').getTime() / 1000),
                      text: 'Нужен один bounded retry path.',
                    },
                  ],
                }),
              }),
            })),
          };
        }
        return { findOne: jest.fn(async () => null), find: jest.fn() };
      },
    };

    initializeSessionMock
      .mockResolvedValueOnce({ sessionId: 'nested-error-session' })
      .mockResolvedValueOnce({ sessionId: 'nested-reduced-session' });
    closeSessionMock.mockResolvedValue(undefined);
    callToolMock
      .mockResolvedValueOnce({
        success: false,
        error: 'create_tasks_mcp_failed',
        data: {
          content: [
            {
              type: 'text',
              text: "create_tasks_agent_error: codexresponses request failed for model 'gpt-5.4' (code: context_length_exceeded): Your input exceeds the context window of this model.",
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                summary_md_text: '',
                scholastic_review_md: '',
                task_draft: [],
                enrich_ready_task_comments: [],
                session_name: '',
                project_id: '',
              }),
            },
          ],
        },
      });

    const tasks = await runCreateTasksAgent({
      sessionId,
      db: dbStub as never,
    });

    expect(callToolMock).toHaveBeenCalledTimes(2);
    const secondEnvelope = JSON.parse(callToolMock.mock.calls[1]?.[1]?.message as string) as Record<string, unknown>;
    expect(secondEnvelope.mode).toBe('raw_text');
    expect(tasks).toEqual([]);
  });

  it('does not retry when fallback cannot recover runtime', async () => {
    initializeSessionMock.mockResolvedValue({ sessionId: 'only-session' });
    closeSessionMock.mockResolvedValue(undefined);
    callToolMock.mockResolvedValue({
      success: true,
      data: {
        content: [
          {
            type: 'text',
            text: "I hit an internal error while calling the model: codexresponses request failed for model 'gpt-5.3-codex' (status=429): Error code: 429 - {'error': {'type': 'usage_limit_reached'}}.",
          },
        ],
      },
    });
    quotaRecoveryMock.mockResolvedValue(false);

    await expect(
      runCreateTasksAgent({
        sessionId: 'session-1',
      })
    ).rejects.toThrow(/usage_limit_reached/i);

    expect(quotaRecoveryMock).toHaveBeenCalledTimes(1);
    expect(callToolMock).toHaveBeenCalledTimes(1);
  });

  it('restarts agent runtime and retries once after invalid-auth failure', async () => {
    initializeSessionMock
      .mockResolvedValueOnce({ sessionId: 'first-session' })
      .mockResolvedValueOnce({ sessionId: 'second-session' });
    closeSessionMock.mockResolvedValue(undefined);
    callToolMock
      .mockResolvedValueOnce({
        success: true,
        data: {
          content: [
            {
              type: 'text',
              text: 'Error executing tool create_tasks: Invalid OpenAI API key The configured OpenAI API key was rejected.',
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                summary_md_text: '',
                scholastic_review_md: '',
                task_draft: [
                  {
                    id: 'TASK-2',
                    row_id: 'TASK-2',
                    name: 'Recovered after auth refresh',
                    description: 'Created after invalid-auth recovery',
                    priority: 'P2',
                  },
                ],
                enrich_ready_task_comments: [],
                session_name: '',
                project_id: 'proj-2',
              }),
            },
          ],
        },
      });
    quotaRecoveryMock.mockResolvedValue(true);

    const tasks = await runCreateTasksAgent({
      sessionId: 'session-2',
      projectId: 'proj-2',
    });

    expect(quotaRecoveryMock).toHaveBeenCalledTimes(1);
    expect(callToolMock).toHaveBeenCalledTimes(2);
    expect(closeSessionMock).toHaveBeenCalledTimes(2);
    expect(tasks).toEqual([
      expect.objectContaining({
        id: 'TASK-2',
        row_id: 'TASK-2',
        name: 'Recovered after auth refresh',
        project_id: 'proj-2',
      }),
    ]);
  });
});
