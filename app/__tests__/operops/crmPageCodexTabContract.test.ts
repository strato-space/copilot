import fs from 'node:fs';
import path from 'node:path';

describe('OperOps CRM Codex tab contract', () => {
  const pagePath = path.resolve(process.cwd(), 'src/pages/operops/CRMPage.tsx');
  const source = fs.readFileSync(pagePath, 'utf8');

  it('adds Codex tab after Archive and loads latest 500 issues from bd list route', () => {
    const archiveTabIndex = source.indexOf("{ key: 'archive', label: 'Archive', configKey: 'archive' },");
    const codexTabIndex = source.indexOf("{ key: 'codex', label: 'Codex' },");

    expect(archiveTabIndex).toBeGreaterThan(-1);
    expect(codexTabIndex).toBeGreaterThan(-1);
    expect(codexTabIndex).toBeGreaterThan(archiveTabIndex);

    expect(source).toContain("api_request<CodexIssue[]>('codex/issues', { limit: 500 }, { silent: true })");
    expect(source).toContain("if (activeMainTab === 'codex') {");
    expect(source).toContain("locale={{ emptyText: 'Нет Codex issues' }}");
  });
});
