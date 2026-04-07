import {
  buildVoiceTaskEnrichmentDescription,
  parseCreateTasksMcpResult,
  parsePossibleTasksResponse,
  parseVoiceTaskEnrichmentSections,
} from '../../src/utils/voicePossibleTasks';

describe('voice possible tasks parser', () => {
  it('parses JSON array payloads from MCP text content', () => {
    const result = parseCreateTasksMcpResult({
      content: [
        {
          text: JSON.stringify([
            {
              row_id: 'task-1',
              id: 'task-1',
              name: 'Развернуть Codex на ноутбуке Алексея',
              description: 'Установить Codex и проверить рабочее окружение',
              priority: 'P1',
            },
          ]),
        },
      ],
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.row_id).toBe('task-1');
    expect(result[0]?.name).toBe('Развернуть Codex на ноутбуке Алексея');
  });

  it('surfaces fast-agent provider errors instead of masking them as parse failures', () => {
    expect(() =>
      parseCreateTasksMcpResult({
        content: [
          {
            text: `I hit an internal error while calling the model: responses request failed for model 'gpt-5.2-codex' (code: insufficient_quota): You exceeded your current quota, please check your plan and billing details. See fast-agent-error for additional details.

Error details: responses request failed for model 'gpt-5.2-codex' (code: insufficient_quota): You exceeded your current quota, please check your plan and billing details.`,
          },
        ],
      })
    ).toThrow(/Ошибка модели в create_tasks: .*insufficient_quota/i);
  });

  it('keeps canonical row_id separate from provisional client_row_key and carries override metadata', () => {
    const [task] = parsePossibleTasksResponse([
      {
        id: 'candidate-id-1',
        client_row_key: 'clone:abc123',
        name: 'Новый локальный draft',
        description: 'Описание',
        priority: 'P2',
        user_owned_overrides: ['description', 'performer_id'],
        row_version: 7,
        field_versions: { description: 3 },
        divergent_backend_candidates: { description: 'Backend proposal' },
      },
    ]);

    expect(task).toBeDefined();
    expect(task?.row_id).toBe('');
    expect(task?.id).toBe('candidate-id-1');
    expect(task?.client_row_key).toBe('clone:abc123');
    expect(task?.user_owned_overrides).toEqual(['description', 'performer_id']);
    expect(task?.row_version).toBe(7);
    expect(task?.field_versions).toEqual({ description: 3 });
    expect(task?.divergent_backend_candidates).toEqual({ description: 'Backend proposal' });
  });

  it('parses canonical Draft enrichment markdown sections from description', () => {
    const parsed = parseVoiceTaskEnrichmentSections(
      [
        '## description',
        'Короткий synopsis',
        '',
        '### object_locators',
        'https://example.com/task',
        '',
        '### expected_results',
        'Получить воспроизводимый результат.',
        '',
        '### acceptance_criteria',
        'Не указано',
        '',
        '### evidence_links',
        '—',
      ].join('\n')
    );

    expect(parsed.synopsis).toBe('Короткий synopsis');
    expect(parsed.sections.object_locators).toBe('https://example.com/task');
    expect(parsed.sections.expected_results).toBe('Получить воспроизводимый результат.');
    expect(parsed.sections.acceptance_criteria).toBe('');
    expect(parsed.sections.evidence_links).toBe('');
    expect(parsed.missingKeys).toContain('acceptance_criteria');
    expect(parsed.missingKeys).toContain('evidence_links');
  });

  it('ignores non-canonical legacy singular enrichment headings', () => {
    const parsed = parseVoiceTaskEnrichmentSections(
      [
        '## description',
        'Legacy synopsis',
        '',
        '**expected result**',
        'Старый формат',
        '',
        '### expected_results',
        'Каноничное значение',
      ].join('\n')
    );

    expect(parsed.sections.description).toContain('Legacy synopsis');
    expect(parsed.sections.description).toContain('**expected result**');
    expect(parsed.sections.expected_results).toBe('Каноничное значение');
    expect(parsed.synopsis).toContain('Legacy synopsis');
  });

  it('keeps parser strict for canonical enrichment section keys', () => {
    const parsed = parseVoiceTaskEnrichmentSections(
      [
        '## description',
        'Короткий synopsis',
        '',
        '### object locator',
        'https://example.com/task',
        '',
        '### expected result',
        'Получить воспроизводимый результат.',
        '',
        '### open questions',
        'Кто отвечает за валидацию?',
      ].join('\n')
    );

    expect(parsed.sections.object_locators).toBe('');
    expect(parsed.sections.expected_results).toBe('');
    expect(parsed.sections.open_questions).toBe('');
    expect(parsed.missingKeys).toContain('object_locators');
    expect(parsed.missingKeys).toContain('expected_results');
    expect(parsed.missingKeys).toContain('open_questions');
  });

  it('builds canonical Draft enrichment markdown from section values', () => {
    const description = buildVoiceTaskEnrichmentDescription({
      description: 'Подготовить запуск',
      expected_results: 'Есть готовый execution brief',
      open_questions: 'Кто утверждает финальный rollout?',
    });

    expect(description).toContain('## description');
    expect(description).toContain('## expected_results');
    expect(description).toContain('Есть готовый execution brief');
    expect(description).toContain('## object_locators');
    expect(description).toContain('Не указано');
    expect(description).toContain('## open_questions');
    expect(description.startsWith('## description')).toBe(true);
  });

  it('keeps parser strict and does not treat preface text as canonical description', () => {
    const parsed = parseVoiceTaskEnrichmentSections(
      [
        'Короткий synopsis',
        '',
        '### expected_results',
        'Получить воспроизводимый результат.',
      ].join('\n')
    );

    expect(parsed.sections.description).toBe('');
    expect(parsed.synopsis).toBe('');
  });
});
