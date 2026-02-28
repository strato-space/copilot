import fs from 'node:fs';
import path from 'node:path';

describe('Voice session Codex list filter/order contract', () => {
  const componentPath = path.resolve(process.cwd(), 'src/components/codex/CodexIssuesTable.tsx');
  const componentSource = fs.readFileSync(componentPath, 'utf8');

  it('filters issues by external source refs passed via props', () => {
    expect(componentSource).toContain('sourceRefs?: unknown[];');
    expect(componentSource).toContain('ticketMatchesVoiceSessionSourceRefs(issue, sourceRefs)');
  });

  it('keeps issues as flat table with in-place row open', () => {
    expect(componentSource).toContain('const dataSource = useMemo(');
    expect(componentSource).toContain('onRow={(record) => ({');
    expect(componentSource).toContain('onClick: () => setSelectedKey(resolveTaskKey(record)),');
  });

  it('renders Codex issues without status segmentation tabs', () => {
    expect(componentSource).toContain('<Table<CodexIssue>');
    expect(componentSource).not.toContain('<Tabs');
  });

  it('renders row card links with codex operops route', () => {
    expect(componentSource).toContain('return `/operops/codex/task/${taskId}`;');
    expect(componentSource).toContain('OPER_OPS_TASK_LINK_LABEL');
    expect(componentSource).toContain('<Tooltip');
    expect(componentSource).toContain('<LinkOutlined />');
  });
});
