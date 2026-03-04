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

  it('exposes saveSessionSummary action bound to save_summary endpoint and patches canonical session summary fields', () => {
    expect(source).toContain('saveSessionSummary: (');
    expect(source).toContain("saveSessionSummary: async (payload, options) => {");
    expect(source).toContain("voicebot/save_summary");
    expect(source).toContain('summary_md_text: savedText');
    expect(source).toContain('summary_saved_at: savedAt');
    expect(source).toContain('session_id: string; md_text: string');
  });
});
