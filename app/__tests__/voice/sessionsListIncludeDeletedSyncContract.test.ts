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
});
