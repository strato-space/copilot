import fs from 'node:fs';
import path from 'node:path';

describe('Voice Codex tab inline details contract', () => {
  const componentPath = path.resolve(process.cwd(), 'src/components/codex/CodexIssuesTable.tsx');
  const source = fs.readFileSync(componentPath, 'utf8');
  const expectPattern = (pattern: RegExp): void => {
    expect(source).toMatch(pattern);
  };

  it('opens task details in place from row click', () => {
    expectPattern(/\[\s*selectedKey\s*,\s*setSelectedKey\s*\]\s*=\s*useState<[^>]+>\(\s*null\s*\)/);
    expectPattern(/onRow=\{\(record\)\s*=>\s*\(\{\s*onClick:\s*\(\)\s*=>\s*setSelectedKey\(resolveTaskKey\(record\)\)/);
    expectPattern(/<Drawer[\s\S]*open=\{selectedTask\s*!==\s*null\}[\s\S]*onClose=\{\(\)\s*=>\s*setSelectedKey\(null\)\}/);
  });

  it('reuses shared codex details card and wide drawer for inline task details', () => {
    expectPattern(/import\s+CodexIssueDetailsCard[\s\S]*from\s+['"]\.\/CodexIssueDetailsCard['"]/);
    expectPattern(/<CodexIssueDetailsCard/);
    expectPattern(/width="min\(1180px,\s*calc\(100vw\s*-\s*48px\)\)"/);
  });

  it('uses codex task route for external task links', () => {
    expectPattern(/`\/operops\/codex\/task\/\$\{(?:taskId|selectedIssueDetailsTaskId)\}`/);
  });

  it('keeps codex inline details open-button label contract', () => {
    expect(source).toMatch(/Открыть задачу в OperOps/);
  });
});
