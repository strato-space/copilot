import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from '@jest/globals';

describe('Voicebot utility routes parity contract', () => {
  const routePath = path.resolve(process.cwd(), 'src/api/routes/voicebot/sessions.ts');
  const source = fs.readFileSync(routePath, 'utf8');

  it('keeps utility endpoints required by voicebot parity', () => {
    expect(source).toContain("router.post('/create_tickets'");
    expect(source).toContain("router.post('/save_possible_tasks'");
    expect(source).toContain("router.post('/process_possible_tasks'");
    expect(source).toContain("router.post('/codex_tasks'");
    expect(source).toContain("router.post('/possible_tasks'");
    expect(source).toContain("router.post('/delete_task_from_session'");
    expect(source).toContain("router.post('/task_types'");
    expect(source).toContain("router.post('/topics'");
    expect(source).toContain("router.post('/save_custom_prompt_result'");
    expect(source).toContain("router.post('/save_summary'");
    expect(source).toContain("router.post('/get_project_files'");
    expect(source).toContain("router.post('/get_all_project_files'");
    expect(source).toContain("router.post('/upload_file_to_project'");
    expect(source).toContain("router.post('/get_file_content'");
    expect(source).toContain("router.post('/upload_progress/:message_id'");
  });

  it('routes codex tasks via bd sync and keeps runtime-aware metadata for non-codex tasks', () => {
    expect(source).toContain('runtime_tag: RUNTIME_TAG');
    expect(source).toContain("source: 'VOICE_BOT'");
    expect(source).toContain('source_data: {');
    expect(source).toContain('session_id: new ObjectId(sessionId)');
    expect(source).toContain('const codexTasksToSync: Array<CodexIssueSyncInput> = [];');
    expect(source).toContain('const filteredTasksToSave = tasksToSave.filter(({ task }) => {');
    expect(source).toContain('[voicebot.create_tickets] dropped codex task before insertMany');
    expect(source).toContain('await db.collection(COLLECTIONS.TASKS).deleteMany(');
    expect(source).toContain('external_ref: canonicalExternalRef');
    expect(source).toContain('codex_task: true');
    expect(source).toContain('const issueId = await createBdIssue({');
  });

  it('normalizes save_create_tasks payload into canonical task fields', () => {
    expect(source).toContain('normalizeCreateTaskForStorage');
    expect(source).toContain("'agent_results.create_tasks': normalizedTasks");
    expect(source).toContain('name: toTaskText(rawTask.name)');
  });

  it('publishes canonical session taskflow contract for MCP/client parity', () => {
    expect(source).toContain('export const SESSION_TASKFLOW_CONTRACT = {');
    expect(source).toContain('export const SESSION_DONE_REST_CONTRACT = {');
    expect(source).toContain('const emitSessionTaskflowRefreshHint = ({');
    expect(source).toContain("canonical_field: SESSION_TASKFLOW_CANONICAL_ROW_ID_FIELD");
    expect(source).toContain("compatibility_input_aliases: [...SESSION_TASKFLOW_ROW_ID_ALIAS_FIELDS]");
    expect(source).toContain('delete_input_aliases: []');
    expect(source).toContain("remove_from_possible_tasks: {");
    expect(source).toContain("operation_status: ['success', 'partial', 'failed']");
    expect(source).toContain("body: { error: 'runtime_mismatch' }");
    expect(source).toContain("canonical_route: {");
    expect(source).toContain("path: '/voicebot/session_done'");
    expect(source).toContain("path: '/voicebot/close_session'");
    expect(source).toContain("use_only_for: 'route_absence'");
    expect(source).toContain("'session_not_found'");
    expect(source).toContain("'chat_id_missing'");
    expect(source).toContain("tools_voice_response_keys: ['ok', 'session_id', 'url', 'source']");
    expect(source).toContain("optional_passthrough: ['notify_preview.event_name']");
    expect(source).toContain('client_timeout_seconds: 5');
    expect(source).toContain('compatibility_fallback_only_for_route_absence: true');
    expect(source).toContain('no_automatic_retry: true');
    expect(source).toContain('taskflow_refresh: {');
    expect(source).toContain("reason: 'create_tickets'");
    expect(source).toContain("reason: 'save_possible_tasks'");
    expect(source).toContain("refreshReason: 'process_possible_tasks'");
    expect(source).toContain("reason: 'delete_task_from_session'");
    expect(source).toContain("reason: 'save_summary'");
    expect(source).toContain('summary: true');
    expect(source).toContain("return res.status(200).json({");
    expect(source).toContain('matched_count: result.matchedCount');
    expect(source).toContain('deleted_count: result.modifiedCount > 0 ? 1 : 0');
  });

  it('reads canonical possible tasks from automation_tasks master rows with session hydration fallback', () => {
    expect(source).toContain('buildVoicePossibleTaskMasterQuery');
    expect(source).toContain('normalizeVoicePossibleTaskDocForApi');
    expect(source).toContain('listPossibleTaskMasterDocs({ db, sessionId })');
    expect(source).toContain('hydrateSessionPossibleTasksFromMaster');
    expect(source).toContain("reason: 'save_possible_tasks'");
  });

  it('enforces project access checks for project-files endpoints', () => {
    expect(source).toContain("canAccessProjectFiles({ db, performer })");
    expect(source).toContain("canAccessProject({ db, performer, projectId })");
  });
});
