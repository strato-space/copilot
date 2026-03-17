import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('possible tasks save canonical items contract', () => {
  const source = readFileSync(
    resolve(process.cwd(), 'src/store/voiceBotStore.ts'),
    'utf8'
  );

  it('prefers canonical items returned by save_possible_tasks', () => {
    expect(source).toContain("const response = await voicebotHttp.request<unknown>(");
    expect(source).toContain("'voicebot/save_possible_tasks'");
    expect(source).toContain("refresh_mode: options?.refreshMode ?? 'full_recompute'");
    expect(source).toContain('const responseTasks = parsePossibleTasksResponse(response, defaultProjectId);');
    expect(source).toContain('if (responseTasks.length > 0) {');
    expect(source).toContain('canonicalTasks = responseTasks;');
  });

  it('routes session-page task generation through backend instead of direct browser MCP create_tasks', () => {
    expect(source).toContain("'voicebot/generate_possible_tasks'");
    expect(source).toContain('requestId: typeof responseRecord?.request_id === \'string\'');
  });
});
