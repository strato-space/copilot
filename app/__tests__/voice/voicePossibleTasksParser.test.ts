import { parseCreateTasksMcpResult } from '../../src/utils/voicePossibleTasks';

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
});
