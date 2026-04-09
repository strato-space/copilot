import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ObjectId } from 'mongodb';
import { writeFileSync } from 'node:fs';
import { VOICEBOT_COLLECTIONS } from '../../../src/constants.js';

const initializeSessionMock = jest.fn();
const callToolMock = jest.fn();
const closeSessionMock = jest.fn();
const quotaRecoveryMock = jest.fn();
const openAiResponsesCreateMock = jest.fn();
const loadPersistedPossibleTaskCarryOverDraftsMock = jest.fn();
const spawnSyncMock = jest.fn();
const CREATE_TASKS_COMPOSITE_META_KEY = '__create_tasks_composite_meta';

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
};

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

jest.unstable_mockModule('openai', () => ({
  default: jest.fn().mockImplementation(() => ({
    responses: {
      create: openAiResponsesCreateMock,
    },
  })),
}));

jest.unstable_mockModule('../../../src/services/voicebot/persistPossibleTasks.js', () => ({
  loadPersistedPossibleTaskCarryOverDrafts: loadPersistedPossibleTaskCarryOverDraftsMock,
}));

jest.unstable_mockModule('node:child_process', () => ({
  spawnSync: spawnSyncMock,
}));

const {
  runCreateTasksAgent,
  isCreateTasksMessageGarbageFlagged,
  parseCreateTasksCompositeResult,
  GREEK_SCHOLASTIC_REVIEW_RULE_TEXT,
} = await import('../../../src/services/voicebot/createTasksAgent.js');

