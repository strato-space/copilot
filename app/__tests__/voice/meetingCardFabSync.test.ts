import fs from 'node:fs';
import path from 'node:path';

describe('MeetingCard FAB sync contract', () => {
  const componentPath = path.resolve(process.cwd(), 'src/components/voice/MeetingCard.tsx');
  const source = fs.readFileSync(componentPath, 'utf8');

  it('syncs active session id via localStorage and global event channel', () => {
    expect(source).toContain("const SESSION_ID_STORAGE_KEY = 'VOICEBOT_ACTIVE_SESSION_ID';");
    expect(source).toContain("window.localStorage.getItem(SESSION_ID_STORAGE_KEY)");
    expect(source).toContain("window.addEventListener('voicebot:active-session-updated', onActiveSessionUpdated as EventListener);");
    expect(source).toContain("window.dispatchEvent(new CustomEvent('voicebot:active-session-updated', {");
  });

  it('routes Rec through activateSession before FAB control and preserves New/Rec/Cut/Pause/Done controls', () => {
    expect(source).toContain('ensurePageSessionActive: true');
    expect(source).toContain('const activated = await activateSession(voiceBotSession._id);');
    expect(source).toContain("action: 'rec'");
    expect(source).toContain("action: 'new'");
    expect(source).toContain("action: 'cut'");
    expect(source).toContain("action: 'pause'");
    expect(source).toContain("action: 'done'");
  });

  it('routes page Done by explicit page session id when FAB is not actively recording that same session', () => {
    expect(source).toContain('const pageSessionId = String(voiceBotSession._id || \'\').trim();');
    expect(source).toContain('const shouldFinalizeViaFab =');
    expect(source).toContain('isThisSessionActiveInFab && (fabIsRecording || fabIsPaused || fabIsFinalUploading)');
    expect(source).toContain('finishSession(pageSessionId);');
    expect(source).toContain('Session-page Done must close explicit pageSessionId');
  });
});
