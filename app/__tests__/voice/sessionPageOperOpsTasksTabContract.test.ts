import fs from 'node:fs';
import path from 'node:path';

describe('SessionPage OperOps tasks tab contract', () => {
  const pagePath = path.resolve(process.cwd(), 'src/pages/voice/SessionPage.tsx');
  const source = fs.readFileSync(pagePath, 'utf8');

  it("renders unified 'Задачи' tab with status-driven content for the current session", () => {
    expect(source).toContain("key: 'operops_tasks'");
    expect(source).toContain("label: renderTabLabel('Задачи', sessionTasksTotalCount, {");
    expect(source).toContain("showCount: sessionOperOpsTasksCount !== null");
    expect(source).toContain('const isDraftSessionTaskSubTab = activeSessionTaskStatuses.includes(\'DRAFT_10\');');
    expect(source).toContain('<PossibleTasks />');
    expect(source).toContain('<CRMKanban');
    expect(source).toContain('buildVoiceSessionTaskSourceRefs(sessionId, voiceBotSession)');
    expect(source).toContain("'voicebot/session_tab_counts'");
    expect(source).toContain('status_counts?: Array<{ status?: unknown; label?: unknown; count?: unknown }>;');
    expect(source).toContain('source_ref: sessionTaskSourceRefs');
    expect(source).toContain('refreshToken={sessionTasksRefreshToken}');
  });

  it('keeps tasks tab before Screenshort and derives fixed lifecycle sub-tabs from target status keys', () => {
    const idxTasks = source.indexOf("key: 'operops_tasks'");
    const idxScreenshort = source.indexOf("key: 'screenshort'");

    expect(idxTasks).toBeGreaterThanOrEqual(0);
    expect(idxScreenshort).toBeGreaterThan(idxTasks);
    expect(source).toContain("const VOICE_SESSION_UNKNOWN_STATUS_KEY = 'UNKNOWN' as const;");
    expect(source).toContain('const VOICE_SESSION_TASK_SUBTAB_KEYS = [...TARGET_TASK_STATUS_KEYS, VOICE_SESSION_UNKNOWN_STATUS_KEY] as const;');
    expect(source).toContain("const VOICE_SESSION_UNKNOWN_STATUS_LABEL = 'Unknown' as const;");
    expect(source).toContain('const sessionTaskTabs = useMemo<VoiceSessionTaskTab[]>(() => {');
    expect(source).toContain('return VOICE_SESSION_TASK_SUBTAB_KEYS');
    expect(source).toContain('.map((statusKey) => ({');
    expect(source).toContain("label: statusKey === VOICE_SESSION_UNKNOWN_STATUS_KEY ? VOICE_SESSION_UNKNOWN_STATUS_LABEL : TARGET_TASK_STATUS_LABELS[statusKey]");
    expect(source).toContain(".filter((entry) => entry.key !== VOICE_SESSION_UNKNOWN_STATUS_KEY || entry.count > 0)");
    expect(source).toContain("label: renderTabLabel(entry.label, entry.count)");
    expect(source).toContain('const sessionTasksTotalCount = useMemo(');
    expect(source).toContain('task_status: activeSessionTaskStatuses');
    expect(source).not.toContain("label: 'Work'");
    expect(source).not.toContain("label: 'Review'");
  });

  it('falls back to the first lifecycle status tab when the selected status disappears', () => {
    expect(source).toContain('const hasActiveTab = sessionTaskTabs.some((entry) => entry.key === sessionTasksSubTab);');
    expect(source).toContain('if (!sessionTasksSubTab || !hasActiveTab) {');
    expect(source).toContain("setSessionTasksSubTab(sessionTaskTabs[0]?.key || '')");
  });

  it('treats status_counts as the only session task breakdown contract', () => {
    expect(source).not.toContain('tasks_work_count?: unknown;');
    expect(source).not.toContain('tasks_review_count?: unknown;');
    expect(source).not.toContain('setSessionWorkTasksCount(');
    expect(source).not.toContain('setSessionReviewTasksCount(');
  });
});
