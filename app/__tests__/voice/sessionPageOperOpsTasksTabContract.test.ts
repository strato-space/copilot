import fs from 'node:fs';
import path from 'node:path';

describe('SessionPage OperOps tasks tab contract', () => {
  const pagePath = path.resolve(process.cwd(), 'src/pages/voice/SessionPage.tsx');
  const source = fs.readFileSync(pagePath, 'utf8');

  it("renders 'Задачи' tab with CRMKanban filtered by current session source refs", () => {
    expect(source).toContain("key: 'operops_tasks'");
    expect(source).toContain("label: renderTabLabel('Задачи', sessionOperOpsTasksCount)");
    expect(source).toContain('<CRMKanban');
    expect(source).toContain('buildVoiceSessionTaskSourceRefs(sessionId, voiceBotSession)');
    expect(source).toContain("'voicebot/session_tab_counts'");
    expect(source).toContain('status_counts?: Array<{ status?: unknown; count?: unknown }>;');
    expect(source).toContain('source_ref: sessionTaskSourceRefs');
    expect(source).toContain('refreshToken={sessionTasksRefreshToken}');
  });

  it('keeps tasks tab before Screenshort and derives sub-tabs from actual task statuses', () => {
    const idxTasks = source.indexOf("key: 'operops_tasks'");
    const idxScreenshort = source.indexOf("key: 'screenshort'");

    expect(idxTasks).toBeGreaterThanOrEqual(0);
    expect(idxScreenshort).toBeGreaterThan(idxTasks);
    expect(source).toContain('const sessionTaskTabs = useMemo(');
    expect(source).toContain("key: entry.status");
    expect(source).toContain("label: renderTabLabel(entry.status, entry.count)");
    expect(source).toContain('task_status: activeSessionTaskStatuses');
    expect(source).not.toContain("{ key: 'work', label: renderTabLabel('Work', sessionWorkTasksCount) }");
    expect(source).not.toContain("{ key: 'review', label: renderTabLabel('Review', sessionReviewTasksCount) }");
  });

  it('falls back to the first available status tab when the selected status disappears', () => {
    expect(source).toContain('if (!sessionTasksSubTab || !hasActiveTab) {');
    expect(source).toContain("setSessionTasksSubTab(sessionTaskTabs[0]?.status || '')");
  });
});
