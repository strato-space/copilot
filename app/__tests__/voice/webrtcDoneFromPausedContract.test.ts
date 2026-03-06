import fs from 'node:fs';
import path from 'node:path';

describe('webrtc fab done double-click contract', () => {
  const scriptPath = path.resolve(process.cwd(), 'public/webrtc/webrtc-voicebot-lib.js');
  const source = fs.readFileSync(scriptPath, 'utf8');

  it('allows Done by double-click when recording or paused', () => {
    expect(source).toContain("fabButton.addEventListener('dblclick'");
    expect(source).toContain('if (!isRecording && !isPaused) return;');
    expect(source).toContain("dispatchControlAction('done');");
  });

  it('delays paused single-click resume so double-click can still resolve to Done', () => {
    expect(source).toContain('if (isRecording || isPaused) {');
    expect(source).toContain('if (isRecording) {');
    expect(source).toContain('handleFabToggle();');
    expect(source).toContain('}, clickDelayMs);');
  });

  it('keeps page Done enabled in Paused when active/session context exists', () => {
    expect(source).toContain("const canPageDone = hasToken && !finalUploading && (hasPageSession || hasActiveSession || hasSession);");
  });

});
