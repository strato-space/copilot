import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from '@jest/globals';

describe('Voicebot utility routes parity contract', () => {
  const routePath = path.resolve(process.cwd(), 'src/api/routes/voicebot/sessions.ts');
  const source = fs.readFileSync(routePath, 'utf8');

  it('keeps utility endpoints required by voicebot parity', () => {
    expect(source).toContain("router.post('/create_tickets'");
    expect(source).toContain("router.post('/delete_task_from_session'");
    expect(source).toContain("router.post('/task_types'");
    expect(source).toContain("router.post('/topics'");
    expect(source).toContain("router.post('/save_custom_prompt_result'");
    expect(source).toContain("router.post('/get_project_files'");
    expect(source).toContain("router.post('/get_all_project_files'");
    expect(source).toContain("router.post('/upload_file_to_project'");
    expect(source).toContain("router.post('/get_file_content'");
    expect(source).toContain("router.post('/upload_progress/:message_id'");
  });

  it('persists runtime-aware task creation metadata for create_tickets', () => {
    expect(source).toContain('runtime_tag: RUNTIME_TAG');
    expect(source).toContain("source: 'VOICE_BOT'");
    expect(source).toContain('source_data: {');
    expect(source).toContain('session_id: new ObjectId(sessionId)');
    expect(source).toContain("codex_review_state: 'deferred'");
    expect(source).toContain('codex_review_due_at: new Date(now.getTime() + CODEX_REVIEW_DEFERRED_WINDOW_MS)');
  });

  it('normalizes save_create_tasks payload into canonical task fields', () => {
    expect(source).toContain('normalizeCreateTaskForStorage');
    expect(source).toContain("'agent_results.create_tasks': normalizedTasks");
    expect(source).toContain("toTaskText(rawTask['Task Title'])");
  });

  it('enforces project access checks for project-files endpoints', () => {
    expect(source).toContain("canAccessProjectFiles({ db, performer })");
    expect(source).toContain("canAccessProject({ db, performer, projectId })");
  });
});
