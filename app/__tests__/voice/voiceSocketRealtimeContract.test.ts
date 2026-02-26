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
    expect(source).toContain('const upsertVoiceBotMessage =');
    expect(source).toContain('const sortVoiceBotMessages =');
    expect(source).toContain('const updatedMessages = upsertVoiceBotMessage(state.voiceBotMessages, data)');
    expect(source).toContain('const updatedMessages = upsertVoiceBotMessage(state.voiceBotMessages, data.message as VoiceBotMessage)');
  });

  it('handles session_status done_queued to update local session state without refresh', () => {
    expect(source).toContain("socket.on(\n                'session_status'");
    expect(source).toContain("if (data?.status === 'done_queued')");
    expect(source).toContain('is_active: false');
    expect(source).toContain('to_finalize: true');
  });

  it('closes session through REST API and reports backend close errors', () => {
    expect(source).toContain("await voicebotRequest('voicebot/session_done', { session_id: normalizedSessionId });");
    expect(source).toContain("message.error(errorText ? `Done failed: ${errorText}` : 'Done failed');");
    expect(source).not.toContain('SOCKET_EVENTS.SESSION_DONE');
  });
});
