import fs from 'node:fs';
import path from 'node:path';

describe('SessionPage codex tab contract', () => {
  const pagePath = path.resolve(process.cwd(), 'src/pages/voice/SessionPage.tsx');
  const source = fs.readFileSync(pagePath, 'utf8');

  it('renders Codex tab in voice session tabs', () => {
    expect(source).toContain("import CodexTasks from '../../components/voice/CodexTasks';");
    expect(source).toContain("key: 'codex'");
    expect(source).toContain("label: 'Codex'");
    expect(source).toContain('children: <CodexTasks />');
  });

  it('keeps Codex tab before Screenshort and Log tabs', () => {
    const idxCodex = source.indexOf("key: 'codex'");
    const idxScreenshort = source.indexOf("key: 'screenshort'");
    const idxLog = source.indexOf("key: 'log'");

    expect(idxCodex).toBeGreaterThanOrEqual(0);
    expect(idxScreenshort).toBeGreaterThan(idxCodex);
    expect(idxLog).toBeGreaterThan(idxScreenshort);
  });
});