describe('runCreateTasksAgent quota fallback', () => {
  beforeEach(() => {
    initializeSessionMock.mockReset();
    callToolMock.mockReset();
    closeSessionMock.mockReset();
    quotaRecoveryMock.mockReset();
    openAiResponsesCreateMock.mockReset();
    loadPersistedPossibleTaskCarryOverDraftsMock.mockReset();
    spawnSyncMock.mockReset();
    loadPersistedPossibleTaskCarryOverDraftsMock.mockResolvedValue([]);
    process.env.OPENAI_API_KEY = 'test-openai-key';
    openAiResponsesCreateMock.mockImplementation(async (request?: { input?: string }) => {
      const raw = String(request?.input || '').trim();
      const parsed = raw ? JSON.parse(raw) as { composite?: unknown } : {};
      return {
        output_text: JSON.stringify(parsed.composite || {}),
      };
    });
  });

  it('treats valid_* garbage detector codes as non-garbage and excludes deleted messages', () => {
    expect(
      isCreateTasksMessageGarbageFlagged({
        garbage_detected: false,
        garbage_detection: { is_garbage: false, code: 'valid_speech_ru' },
      })
    ).toBe(false);
    expect(
      isCreateTasksMessageGarbageFlagged({
        is_deleted: true,
        garbage_detection: { is_garbage: false, code: 'valid_speech' },
      })
    ).toBe(true);
  });

  it('rejects empty-success MCP payloads instead of normalizing them to an empty composite', () => {
    expect(() =>
      parseCreateTasksCompositeResult({
        content: [{ type: 'text', text: '' }],
        isError: false,
      })
    ).toThrow('create_tasks_empty_mcp_result');
  });

  it('falls back to codex CLI when MCP returns an empty success payload', async () => {
    initializeSessionMock.mockResolvedValueOnce({ sessionId: 'mcp-session' });
    closeSessionMock.mockResolvedValue(undefined);
    callToolMock.mockResolvedValueOnce({
      success: true,
      data: {
        content: [{ type: 'text', text: '' }],
        isError: false,
      },
    });
    spawnSyncMock.mockImplementation((_command: string, args: string[]) => {
      const outputIndex = args.indexOf('-o');
      const outputPath = outputIndex >= 0 ? args[outputIndex + 1] : '';
      writeFileSync(
        outputPath,
        JSON.stringify({
          summary_md_text: 'Краткое summary',
          scholastic_review_md: 'Короткое review',
          task_draft: [
            {
              id: 'TASK-CLI-1',
              row_id: 'TASK-CLI-1',
              name: 'Проверить пайплайн create_tasks',
              description: 'Найти источник empty-success и зафиксировать его.',
              priority: 'P2',
              candidate_class: 'deliverable_task',
            },
          ],
          enrich_ready_task_comments: [],
          no_task_decision: null,
          session_name: 'Проверка empty-success',
          project_id: 'proj-1',
        }),
        'utf8'
      );
      return { status: 0, stdout: '', stderr: '' };
    });

    const tasks = await runCreateTasksAgent({
      sessionId: 'session-1',
      projectId: 'proj-1',
      rawText: 'Нужно проверить create_tasks и найти пустой success.',
    });

    expect(spawnSyncMock).toHaveBeenCalledTimes(1);
    expect(tasks).toEqual([
      expect.objectContaining({
        id: 'TASK-CLI-1',
        row_id: 'TASK-CLI-1',
        name: 'Проверить пайплайн create_tasks',
      }),
    ]);
  });

  it('preserves session context in codex CLI fallback when running in session_id mode', async () => {
    initializeSessionMock.mockResolvedValueOnce({ sessionId: 'mcp-session' });
    closeSessionMock.mockResolvedValue(undefined);
    callToolMock.mockResolvedValueOnce({
      success: true,
      data: {
        content: [{ type: 'text', text: '' }],
        isError: false,
      },
    });
    spawnSyncMock.mockImplementation((_command: string, args: string[]) => {
      const prompt = args[args.length - 1] || '';
      expect(prompt).toContain('"session_id": "session-ctx"');
      expect(prompt).toContain('"session_url": "https://copilot.stratospace.fun/voice/session/session-ctx"');
      expect(prompt).toContain(GREEK_SCHOLASTIC_REVIEW_RULE_TEXT);
      const outputIndex = args.indexOf('-o');
      const outputPath = outputIndex >= 0 ? args[outputIndex + 1] : '';
      writeFileSync(
        outputPath,
        JSON.stringify({
          summary_md_text: '',
          scholastic_review_md: '',
          task_draft: [],
          enrich_ready_task_comments: [],
          no_task_decision: {
            code: 'no_deliverables',
            reason: 'No bounded deliverables',
            evidence: ['session-backed fallback'],
            inferred: false,
            source: 'agent',
          },
          session_name: 'Сессионный fallback',
          project_id: 'proj-1',
        }),
        'utf8'
      );
      return { status: 0, stdout: '', stderr: '' };
    });

    const tasks = await runCreateTasksAgent({
      sessionId: 'session-ctx',
      projectId: 'proj-1',
    });

    expect(spawnSyncMock).toHaveBeenCalledTimes(1);
    expect(tasks).toEqual([]);
    const meta = (tasks as unknown as Record<string, unknown>)[CREATE_TASKS_COMPOSITE_META_KEY] as Record<string, unknown>;
    expect(meta?.no_task_decision).toEqual(
      expect.objectContaining({
        code: 'no_deliverables',
      })
    );
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
                    candidate_class: 'deliverable_task',
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
        id: expect.stringMatching(/^voice-task-/),
        row_id: expect.stringMatching(/^voice-task-/),
        name: 'Recovered task',
        project_id: 'proj-1',
      }),
    ]);
  });

  it('keeps explicit numbered cue extraction bounded to model-produced deliverables without extra lexical backfill', async () => {
    initializeSessionMock.mockResolvedValueOnce({ sessionId: 'primary-gap-session' });
    closeSessionMock.mockResolvedValue(undefined);
    callToolMock
      .mockResolvedValueOnce({
        success: true,
        data: {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                summary_md_text: 'Primary summary',
                scholastic_review_md: 'Primary review',
                task_draft: [
                  {
                    id: 'TASK-JABULA-NAV',
                    row_id: 'TASK-JABULA-NAV',
                    name: 'Собрать схему навигации Jabula mainpage',
                    description: 'Диаграмма переходов по mainpage.',
                    candidate_class: 'deliverable_task',
                    priority: 'P2',
                  },
                  {
                    id: 'TASK-UI-CATALOG',
                    row_id: 'TASK-UI-CATALOG',
                    name: 'Составить каталог UI-элементов по страницам',
                    description: 'Каталог UI с маппингом на Ant Design.',
                    candidate_class: 'deliverable_task',
                    priority: 'P3',
                  },
                  {
                    id: 'TASK-YURA-THESES',
                    row_id: 'TASK-YURA-THESES',
                    name: 'Свести клиентские комментарии в технические тезисы',
                    description: 'Пак тезисов для Юры: что можем и что не можем.',
                    candidate_class: 'deliverable_task',
                    priority: 'P3',
                  },
                ],
                enrich_ready_task_comments: [],
                session_name: '',
                project_id: 'proj-gap',
              }),
            },
          ],
        },
      });

    const transcript = [
      'Первая задача — подфиналить комментарии по mainpage Jabula.',
      'Нужно сделать две задачи. Описать навигационную структуру Jabula mainpage в виде диаграммы.',
      'Вторая задача — по всем страницам выделить список UI элементов и соотнести их с Ant Design.',
      'После созвона покажи трейдинг-платформу, потому что я не понимаю, как там работает навигация, какие три уровня и точки входа.',
      'Тебе нужно просто собрать пак комментариев в тезисы для Юры: что можем, а что не можем.',
    ].join('\n\n');

    const tasks = await runCreateTasksAgent({
      sessionId: 'session-gap-repair',
      projectId: 'proj-gap',
      rawText: transcript,
    });

    expect(callToolMock).toHaveBeenCalledTimes(1);
    expect(closeSessionMock).toHaveBeenCalledTimes(1);
    expect(tasks).toHaveLength(3);
    expect(tasks.map((task) => String(task.name))).toEqual(
      expect.arrayContaining([
        'Собрать схему навигации Jabula mainpage',
        'Составить каталог UI-элементов по страницам',
        'Свести клиентские комментарии в технические тезисы',
      ])
    );
    expect(tasks.map((task) => String(task.name))).not.toEqual(
      expect.arrayContaining([
        'Финализировать комментарии по главной странице Jabula',
        'Разобрать навигацию трейдинг-платформы',
      ])
    );
  });

  it('does not synthesize a structural-analysis task from coordination wording in numbered transcript', async () => {
    initializeSessionMock.mockResolvedValueOnce({ sessionId: 'primary-structural-before-verb-session' });
    closeSessionMock.mockResolvedValue(undefined);
    callToolMock.mockResolvedValueOnce({
      success: true,
      data: {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              summary_md_text: 'Primary summary',
              scholastic_review_md: 'Primary review',
              task_draft: [
                {
                  id: 'TASK-NAV',
                  row_id: 'TASK-NAV',
                  name: 'Собрать схему навигации Jabula mainpage',
                  description: 'Диаграмма переходов по mainpage.',
                  candidate_class: 'deliverable_task',
                  priority: 'P2',
                },
                {
                  id: 'TASK-UI-CATALOG',
                  row_id: 'TASK-UI-CATALOG',
                  name: 'Составить каталог UI-элементов по страницам',
                  description: 'Каталог UI с маппингом на Ant Design.',
                  candidate_class: 'deliverable_task',
                  priority: 'P3',
                },
                {
                  id: 'TASK-YURA-THESES',
                  row_id: 'TASK-YURA-THESES',
                  name: 'Свести клиентские комментарии в технические тезисы',
                  description: 'Пак тезисов для Юры: что можем и что не можем.',
                  candidate_class: 'deliverable_task',
                  priority: 'P3',
                },
              ],
              enrich_ready_task_comments: [],
              session_name: 'Primary session',
              project_id: 'proj-gap',
            }),
          },
        ],
      },
    });

    const transcript = [
      'Первая задача — подфиналить комментарии по mainpage Jabula.',
      'Нужно сделать две задачи. Описать навигационную структуру Jabula mainpage в виде диаграммы.',
      'Вторая задача — по всем страницам выделить список UI элементов и соотнести их с Ant Design.',
      'А можем мы после созвона остаться, чтобы ты мне трейдинг-платформу показал?',
      'Потому что я вообще не понял, как там работает эта навигация.',
      'Как там эти три уровня и точки входа.',
      'Тебе нужно просто собрать пак комментариев в тезисы для Юры: что можем, а что не можем.',
    ].join('\n\n');

    const tasks = await runCreateTasksAgent({
      sessionId: 'session-structural-before-verb',
      projectId: 'proj-gap',
      rawText: transcript,
    });

    expect(callToolMock).toHaveBeenCalledTimes(1);
    expect(tasks).toHaveLength(3);
    expect(tasks.map((task) => String(task.name))).toEqual(
      expect.arrayContaining([
        'Собрать схему навигации Jabula mainpage',
        'Составить каталог UI-элементов по страницам',
        'Свести клиентские комментарии в технические тезисы',
      ])
    );
    expect(tasks.map((task) => String(task.name))).not.toContain('Разобрать навигацию трейдинг-платформы');
  });

  it('does not start a generic task-gap second pass from structural coordination cues alone', async () => {
    initializeSessionMock
      .mockResolvedValueOnce({ sessionId: 'primary-structural-session' })
      .mockResolvedValueOnce({ sessionId: 'repair-structural-session' });
    closeSessionMock.mockResolvedValue(undefined);
    callToolMock
      .mockResolvedValueOnce({
        success: true,
        data: {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                summary_md_text: 'Primary summary',
                scholastic_review_md: 'Primary review',
                task_draft: [
                  {
                    id: 'TASK-CHECKLIST',
                    row_id: 'TASK-CHECKLIST',
                    name: 'Собрать чеклист требований',
                    description: 'Собрать список требований по релизу.',
                    candidate_class: 'deliverable_task',
                    priority: 'P3',
                  },
                ],
                enrich_ready_task_comments: [],
                session_name: 'Структурный разбор продукта',
                project_id: 'proj-structural',
              }),
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
                    id: 'TASK-FLOW-WALKTHROUGH',
                    row_id: 'TASK-FLOW-WALKTHROUGH',
                    name: 'Описать пользовательский путь оплаты',
                    description: 'Собрать walkthrough с точками входа и ветвлениями.',
                    candidate_class: 'deliverable_task',
                    priority: 'P2',
                  },
                ],
                enrich_ready_task_comments: [],
                session_name: '',
                project_id: 'proj-structural',
              }),
            },
          ],
        },
      });

    const transcript = [
      'Нужно собрать чеклист требований по релизу.',
      'После демо покажи платежный сценарий, потому что я не понимаю, где вход пользователя, какие ветки и как он проходит путь до оплаты.',
      'Нужно это разложить в понятный walkthrough, чтобы потом отдать команде.',
    ].join('\n\n');

    const tasks = await runCreateTasksAgent({
      sessionId: 'session-structural-repair',
      projectId: 'proj-structural',
      rawText: transcript,
    });

    expect(callToolMock).toHaveBeenCalledTimes(1);
    expect(tasks).toHaveLength(1);
    expect(tasks.map((task) => String(task.name))).toEqual(
      expect.arrayContaining(['Собрать чеклист требований'])
    );
    expect(tasks.map((task) => String(task.name))).not.toContain('Описать пользовательский путь оплаты');
  });

  it('does not trigger task-gap repair for generic after-demo remarks without structural confusion', async () => {
    initializeSessionMock.mockResolvedValueOnce({ sessionId: 'primary-nonrepair-session' });
    closeSessionMock.mockResolvedValue(undefined);
    callToolMock.mockResolvedValue({
      success: true,
      data: {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              summary_md_text: 'Primary summary',
              scholastic_review_md: 'Primary review',
                task_draft: [
                  {
                    id: 'TASK-LOGIN-CHECK',
                    row_id: 'TASK-LOGIN-CHECK',
                    name: 'Собрать список шагов воспроизведения для ошибки логина',
                    description: 'Собрать список воспроизводимых шагов и наблюдений по ошибке логина после демо.',
                    candidate_class: 'deliverable_task',
                    priority: 'P3',
                  },
                ],
              enrich_ready_task_comments: [],
              session_name: 'Тест без structural repair',
              project_id: 'proj-nonrepair',
            }),
          },
        ],
      },
    });

    const transcript = [
      'После демо на экране была ошибка с логином.',
      'Нужно проверить форму логина и собрать список воспроизводимых шагов.',
    ].join('\n\n');

    const tasks = await runCreateTasksAgent({
      sessionId: 'session-nonrepair',
      projectId: 'proj-nonrepair',
      rawText: transcript,
    });

    expect(callToolMock).toHaveBeenCalledTimes(1);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toEqual(
      expect.objectContaining({
        name: 'Собрать список шагов воспроизведения для ошибки логина',
      })
    );
  });

  it('does not open a generic repair pass for loose non-enumerated asks when primary extraction already covers bounded deliverables', async () => {
    initializeSessionMock
      .mockResolvedValueOnce({ sessionId: 'primary-distributed-session' })
      .mockResolvedValueOnce({ sessionId: 'repair-distributed-session' });
    closeSessionMock.mockResolvedValue(undefined);
    callToolMock
      .mockResolvedValueOnce({
        success: true,
        data: {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                summary_md_text: 'Primary summary',
                scholastic_review_md: 'Primary review',
                task_draft: [
                  {
                    id: 'TASK-COMMENTS',
                    row_id: 'TASK-COMMENTS',
                    name: 'Подфиналить комментарии по главной странице',
                    description: 'Подфиналить комментарии по mainpage.',
                    candidate_class: 'deliverable_task',
                    priority: 'P2',
                  },
                  {
                    id: 'TASK-NAV',
                    row_id: 'TASK-NAV',
                    name: 'Собрать диаграмму навигации Jabula',
                    description: 'Диаграмма навигации.',
                    candidate_class: 'deliverable_task',
                    priority: 'P2',
                  },
                  {
                    id: 'TASK-UI',
                    row_id: 'TASK-UI',
                    name: 'Составить каталог UI-элементов',
                    description: 'Каталог UI.',
                    candidate_class: 'deliverable_task',
                    priority: 'P3',
                  },
                ],
                enrich_ready_task_comments: [],
                session_name: 'Jabula',
                project_id: 'proj-distributed',
              }),
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
                    id: 'TASK-THESES',
                    row_id: 'TASK-THESES',
                    name: 'Свести комментарии в технические тезисы',
                    description: 'Подготовить тезисы для Юры.',
                    candidate_class: 'deliverable_task',
                    priority: 'P3',
                  },
                ],
                enrich_ready_task_comments: [],
                session_name: '',
                project_id: 'proj-distributed',
              }),
            },
          ],
        },
      });

    const transcript = [
      'Нужно подфиналить комментарии по mainpage.',
      'По самой Jabula нужна схема навигации.',
      'И еще нужен каталог UI элементов.',
      'Отдельная задача — проверить доступы и креды.',
      'Нужно созвониться и после колла показать платформу.',
      'Тебе нужно просто собрать этот пак комментариев в тезисы для Юры: что можем, а что не можем.',
    ].join('\n\n');

    const tasks = await runCreateTasksAgent({
      sessionId: 'session-distributed-repair',
      projectId: 'proj-distributed',
      rawText: transcript,
    });

    expect(callToolMock).toHaveBeenCalledTimes(1);
    expect(tasks).toHaveLength(3);
    expect(tasks.map((task) => String(task.name))).toEqual(
      expect.arrayContaining([
        'Подфиналить комментарии по главной странице',
        'Собрать диаграмму навигации Jabula',
        'Составить каталог UI-элементов',
      ])
    );
  });

  it('does not add deterministic literal-cue tasks when extraction already returned deliverables', async () => {
    initializeSessionMock.mockResolvedValueOnce({ sessionId: 'primary-literal-session' });
    closeSessionMock.mockResolvedValue(undefined);
    callToolMock
      .mockResolvedValueOnce({
        success: true,
        data: {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                summary_md_text: 'Primary summary',
                scholastic_review_md: 'Primary review',
                task_draft: [
                  {
                    id: 'TASK-NAV',
                    row_id: 'TASK-NAV',
                    name: 'Собрать диаграмму навигации Jabula',
                    description: 'Диаграмма навигации.',
                    candidate_class: 'deliverable_task',
                    priority: 'P2',
                  },
                  {
                    id: 'TASK-UI',
                    row_id: 'TASK-UI',
                    name: 'Составить каталог UI-элементов',
                    description: 'Каталог UI.',
                    candidate_class: 'deliverable_task',
                    priority: 'P3',
                  },
                  {
                    id: 'TASK-THESES',
                    row_id: 'TASK-THESES',
                    name: 'Свести комментарии в технические тезисы',
                    description: 'Подготовить тезисы для Юры.',
                    candidate_class: 'deliverable_task',
                    priority: 'P3',
                  },
                ],
                enrich_ready_task_comments: [],
                session_name: 'Jabula',
                project_id: 'proj-literal',
              }),
            },
          ],
        },
      });

    const transcript = [
      'Первая задача — подфиналить комментарии по mainpage.',
      'Нужно сделать две задачи. Описать навигационную структуру Jabula.',
      'Вторая задача — собрать каталог UI элементов.',
      'Тебе нужно просто собрать этот пак комментариев в тезисы для Юры: что можем, а что не можем.',
    ].join('\n\n');

    const tasks = await runCreateTasksAgent({
      sessionId: 'session-literal-repair',
      projectId: 'proj-literal',
      rawText: transcript,
    });

    expect(callToolMock).toHaveBeenCalledTimes(1);
    expect(tasks).toHaveLength(3);
    expect(tasks.map((task) => String(task.name))).toEqual(
      expect.arrayContaining([
        'Собрать диаграмму навигации Jabula',
        'Составить каталог UI-элементов',
        'Свести комментарии в технические тезисы',
      ])
    );
    expect(tasks.map((task) => String(task.name))).not.toContain('Финализировать комментарии по главной странице');
  });

  it('does not materialize colloquial numbered literal cues into additional fallback tasks', async () => {
    initializeSessionMock.mockResolvedValueOnce({ sessionId: 'primary-colloquial-session' });
    closeSessionMock.mockResolvedValue(undefined);
    callToolMock
      .mockResolvedValueOnce({
        success: true,
        data: {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                summary_md_text: 'Primary summary',
                scholastic_review_md: 'Primary review',
                task_draft: [
                  {
                    id: 'TASK-NAV',
                    row_id: 'TASK-NAV',
                    name: 'Собрать диаграмму навигации Jabula',
                    description: 'Диаграмма навигации.',
                    candidate_class: 'deliverable_task',
                    priority: 'P2',
                  },
                  {
                    id: 'TASK-UI',
                    row_id: 'TASK-UI',
                    name: 'Составить каталог UI-элементов',
                    description: 'Каталог UI.',
                    candidate_class: 'deliverable_task',
                    priority: 'P3',
                  },
                  {
                    id: 'TASK-THESES',
                    row_id: 'TASK-THESES',
                    name: 'Свести комментарии в технические тезисы',
                    description: 'Подготовить тезисы для Юры.',
                    candidate_class: 'deliverable_task',
                    priority: 'P3',
                  },
                ],
                enrich_ready_task_comments: [],
                session_name: 'Jabula',
                project_id: 'proj-colloquial',
              }),
            },
          ],
        },
      });

    const transcript = [
      'Ну, тогда первая задача у нас подфиналить комментарии относительно мейнпэйджи.',
      'Нужно сделать две задачи. Описать навигационную структуру Jabula.',
      'Вторая задача — собрать каталог UI элементов.',
      'Тебе нужно просто собрать этот пак комментариев в тезисы для Юры: что можем, а что не можем.',
    ].join('\n\n');

    const tasks = await runCreateTasksAgent({
      sessionId: 'session-colloquial-literal',
      projectId: 'proj-colloquial',
      rawText: transcript,
    });

    expect(callToolMock).toHaveBeenCalledTimes(1);
    expect(tasks).toHaveLength(3);
    expect(tasks.map((task) => String(task.name))).toEqual(
      expect.arrayContaining([
        'Собрать диаграмму навигации Jabula',
        'Составить каталог UI-элементов',
        'Свести комментарии в технические тезисы',
      ])
    );
    expect(tasks.map((task) => String(task.name))).not.toContain(
      'Ну, тогда первая задача у нас подфиналить комментарии относительно мейнпэйджи'
    );
    expect(tasks.map((task) => String(task.name))).not.toContain(
      'Финализировать комментарии по главной странице'
    );
  });

  it('does not run an extra repair pass or add a duplicate when the normalized deliverable is already covered', async () => {
    initializeSessionMock
      .mockResolvedValueOnce({ sessionId: 'primary-dedup-session' })
      .mockResolvedValueOnce({ sessionId: 'generic-dedup-session' });
    closeSessionMock.mockResolvedValue(undefined);
    callToolMock
      .mockResolvedValueOnce({
        success: true,
        data: {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                summary_md_text: 'Primary summary',
                scholastic_review_md: 'Primary review',
                task_draft: [
                  {
                    id: 'TASK-COMMENTS',
                    row_id: 'TASK-COMMENTS',
                    name: 'Финализировать комментарии по главной странице Jabula',
                    description: 'Подфиналить комментарии по mainpage Jabula.',
                    candidate_class: 'deliverable_task',
                    priority: 'P2',
                  },
                  {
                    id: 'TASK-NAV',
                    row_id: 'TASK-NAV',
                    name: 'Построить схему навигации главной страницы Jabula',
                    description: 'Диаграмма переходов по mainpage.',
                    candidate_class: 'deliverable_task',
                    priority: 'P2',
                  },
                  {
                    id: 'TASK-UI',
                    row_id: 'TASK-UI',
                    name: 'Собрать каталог UI-элементов по страницам Jabula',
                    description: 'Каталог уникальных элементов интерфейса.',
                    candidate_class: 'deliverable_task',
                    priority: 'P3',
                  },
                  {
                    id: 'TASK-THESES',
                    row_id: 'TASK-THESES',
                    name: 'Подготовить тезисный пакет трёх комментариев для Юры',
                    description: 'Пак тезисов для Юры: что можем и что не можем.',
                    candidate_class: 'deliverable_task',
                    priority: 'P3',
                  },
                ],
                enrich_ready_task_comments: [],
                session_name: 'Jabula',
                project_id: 'proj-dedup',
              }),
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
                project_id: 'proj-dedup',
              }),
            },
          ],
        },
      });

    const transcript = [
      'Ну, тогда первая задача у нас подфиналить комментарии относительно мейнпэйджи.',
      'Нужно сделать две задачи. Описать навигационную структуру Jabula mainpage в виде диаграммы.',
      'Вторая задача — выделить список UI элементов, которые там есть, уникальные.',
      'Тебе нужно просто собрать пак комментариев в тезисы для Юры: что можем, а что не можем.',
    ].join('\n\n');

    const tasks = await runCreateTasksAgent({
      sessionId: 'session-dedup-literal',
      projectId: 'proj-dedup',
      rawText: transcript,
    });

    expect(callToolMock).toHaveBeenCalledTimes(1);
    expect(tasks).toHaveLength(4);
    expect(tasks.map((task) => String(task.name))).toEqual([
      'Финализировать комментарии по главной странице Jabula',
      'Построить схему навигации главной страницы Jabula',
      'Собрать каталог UI-элементов по страницам Jabula',
      'Подготовить тезисный пакет трёх комментариев для Юры',
    ]);
  });

  it('does not add a second inventory task when the literal cue only differs by compact UI wording', async () => {
    initializeSessionMock.mockResolvedValueOnce({ sessionId: 'primary-ui-dedup-session' });
    closeSessionMock.mockResolvedValue(undefined);
    callToolMock.mockResolvedValue({
      success: true,
      data: {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              summary_md_text: 'Primary summary',
              scholastic_review_md: 'Primary review',
              task_draft: [
                {
                  id: 'TASK-UI',
                  row_id: 'TASK-UI',
                  name: 'Собрать каталог UI-элементов по всем страницам',
                  description: 'Каталог уникальных элементов интерфейса.',
                  candidate_class: 'deliverable_task',
                  priority: 'P3',
                },
              ],
              enrich_ready_task_comments: [],
              session_name: 'UI inventory',
              project_id: 'proj-ui-dedup',
            }),
          },
        ],
      },
    });

    const transcript = [
      'Нужно сделать две задачи.',
      'Вторая задача — выделить список UI элементов, которые там есть, уникальные.',
    ].join('\n\n');

    const tasks = await runCreateTasksAgent({
      sessionId: 'session-ui-dedup',
      projectId: 'proj-ui-dedup',
      rawText: transcript,
    });

    expect(callToolMock).toHaveBeenCalledTimes(1);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toEqual(
      expect.objectContaining({
        name: 'Собрать каталог UI-элементов по всем страницам',
      })
    );
  });

  it('does not start task-gap repair from coordination-heavy reference asks without an explicit deliverable action', async () => {
    initializeSessionMock.mockResolvedValueOnce({ sessionId: 'primary-reference-session' });
    closeSessionMock.mockResolvedValue(undefined);
    callToolMock.mockResolvedValue({
      success: true,
      data: {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              summary_md_text: 'Primary summary',
              scholastic_review_md: 'Primary review',
              task_draft: [
                {
                  id: 'TASK-COMMENTS',
                  row_id: 'TASK-COMMENTS',
                  name: 'Финализировать комментарии по главной странице Jabula',
                  description: 'Подфиналить комментарии по mainpage Jabula.',
                  candidate_class: 'deliverable_task',
                  priority: 'P2',
                },
                {
                  id: 'TASK-NAV',
                  row_id: 'TASK-NAV',
                  name: 'Построить схему навигации главной страницы Jabula',
                  description: 'Диаграмма переходов по mainpage.',
                  candidate_class: 'deliverable_task',
                  priority: 'P2',
                },
                {
                  id: 'TASK-UI',
                  row_id: 'TASK-UI',
                  name: 'Собрать каталог UI-элементов по страницам Jabula',
                  description: 'Каталог уникальных элементов интерфейса.',
                  candidate_class: 'deliverable_task',
                  priority: 'P3',
                },
              ],
              enrich_ready_task_comments: [],
              session_name: 'Jabula',
              project_id: 'proj-reference',
            }),
          },
        ],
      },
    });

    const transcript = [
      'Первая задача — подфиналить комментарии по mainpage.',
      'Вторая задача — описать навигационную структуру Jabula.',
      'Третья задача — собрать каталог UI элементов по страницам.',
      'Нам бы показать UX-овые пласты работ в формате большого юзерфлоу, диаграмм, документов.',
    ].join('\n\n');

    const tasks = await runCreateTasksAgent({
      sessionId: 'session-reference-skip',
      projectId: 'proj-reference',
      rawText: transcript,
    });

    expect(callToolMock).toHaveBeenCalledTimes(1);
    expect(tasks).toHaveLength(3);
    expect(tasks.map((task) => String(task.name))).toEqual([
      'Финализировать комментарии по главной странице Jabula',
      'Построить схему навигации главной страницы Jabula',
      'Собрать каталог UI-элементов по страницам Jabula',
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
                  candidate_class: 'deliverable_task',
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
                  candidate_class: 'deliverable_task',
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

  it('propagates explicit no-task decisions from composite payloads when task_draft is empty', async () => {
    initializeSessionMock.mockResolvedValue({ sessionId: 'no-task-explicit-session' });
    closeSessionMock.mockResolvedValue(undefined);
    callToolMock.mockResolvedValue({
      success: true,
      data: {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              summary_md_text: 'Summary exists',
              scholastic_review_md: 'Review exists',
              task_draft: [],
              enrich_ready_task_comments: [],
              no_task_decision: {
                code: 'discussion-only',
                reason: 'Conversation stayed at strategic framing level without actionable owners.',
                evidence: ['No clear executor assignment', 'No bounded deliverable in transcript'],
              },
              session_name: '',
              project_id: 'proj-no-task',
            }),
          },
        ],
      },
    });

    const tasks = await runCreateTasksAgent({
      sessionId: 'session-no-task-explicit',
      projectId: 'proj-no-task',
    });
    const compositeMeta = (tasks as unknown as Record<string, unknown>).__create_tasks_composite_meta as
      | Record<string, unknown>
      | undefined;
    const noTaskDecision = compositeMeta?.no_task_decision as Record<string, unknown> | undefined;

    expect(tasks).toEqual([]);
    expect(noTaskDecision).toEqual(
      expect.objectContaining({
        code: 'discussion_only',
        reason: 'Conversation stayed at strategic framing level without actionable owners.',
        inferred: false,
        source: 'agent_explicit',
        evidence: ['No clear executor assignment', 'No bounded deliverable in transcript'],
      })
    );
  });

  it('infers a machine-checkable no-task decision for 69c37a231f1bc03e330f9641-style zero-task responses', async () => {
    initializeSessionMock.mockResolvedValue({ sessionId: 'no-task-inferred-session' });
    closeSessionMock.mockResolvedValue(undefined);
    callToolMock.mockResolvedValue({
      success: true,
      data: {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              summary_md_text: 'Visible summary text',
              scholastic_review_md: 'Visible review text',
              task_draft: [],
              enrich_ready_task_comments: [],
              session_name: '',
              project_id: 'proj-repro',
            }),
          },
        ],
      },
    });

    const tasks = await runCreateTasksAgent({
      sessionId: '69c37a231f1bc03e330f9641',
      projectId: 'proj-repro',
    });
    const compositeMeta = (tasks as unknown as Record<string, unknown>).__create_tasks_composite_meta as
      | Record<string, unknown>
      | undefined;
    const noTaskDecision = compositeMeta?.no_task_decision as Record<string, unknown> | undefined;
    const evidence = Array.isArray(noTaskDecision?.evidence) ? (noTaskDecision?.evidence as string[]) : [];

    expect(tasks).toEqual([]);
    expect(noTaskDecision).toEqual(
      expect.objectContaining({
        code: 'no_task_reason_missing',
        inferred: true,
        source: 'agent_inferred',
      })
    );
    expect(evidence).toEqual(
      expect.arrayContaining(['has_summary_md_text=true', 'has_scholastic_review_md=true'])
    );
  });

  it('derives preferred output language without garbage-flagged transcript samples', async () => {
    const sessionId = new ObjectId().toHexString();
    const dbStub = {
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return {
            findOne: jest.fn(async () => ({
              _id: new ObjectId(sessionId),
              summary_md_text: '',
              review_md_text: '',
              session_name: '',
            })),
          };
        }
        if (name === VOICEBOT_COLLECTIONS.MESSAGES) {
          return {
            find: jest.fn(() => ({
              sort: () => ({
                limit: () => ({
                  toArray: async () => [
                    {
                      message_timestamp: 20,
                      transcription_text: 'hello from noisy repeated clip',
                      garbage_detected: true,
                      garbage_detection: {
                        is_garbage: true,
                        code: 'noise_or_garbage',
                      },
                    },
                    {
                      message_timestamp: 10,
                      transcription_text: 'нужно подготовить смету и согласовать сроки',
                      garbage_detected: false,
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

    initializeSessionMock.mockResolvedValue({ sessionId: 'language-filter-session' });
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
              task_draft: [],
              enrich_ready_task_comments: [],
              no_task_decision: {
                code: 'discussion-only',
                reason: 'No bounded deliverables in transcript.',
                evidence: ['language filter fixture'],
              },
              session_name: '',
              project_id: '',
            }),
          },
        ],
      },
    });

    await runCreateTasksAgent({
      sessionId,
      db: dbStub as never,
    });

    const envelope = JSON.parse(String(callToolMock.mock.calls[0]?.[1]?.message || '')) as Record<string, unknown>;
    expect(envelope.preferred_output_language).toBe('ru');
  });

  it('normalizes semantically empty composite payloads into deterministic no-task behavior', async () => {
    initializeSessionMock.mockResolvedValue({ sessionId: 'empty-composite-session' });
    closeSessionMock.mockResolvedValue(undefined);
    callToolMock.mockResolvedValue({
      success: true,
      data: {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              session_name: 'Only session title leaked through',
              project_id: 'proj-empty',
            }),
          },
        ],
      },
    });

    const tasks = await runCreateTasksAgent({
      sessionId: 'session-empty-composite',
      projectId: 'proj-empty',
    });
    const compositeMeta = (tasks as unknown as Record<string, unknown>).__create_tasks_composite_meta as
      | Record<string, unknown>
      | undefined;
    const noTaskDecision = compositeMeta?.no_task_decision as Record<string, unknown> | undefined;
    const evidence = Array.isArray(noTaskDecision?.evidence) ? (noTaskDecision?.evidence as string[]) : [];

    expect(tasks).toEqual([]);
    expect(noTaskDecision).toEqual(
      expect.objectContaining({
        code: 'no_task_reason_missing',
        inferred: true,
        source: 'agent_inferred',
      })
    );
    expect(evidence).toEqual(
      expect.arrayContaining(['has_summary_md_text=false', 'has_scholastic_review_md=false'])
    );
  });

  it('assigns deterministic content-based locators when the model omits row identifiers', async () => {
    initializeSessionMock.mockResolvedValue({ sessionId: 'anonymous-session' });
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
                  row_id: 'task-1',
                  id: 'task-1',
                  task_id_from_ai: 'task-1',
                  name: 'Насытить карточку проекта контекстным словарём для матчинга',
                  description: 'Добавить предметный словарь и context markers для project binding.',
                  candidate_class: 'deliverable_task',
                  priority: 'P2',
                  dialogue_reference: 'Нужно насытить project card словарём.',
                },
              ],
              enrich_ready_task_comments: [],
              session_name: 'Автопривязка voice-сессий и запуск задач',
              project_id: 'proj-anonymous',
            }),
          },
        ],
      },
    });

    const first = await runCreateTasksAgent({
      sessionId: 'session-anonymous',
      projectId: 'proj-anonymous',
    });
    const second = await runCreateTasksAgent({
      sessionId: 'session-anonymous',
      projectId: 'proj-anonymous',
    });

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(String(first[0]?.row_id || '')).toMatch(/^voice-task-/);
    expect(String(first[0]?.id || '')).toMatch(/^voice-task-/);
    expect(first[0]?.row_id).not.toBe('task-1');
    expect(second[0]?.row_id).toBe(first[0]?.row_id);
    expect(second[0]?.id).toBe(first[0]?.id);
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
                  candidate_class: 'deliverable_task',
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
    expect(envelope.preferred_output_language).toBe('ru');
  });

  it('resolves VOICEBOT_PROJECT_CRM_LOOKBACK_DAYS with clamp and default fallback for project CRM window', async () => {
    const previousLookback = process.env.VOICEBOT_PROJECT_CRM_LOOKBACK_DAYS;
    try {
      const firstMessageAt = new Date('2026-02-01T10:00:00.000Z');
      const lastMessageAt = new Date('2026-02-03T18:00:00.000Z');
      const sessionFindOne = jest.fn(async () => {
        const id = new ObjectId();
        return {
          _id: id,
          created_at: new Date('2026-02-01T08:00:00.000Z'),
          updated_at: new Date('2026-02-03T19:00:00.000Z'),
        };
      });
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

      const cases: Array<{ envValue: string; expectedLookbackDays: number }> = [
        { envValue: '120', expectedLookbackDays: 30 },
        { envValue: '0', expectedLookbackDays: 1 },
        { envValue: '', expectedLookbackDays: 14 },
      ];

      for (const testCase of cases) {
        process.env.VOICEBOT_PROJECT_CRM_LOOKBACK_DAYS = testCase.envValue;
        const sessionId = new ObjectId().toHexString();

        initializeSessionMock.mockResolvedValue({ sessionId: 'window-clamp-session' });
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
                      id: 'TASK-LOOKBACK-1',
                      row_id: 'TASK-LOOKBACK-1',
                      name: 'Lookback task',
                      description: 'Envelope validation task',
                      candidate_class: 'deliverable_task',
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
        const lookbackMs = testCase.expectedLookbackDays * 24 * 60 * 60 * 1000;

        expect(crmWindow.from_date).toBe(new Date(lastMessageAt.getTime() - lookbackMs).toISOString());
        expect(crmWindow.to_date).toBe(lastMessageAt.toISOString());

        callToolMock.mockClear();
      }
    } finally {
      if (previousLookback === undefined) {
        delete process.env.VOICEBOT_PROJECT_CRM_LOOKBACK_DAYS;
      } else {
        process.env.VOICEBOT_PROJECT_CRM_LOOKBACK_DAYS = previousLookback;
      }
    }
  });

  it('adds preferred_output_language=en to raw_text envelopes when the source text is english-only', async () => {
    initializeSessionMock.mockResolvedValue({ sessionId: 'language-session' });
    closeSessionMock.mockResolvedValue(undefined);
    callToolMock.mockResolvedValue({
      success: true,
      data: {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              summary_md_text: 'English summary',
              scholastic_review_md: 'English review',
              task_draft: [],
              enrich_ready_task_comments: [],
              session_name: 'English only planning discussion',
              project_id: '',
            }),
          },
        ],
      },
    });

    await runCreateTasksAgent({
      sessionId: 'session-english',
      rawText: 'Prepare the outreach deck and confirm the target list before Friday.',
    });

    expect(callToolMock).toHaveBeenCalledTimes(1);
    const envelopeRaw = callToolMock.mock.calls[0]?.[1]?.message as string;
    const envelope = JSON.parse(envelopeRaw) as Record<string, unknown>;
    expect(envelope.mode).toBe('raw_text');
    expect(envelope.preferred_output_language).toBe('en');
    expect(openAiResponsesCreateMock).not.toHaveBeenCalled();
  });

  it('prefers russian when session-level summaries are english but message samples contain cyrillic object-id linked transcript', async () => {
    const sessionId = new ObjectId().toHexString();
    const sessionFindOne = jest.fn(async () => ({
      _id: new ObjectId(sessionId),
      summary_md_text: 'English summary already persisted',
      review_md_text: 'English review already persisted',
      session_name: 'English session title',
    }));
    const messagesFind = jest.fn((query: Record<string, unknown>) => {
      const values = Array.isArray((query.session_id as { $in?: unknown[] })?.$in)
        ? ((query.session_id as { $in?: unknown[] }).$in as unknown[])
        : [];
      expect(values).toEqual(
        expect.arrayContaining([sessionId, expect.any(ObjectId)])
      );
      return {
        sort: () => ({
          limit: () => ({
            toArray: async () => [
              {
                transcription_text: 'Нужно пересобрать оффер и провести разговор с клиентом.',
              },
            ],
          }),
        }),
      };
    });
    const dbStub = {
      collection: (name: string) => {
        if (name === 'automation_voice_bot_sessions') {
          return { findOne: sessionFindOne };
        }
        if (name === 'automation_voice_bot_messages') {
          return { find: messagesFind, findOne: jest.fn(async () => null) };
        }
        return { findOne: jest.fn(async () => null), find: jest.fn() };
      },
    };

    initializeSessionMock.mockResolvedValue({ sessionId: 'language-from-message-session' });
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
                  id: 'TASK-LANG-1',
                  row_id: 'TASK-LANG-1',
                  name: 'Language sample task',
                  description: 'Envelope language selection task',
                  candidate_class: 'deliverable_task',
                  priority: 'P3',
                },
              ],
              enrich_ready_task_comments: [],
              session_name: '',
              project_id: 'proj-msg-lang',
            }),
          },
        ],
      },
    });

    await runCreateTasksAgent({
      sessionId,
      projectId: 'proj-msg-lang',
      db: dbStub as never,
    });

    const envelopeRaw = callToolMock.mock.calls[0]?.[1]?.message as string;
    const envelope = JSON.parse(envelopeRaw) as Record<string, unknown>;
    expect(envelope.preferred_output_language).toBe('ru');
  });

  it('does not invoke OpenAI language-repair pass for mixed-language review artifacts', async () => {
    initializeSessionMock.mockResolvedValue({ sessionId: 'repair-session' });
    closeSessionMock.mockResolvedValue(undefined);
    callToolMock.mockResolvedValue({
      success: true,
      data: {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              summary_md_text: 'Русский summary без проблем.',
              scholastic_review_md:
                '## Terms\n- `пересмотр цены` — клиентская renegotiation условий.\n\n## Logic\n- Нужен lead-pipeline и staffing review без лишней воды.',
              task_draft: [
                {
                  id: 'TASK-REPAIR-1',
                  row_id: 'TASK-REPAIR-1',
                  name: 'Подготовить разговор с DBI',
                  description: '## description\nСобрать позицию и тезисы.\n\n## object_locators\nНе указано',
                  candidate_class: 'deliverable_task',
                  priority: 'P2',
                },
              ],
              enrich_ready_task_comments: [],
              session_name: 'DBI: цены и новый заход',
              project_id: 'proj-repair',
            }),
          },
        ],
      },
    });
    openAiResponsesCreateMock.mockResolvedValue({
      output_text: JSON.stringify({
        summary_md_text: 'Русский summary без проблем.',
        scholastic_review_md:
          '## Термины\n- `пересмотр цены` — клиентский пересмотр условий.\n\n## Логика\n- Нужен новый контур лидогенерации и пересмотр ролевой конфигурации без лишней воды.',
        task_draft: [
          {
            id: 'TASK-REPAIR-1',
            row_id: 'TASK-REPAIR-1',
            name: 'Подготовить разговор с DBI',
            description: '## description\nСобрать позицию и тезисы.\n\n## object_locators\nНе указано',
            candidate_class: 'deliverable_task',
            priority: 'P2',
          },
        ],
        enrich_ready_task_comments: [],
        session_name: 'DBI: цены и новый заход',
        project_id: 'proj-repair',
      }),
    });

    const tasks = await runCreateTasksAgent({
      sessionId: 'repair-session',
      projectId: 'proj-repair',
    });

    const compositeMeta = (tasks as unknown as Record<string, unknown>).__create_tasks_composite_meta as
      | Record<string, unknown>
      | undefined;

    expect(openAiResponsesCreateMock).not.toHaveBeenCalled();
    expect(String(compositeMeta?.scholastic_review_md || '')).toContain('## Terms');
    expect(String(compositeMeta?.scholastic_review_md || '')).toContain('renegotiation');
    expect(String(compositeMeta?.scholastic_review_md || '')).toContain('lead-pipeline');
  });

  it('retries once with reduced raw_text context after string_above_max_length overflow and strips top-level session_id', async () => {
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
              text: "I hit an internal error while calling the model: Invalid 'input[31].output': string_above_max_length",
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
                    candidate_class: 'deliverable_task',
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
    const firstRequest = callToolMock.mock.calls[0]?.[1] as Record<string, unknown>;
    const secondRequest = callToolMock.mock.calls[1]?.[1] as Record<string, unknown>;
    const firstEnvelope = JSON.parse(callToolMock.mock.calls[0]?.[1]?.message as string) as Record<string, unknown>;
    const secondEnvelope = JSON.parse(callToolMock.mock.calls[1]?.[1]?.message as string) as Record<string, unknown>;
    expect(firstRequest.session_id).toBe(sessionId);
    expect(secondRequest).not.toHaveProperty('session_id');
    expect(firstEnvelope.mode).toBe('session_id');
    expect(secondEnvelope.mode).toBe('raw_text');
    expect(String(secondEnvelope.raw_text || '')).toContain('Reduced create_tasks context for session');
    const secondSerializedMessage = String(callToolMock.mock.calls[1]?.[1]?.message || '');
    expect(secondSerializedMessage).not.toContain('"mode":"session_id"');
    expect(secondSerializedMessage).toMatch(/"session_id"\s*:/);
    expect(String(secondEnvelope.raw_text || '').length).toBeLessThanOrEqual(12000);
    expect(Buffer.byteLength(secondSerializedMessage, 'utf8')).toBeLessThanOrEqual(14000);
    expect(tasks).toEqual([
      expect.objectContaining({
        id: 'TASK-R1',
        row_id: 'TASK-R1',
        project_id: 'proj-overflow',
      }),
    ]);
  });

  it('excludes garbage-flagged transcript excerpts from reduced create_tasks retry context', async () => {
    const sessionId = new ObjectId().toHexString();
    const dbStub = {
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return {
            findOne: jest.fn(async () => ({
              _id: new ObjectId(sessionId),
              session_name: 'Reduced Context Filter Session',
              summary_md_text: 'Нужен только чистый actionable контекст.',
            })),
          };
        }
        if (name === VOICEBOT_COLLECTIONS.MESSAGES) {
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
                      message_timestamp: 30,
                      transcription_text: 'discard this noisy repeated loop',
                      garbage_detected: true,
                      garbage_detection: {
                        is_garbage: true,
                        code: 'noise_or_garbage',
                      },
                    },
                    {
                      message_timestamp: 20,
                      transcription_text: 'Нужно подготовить финальный оффер и отправить клиенту.',
                      garbage_detected: false,
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
      .mockResolvedValueOnce({ sessionId: 'reduced-garbage-primary' })
      .mockResolvedValueOnce({ sessionId: 'reduced-garbage-retry' });
    closeSessionMock.mockResolvedValue(undefined);
    callToolMock
      .mockResolvedValueOnce({
        success: true,
        data: {
          content: [
            {
              type: 'text',
              text: "I hit an internal error while calling the model: Invalid 'input[31].output': string_above_max_length",
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
                no_task_decision: {
                  code: 'discussion-only',
                  reason: 'No bounded tasks in reduced context',
                  evidence: ['garbage filtered reduced context'],
                },
                enrich_ready_task_comments: [],
                session_name: '',
                project_id: '',
              }),
            },
          ],
        },
      });

    await runCreateTasksAgent({
      sessionId,
      db: dbStub as never,
    });

    const retryEnvelope = JSON.parse(String(callToolMock.mock.calls[1]?.[1]?.message || '')) as Record<string, unknown>;
    const retryRawText = String(retryEnvelope.raw_text || '');
    expect(retryRawText).toContain('Нужно подготовить финальный оффер и отправить клиенту.');
    expect(retryRawText).not.toContain('discard this noisy repeated loop');
  });

  it('keeps reduced raw_text retry envelope bounded even when source transcript chunks are very large', async () => {
    const sessionId = new ObjectId().toHexString();
    const hugeChunk = `START_MARKER ${'A'.repeat(220000)} END_MARKER`;
    const dbStub = {
      collection: (name: string) => {
        if (name === 'automation_voice_bot_sessions') {
          return {
            findOne: jest.fn(async () => ({
              _id: new ObjectId(sessionId),
              session_name: 'Huge Context Session',
              project_id: 'proj-huge',
              summary_md_text: `SUMMARY_START ${'B'.repeat(80000)} SUMMARY_END`,
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
                    { message_timestamp: 1, transcription_text: hugeChunk },
                    { message_timestamp: 2, transcription_text: hugeChunk },
                    { message_timestamp: 3, transcription_text: hugeChunk },
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
      .mockResolvedValueOnce({ sessionId: 'huge-session' })
      .mockResolvedValueOnce({ sessionId: 'huge-reduced-session' });
    closeSessionMock.mockResolvedValue(undefined);
    callToolMock
      .mockResolvedValueOnce({
        success: true,
        data: {
          content: [
            {
              type: 'text',
              text: "I hit an internal error while calling the model: Invalid 'input[31].output': string_above_max_length",
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
                no_task_decision: {
                  code: 'discussion-only',
                  reason: 'No bounded tasks in reduced context',
                  evidence: ['large_context_reduced'],
                },
                enrich_ready_task_comments: [],
                session_name: '',
                project_id: 'proj-huge',
              }),
            },
          ],
        },
      });

    await runCreateTasksAgent({
      sessionId,
      projectId: 'proj-huge',
      db: dbStub as never,
    });

    const secondEnvelope = JSON.parse(callToolMock.mock.calls[1]?.[1]?.message as string) as Record<string, unknown>;
    const secondSerializedMessage = String(callToolMock.mock.calls[1]?.[1]?.message || '');
    const reducedText = String(secondEnvelope.raw_text || '');

    expect(secondEnvelope.mode).toBe('raw_text');
    expect(secondSerializedMessage).toMatch(/"session_id"\s*:/);
    expect(reducedText.length).toBeLessThanOrEqual(12000);
    expect(Buffer.byteLength(secondSerializedMessage, 'utf8')).toBeLessThanOrEqual(14000);
    expect(reducedText).toContain('START_MARKER');
    expect(reducedText).not.toContain('END_MARKER');
    expect(reducedText).toContain('Reduced create_tasks context for session');
  });

  it('does not perform more than one reduced-context retry when string_above_max_length repeats', async () => {
    const sessionId = new ObjectId().toHexString();
    const dbStub = {
      collection: (name: string) => {
        if (name === 'automation_voice_bot_sessions') {
          return {
            findOne: jest.fn(async () => ({
              _id: new ObjectId(sessionId),
              session_name: 'Repeated Overflow Session',
              summary_md_text: 'Нужен компактный fallback.',
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
                      text: 'Нужен единственный deterministic retry.',
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
      .mockResolvedValueOnce({ sessionId: 'repeat-overflow-session' })
      .mockResolvedValueOnce({ sessionId: 'repeat-overflow-reduced-session' });
    closeSessionMock.mockResolvedValue(undefined);
    callToolMock
      .mockResolvedValueOnce({
        success: true,
        data: {
          content: [
            {
              type: 'text',
              text: "I hit an internal error while calling the model: Invalid 'input[31].output': string_above_max_length",
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
              text: "I hit an internal error while calling the model: Invalid 'input[31].output': string_above_max_length",
            },
          ],
        },
      });

    await expect(
      runCreateTasksAgent({
        sessionId,
        db: dbStub as never,
      })
    ).rejects.toThrow(/string_above_max_length/i);

    expect(callToolMock).toHaveBeenCalledTimes(2);
    const secondRequest = callToolMock.mock.calls[1]?.[1] as Record<string, unknown>;
    expect(secondRequest).not.toHaveProperty('session_id');
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
                no_task_decision: {
                  code: 'discussion_only',
                  reason: 'Reduced context yielded discussion-only output.',
                  evidence: ['retry_path=reduced_context'],
                },
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
                    candidate_class: 'deliverable_task',
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
        id: expect.stringMatching(/^voice-task-/),
        row_id: expect.stringMatching(/^voice-task-/),
        name: 'Recovered after auth refresh',
        project_id: 'proj-2',
      }),
    ]);
  });

  it('retries once with runtime_rejections when mixed valid/invalid classes appear in task_draft', async () => {
    initializeSessionMock
      .mockResolvedValueOnce({ sessionId: 'transition-primary-session' })
      .mockResolvedValueOnce({ sessionId: 'transition-retry-session' });
    closeSessionMock.mockResolvedValue(undefined);
    callToolMock
      .mockResolvedValueOnce({
        success: true,
        data: {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                summary_md_text: 'Primary summary',
                scholastic_review_md: 'Primary review',
                task_draft: [
                  {
                    id: 'TASK-VALID',
                    row_id: 'TASK-VALID',
                    name: 'Собрать итоговый план',
                    description: 'Подготовить итоговый артефакт.',
                    candidate_class: 'deliverable_task',
                    priority: 'P2',
                  },
                  {
                    id: 'TASK-INVALID',
                    row_id: 'TASK-INVALID',
                    name: 'Созвониться позже',
                    description: 'Координация без артефакта.',
                    candidate_class: 'coordination_only',
                    priority: 'P3',
                  },
                ],
                enrich_ready_task_comments: [],
                session_name: '',
                project_id: 'proj-transition',
              }),
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
                summary_md_text: 'Retried summary',
                scholastic_review_md: 'Retried review',
                task_draft: [
                  {
                    id: 'TASK-VALID-RETRY',
                    row_id: 'TASK-VALID-RETRY',
                    name: 'Собрать итоговый план',
                    description: 'Подготовить итоговый артефакт.',
                    candidate_class: 'deliverable_task',
                    priority: 'P2',
                  },
                ],
                enrich_ready_task_comments: [],
                session_name: '',
                project_id: 'proj-transition',
              }),
            },
          ],
        },
      });

    const tasks = await runCreateTasksAgent({
      sessionId: 'session-transition-mixed',
      projectId: 'proj-transition',
    });

    expect(callToolMock).toHaveBeenCalledTimes(2);
    const retryEnvelopeRaw = callToolMock.mock.calls[1]?.[1]?.message as string;
    const retryEnvelope = JSON.parse(retryEnvelopeRaw) as Record<string, unknown>;
    const runtimeRejections = Array.isArray(retryEnvelope.runtime_rejections)
      ? (retryEnvelope.runtime_rejections as Array<Record<string, unknown>>)
      : [];
    expect(runtimeRejections).toHaveLength(1);
    expect(runtimeRejections[0]).toEqual(
      expect.objectContaining({
        candidate_id: 'TASK-INVALID',
        attempted_surface: 'task_draft',
        candidate_class: 'coordination_only',
        violated_invariant_code: 'task_draft_class_not_materializable',
      })
    );
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toEqual(
      expect.objectContaining({
        id: 'TASK-VALID-RETRY',
      })
    );
  });

  it('normalizes explicit unknown candidate_class to deliverable without transition retry', async () => {
    initializeSessionMock.mockResolvedValueOnce({ sessionId: 'unknown-primary-session' });
    closeSessionMock.mockResolvedValue(undefined);
    callToolMock.mockResolvedValueOnce({
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
                  id: 'TASK-UNKNOWN',
                  row_id: 'TASK-UNKNOWN',
                  name: 'Непонятная сущность',
                  description: 'Класс не определен.',
                  candidate_class: 'unknown',
                  priority: 'P3',
                },
              ],
              enrich_ready_task_comments: [],
              session_name: '',
              project_id: 'proj-unknown',
            }),
          },
        ],
      },
    });

    const tasks = await runCreateTasksAgent({
      sessionId: 'session-unknown-class',
      projectId: 'proj-unknown',
    });

    expect(callToolMock).toHaveBeenCalledTimes(1);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toEqual(
      expect.objectContaining({
        id: 'TASK-UNKNOWN',
        candidate_class: 'deliverable_task',
      })
    );
  });

  it('defaults missing candidate_class to deliverable without transition retry', async () => {
    initializeSessionMock.mockResolvedValueOnce({ sessionId: 'missing-class-primary-session' });
    closeSessionMock.mockResolvedValue(undefined);
    callToolMock.mockResolvedValueOnce({
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
                  id: 'TASK-MISSING-CLASS',
                  row_id: 'TASK-MISSING-CLASS',
                  name: 'Собрать документ решения',
                  description: 'Класс кандидата в ответе отсутствует.',
                  candidate_class: '',
                  priority: 'P2',
                },
              ],
              enrich_ready_task_comments: [],
              session_name: '',
              project_id: 'proj-missing-class',
            }),
          },
        ],
      },
    });

    const tasks = await runCreateTasksAgent({
      sessionId: 'session-missing-class',
      projectId: 'proj-missing-class',
    });

    expect(callToolMock).toHaveBeenCalledTimes(1);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toEqual(
      expect.objectContaining({
        id: 'TASK-MISSING-CLASS',
        candidate_class: 'deliverable_task',
      })
    );
  });

  it('keeps mixed deliverable and missing-class candidates without discard retry', async () => {
    initializeSessionMock.mockResolvedValueOnce({ sessionId: 'missing-class-discard-primary-session' });
    closeSessionMock.mockResolvedValue(undefined);
    callToolMock.mockResolvedValueOnce({
      success: true,
      data: {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              summary_md_text: 'Summary before discard',
              scholastic_review_md: 'Review before discard',
              task_draft: [
                {
                  id: 'TASK-VALID-KEEP',
                  row_id: 'TASK-VALID-KEEP',
                  name: 'Собрать релизный артефакт',
                  description: 'Deliverable with explicit class.',
                  candidate_class: 'deliverable_task',
                  priority: 'P2',
                },
                {
                  id: 'TASK-MISSING-RETRY',
                  row_id: 'TASK-MISSING-RETRY',
                  name: 'Кандидат без класса',
                  description: 'Класс не указан и не заполнен.',
                  task_class: null,
                  priority: 'P3',
                },
              ],
              enrich_ready_task_comments: [],
              session_name: '',
              project_id: 'proj-missing-discard',
            }),
          },
        ],
      },
    });

    const tasks = await runCreateTasksAgent({
      sessionId: 'session-missing-class-discard',
      projectId: 'proj-missing-discard',
    });

    expect(callToolMock).toHaveBeenCalledTimes(1);
    expect(tasks).toHaveLength(2);
    expect(tasks.map((task) => String(task.id))).toEqual(
      expect.arrayContaining(['TASK-VALID-KEEP', 'TASK-MISSING-RETRY'])
    );
    expect(tasks.find((task) => String(task.id) === 'TASK-MISSING-RETRY')).toEqual(
      expect.objectContaining({ candidate_class: 'deliverable_task' })
    );
    const compositeMeta = (tasks as unknown as Record<string, unknown>).__create_tasks_composite_meta as
      | Record<string, unknown>
      | undefined;
    const runtimeTransitionDiscards = Array.isArray(compositeMeta?.runtime_transition_discards)
      ? (compositeMeta?.runtime_transition_discards as Array<Record<string, unknown>>)
      : [];
    expect(runtimeTransitionDiscards).toHaveLength(0);
  });

  it('does not use persisted carry-over when missing classes are normalized to deliverable', async () => {
    initializeSessionMock.mockResolvedValueOnce({ sessionId: 'missing-class-carry-over-primary-session' });
    closeSessionMock.mockResolvedValue(undefined);
    callToolMock.mockResolvedValueOnce({
      success: true,
      data: {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              summary_md_text: 'Summary before carry-over',
              scholastic_review_md: 'Review before carry-over',
              task_draft: [
                {
                  id: 'TASK-MISSING-A',
                  row_id: 'TASK-MISSING-A',
                  name: 'Первый кандидат без класса',
                  description: 'Класс отсутствует.',
                  candidate_class: '',
                  priority: 'P3',
                },
                {
                  id: 'TASK-MISSING-B',
                  row_id: 'TASK-MISSING-B',
                  name: 'Второй кандидат без класса',
                  description: 'Класс также отсутствует.',
                  task_class: null,
                  priority: 'P3',
                },
              ],
              enrich_ready_task_comments: [],
              session_name: '',
              project_id: 'proj-missing-carry-over',
            }),
          },
        ],
      },
    });

    loadPersistedPossibleTaskCarryOverDraftsMock.mockResolvedValue([
      {
        row_id: 'TASK-CARRY-1',
        id: 'TASK-CARRY-1',
        name: 'Carry-over task 1',
        description: 'Existing persisted task',
        project_id: 'proj-missing-carry-over',
        candidate_class: 'deliverable_task',
      },
      {
        row_id: 'TASK-CARRY-2',
        id: 'TASK-CARRY-2',
        name: 'Carry-over task 2',
        description: 'Existing persisted task',
        project_id: 'proj-missing-carry-over',
        candidate_class: 'deliverable_task',
      },
      {
        row_id: 'TASK-CARRY-3',
        id: 'TASK-CARRY-3',
        name: 'Carry-over task 3',
        description: 'Existing persisted task',
        project_id: 'proj-missing-carry-over',
        candidate_class: 'deliverable_task',
      },
      {
        row_id: 'TASK-CARRY-4',
        id: 'TASK-CARRY-4',
        name: 'Carry-over task 4',
        description: 'Existing persisted task',
        project_id: 'proj-missing-carry-over',
        candidate_class: 'deliverable_task',
      },
      {
        row_id: 'TASK-CARRY-5',
        id: 'TASK-CARRY-5',
        name: 'Carry-over task 5',
        description: 'Existing persisted task',
        project_id: 'proj-missing-carry-over',
        candidate_class: 'deliverable_task',
      },
    ]);

    const dbStub = {
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return {
            findOne: async () => null,
          };
        }
        if (name === VOICEBOT_COLLECTIONS.MESSAGES) {
          return {
            findOne: async () => null,
            find: () => ({
              sort: () => ({
                limit: () => ({
                  toArray: async () => [],
                }),
              }),
            }),
          };
        }
        return {
          findOne: async () => null,
        };
      },
    } as unknown as import('mongodb').Db;
    const tasks = await runCreateTasksAgent({
      sessionId: '69cf65712a7446295ac67771',
      projectId: 'proj-missing-carry-over',
      db: dbStub,
    });

    expect(callToolMock).toHaveBeenCalledTimes(1);
    expect(loadPersistedPossibleTaskCarryOverDraftsMock).toHaveBeenCalledTimes(0);
    expect(tasks).toHaveLength(2);
    expect(tasks.map((task) => String(task.id))).toEqual([
      'TASK-MISSING-A',
      'TASK-MISSING-B',
    ]);
    expect(tasks.every((task) => String(task.candidate_class) === 'deliverable_task')).toBe(true);

    const compositeMeta = (tasks as unknown as Record<string, unknown>).__create_tasks_composite_meta as
      | Record<string, unknown>
      | undefined;
    const runtimeTransitionDiscards = Array.isArray(compositeMeta?.runtime_transition_discards)
      ? (compositeMeta.runtime_transition_discards as Array<Record<string, unknown>>)
      : [];
    expect(runtimeTransitionDiscards).toHaveLength(0);
    expect(compositeMeta?.runtime_transition_carry_over ?? null).toBeNull();
  });

  it('fails fast with machine-readable transition error after one reformulation retry', async () => {
    initializeSessionMock
      .mockResolvedValueOnce({ sessionId: 'exhaust-primary-session' })
      .mockResolvedValueOnce({ sessionId: 'exhaust-retry-session' });
    closeSessionMock.mockResolvedValue(undefined);
    callToolMock
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
                    id: 'TASK-INVALID-1',
                    row_id: 'TASK-INVALID-1',
                    name: 'Созвон',
                    description: 'Coordination only',
                    candidate_class: 'coordination_only',
                    priority: 'P3',
                  },
                ],
                enrich_ready_task_comments: [],
                session_name: '',
                project_id: 'proj-exhaust',
              }),
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
                    id: 'TASK-INVALID-2',
                    row_id: 'TASK-INVALID-2',
                    name: 'Референс',
                    description: 'Still not deliverable',
                    candidate_class: 'reference_or_idea',
                    priority: 'P4',
                  },
                ],
                enrich_ready_task_comments: [],
                session_name: '',
                project_id: 'proj-exhaust',
              }),
            },
          ],
        },
      });

    await expect(
      runCreateTasksAgent({
        sessionId: 'session-transition-exhaust',
        projectId: 'proj-exhaust',
      })
    ).rejects.toMatchObject({
      details: expect.objectContaining({
        code: 'create_tasks_transition_retries_exhausted',
        retry_budget: expect.objectContaining({
          transition_reformulation_attempts: 1,
          transition_reformulation_limit: 1,
        }),
      }),
    });
    expect(callToolMock).toHaveBeenCalledTimes(2);
  });

  it('does not reject a deliverable candidate solely because the name is stopword-like', async () => {
    initializeSessionMock.mockResolvedValue({ sessionId: 'stopword-name-session' });
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
                  id: 'TASK-STOPWORD-NAME',
                  row_id: 'TASK-STOPWORD-NAME',
                  name: 'Сделать',
                  description: 'Собрать исполнительный артефакт по релизу.',
                  candidate_class: 'deliverable_task',
                  priority: 'P2',
                },
              ],
              enrich_ready_task_comments: [],
              session_name: '',
              project_id: 'proj-stopword',
            }),
          },
        ],
      },
    });

    const tasks = await runCreateTasksAgent({
      sessionId: 'session-stopword-name',
      projectId: 'proj-stopword',
    });

    expect(callToolMock).toHaveBeenCalledTimes(1);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toEqual(
      expect.objectContaining({
        id: 'TASK-STOPWORD-NAME',
        name: 'Сделать',
      })
    );
  });

  it('does not rewrite colloquial deliverable task names in runtime write path', async () => {
    initializeSessionMock.mockResolvedValue({ sessionId: 'no-runtime-lexical-rewrite-session' });
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
                  id: 'TASK-RAW-NAME',
                  row_id: 'TASK-RAW-NAME',
                  name: 'Ну, тогда первая задача у нас подфиналить комментарии относительно мейнпэйджи',
                  description: 'Сохранить имя как прислал prompt.',
                  candidate_class: 'deliverable_task',
                  priority: 'P2',
                },
              ],
              enrich_ready_task_comments: [],
              session_name: '',
              project_id: 'proj-raw-name',
            }),
          },
        ],
      },
    });

    const tasks = await runCreateTasksAgent({
      sessionId: 'session-raw-name',
      projectId: 'proj-raw-name',
    });

    expect(callToolMock).toHaveBeenCalledTimes(1);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toEqual(
      expect.objectContaining({
        id: 'TASK-RAW-NAME',
        name: 'Ну, тогда первая задача у нас подфиналить комментарии относительно мейнпэйджи',
      })
    );
  });
});
