import fs from 'node:fs';
import path from 'node:path';

describe('SessionPage codex tab contract', () => {
  const pagePath = path.resolve(process.cwd(), 'src/pages/voice/SessionPage.tsx');
  const source = fs.readFileSync(pagePath, 'utf8');
  const codexTablePath = path.resolve(process.cwd(), 'src/components/codex/CodexIssuesTable.tsx');
  const codexTableSource = fs.readFileSync(codexTablePath, 'utf8');

  it('renders Codex tab in voice session tabs', () => {
    expect(source).toContain("import CodexIssuesTable from '../../components/codex/CodexIssuesTable';");
    expect(source).toContain("key: 'codex'");
    expect(source).toContain("label: renderTabLabel('Codex', sessionCodexCount)");
    expect(source).toContain('children: <CodexIssuesTable sourceRefs={sessionTaskSourceRefs} refreshToken={sessionCodexRefreshToken} />');
    expect(source).toContain("'voicebot/session_tab_counts'");
    expect(source).toContain("api_request<unknown>('codex/issues', { view: 'all', limit: 1000 }, { silent: true })");
    expect(codexTableSource).toContain("api_request<unknown>('codex/issues'");
  });

  it('keeps Codex tab before Screenshort and Log tabs', () => {
    const idxCodex = source.indexOf("key: 'codex'");
    const idxScreenshort = source.indexOf("key: 'screenshort'");
    const idxLog = source.indexOf("key: 'log'");

    expect(idxCodex).toBeGreaterThanOrEqual(0);
    expect(idxScreenshort).toBeGreaterThan(idxCodex);
    expect(idxLog).toBeGreaterThan(idxScreenshort);
  });

  it('uses codex issue links with the codex operops route contract', () => {
    expect(codexTableSource).toContain('return `/operops/codex/task/${taskId}`;');
  });
});
