import fs from 'node:fs';
import path from 'node:path';

describe('MeetingCard tasks button contract', () => {
  const componentPath = path.resolve(process.cwd(), 'src/components/voice/MeetingCard.tsx');
  const utilPath = path.resolve(process.cwd(), 'src/utils/voicePossibleTasks.ts');
  const componentSource = fs.readFileSync(componentPath, 'utf8');
  const utilSource = fs.readFileSync(utilPath, 'utf8');

  it('places Tasks before Summarize and delegates to createPossibleTasksForSession', () => {
    const idxTasks = componentSource.indexOf('Tooltip title="Tasks"');
    const idxSummarize = componentSource.indexOf('Tooltip title="Summarize"');

    expect(idxTasks).toBeGreaterThanOrEqual(0);
    expect(idxSummarize).toBeGreaterThan(idxTasks);
    expect(componentSource).toContain('createPossibleTasksForSession');
    expect(componentSource).toContain('const triggerTasks = async (): Promise<void> => {');
    expect(componentSource).toContain('const result = await createPossibleTasksForSession(voiceBotSession._id);');
    expect(componentSource).toContain("content: tasksCount > 0 ? `Возможные задачи обновлены: ${tasksCount}` : 'Возможные задачи не найдены'");
  });

  it('builds MCP create_tasks args with a structured message envelope', () => {
    expect(utilSource).toContain("kind: 'voice_possible_tasks'");
    expect(utilSource).toContain('message_envelope');
    expect(utilSource).toContain('blocks,');
    expect(utilSource).toContain("type: 'attachment'");
    expect(utilSource).toContain("type: 'categorization'");
    expect(utilSource).toContain("type: 'transcript'");
  });

  it('logs and surfaces invalid create_tasks payloads instead of hanging in loading state', () => {
    const storePath = path.resolve(process.cwd(), 'src/store/voiceBotStore.ts');
    const storeSource = fs.readFileSync(storePath, 'utf8');
    expect(storeSource).toContain("[create_tasks] MCP returned error payload");
    expect(storeSource).toContain("[create_tasks] invalid MCP result format");
    expect(storeSource).toContain("Некорректный ответ create_tasks:");
    expect(storeSource).toContain("Некорректный ответ create_tasks: ожидался JSON-массив задач");
  });
});
