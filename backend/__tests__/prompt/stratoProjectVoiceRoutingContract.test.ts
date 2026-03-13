import fs from 'node:fs';

import { describe, expect, it } from '@jest/globals';

describe('StratoProject voice routing contract', () => {
  it('requires chat-members crosswalk resolution and Copilot fail-closed fallback for explicit sessions', () => {
    const source = fs.readFileSync('/home/strato-space/prompt/StratoProject/project.md', 'utf8');

    expect(source).toContain('/home/strato-space/settings/chat-members.json');
    expect(source).toContain('canonical_project_id');
    expect(source).toContain('project-crosswalk');
    expect(source).toContain('fail-closed fallback');
    expect(source).toContain('topic = "Copilot"');
    expect(source).toContain('никогда не относить такую сессию к client/DBI bucket только по тексту транскрипта');
  });
});
