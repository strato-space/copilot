import fs from 'node:fs';
import path from 'node:path';

describe('webrtc paused restore contract', () => {
  const scriptPath = path.resolve(process.cwd(), 'public/webrtc/webrtc-voicebot-lib.js');
  const source = fs.readFileSync(scriptPath, 'utf8');

  it('persists paused state on unload whenever recording is not active', () => {
    expect(source).toContain('const persistedPaused = isPaused || readPausedHint() || !isRecording;');
    expect(source).toContain("const persistedState = persistedPaused ? 'paused' : 'recording';");
    expect(source).toContain('persistVoicebotState(persistedState)');
  });

  it('documents deterministic refresh recovery for paused state', () => {
    expect(source).toContain('Keep refresh recovery deterministic: any non-recording state must restore as paused');
    expect(source).toContain('prevents stale "recording" writes during unload races');
  });
});
