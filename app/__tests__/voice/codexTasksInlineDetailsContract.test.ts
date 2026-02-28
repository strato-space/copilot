import fs from 'node:fs';
import path from 'node:path';

describe('Voice Codex tab inline details contract', () => {
  const componentPath = path.resolve(process.cwd(), 'src/components/codex/CodexIssuesTable.tsx');
  const source = fs.readFileSync(componentPath, 'utf8');

  it('opens task details in place from row click', () => {
    expect(source).toContain('const [selectedKey, setSelectedKey] = useState<string | null>(null);');
    expect(source).toContain('onRow={(record) => ({');
    expect(source).toContain('onClick: () => setSelectedKey(resolveTaskKey(record)),');
    expect(source).toContain('<Drawer');
  });

  it('reuses shared codex details card and wide drawer for inline task details', () => {
    expect(source).toContain("import CodexIssueDetailsCard from './CodexIssueDetailsCard';");
    expect(source).toContain('<CodexIssueDetailsCard');
    expect(source).toContain('width=\"min(1180px, calc(100vw - 48px))\"');
  });

  it('uses codex task route for external task links', () => {
    expect(source).toContain('return `/operops/codex/task/${taskId}`;');
  });

  it('keeps codex inline details open-button label contract', () => {
    expect(source).toContain('Открыть задачу в OperOps');
  });
});
