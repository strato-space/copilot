import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from '@jest/globals';

describe('update_project notify context contract', () => {
  const routePath = path.resolve(process.cwd(), 'src/api/routes/voicebot/sessions.ts');
  const source = fs.readFileSync(routePath, 'utf8');

  it('emits project-assignment notify metadata only on actual project_id change', () => {
    expect(source).toContain('const projectChanged = oldProjectId !== projectId;');
    expect(source).toContain('if (projectChanged) {');
    expect(source).toContain('VOICEBOT_JOBS.notifies.SESSION_PROJECT_ASSIGNED');
    expect(source).toContain('old_project_id: oldProjectId');
    expect(source).toContain("source: 'project_update'");
  });

  it('does not tie project-assignment notify path to session rename route', () => {
    const start = source.indexOf("router.post('/update_name'");
    const end = source.indexOf("router.post('/update_project'");
    const updateNameSection = source.slice(start, end);

    expect(updateNameSection).toContain("router.post('/update_name'");
    expect(updateNameSection).not.toContain('insertSessionLogEvent');
    expect(updateNameSection).not.toContain('notify_payload');
    expect(updateNameSection).not.toContain('old_project_id');
  });
});
