import fs from 'node:fs';
import path from 'node:path';

describe('SessionPage OperOps tasks tab contract', () => {
  const pagePath = path.resolve(process.cwd(), 'src/pages/voice/SessionPage.tsx');
  const source = fs.readFileSync(pagePath, 'utf8');

  it("renders 'Задачи' tab with CRMKanban filtered by current session source refs", () => {
    expect(source).toContain("key: 'operops_tasks'");
    expect(source).toContain("label: 'Задачи'");
    expect(source).toContain('<CRMKanban');
    expect(source).toContain('buildVoiceSessionTaskSourceRefs(sessionId, voiceBotSession)');
    expect(source).toContain('source_ref: sessionTaskSourceRefs');
  });

  it('keeps tasks tab before Screenshort and provides Work/Review sub-tabs', () => {
    const idxTasks = source.indexOf("key: 'operops_tasks'");
    const idxScreenshort = source.indexOf("key: 'screenshort'");

    expect(idxTasks).toBeGreaterThanOrEqual(0);
    expect(idxScreenshort).toBeGreaterThan(idxTasks);
    expect(source).toContain("{ key: 'work', label: 'Work' }");
    expect(source).toContain("{ key: 'review', label: 'Review' }");
  });
});
