import fs from 'node:fs';
import path from 'node:path';

describe('Voice sessions list surface contract', () => {
  const pagePath = path.resolve(process.cwd(), 'src/pages/voice/SessionsListPage.tsx');
  const cssPath = path.resolve(process.cwd(), 'src/index.css');
  const source = fs.readFileSync(pagePath, 'utf8');
  const css = fs.readFileSync(cssPath, 'utf8');

  it('adds a Tasks column after Chunks and sums task plus codex counts', () => {
    expect(source).toContain("title: (\n                <Tooltip title=\"Tasks\">");
    expect(source).toContain("key: 'tasks_count',");
    expect(source).toContain('width: 84,');
    expect(source).toContain('getSessionTasksTotalCount(record)');
    expect(source).toContain("tasks_count?: number;");
    expect(source).toContain("codex_count?: number;");
  });

  it('keeps merge controls free of visible session ids', () => {
    expect(source).toContain("label: sessionName,");
    expect(source).not.toContain("session._id.slice(-6)");
    expect(source).not.toContain("({session._id})");
  });

  it('uses a liquid-glass shell with padded Ant Design tables', () => {
    expect(source).toContain('className="voice-sessions-shell"');
    expect(source).toContain('className="voice-sessions-surface"');
    expect(css).toContain('.voice-sessions-shell');
    expect(css).toContain('.voice-sessions-shell .ant-table-wrapper');
    expect(css).toContain('.voice-sessions-shell .ant-table-thead > tr > th');
    expect(css).toContain('.voice-sessions-shell .ant-pagination');
  });
});
