import fs from 'node:fs';
import path from 'node:path';

describe('voiceBotStore summarize endpoint contract', () => {
  const storePath = path.resolve(process.cwd(), 'src/store/voiceBotStore.ts');
  const source = fs.readFileSync(storePath, 'utf8');

  it('exposes triggerSessionReadyToSummarize action bound to flat endpoint', () => {
    expect(source).toContain('triggerSessionReadyToSummarize: (sessionId: string) => Promise<Record<string, unknown>>;');
    expect(source).toContain("triggerSessionReadyToSummarize: async (sessionId) => {");
    expect(source).toContain("voicebot/trigger_session_ready_to_summarize");
    expect(source).toContain("session_id: sessionId");
  });
});
