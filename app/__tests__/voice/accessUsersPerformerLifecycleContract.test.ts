import fs from 'node:fs';
import path from 'node:path';

describe('AccessUsers performer lifecycle contract', () => {
  const modalPath = path.resolve(process.cwd(), 'src/components/voice/AccessUsersModal.tsx');
  const modalSource = fs.readFileSync(modalPath, 'utf8');
  const storePath = path.resolve(process.cwd(), 'src/store/voiceBotStore.ts');
  const storeSource = fs.readFileSync(storePath, 'utf8');

  it('fetches selectable users with include_ids to preserve historical assignments', () => {
    expect(modalSource).toContain('void fetchPerformersList(accessUsersModal.selectedUserIds);');
    expect(storeSource).toContain('fetchPerformersList: async (includeIds = []) => {');
    expect(storeSource).toContain('const payload = normalizedIncludeIds.length > 0');
    expect(storeSource).toContain("voicebotHttp.request<Array<Record<string, unknown>>>('voicebot/auth/list-users', payload)");
  });

  it('hides inactive/deleted users from add-user dropdown', () => {
    expect(modalSource).toContain('isPerformerSelectable(user) &&');
  });
});
