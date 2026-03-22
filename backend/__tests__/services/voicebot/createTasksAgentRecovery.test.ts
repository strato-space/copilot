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
              text: JSON.stringify([
                {
                  id: 'TASK-1',
                  row_id: 'TASK-1',
                  name: 'Recovered task',
                  description: 'Created after backend fallback',
                  priority: 'P2',
                },
              ]),
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
        if (name === 'voicebot_sessions') {
          return { findOne: sessionFindOne };
        }
        if (name === 'voicebot_messages') {
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
            text: JSON.stringify([
              {
                id: 'TASK-WINDOW-1',
                row_id: 'TASK-WINDOW-1',
                name: 'Windowed task',
                description: 'Task from bounded window context',
                priority: 'P3',
              },
            ]),
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
    const paddingMs = 30 * 24 * 60 * 60 * 1000;

    expect(envelope.project_id).toBe('proj-window');
    expect(crmWindow).toEqual({
      from_date: new Date(firstMessageAt.getTime() - paddingMs).toISOString(),
      to_date: new Date(lastMessageAt.getTime() + paddingMs).toISOString(),
      anchor_from: firstMessageAt.toISOString(),
      anchor_to: lastMessageAt.toISOString(),
      source: 'message_bounds',
    });
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
              text: JSON.stringify([
                {
                  id: 'TASK-2',
                  row_id: 'TASK-2',
                  name: 'Recovered after auth refresh',
                  description: 'Created after invalid-auth recovery',
                  priority: 'P2',
                },
              ]),
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
