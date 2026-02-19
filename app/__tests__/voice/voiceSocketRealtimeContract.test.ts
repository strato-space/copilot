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
});

