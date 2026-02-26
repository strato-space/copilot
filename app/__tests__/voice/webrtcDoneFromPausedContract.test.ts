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
});

