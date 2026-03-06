import fs from 'node:fs';
import path from 'node:path';

describe('Voice socket realtime contract', () => {
  const sourcePath = path.resolve(process.cwd(), 'src/store/voiceBotStore.ts');
  const source = fs.readFileSync(sourcePath, 'utf8');

  it('rehydrates session after socket reconnect', () => {
    expect(source).toContain("socket.on('connect'");
    expect(source).toContain('fetchVoiceBotSession(activeSessionId)');
    expect(source).toContain('Failed to rehydrate voice session after reconnect');
  });

  it('upserts realtime messages and keeps chronological sort', () => {
    expect(source).toContain('const messageListUtils = {');
    expect(source).toContain('sort(messages: VoiceBotMessage[]): VoiceBotMessage[] {');
    expect(source).toContain('const updatedMessages = messageListUtils.upsert(state.voiceBotMessages, data)');
    expect(source).toContain('const updatedMessages = messageListUtils.upsert(state.voiceBotMessages, data.message as VoiceBotMessage)');
  });

  it('handles session_status done_queued to update local session state without refresh', () => {
    expect(source).toContain("socket.on(\n                'session_status'");
    expect(source).toContain("if (data?.status === 'done_queued')");
    expect(source).toContain('is_active: false');
    expect(source).toContain('to_finalize: true');
  });

  it('consumes taskflow_refresh hints to refresh possible-tasks data and bump tab refresh tokens', () => {
    expect(source).toContain("socket.on('session_update'");
    expect(source).toContain('const refreshHint = data?.taskflow_refresh');
    expect(source).toContain('const shouldRefreshPossibleTasks = Boolean(refreshHint?.possible_tasks);');
    expect(source).toContain('const shouldRefreshSummary = Boolean(refreshHint?.summary);');
    expect(source).toContain('nextState.sessionTasksRefreshToken = state.sessionTasksRefreshToken + 1;');
    expect(source).toContain('nextState.sessionCodexRefreshToken = state.sessionCodexRefreshToken + 1;');
    expect(source).toContain('get().fetchSessionPossibleTasks(activeSessionId, { silent: true })');
    expect(source).toContain('get().getSessionData(activeSessionId)');
    expect(source).toContain('Failed to refresh voice session possible tasks after realtime hint');
    expect(source).toContain('Failed to refresh voice session summary after realtime hint');
  });

  it('uses additive refresh token increments so repeated taskflow hints stay concurrency-safe', () => {
    expect(source).toContain('nextState.sessionTasksRefreshToken = state.sessionTasksRefreshToken + 1;');
    expect(source).toContain('nextState.sessionCodexRefreshToken = state.sessionCodexRefreshToken + 1;');
    expect(source).not.toContain('nextState.sessionTasksRefreshToken = 1;');
    expect(source).not.toContain('nextState.sessionCodexRefreshToken = 1;');
  });

  it('closes session through REST API and reports backend close errors', () => {
    expect(source).toContain("await voicebotHttp.request('voicebot/session_done', { session_id: normalizedSessionId });");
    expect(source).toContain("message.error(errorText ? `Done failed: ${errorText}` : 'Done failed');");
    expect(source).not.toContain('SOCKET_EVENTS.SESSION_DONE');
  });
});
