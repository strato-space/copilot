import fs from 'node:fs';
import path from 'node:path';

describe('MeetingCard tasks button contract', () => {
  const componentPath = path.resolve(process.cwd(), 'src/components/voice/MeetingCard.tsx');
  const utilPath = path.resolve(process.cwd(), 'src/utils/voicePossibleTasks.ts');
  const componentSource = fs.readFileSync(componentPath, 'utf8');
  const utilSource = fs.readFileSync(utilPath, 'utf8');

  it('places Tasks and Summarize in the right header action cluster before custom prompt and delegates to createPossibleTasksForSession', () => {
    const idxTasks = componentSource.indexOf('Tooltip title="Tasks"');
    const idxSummarize = componentSource.indexOf('Tooltip title="Summarize"');
    const idxHeaderActions = componentSource.indexOf('className="voice-meeting-header-actions"');
    const idxCustomPrompt = componentSource.indexOf('Tooltip title="Запустить произвольный промпт"');

    expect(idxTasks).toBeGreaterThanOrEqual(0);
    expect(idxSummarize).toBeGreaterThan(idxTasks);
    expect(idxHeaderActions).toBeGreaterThan(-1);
    expect(idxTasks).toBeGreaterThan(idxHeaderActions);
    expect(idxSummarize).toBeGreaterThan(idxTasks);
    expect(idxCustomPrompt).toBeGreaterThan(idxSummarize);
    expect(componentSource).toContain('createPossibleTasksForSession');
    expect(componentSource).toContain('const triggerTasks = async (): Promise<void> => {');
    expect(componentSource).toContain('const result = await createPossibleTasksForSession(voiceBotSession._id);');
    expect(componentSource).toContain("content: tasksCount > 0 ? `Возможные задачи обновлены: ${tasksCount}` : 'Возможные задачи не найдены'");
  });

  it('builds MCP create_tasks args with a compact session envelope and avoids giant transcript blocks', () => {
    expect(utilSource).toContain("mode: 'session_id'");
    expect(utilSource).toContain("session_url: canonicalSessionUrl(sessionId)");
    expect(utilSource).toContain("mode: 'raw_text'");
    expect(utilSource).not.toContain('message_envelope');
    expect(utilSource).not.toContain('blocks,');
  });

  it('surfaces backend create_tasks errors instead of relying on direct browser MCP payload parsing', () => {
    const storePath = path.resolve(process.cwd(), 'src/store/voiceBotStore.ts');
    const storeSource = fs.readFileSync(storePath, 'utf8');
    expect(componentSource).toContain("const errorText = error instanceof Error ? error.message : String(error);");
    expect(storeSource).toContain("'voicebot/generate_possible_tasks'");
    expect(storeSource).toContain('const responseRecord =');
    expect(storeSource).not.toContain("[create_tasks] MCP returned error payload");
  });
});
