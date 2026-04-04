import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ObjectId } from 'mongodb';

const initializeSessionMock = jest.fn();
const callToolMock = jest.fn();
const closeSessionMock = jest.fn();
const quotaRecoveryMock = jest.fn();
const openAiResponsesCreateMock = jest.fn();

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

const { runCreateTasksAgent } = await import('../../../src/services/voicebot/createTasksAgent.js');

describe('runCreateTasksAgent quota fallback', () => {
  beforeEach(() => {
    initializeSessionMock.mockReset();
    callToolMock.mockReset();
    closeSessionMock.mockReset();
    quotaRecoveryMock.mockReset();
    openAiResponsesCreateMock.mockReset();
    process.env.OPENAI_API_KEY = 'test-openai-key';
    openAiResponsesCreateMock.mockImplementation(async (request?: { input?: string }) => {
      const raw = String(request?.input || '').trim();
      const parsed = raw ? JSON.parse(raw) as { composite?: unknown } : {};
      return {
        output_text: JSON.stringify(parsed.composite || {}),
      };
    });
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
        id: expect.stringMatching(/^voice-task-/),
        row_id: expect.stringMatching(/^voice-task-/),
        name: 'Recovered task',
        project_id: 'proj-1',
      }),
    ]);
  });

  it('completes explicit numbered task cues without a second generative repair pass', async () => {
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
                    priority: 'P2',
                  },
                  {
                    id: 'TASK-UI-CATALOG',
                    row_id: 'TASK-UI-CATALOG',
                    name: 'Составить каталог UI-элементов по страницам',
                    description: 'Каталог UI с маппингом на Ant Design.',
                    priority: 'P3',
                  },
                  {
                    id: 'TASK-YURA-THESES',
                    row_id: 'TASK-YURA-THESES',
                    name: 'Свести клиентские комментарии в технические тезисы',
                    description: 'Пак тезисов для Юры: что можем и что не можем.',
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

    expect(callToolMock).toHaveBeenCalledTimes(2);
    expect(closeSessionMock).toHaveBeenCalledTimes(2);
    expect(tasks).toHaveLength(5);
    expect(tasks.map((task) => String(task.name))).toEqual(
      expect.arrayContaining([
        'Финализировать комментарии по главной странице Jabula',
        'Собрать схему навигации Jabula mainpage',
        'Составить каталог UI-элементов по страницам',
        'Сделать схему навигации трейдинг-платформы',
        'Свести клиентские комментарии в технические тезисы',
      ])
    );
  });

  it('runs task-gap repair for generic structural coordination cues outside the Jabula wording', async () => {
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

    expect(callToolMock).toHaveBeenCalledTimes(2);
    expect(tasks).toHaveLength(2);
    expect(tasks.map((task) => String(task.name))).toEqual(
      expect.arrayContaining(['Собрать чеклист требований', 'Описать пользовательский путь оплаты'])
    );

    const repairEnvelopeRaw = callToolMock.mock.calls[1]?.[1]?.message as string;
    const repairEnvelope = JSON.parse(repairEnvelopeRaw) as Record<string, unknown>;
    expect(String(repairEnvelope.raw_text || '')).toContain('Режим добора задач');
    expect(String(repairEnvelope.raw_text || '')).toContain('Уже извлечено в первичном проходе');
    expect(String(repairEnvelope.raw_text || '')).toContain('платежный сценарий');
    expect(String(repairEnvelope.raw_text || '')).toContain('walkthrough');
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
                    priority: 'P2',
                  },
                  {
                    id: 'TASK-NAV',
                    row_id: 'TASK-NAV',
                    name: 'Собрать диаграмму навигации Jabula',
                    description: 'Диаграмма навигации.',
                    priority: 'P2',
                  },
                  {
                    id: 'TASK-UI',
                    row_id: 'TASK-UI',
                    name: 'Составить каталог UI-элементов',
                    description: 'Каталог UI.',
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

  it('adds a deterministic literal-cue task when explicit numbered task cues stay uncovered after primary extraction', async () => {
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
                    priority: 'P2',
                  },
                  {
                    id: 'TASK-UI',
                    row_id: 'TASK-UI',
                    name: 'Составить каталог UI-элементов',
                    description: 'Каталог UI.',
                    priority: 'P3',
                  },
                  {
                    id: 'TASK-THESES',
                    row_id: 'TASK-THESES',
                    name: 'Свести комментарии в технические тезисы',
                    description: 'Подготовить тезисы для Юры.',
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
    expect(tasks).toHaveLength(4);
    expect(tasks.map((task) => String(task.name))).toEqual(
      expect.arrayContaining([
        'Финализировать комментарии по главной странице',
        'Собрать диаграмму навигации Jabula',
        'Составить каталог UI-элементов',
        'Свести комментарии в технические тезисы',
      ])
    );
  });

  it('normalizes colloquial numbered literal cues before deterministic fallback materialization', async () => {
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
                    priority: 'P2',
                  },
                  {
                    id: 'TASK-UI',
                    row_id: 'TASK-UI',
                    name: 'Составить каталог UI-элементов',
                    description: 'Каталог UI.',
                    priority: 'P3',
                  },
                  {
                    id: 'TASK-THESES',
                    row_id: 'TASK-THESES',
                    name: 'Свести комментарии в технические тезисы',
                    description: 'Подготовить тезисы для Юры.',
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
    expect(tasks).toHaveLength(4);
    expect(tasks.map((task) => String(task.name))).toEqual(
      expect.arrayContaining([
        'Собрать диаграмму навигации Jabula',
        'Составить каталог UI-элементов',
        'Свести комментарии в технические тезисы',
        'Финализировать комментарии по главной странице',
      ])
    );
    expect(tasks.map((task) => String(task.name))).not.toContain(
      'Ну, тогда первая задача у нас подфиналить комментарии относительно мейнпэйджи'
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
                    priority: 'P2',
                  },
                  {
                    id: 'TASK-NAV',
                    row_id: 'TASK-NAV',
                    name: 'Построить схему навигации главной страницы Jabula',
                    description: 'Диаграмма переходов по mainpage.',
                    priority: 'P2',
                  },
                  {
                    id: 'TASK-UI',
                    row_id: 'TASK-UI',
                    name: 'Собрать каталог UI-элементов по страницам Jabula',
                    description: 'Каталог уникальных элементов интерфейса.',
                    priority: 'P3',
                  },
                  {
                    id: 'TASK-THESES',
                    row_id: 'TASK-THESES',
                    name: 'Подготовить тезисный пакет трёх комментариев для Юры',
                    description: 'Пак тезисов для Юры: что можем и что не можем.',
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
                  priority: 'P2',
                },
                {
                  id: 'TASK-NAV',
                  row_id: 'TASK-NAV',
                  name: 'Построить схему навигации главной страницы Jabula',
                  description: 'Диаграмма переходов по mainpage.',
                  priority: 'P2',
                },
                {
                  id: 'TASK-UI',
                  row_id: 'TASK-UI',
                  name: 'Собрать каталог UI-элементов по страницам Jabula',
                  description: 'Каталог уникальных элементов интерфейса.',
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

  it('throws on semantically empty composite payloads instead of treating them as no-task success', async () => {
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

    await expect(
      runCreateTasksAgent({
        sessionId: 'session-empty-composite',
        projectId: 'proj-empty',
      })
    ).rejects.toThrow('create_tasks_empty_mcp_result');
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

  it('repairs mixed-language russian review artifacts before returning composite metadata', async () => {
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

    expect(openAiResponsesCreateMock.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(openAiResponsesCreateMock.mock.calls.length).toBeLessThanOrEqual(2);
    expect(String(compositeMeta?.scholastic_review_md || '')).toContain('## Термины');
    expect(String(compositeMeta?.scholastic_review_md || '')).not.toContain('## Terms');
    expect(String(compositeMeta?.scholastic_review_md || '')).not.toContain('renegotiation');
    expect(String(compositeMeta?.scholastic_review_md || '')).not.toContain('lead-pipeline');
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

  it('drops coordination, input, reference, and status rows from task_draft while preserving deliverables', async () => {
    initializeSessionMock.mockResolvedValue({ sessionId: 'ontology-session' });
    closeSessionMock.mockResolvedValue(undefined);
    callToolMock.mockResolvedValue({
      success: true,
      data: {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              summary_md_text: 'Есть и summary, и review.',
              scholastic_review_md: 'Есть review.',
              task_draft: [
                {
                  id: 'TASK-DELIVERABLE',
                  row_id: 'TASK-DELIVERABLE',
                  name: 'Описать навигационную структуру Jabula mainpage',
                  description: 'Сделать схему entry point, разделов и переходов.',
                  priority: 'P2',
                },
                {
                  id: 'TASK-COORD',
                  row_id: 'TASK-COORD',
                  name: 'Созвониться с Юрой после колла',
                  description: 'После созвона показать платформу и обсудить позже.',
                  priority: 'P3',
                },
                {
                  id: 'TASK-INPUT',
                  row_id: 'TASK-INPUT',
                  name: 'Скинуть логины и пароли Jabula',
                  description: 'Передать креды и доступы.',
                  priority: 'P3',
                },
                {
                  id: 'TASK-REF',
                  row_id: 'TASK-REF',
                  name: 'Посмотреть кайфовый референс impact',
                  description: 'Можно бы потом использовать как пример.',
                  priority: 'P4',
                },
                {
                  id: 'TASK-STATUS',
                  row_id: 'TASK-STATUS',
                  name: 'Посмотрю это позже и отпишусь',
                  description: 'Это просто статус-апдейт без deliverable.',
                  priority: 'P4',
                },
              ],
              enrich_ready_task_comments: [],
              session_name: '',
              project_id: 'proj-ontology',
            }),
          },
        ],
      },
    });

    const tasks = await runCreateTasksAgent({
      sessionId: 'session-ontology',
      projectId: 'proj-ontology',
    });

    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toEqual(
      expect.objectContaining({
        id: 'TASK-DELIVERABLE',
        name: 'Описать навигационную структуру Jabula mainpage',
      })
    );
  });

  it('keeps bounded preparation tasks that end in a presentable artifact', async () => {
    initializeSessionMock.mockResolvedValue({ sessionId: 'ontology-prep-session' });
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
                  id: 'TASK-PREP',
                  row_id: 'TASK-PREP',
                  name: 'Подготовить демо и тезисы для показа клиенту',
                  description: 'Собрать документ с тезисами и демо-сценарием, затем показать клиенту.',
                  priority: 'P2',
                },
              ],
              enrich_ready_task_comments: [],
              session_name: '',
              project_id: 'proj-ontology',
            }),
          },
        ],
      },
    });

    const tasks = await runCreateTasksAgent({
      sessionId: 'session-ontology-prep',
      projectId: 'proj-ontology',
    });

    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toEqual(
      expect.objectContaining({
        id: 'TASK-PREP',
        name: 'Подготовить демо и тезисы для показа клиенту',
      })
    );
  });
});
