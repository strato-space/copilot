import fs from 'node:fs';
import path from 'node:path';

describe('Voice sessions include_deleted sync contract', () => {
  const pagePath = path.resolve(process.cwd(), 'src/pages/voice/SessionsListPage.tsx');
  const storePath = path.resolve(process.cwd(), 'src/store/voiceBotStore.ts');
  const pageSource = fs.readFileSync(pagePath, 'utf8');
  const storeSource = fs.readFileSync(storePath, 'utf8');

  it('forces list refetch when store includeDeleted differs from URL flag', () => {
    expect(pageSource).toContain('const shouldForceSyncIncludeDeleted =');
    expect(pageSource).toContain('sessionsListIncludeDeleted !== null && sessionsListIncludeDeleted !== showDeletedSessions');
    expect(pageSource).toContain('force: shouldForceSyncIncludeDeleted');
  });

  it('allows forced fetch while sessions list loading is in progress', () => {
    expect(storeSource).toContain('if (isSessionsListLoading && !force) return;');
  });

  it('does not keep stale sessions list cache between page opens', () => {
    expect(storeSource).not.toContain('if (!force && sessionsListLoadedAt && sessionsListIncludeDeleted === includeDeleted) return;');
  });

  it('sorts sessions by created_at before last_voice_timestamp to keep date ordering stable', () => {
    const createdSortSnippet = 'const leftCreatedTs = parseSessionTimestamp(left.created_at);';
    const lastVoiceSortSnippet = 'const leftLastVoiceTs = parseSessionTimestamp(left.last_voice_timestamp);';
    const activeSortSnippet = 'const leftActive = left.is_active === true ? 1 : 0;';
    expect(pageSource).toContain(createdSortSnippet);
    expect(pageSource).toContain(lastVoiceSortSnippet);
    expect(pageSource).not.toContain(activeSortSnippet);
    expect(pageSource.indexOf(createdSortSnippet)).toBeLessThan(pageSource.indexOf(lastVoiceSortSnippet));
  });

  it('renders state pictogram column and removes legacy active red dot in date cell', () => {
    expect(pageSource).toContain('type SessionProjectTab = \'all\' | \'without_project\' | \'active\' | \'mine\';');
    expect(pageSource).toContain("{ key: 'active', label: 'Активные' }");
    expect(pageSource).toContain("{ key: 'mine', label: 'Мои' }");
    expect(pageSource).not.toContain("STATUS: 'f_state'");
    expect(pageSource).not.toContain('placeholder=\"Все статусы\"');
    expect(pageSource).toContain("key: 'session_state'");
    expect(pageSource).toContain('width: 20');
    expect(pageSource).toContain('const resolveSessionVisualState = (');
    expect(pageSource).toContain("state === 'recording'");
    expect(pageSource).toContain("state === 'cutting'");
    expect(pageSource).toContain("state === 'paused'");
    expect(pageSource).toContain("state === 'final_uploading'");
    expect(pageSource).toContain("state === 'closed'");
    expect(pageSource).toContain("state === 'error'");
    expect(pageSource).toContain("if (state === 'closed') {");
    expect(pageSource).toContain('return null;');
    expect(pageSource).toContain('<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">');
    expect(pageSource).toContain('<circle cx="5" cy="5" r="3.6" fill="none" stroke="#64748b" strokeWidth="1.4" />');
    expect(pageSource).toContain("ready: 'Ready'");
    expect(pageSource).not.toContain("record.is_active ? (");
    expect(pageSource).not.toContain("rounded bg-red-500 -left-[4px]");
  });

  it('persists and restores sessions list filters from localStorage', () => {
    expect(pageSource).toContain("const SESSIONS_LIST_FILTERS_STORAGE_KEY = 'voicebot_sessions_list_filters_v1';");
    expect(pageSource).toContain('const PERSISTED_QUERY_KEYS = [');
    expect(pageSource).toContain('Failed to restore sessions list filters');
    expect(pageSource).toContain('Failed to persist sessions list filters');
    expect(pageSource).toContain('localStorage.setItem(SESSIONS_LIST_FILTERS_STORAGE_KEY');
    expect(pageSource).toContain('localStorage.getItem(SESSIONS_LIST_FILTERS_STORAGE_KEY)');
  });

  it('places show-deleted checkbox in tabs bar extra content', () => {
    expect(pageSource).toContain('tabBarExtraContent={(');
    expect(pageSource).toContain('Показывать удаленные');
    expect(pageSource).not.toContain('className=\"flex justify-end mb-2\"');
  });
});
