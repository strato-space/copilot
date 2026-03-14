import fs from 'node:fs';
import path from 'node:path';

describe('OperOps CRM Codex tab contract', () => {
  const pagePath = path.resolve(process.cwd(), 'src/pages/operops/CRMPage.tsx');
  const source = fs.readFileSync(pagePath, 'utf8');
  const codexTablePath = path.resolve(process.cwd(), 'src/components/codex/CodexIssuesTable.tsx');
  const codexTableSource = fs.readFileSync(codexTablePath, 'utf8');

  it('adds Codex tab after Archive and renders shared Codex table component', () => {
    expect(source).toContain("const STATUS_TAB_KEYS: OperOpsStatusTabKey[] = ['draft', 'ready', 'in_progress', 'review', 'done', 'archive', 'codex'];");
    expect(source).toContain("import CodexIssuesTable from '../../components/codex/CodexIssuesTable';");
    expect(source).toContain('<CodexIssuesTable />');
  });

  it('uses shared table rendering semantics on Codex tab', () => {
    expect(source).toContain('const isCodexTab = activeTabDefinition?.isCodex ?? false;');
    expect(source).toContain('isCodexTab ? (');
    expect(source).toContain('<CodexIssuesTable />');
    expect(source).not.toContain('const [codexLoading');
    expect(source).not.toContain('setCodexLoadError');
  });

  it('keeps codex issue links on codex operops task route', () => {
    expect(codexTableSource).toContain('return `/operops/codex/task/${taskId}`;');
  });
});
