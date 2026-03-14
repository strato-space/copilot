import fs from 'node:fs';
import path from 'node:path';

describe('SessionPage tab counters and indicators contract', () => {
  const pagePath = path.resolve(process.cwd(), 'src/pages/voice/SessionPage.tsx');
  const cssPath = path.resolve(process.cwd(), 'src/index.css');
  const source = fs.readFileSync(pagePath, 'utf8');
  const css = fs.readFileSync(cssPath, 'utf8');

  it('renders compact count labels for all voice tabs except Log', () => {
    expect(source).toContain("label: renderTabLabel('Транскрипция', transcriptionCount");
    expect(source).toContain("label: renderTabLabel('Категоризация', categorizationCount");
    expect(source).toContain("label: renderTabLabel('Задачи', sessionTasksTotalCount, { processing: hasPossibleTasksPending })");
    expect(source).toContain("label: renderTabLabel('Codex', sessionCodexCount)");
    expect(source).toContain("label: renderTabLabel('Screenshort', screenshortCount)");
    expect(source).toContain("label: renderTabLabel('Log', 0, { showCount: false })");
    expect(source).toContain('const renderTabLabel = (label: string, count: number');
    expect(source).not.toContain("label: 'Work'");
    expect(source).not.toContain("label: 'Review'");
  });

  it('always renders a fixed lifecycle filter axis inside unified Tasks', () => {
    expect(source).toContain('const sessionTaskCountByStatus = useMemo(() => {');
    expect(source).toContain('TARGET_VOICE_TASK_SUBTAB_KEYS.map((statusKey) => ({');
    expect(source).toContain("label: TARGET_TASK_STATUS_LABELS[statusKey]");
    expect(source).toContain("count: sessionTaskCountByStatus.get(statusKey) ?? 0");
    expect(source).toContain("setSessionTasksSubTab(sessionTaskTabs[0]?.key || '')");
    expect(source).not.toContain('.filter((entry) => entry.count > 0');
  });

  it('marks only Transcription, Categorization, and unified Tasks with processing dots', () => {
    expect(source).toContain('{ processing: hasTranscriptionPending }');
    expect(source).toContain('{ processing: hasCategorizationPending }');
    expect(source).toContain("label: renderTabLabel('Задачи', sessionTasksTotalCount, { processing: hasPossibleTasksPending })");
    expect(source).not.toContain("label: renderTabLabel('Codex', sessionCodexCount, { processing:");
    expect(source).not.toContain("label: renderTabLabel('Screenshort', screenshortCount, { processing:");
  });

  it('defines a slow green processing-dot animation for tab labels', () => {
    expect(css).toContain('@keyframes voice-tab-processing-pulse');
    expect(css).toContain('.voice-tab-processing-dot');
    expect(css).toContain('animation: voice-tab-processing-pulse 2.4s ease-in-out infinite;');
    expect(css).toContain('background: #22c55e;');
  });
});
