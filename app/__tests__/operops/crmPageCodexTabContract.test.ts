import fs from 'node:fs';
import path from 'node:path';

describe('OperOps CRM Codex tab contract', () => {
  const pagePath = path.resolve(process.cwd(), 'src/pages/operops/CRMPage.tsx');
  const source = fs.readFileSync(pagePath, 'utf8');

  it('adds Codex tab after Archive and loads latest 500 issues from codex route', () => {
    const archiveTabIndex = source.indexOf("{ key: 'archive', label: 'Archive', configKey: 'archive' },");
    const codexTabIndex = source.indexOf("{ key: 'codex', label: 'Codex' },");

    expect(archiveTabIndex).toBeGreaterThan(-1);
    expect(codexTabIndex).toBeGreaterThan(-1);
    expect(codexTabIndex).toBeGreaterThan(archiveTabIndex);

    expect(source).toContain("api_request<CodexIssue[]>('codex/issues', { limit: 500 }, { silent: true })");
    expect(source).toContain("if (activeMainTab === 'codex') {");
  });

  it('shows explicit Codex loading and error states', () => {
    expect(source).toContain('const [codexLoading, setCodexLoading] = useState(false);');
    expect(source).toContain('const [codexLoadError, setCodexLoadError] = useState<string | null>(null);');
    expect(source).toContain('setCodexLoadError(null);');
    expect(source).toContain('message.error(userMessage);');
    expect(source).toContain('loading={codexLoading}');
    expect(source).toContain("locale={{ emptyText: codexLoadError ? `Ошибка: ${codexLoadError}` : 'Нет Codex issues' }}");
  });

  it('renders Codex description preview tooltip with viewport-safe constraints', () => {
    expect(source).toContain('placement="leftTop"');
    expect(source).toContain("overlayStyle={{ maxWidth: 'min(760px, calc(100vw - 32px))' }}");
    expect(source).toContain("overlayInnerStyle={{ maxHeight: '60vh', overflowY: 'auto', overflowX: 'hidden' }}");
  });
});
