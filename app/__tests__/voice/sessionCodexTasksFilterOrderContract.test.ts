import fs from 'node:fs';
import path from 'node:path';

describe('Voice session Codex list filter/order contract', () => {
  const storePath = path.resolve(process.cwd(), 'src/store/voiceBotStore.ts');
  const storeSource = fs.readFileSync(storePath, 'utf8');

  const componentPath = path.resolve(process.cwd(), 'src/components/voice/CodexTasks.tsx');
  const componentSource = fs.readFileSync(componentPath, 'utf8');

  it('filters tasks by canonicalized voice session source refs', () => {
    expect(storeSource).toContain('const sessionSourceRefs = buildVoiceSessionTaskSourceRefs(normalizedSessionId, get().voiceBotSession);');
    expect(storeSource).toContain('ticketMatchesVoiceSessionSourceRefs(task, sessionSourceRefs)');
  });

  it('keeps newest-first chronological ordering without status grouping logic', () => {
    expect(storeSource).toContain('const sortCodexTasksNewestFirst = (tasks: CodexTask[]): CodexTask[] => {');
    expect(storeSource).toContain('resolveCodexTaskTimestamp(right) - resolveCodexTaskTimestamp(left)');
    expect(storeSource).toContain('return sortCodexTasksNewestFirst(filteredTasks);');
  });

  it('renders Codex tasks as a flat table without status segmentation tabs', () => {
    expect(componentSource).toContain('<Table<CodexTask>');
    expect(componentSource).not.toContain('<Tabs');
    expect(componentSource).not.toContain('task_status: [');
  });
});
