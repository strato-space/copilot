import fs from 'node:fs';
import path from 'node:path';

describe('Voice Codex tab inline details contract', () => {
  const componentPath = path.resolve(process.cwd(), 'src/components/voice/CodexTasks.tsx');
  const source = fs.readFileSync(componentPath, 'utf8');

  it('opens task details in place from row click', () => {
    expect(source).toContain('const [selectedTaskKey, setSelectedTaskKey] = useState<string | null>(null);');
    expect(source).toContain('const openTaskDetails = useCallback((task: CodexTask) => {');
    expect(source).toContain('onRow={(record) => ({');
    expect(source).toContain('onClick: () => openTaskDetails(record),');
    expect(source).toContain('<Drawer');
  });

  it('renders bd-show-like payload inside inline details drawer', () => {
    expect(source).toContain('const buildBdShowEquivalent = (task: CodexTask): Record<string, unknown> => {');
    expect(source).toContain('`bd show` equivalent');
    expect(source).toContain('JSON.stringify(buildBdShowEquivalent(selectedTask), null, 2)');
    expect(source).toContain("status: toText(task.task_status) || null");
    expect(source).toContain("dependencies,");
    expect(source).toContain("labels,");
  });
});
